/**
 * 12 — Fund the managed wallet: bridge USDC Base → Solana (recipient = the
 * provisioned managed Solana address). The EVM wallet signs the burn on Base;
 * Cesto drives attestation + mint. Same shape as example 09.
 *
 * Run:
 *   BRIDGE_AMOUNT_BASE_UNITS=4999500 pnpm managed:fund --yes
 *   pnpm managed:fund --resume <transferId> [burnTxHash]
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

  confirmOrExit('managed:fund');

  const amount = bridgeAmount();
  const mode = bridgeMode();
  const cesto = createClient();
  const evmAccount = loadEvmAccount();
  assertAddress('EVM', evmAccount.address, 'EVM_WALLET_ADDRESS');
  const publicClient = makeBaseClient();

  // Recipient = the managed wallet provisioned in step 11.
  const managed = await cesto.users.get(evmAccount.address);
  const recipient = managed.solanaAddress;

  console.log('─'.repeat(72));
  console.log(`Base → Solana (managed) | ${usdc(amount)} USDC | mode=${mode}`);
  console.log(`from (signer) : ${evmAccount.address}`);
  console.log(`to (managed)  : ${recipient}`);
  console.log('─'.repeat(72));

  const [eth, usdcBalance] = await evmBalances(publicClient, evmAccount.address);
  console.log(`balances: ${formatEther(eth)} ETH, ${usdc(usdcBalance)} USDC`);
  if (eth === 0n) throw new Error('No Base ETH for gas on the EVM wallet');
  if (usdcBalance < BigInt(amount)) throw new Error('Insufficient Base USDC');

  const quote = await cesto.bridge.quote({ sourceChain: 'base', destChain: 'solana', amount, recipient, mode });
  console.log(`quote: netOut=${usdc(quote.netOut)} estimatedFee=${usdc(quote.estimatedFee)} eta=${quote.etaSeconds}s ataExists=${quote.ataExists}`);

  const { transferId, burn } = await cesto.bridge.initiate({
    sourceChain: 'base',
    destChain: 'solana',
    amount,
    recipient,
    mode,
    sourceAddress: evmAccount.address,
  });
  if (burn?.kind !== 'evm') throw new Error('expected an EVM burn payload');
  console.log(`transfer ${transferId} — signing burn on Base…`);

  const walletClient = createWalletClient({ account: evmAccount, chain: base, transport: http(BASE_RPC) });

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

  await submitBurnWithRetry(cesto, transferId, burnTxHash);
  console.log('burn verified — Cesto is driving attestation + mint in the background');

  const done = await cesto.bridge.waitForTransfer(transferId);
  printCompleted(done);
  console.log(`\nInvestable netOut (base units): ${done.netOut}`);
}

main().catch((error) => {
  if (error instanceof BridgeTransferFailedError) {
    console.error(`\n❌ transfer ${error.transferId} FAILED: ${error.reason ?? 'no reason recorded'}`);
    console.error('A landed burn is never lost — attestations do not expire. Re-run with:');
    console.error(`  pnpm managed:fund --resume ${error.transferId}`);
  } else {
    console.error('\n❌ bridge failed:', error);
  }
  process.exit(1);
});
