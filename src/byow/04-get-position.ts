/**
 * Read a wallet's LIVE position in one basket — on-chain balances of the
 * basket's constituent tokens (exactly what a close would sell). This is the
 * position view for SDK-opened positions. Works with a read-only key.
 *
 * Run: pnpm byow:position
 */
import { createClient, requireEnv } from '../lib/client';

const cesto = createClient();

const position = await cesto.positions.getPosition({
  user: requireEnv('WALLET_ADDRESS'),
  slug: requireEnv('PRODUCT_SLUG'),
});

console.log(`${position.productSlug} — hasPosition: ${position.hasPosition}`);
console.log(`Total value: $${position.totalValueUsd}\n`);
for (const h of position.holdings) {
  console.log(`• ${h.symbol}: ${h.amount} base units ≈ $${h.valueUsd}`);
}
if (position.lastExecution) {
  const { type, status, executionId } = position.lastExecution;
  console.log(`\nLast execution (your API key): ${type} ${status} (${executionId})`);
}
