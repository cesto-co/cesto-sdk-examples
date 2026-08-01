/**
 * Close a position with the one-call helper.
 *
 * Close is balance-driven and always sells the wallet's FULL holding of the
 * basket's tokens — there is no amount and no partial close.
 *
 * Run: pnpm byow:close --yes
 */
import { confirmOrExit, createClient, requireEnv } from '../lib/client';
import { createSignTransactions, loadKeypair, printExecution } from '../lib/wallet';

const cesto = createClient();
const slug = requireEnv('PRODUCT_SLUG');

const keypair = loadKeypair();
const user = keypair.publicKey.toBase58();

// Nothing to sell → nothing to close. Check before preparing.
const position = await cesto.positions.getPosition({ user, slug });
if (!position.hasPosition) {
  console.log(`${user} holds nothing from "${slug}" — nothing to close.`);
  process.exit(0);
}
console.log(`Closing ≈ $${position.totalValueUsd} across ${position.holdings.length} token(s).`);

confirmOrExit(`closes the full "${slug}" holding of ${user}`);

const result = await cesto.close.execute({
  user,
  slug,
  signTransactions: createSignTransactions(keypair),
});

printExecution(result);
