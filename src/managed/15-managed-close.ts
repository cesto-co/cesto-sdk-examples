/**
 * 15 — Close the managed position AND withdraw the proceeds to the user's EVM
 * wallet: the full custody loop, with no user signature anywhere.
 *
 *   1. `close.startAndWait` sells the managed wallet's full holding of the
 *      basket back to USDC, server-signed by the managed Privy wallet. No
 *      `consent` — see 13-managed-open.ts for why that field is the whole
 *      difference between the two server-signed flows.
 *   2. `bridge.initiate` (solana → base) from the managed address. Managed
 *      burns are auto-signed and landed server-side (sponsor pays gas), so the
 *      response is `{ status: 'BURN_SUBMITTED', burn: null, burnTxHash }` —
 *      asserted with the `isAutoSubmittedBurn` guard. Never call `submitBurn`
 *      for a managed burn.
 *   3. `waitForTransfer` polls until the relayer-paid mint lands on Base, then
 *      the Base USDC balance is re-read to verify the withdrawal arrived.
 *
 * Run: PRODUCT_SLUG=solana-maxi-portfolio pnpm managed:close --yes
 */
import { BridgeTransferFailedError, isAutoSubmittedBurn } from '@cesto/sdk';
import { Connection, PublicKey } from '@solana/web3.js';

import {
  bridgeMode,
  evmBalances,
  makeBaseClient,
  printCompleted,
  solanaBalances,
  solanaRpc,
  usdc,
} from '../lib/bridge';
import { confirmOrExit, createClient, requireEnv } from '../lib/client';
import { printExecution } from '../lib/wallet';

async function main() {
  const cesto = createClient();
  // No universal default — pick a basket from `pnpm byow:products` and set it in .env.
  const slug = requireEnv('PRODUCT_SLUG').trim();
  const evmWalletAddress = requireEnv('EVM_WALLET_ADDRESS').trim() as `0x${string}`;

  confirmOrExit(
    `closes the managed position in "${slug}" and bridges the proceeds back to ${evmWalletAddress} on Base`,
  );

  const managed = await cesto.users.get(evmWalletAddress);
  console.log(`managed wallet: ${managed.solanaAddress}`);

  const before = await cesto.positions.getHoldings({ wallet: managed.solanaAddress, product: slug });
  console.log(`before: hasPosition=${before.hasPosition} totalValueUsd=$${before.totalValueUsd}`);

  // ── 1. Close — sell the full holding back to USDC (server-signed). ──────────
  const result = await cesto.close.startAndWait({ user: evmWalletAddress, product: slug });
  printExecution(result);

  // ── 2. Withdraw — bridge the managed wallet's full USDC balance to Base. ────
  const connection = new Connection(solanaRpc(), 'confirmed');
  const { usdcBalance } = await solanaBalances(connection, new PublicKey(managed.solanaAddress));
  console.log(`managed wallet USDC after close: ${usdc(usdcBalance)}`);
  if (usdcBalance === 0n) throw new Error('No USDC in the managed wallet after close — nothing to withdraw');

  const base = makeBaseClient();
  const [, baseUsdcBefore] = await evmBalances(base, evmWalletAddress);
  console.log(`Base USDC before withdrawal: ${usdc(baseUsdcBefore)}`);

  const res = await cesto.bridge.initiate({
    sourceChain: 'solana',
    destChain: 'base',
    amount: usdcBalance.toString(),
    recipient: evmWalletAddress,
    mode: bridgeMode(),
    sourceAddress: managed.solanaAddress,
  });
  if (!isAutoSubmittedBurn(res)) {
    // Managed burns are always auto-signed/landed server-side — an unsigned
    // payload means the source address was not recognized as a managed wallet.
    throw new Error(
      `expected an auto-submitted managed burn, got status=${res.status} (transfer ${res.transferId})`,
    );
  }
  console.log(`transfer ${res.transferId} — burn landed by Cesto: https://solscan.io/tx/${res.burnTxHash}`);

  // ── 3. Wait for the relayer-paid mint on Base, then verify the balance. ─────
  const done = await cesto.bridge.waitForTransfer(res.transferId);
  printCompleted(done);

  const [, baseUsdcAfter] = await evmBalances(base, evmWalletAddress);
  console.log(`Base USDC after withdrawal:  ${usdc(baseUsdcAfter)} (+${usdc(baseUsdcAfter - baseUsdcBefore)})`);
  console.log('\nCustody loop complete: Base → managed Solana → basket → USDC → Base.');
}

main().catch((error) => {
  if (error instanceof BridgeTransferFailedError) {
    console.error(`\n❌ transfer ${error.transferId} FAILED: ${error.reason ?? 'no reason recorded'}`);
    console.error('A landed burn is never lost — attestations do not expire. Re-drive it with:');
    console.error(`  pnpm byow:bridge:solana-to-base --resume ${error.transferId}`);
  } else {
    console.error('\n❌ close/withdraw failed:', error);
  }
  process.exit(1);
});
