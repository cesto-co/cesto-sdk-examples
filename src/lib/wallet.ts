import type { PositionExecution, SignTransactions } from '@cesto/sdk';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { requireEnv } from './client';

/**
 * Load the signing keypair from WALLET_SECRET_KEY.
 * Accepts a base58 string (Phantom export) or a JSON byte array (solana-keygen).
 */
export function loadKeypair(): Keypair {
  const raw = requireEnv('WALLET_SECRET_KEY').trim();
  const bytes = raw.startsWith('[')
    ? Uint8Array.from(JSON.parse(raw) as number[])
    : bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}

/**
 * Build the `signTransactions` callback for `open.execute` / `close.execute`.
 *
 * It receives every prepared transaction from the Cesto API, signs each one
 * locally, and returns them base64-encoded. Only signatures are added — the
 * message bytes must stay identical, or submit rejects them.
 */
export function createSignTransactions(keypair: Keypair): SignTransactions {
  return async (transactions) =>
    transactions.map(({ nodeId, transaction }) => {
      const vtx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
      vtx.sign([keypair]);
      return { nodeId, signedTransaction: Buffer.from(vtx.serialize()).toString('base64') };
    });
}

/** Pretty-print an execution result (status + per-leg outcomes). */
export function printExecution(result: PositionExecution): void {
  console.log(`Execution ${result.executionId}: ${result.status}`);
  for (const tx of result.transactions) {
    if (tx.ok) {
      console.log(`  ✔ ${tx.nodeId} — https://solscan.io/tx/${tx.signature}`);
    } else {
      console.log(`  ✘ ${tx.nodeId} — ${tx.error ?? 'failed'}`);
    }
  }
}
