/**
 * 10 — Bridge USDC from Solana to Base (Circle CCTP, mainnet).
 *
 * The withdrawal flow: USDC leaves the user's Solana wallet and arrives on
 * their Base wallet. Same five steps as example 09, with the Solana signing
 * model on the burn leg:
 *
 *   the burn transaction is built server-side but signed LOCALLY — by the user
 *   wallet plus an ephemeral CCTP "message event" keypair the API returns as
 *   `additionalSignerSecrets`. Those extra keypairs hold no funds and are
 *   single-use; they exist because CCTP stores the cross-chain message in a
 *   fresh account per burn.
 *
 * The destination leg is gasless: Cesto's relayer pays the Base mint. The
 * source burn is signed and paid by the source wallet itself (non-custodial —
 * Cesto never sees the key).
 *
 * Setup (.env):
 *   CESTO_API_KEY            write-scoped key
 *   WALLET_SECRET_KEY        Solana key (base58 or JSON byte array) holding
 *                            USDC + a little SOL for the burn fee
 *   WALLET_ADDRESS           its address — verified before funds move
 *   EVM_WALLET_ADDRESS       recipient wallet on Base (0x…)
 *   BRIDGE_AMOUNT_BASE_UNITS optional, default 1000000 (= 1 USDC)
 *   BRIDGE_MODE              'fast' (default, ~1bps, seconds) | 'standard'
 *                            (lossless, ~20s from Solana)
 *
 * Run:
 *   pnpm byow:bridge:solana-to-base --yes
 *   pnpm byow:bridge:solana-to-base --resume <transferId> [burnTxHash]
 *
 * If the run dies after the burn lands, nothing is stuck: attestations never
 * expire. Re-run with --resume to re-register the burn or keep waiting.
 */

import { BridgeTransferFailedError } from '@cesto/sdk';
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { loadKeypair } from '../lib/wallet';
import {
  assertAddress,
  bridgeAmount,
  bridgeMode,
  confirmOrExit,
  printCompleted,
  requireEnv,
  resumeArgs,
  resumeTransfer,
  solanaBalances,
  solanaRpc,
  submitBurnWithRetry,
  usdc,
} from '../lib/bridge';
import { createClient } from '../lib/client';

async function main() {
  const resume = resumeArgs();
  if (resume) {
    await resumeTransfer(createClient(), resume.transferId, resume.burnTxHash);
    return;
  }

  confirmOrExit('byow:bridge:solana-to-base');

  const amount = bridgeAmount();
  const mode = bridgeMode();
  const cesto = createClient();
  const solana = loadKeypair();
  assertAddress('Solana', solana.publicKey.toBase58(), 'WALLET_ADDRESS');
  const recipient = requireEnv('EVM_WALLET_ADDRESS').trim();
  const connection = new Connection(solanaRpc(), 'confirmed');

  console.log('─'.repeat(72));
  console.log(`Solana → Base | ${usdc(amount)} USDC | mode=${mode}`);
  console.log(`from (signer) : ${solana.publicKey.toBase58()}`);
  console.log(`to (recipient): ${recipient}`);
  console.log('─'.repeat(72));

  const { sol, usdcBalance } = await solanaBalances(connection, solana.publicKey);
  console.log(`balances: ${sol / LAMPORTS_PER_SOL} SOL, ${usdc(usdcBalance)} USDC`);
  if (usdcBalance < BigInt(amount)) throw new Error('Insufficient Solana USDC');
  if (sol < 1_000_000) throw new Error('Insufficient SOL for the burn transaction fee');

  // ── 1. Quote — fees and ETA. Creates nothing. ──────────────────────────────
  const quote = await cesto.bridge.quote({ sourceChain: 'solana', destChain: 'base', amount, recipient, mode });
  console.log(`quote: netOut=${usdc(quote.netOut)} estimatedFee=${usdc(quote.estimatedFee)} eta=${quote.etaSeconds}s`);

  // ── 2. Initiate — creates the transfer, returns the unsigned burn. ─────────
  const { transferId, burn } = await cesto.bridge.initiate({
    sourceChain: 'solana',
    destChain: 'base',
    amount,
    recipient,
    mode,
    sourceAddress: solana.publicKey.toBase58(),
  });
  if (burn?.kind !== 'solana') throw new Error('expected a Solana burn payload');
  console.log(`transfer ${transferId} — signing burn on Solana…`);

  // ── 3. Sign + land the burn on Solana. ─────────────────────────────────────
  // The server built this transaction moments ago (fresh blockhash) — sign and
  // send it promptly. Co-signers: the user wallet (fee payer + USDC owner) and
  // every ephemeral message-event keypair returned by the API.
  const tx = Transaction.from(Buffer.from(burn.transaction, 'base64'));
  const extraSigners = burn.additionalSignerSecrets.map((s) => Keypair.fromSecretKey(bs58.decode(s)));
  tx.sign(solana, ...extraSigners);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const burnTxHash = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: burnTxHash, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log(`burn: https://solscan.io/tx/${burnTxHash}`);

  // ── 4. Report the burn — Cesto verifies it against Circle before acting. ───
  await submitBurnWithRetry(cesto, transferId, burnTxHash);
  console.log('burn verified — Cesto is driving attestation + mint in the background');

  // ── 5. Wait for the Base mint (relayer-paid). ──────────────────────────────
  printCompleted(await cesto.bridge.waitForTransfer(transferId));
}

main().catch((error) => {
  if (error instanceof BridgeTransferFailedError) {
    console.error(`\n❌ transfer ${error.transferId} FAILED: ${error.reason ?? 'no reason recorded'}`);
    console.error('A landed burn is never lost — attestations do not expire. Re-run with:');
    console.error(`  pnpm byow:bridge:solana-to-base --resume ${error.transferId}`);
  } else {
    console.error('\n❌ bridge failed:', error);
  }
  process.exit(1);
});
