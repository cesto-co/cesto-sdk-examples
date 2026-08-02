/**
 * Fetch one basket by slug, including its backtested value chart.
 *
 * Run: pnpm byow:product
 */
import { isPredictionMarketChart } from '@cesto/sdk';

import { createClient, requireEnv } from '../lib/client';

const cesto = createClient();
const slug = requireEnv('PRODUCT_SLUG');

const product = await cesto.products.get({
  slug,
  includeBacktestChart: true,
  chartTimeRange: '1y', // '7d' | '1m' | '3m' | '6m' | '1y' | 'all'
});

console.log(`${product.name}  (id: ${product.id})`);

// The chart is a union type — discriminate it with the shipped guard.
const chart = product.backtestChart;
if (!chart) {
  console.log('No backtest chart available.');
} else if (isPredictionMarketChart(chart)) {
  console.log(`Prediction-market chart with ${chart.markets.length} market(s).`);
} else {
  console.log(`Value chart with ${chart.timeSeries.length} points.`);
}
