/**
 * 09 — Bridge USDC from Base to Solana (Circle CCTP, mainnet).
 *
 * The partner onboarding flow: a user's USDC on Base arrives in their Solana
 * wallet, ready to invest. Five steps:
 *
 *   1. quote       fees, ETA, and whether the recipient's USDC ATA exists
 *   2. initiate    creates the transfer, returns the unsigned burn
 *   3. sign        the wallet approves (if needed) + burns on Base
 *   4. submitBurn  Cesto verifies the burn against Circle's attestation
 *   5. wait        Circle attests → Cesto's relayer mints on Solana
 *
 * The destination leg is fully gasless for the user: the relayer pays the mint
 * and, on a first transfer, creates the recipient's USDC token account (rent
 * included) — the recipient needs no SOL. The source burn is signed and paid
 * by the source wallet itself (non-custodial — Cesto never sees the key).
 *
 * Setup (.env):
 *   CESTO_API_KEY            write-scoped key
 *   EVM_USER_PRIVATE_KEY     0x-prefixed key holding USDC + a little Base ETH
 *   EVM_WALLET_ADDRESS       its address — verified before funds move
 *   WALLET_ADDRESS           Solana recipient wallet (NOT a token account)
 *   BRIDGE_AMOUNT_BASE_UNITS optional, default 1000000 (= 1 USDC)
 *   BRIDGE_MODE              'fast' (default, ~1bps, seconds) | 'standard'
 *                            (lossless, ~15–20 min of EVM finality)
 *
 * Run:
 *   pnpm byow:bridge:base-to-solana --yes
 *   pnpm byow:bridge:base-to-solana --resume <transferId> [burnTxHash]
 *
 * If the run dies after the burn lands, nothing is stuck: attestations never
 * expire. Re-run with --resume to re-register the burn or keep waiting.
 */

import { BridgeTransferFailedError } from '@cesto/sdk';
import { type Address, type Hex, createWalletClient, formatEther, http } from 'viem';
import { base } from 'viem/chains';

import {
  BASE_RPC,
  assertAddress,
  bridgeAmount,
  bridgeMode,
  confirmOrExit,
  evmBalances,
  loadEvmAccount,
  makeBaseClient,
  printCompleted,
  requireEnv,
  resumeArgs,
  resumeTransfer,
  submitBurnWithRetry,
  usdc,
  waitForAllowance,
} from '../lib/bridge';
import { createClient } from '../lib/client';

async function main() {
  const resume = resumeArgs();
  if (resume) {
    await resumeTransfer(createClient(), resume.transferId, resume.burnTxHash);
    return;
  }

  confirmOrExit('byow:bridge:base-to-solana');

  const amount = bridgeAmount();
  const mode = bridgeMode();
  const cesto = createClient();
  const evmAccount = loadEvmAccount();
  assertAddress('EVM', evmAccount.address, 'EVM_WALLET_ADDRESS');
  const recipient = requireEnv('WALLET_ADDRESS').trim();
  const publicClient = makeBaseClient();

  console.log('─'.repeat(72));
  console.log(`Base → Solana | ${usdc(amount)} USDC | mode=${mode}`);
  console.log(`from (signer) : ${evmAccount.address}`);
  console.log(`to (recipient): ${recipient}`);
  console.log('─'.repeat(72));

  const [eth, usdcBalance] = await evmBalances(publicClient, evmAccount.address);
  console.log(`balances: ${formatEther(eth)} ETH, ${usdc(usdcBalance)} USDC`);
  if (eth === 0n) throw new Error('No Base ETH for gas on the EVM wallet');
  if (usdcBalance < BigInt(amount)) throw new Error('Insufficient Base USDC');

  // ── 1. Quote — fees, ETA, ATA existence. Creates nothing. ──────────────────
  const quote = await cesto.bridge.quote({ sourceChain: 'base', destChain: 'solana', amount, recipient, mode });
  console.log(
    `quote: netOut=${usdc(quote.netOut)} estimatedFee=${usdc(quote.estimatedFee)} ` +
      `eta=${quote.etaSeconds}s ataExists=${quote.ataExists}`,
  );

  // ── 2. Initiate — creates the transfer, returns the unsigned burn. ─────────
  const { transferId, burn } = await cesto.bridge.initiate({
    sourceChain: 'base',
    destChain: 'solana',
    amount,
    recipient,
    mode,
    sourceAddress: evmAccount.address, // the wallet that will sign the burn
  });
  if (burn?.kind !== 'evm') throw new Error('expected an EVM burn payload');
  console.log(`transfer ${transferId} — signing burn on Base…`);

  const walletClient = createWalletClient({ account: evmAccount, chain: base, transport: http(BASE_RPC) });

  // ── 3. Sign + land the burn on Base. ───────────────────────────────────────
  // approvalTx is present only when the USDC allowance is insufficient. It
  // MUST be confirmed — and readable — before the burn, or the burn reverts
  // with `ERC20: transfer amount exceeds allowance` (load-balanced RPCs lag).
  if (burn.approvalTx) {
    const approveHash = await walletClient.sendTransaction({
      to: burn.approvalTx.to as Address,
      data: burn.approvalTx.data as Hex,
      value: BigInt(burn.approvalTx.value),
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log(`approval: https://basescan.org/tx/${approveHash}`);
    await waitForAllowance(publicClient, evmAccount.address, burn.approvalTx.to as Address, BigInt(amount));
  } else {
    console.log('(allowance already sufficient — skipping approval)');
  }

  const burnTxHash = await walletClient.sendTransaction({
    to: burn.burnTx.to as Address,
    data: burn.burnTx.data as Hex,
    value: BigInt(burn.burnTx.value),
    ...(burn.burnTx.gasLimit ? { gas: BigInt(burn.burnTx.gasLimit) } : {}),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: burnTxHash });
  if (receipt.status !== 'success') throw new Error(`burn reverted: ${burnTxHash}`);
  console.log(`burn: https://basescan.org/tx/${burnTxHash}`);

  // ── 4. Report the burn — Cesto verifies it against Circle before acting. ───
  await submitBurnWithRetry(cesto, transferId, burnTxHash);
  console.log('burn verified — Cesto is driving attestation + mint in the background');

  // ── 5. Wait for the Solana mint (relayer-paid). ────────────────────────────
  printCompleted(await cesto.bridge.waitForTransfer(transferId));
}

main().catch((error) => {
  if (error instanceof BridgeTransferFailedError) {
    console.error(`\n❌ transfer ${error.transferId} FAILED: ${error.reason ?? 'no reason recorded'}`);
    console.error('A landed burn is never lost — attestations do not expire. Re-run with:');
    console.error(`  pnpm byow:bridge:base-to-solana --resume ${error.transferId}`);
  } else {
    console.error('\n❌ bridge failed:', error);
  }
  process.exit(1);
});
