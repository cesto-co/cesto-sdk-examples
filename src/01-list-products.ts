/**
 * List Cesto baskets (products), then list again with backtested performance.
 *
 * Run: pnpm products
 */
import { createClient } from './lib/client';

const cesto = createClient();

const products = await cesto.products.list();
console.log(`${products.length} products\n`);
for (const p of products.slice(0, 10)) {
  console.log(`• ${p.name}  (slug: ${p.slug}${p.category ? `, category: ${p.category}` : ''})`);
}

// includeBacktest merges backtested performance onto each item (one extra
// request). If that call fails, `backtest` is null — the list still returns.
const withPerf = await cesto.products.list({ includeBacktest: true });
const first = withPerf[0];
if (first) {
  console.log(`\nBacktest for "${first.name}":`, first.backtest ?? 'unavailable');
}
