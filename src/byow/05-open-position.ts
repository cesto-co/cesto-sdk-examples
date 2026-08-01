/**
 * Open a position with the one-call helper — prepare → sign → submit → wait.
 *
 * Your wallet signs locally via the `signTransactions` callback; the SDK never
 * sees the private key. Requires a WRITE-scoped API key and a wallet funded
 * with the input token — gas and rent are sponsored by Cesto (no SOL needed).
 *
 * Run: pnpm byow:open --yes
 */
import { confirmOrExit, createClient, requireEnv } from '../lib/client';
import { createSignTransactions, loadKeypair, printExecution } from '../lib/wallet';

const cesto = createClient();
const slug = requireEnv('PRODUCT_SLUG');
const amount = BigInt(requireEnv('OPEN_AMOUNT_BASE_UNITS'));

const keypair = loadKeypair();
const user = keypair.publicKey.toBase58();

confirmOrExit(`opens a position in "${slug}" for ${amount} base units from ${user}`);

const result = await cesto.open.execute({
  user,
  slug,
  amount,
  signTransactions: createSignTransactions(keypair),
});

printExecution(result);

// Read the position back — SDK positions are self-custody, so getPosition
// (live on-chain holdings) is the position view, not getPositions.
const position = await cesto.positions.getPosition({ user, slug });
console.log(`\nPosition value now: $${position.totalValueUsd}`);
