/**
 * Shared helpers for the bridge examples (09 base→solana, 10 solana→base) —
 * chain clients, env/secret loading, balance checks, and the recovery path.
 * Secrets are read from the environment and never printed.
 */
import type { Cesto } from '@cesto/sdk';
import type { BridgeMode, BridgeTransfer } from '@cesto/sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  type Address,
  type Hex,
  createPublicClient,
  decodeFunctionData,
  formatUnits,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

import { requireEnv } from './client';

export { requireEnv } from './client';

// ── Constants ─────────────────────────────────────────────────────────────────

export const SOLANA_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export const usdc = (baseUnits: bigint | string) => formatUnits(BigInt(baseUnits), 6);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** USDC base units per run (default 1000000 = 1 USDC). */
export const bridgeAmount = () => process.env.BRIDGE_AMOUNT_BASE_UNITS ?? '1000000';
export const bridgeMode = (): BridgeMode =>
  process.env.BRIDGE_MODE === 'standard' ? 'standard' : 'fast';

// ── Clients ───────────────────────────────────────────────────────────────────

// Base's official public endpoint. It rate-limits bursts, which is why
// `waitForAllowance` polls — but it does serve the reads these examples make.
//
// It previously defaulted to `base-rpc.publicnode.com`, chosen for burst
// tolerance, which rejects `eth_call` at anything but the latest block with
// `-32602 Archive requests require a personal token`. Every Base-source bridge
// example failed on it out of the box, and the failure surfaced as an allowance
// timeout rather than as an RPC error. Override with BASE_RPC_URL if you have a
// dedicated endpoint — recommended for anything beyond trying the examples.
export const BASE_RPC = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';

// A client bound to `base` is not assignable to viem's default PublicClient
// generic (OP-stack tx shapes) — infer the concrete type from a factory.
export function makeBaseClient() {
  return createPublicClient({ chain: base, transport: http(BASE_RPC) });
}
export type BaseClient = ReturnType<typeof makeBaseClient>;

export function solanaRpc(): string {
  return process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
}

// ── Wallet loading (secrets never logged) ─────────────────────────────────────

export function loadEvmAccount() {
  return privateKeyToAccount(requireEnv('EVM_USER_PRIVATE_KEY').trim() as Hex);
}

/** Fail loudly when a loaded key does not derive the funded address. */
export function assertAddress(label: string, derived: string, expectedEnv: string): void {
  const expected = process.env[expectedEnv]?.trim();
  if (expected && derived.toLowerCase() !== expected.toLowerCase()) {
    console.error(`${label} key derives ${derived} but ${expectedEnv}=${expected} — fix .env`);
    process.exit(1);
  }
}

/** Guard for examples that spend real funds: require an explicit --yes. */
export function confirmOrExit(script: string): void {
  if (process.argv.includes('--yes')) return;
  console.log('This example bridges REAL USDC on Solana + Base mainnet.');
  console.log('Re-run with --yes to proceed, e.g.:');
  console.log(`  pnpm ${script} --yes`);
  process.exit(0);
}

// ── Balances ──────────────────────────────────────────────────────────────────

export async function solanaBalances(connection: Connection, owner: PublicKey) {
  const [sol, tokenAccounts] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { mint: SOLANA_USDC_MINT }),
  ]);
  const usdcBalance = tokenAccounts.value.reduce(
    (sum, { account }) => sum + BigInt(account.data.parsed.info.tokenAmount.amount),
    0n,
  );
  return { sol, usdcBalance };
}

export function evmBalances(client: BaseClient, owner: Address) {
  return Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({
      address: BASE_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner],
    }),
  ] as const);
}

// ── Shared flow steps ─────────────────────────────────────────────────────────

/** submitBurn can 404 while Circle indexes a fresh burn — retry a few times. */
export async function submitBurnWithRetry(cesto: Cesto, transferId: string, burnTxHash: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await cesto.bridge.submitBurn(transferId, { burnTxHash });
    } catch (error) {
      if (attempt >= 6) {
        throw new Error(
          `submitBurn failed after ${attempt - 1} attempts (${error instanceof Error ? error.message : String(error)}). ` +
            `Recover with: --resume ${transferId} ${burnTxHash} (either bridge script)`,
        );
      }
      console.log(`   submitBurn attempt ${attempt} failed (burn not indexed yet?) — retrying in 4s…`);
      await sleep(4000);
    }
  }
}

/**
 * The spender an `approve(address,uint256)` calldata grants to.
 *
 * NOT `approvalTx.to`. That is the USDC contract — the address an approve call
 * is SENT to. The spender is approve's first argument (CCTP's TokenMessenger).
 *
 * Passing `approvalTx.to` as the spender made `waitForAllowance` poll
 * `allowance(owner, USDC)`, which is 0 and always will be, so every first-time
 * Base-source bridge timed out after 40s on an approval that had landed
 * correctly and granted exactly the right allowance.
 */
export function approvalSpender(data: Hex): Address {
  const { args } = decodeFunctionData({
    abi: parseAbi(['function approve(address spender, uint256 amount)']),
    data,
  });
  return args[0] as Address;
}

/**
 * Wait until a fresh USDC allowance is readable (load-balanced RPCs lag, and
 * public endpoints rate-limit bursts — both are transient, so keep polling).
 */
export async function waitForAllowance(
  client: BaseClient,
  owner: Address,
  spender: Address,
  needed: bigint,
) {
  let lastError: unknown;
  for (let i = 0; i < 20; i++) {
    try {
      const allowance = await client.readContract({
        address: BASE_USDC,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [owner, spender],
      });
      if (allowance >= needed) return;
    } catch (error) {
      // Keep polling — a rate limit or timeout here is genuinely transient.
      // But REMEMBER the error: swallowing it entirely turned "this endpoint
      // cannot serve eth_call" into a 40s allowance timeout, which points the
      // reader at their approval instead of at their RPC.
      lastError = error;
    }
    await sleep(2000);
  }
  const detail =
    lastError instanceof Error ? ` Last RPC error: ${lastError.message}` : '';
  throw new Error(
    `USDC allowance not readable after ~40s via ${BASE_RPC}. The approval already ` +
      `landed but no USDC moved — re-run the script to continue, or set BASE_RPC_URL ` +
      `to an endpoint that serves eth_call.${detail}`,
  );
}

// ── Recovery ──────────────────────────────────────────────────────────────────

export function printCompleted(t: BridgeTransfer): void {
  const explorer = t.destChain.startsWith('solana')
    ? `https://solscan.io/tx/${t.mintTxHash}`
    : `https://basescan.org/tx/${t.mintTxHash}`;
  console.log(`COMPLETED: netOut=${usdc(t.netOut ?? '?')} mint: ${explorer}`);
}

/**
 * Recovery path for an interrupted run. A landed burn is never lost: either
 * re-register it (the API never saw it) or simply keep waiting — the server
 * drives attestation + the relayer mint in the background. FAILED transfers
 * print the reason plus manual-recovery instructions.
 */
export async function resumeTransfer(cesto: Cesto, transferId: string, burnTxHash?: string) {
  const transfer = await cesto.bridge.getTransfer(transferId);
  console.log(`transfer ${transferId}: ${transfer.status} (${transfer.sourceChain} → ${transfer.destChain})`);

  if (transfer.status === 'COMPLETED') {
    printCompleted(transfer);
    return;
  }
  if (transfer.status === 'FAILED') {
    console.error(`transfer FAILED: ${transfer.error ?? 'no reason recorded'}`);
    console.error('A landed burn is never lost — Circle attestations do not expire.');
    console.error('Contact Cesto support with the transferId to re-drive the mint.');
    process.exit(1);
  }
  if (transfer.status === 'BURN_TX_BUILT') {
    if (!burnTxHash) {
      console.error('The API never registered the burn. Re-run with the landed burn tx hash:');
      console.error(`  --resume ${transferId} <burnTxHash>`);
      process.exit(1);
    }
    console.log('re-submitting the landed burn…');
    await submitBurnWithRetry(cesto, transferId, burnTxHash);
  }

  console.log('waiting for attestation + destination mint…');
  printCompleted(await cesto.bridge.waitForTransfer(transferId));
}

/**
 * Parse `--resume <transferId> [burnTxHash]` from argv. Returns null when the
 * flag is absent; exits with usage when present but malformed.
 */
export function resumeArgs(): { transferId: string; burnTxHash?: string } | null {
  const idx = process.argv.indexOf('--resume');
  if (idx === -1) return null;
  const transferId = process.argv[idx + 1];
  const burnTxHash = process.argv[idx + 2];
  if (!transferId || transferId.startsWith('--')) {
    console.error('Usage: --resume <transferId> [burnTxHash]');
    process.exit(1);
  }
  return { transferId, burnTxHash: burnTxHash?.startsWith('--') ? undefined : burnTxHash };
}
