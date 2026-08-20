/**
 * Rebalance a position onto the basket's latest version.
 *
 * Baskets are versioned. When a creator publishes a new token mix, existing
 * positions stay on the version they opened at until they are rebalanced — the
 * migration is never automatic for a self-custody wallet, because only the
 * wallet can sign it.
 *
 * `getAvailability` first: it reports whether a newer version exists, what
 * would be sold and bought, and whether this wallet is eligible. Show it to the
 * user before asking them to sign — a rebalance is a set of real swaps with
 * real slippage, not a settings change.
 *
 * `execute` is the same prepare -> sign -> submit -> poll shape as open and
 * close, and it returns `null` when the position is already on the latest
 * version. That is a normal outcome, not a failure.
 *
 * Run: pnpm byow:rebalance --yes
 */
import { confirmOrExit, createClient, requireEnv } from '../lib/client';
import { createSignTransactions, loadKeypair, printExecution } from '../lib/wallet';

const cesto = createClient();
const slug = requireEnv('PRODUCT_SLUG');

const keypair = loadKeypair();
const wallet = keypair.publicKey.toBase58();

const availability = await cesto.rebalance.getAvailability({ wallet, product: slug });

if (!availability.available) {
  console.log(`No rebalance available for "${slug}": ${availability.reason ?? 'already current'}`);
  process.exit(0);
}

console.log(
  `${availability.currentVersionLabel ?? 'current'} → ${availability.targetVersionLabel ?? 'latest'}`,
);
console.log(`Invested: ${availability.totalInvested} base units`);

// Allocations arrive as a PERCENT already (100 = the whole position), not
// as a 0-1 weight — do not scale them.
const pct = (n: number) => `${n.toFixed(1)}%`;
for (const t of availability.tokensToSell) {
  console.log(`  sell ${t.symbol}: ${pct(t.currentAllocation)} → ${pct(t.targetAllocation)}  ≈ $${t.estimatedUsdValue}`);
}
for (const t of availability.tokensToBuy) {
  console.log(`  buy  ${t.symbol}: ${pct(t.currentAllocation)} → ${pct(t.targetAllocation)}  ≈ $${t.estimatedUsdValue}`);
}
for (const t of availability.tokensUnchanged) {
  console.log(`  keep ${t.symbol}: ${pct(t.allocation)}`);
}
console.log(`Estimated platform fee: ${availability.estimatedPlatformFee} base units`);

// Eligibility is separate from availability: a newer version can exist while
// this particular wallet still cannot migrate — most often because the new
// version raised the minimum above what the position holds.
if (!availability.eligible) {
  console.log('\nNot eligible to rebalance:');
  for (const err of availability.eligibilityErrors ?? []) console.log(`  - ${err}`);
  if (availability.ineligibleReason) console.log(`  ${JSON.stringify(availability.ineligibleReason)}`);
  process.exit(1);
}

confirmOrExit(`rebalances the "${slug}" position of ${wallet}`);

const result = await cesto.rebalance.execute({
  wallet,
  product: slug,
  signTransactions: createSignTransactions(keypair),
});

// null means the position was already current by the time it was prepared —
// nothing was signed and nothing was sent.
if (!result) {
  console.log('Already on the latest version — nothing to migrate.');
  process.exit(0);
}

printExecution(result);

const after = await cesto.positions.getHoldings({ wallet, product: slug });
console.log(`\nPosition now $${after.totalValueUsd} across ${after.holdings.length} token(s):`);
for (const h of after.holdings) {
  console.log(`  ${h.symbol}: ${h.amount} base units ≈ $${h.valueUsd}`);
}
