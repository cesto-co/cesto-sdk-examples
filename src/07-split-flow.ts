/**
 * The split open flow, step by step: prepare → sign → submit → poll.
 *
 * This is what a web app does — the backend runs the SDK, the browser wallet
 * signs. Here both halves run in one process so you can see each hop; the
 * "browser" section is the code you'd move behind wallet-adapter's
 * `signTransaction`.
 *
 * Run: pnpm split-flow --yes
 */
import { VersionedTransaction } from '@solana/web3.js';

import { confirmOrExit, createClient, requireEnv } from './lib/client';
import { loadKeypair, printExecution } from './lib/wallet';

const cesto = createClient();
const slug = requireEnv('PRODUCT_SLUG');
const amount = BigInt(requireEnv('OPEN_AMOUNT_BASE_UNITS'));

const keypair = loadKeypair();
const user = keypair.publicKey.toBase58();

confirmOrExit(`opens a position in "${slug}" for ${amount} base units from ${user}`);

// 1) BACKEND — prepare. Cesto builds the unsigned transactions and keeps the
//    canonical bytes for ~60s. Get them signed and submitted before expiresAt.
const prepared = await cesto.open.prepare({ user, slug, amount });
console.log(`Prepared ${prepared.transactions.length} tx(s), expires ${prepared.expiresAt}`);

// 2) "BROWSER" — the user's wallet signs each transaction AS-IS. Any modified
//    byte is rejected at submit; only signatures may be added.
const signed = prepared.transactions.map(({ nodeId, transaction }) => {
  const vtx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
  vtx.sign([keypair]); // in a web app: await wallet.signTransaction(vtx)
  return { nodeId, signedTransaction: Buffer.from(vtx.serialize()).toString('base64') };
});

// 3) BACKEND — submit. Single-use and never auto-retried: if it times out
//    client-side, poll getExecution instead of re-sending.
await cesto.positions.submit({ executionId: prepared.executionId, transactions: signed });
console.log('Submitted. Polling…');

// 4) BACKEND — poll manually (waitForExecution does this loop for you).
let execution = await cesto.positions.getExecution(prepared.executionId);
while (execution.status === 'QUEUED' || execution.status === 'PROCESSING') {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  execution = await cesto.positions.getExecution(prepared.executionId);
  console.log(`  status: ${execution.status}`);
}

printExecution(execution);
