/**
 * 14 — Exercise every SDK GET endpoint against the managed flow.
 *
 * Covers: products.list (+backtest), products.get (+chart), positions.getPositions,
 * positions.getPosition, users.get, bridge.getTransfer, positions.getExecution.
 * Read-only.
 *
 * Run:
 *   pnpm managed:gets                       # everything except transfer/execution lookups
 *   pnpm managed:gets <transferId> <executionId>   # include those too
 */
import { createClient, requireEnv } from '../lib/client';

const cesto = createClient();
const evmWalletAddress = requireEnv('EVM_WALLET_ADDRESS').trim();
const solWallet = requireEnv('WALLET_ADDRESS').trim();
const slug = process.env.PRODUCT_SLUG?.trim() || 'test-basket-sdk';
const [transferId, executionId] = process.argv.slice(2).filter((a) => !a.startsWith('-'));

console.log('══ products.list ══');
const products = await cesto.products.list();
console.log(`${products.length} products`);
console.log('══ products.list({ includeBacktest: true }) ══');
const withBacktest = await cesto.products.list({ includeBacktest: true });
console.log(`backtest present on ${withBacktest.filter((p) => p.backtest).length}/${withBacktest.length}`);

console.log(`══ products.get("${slug}", includeBacktestChart) ══`);
const product = await cesto.products.get(slug, { includeBacktestChart: true });
console.log(`id=${product.id} versionId=${product.versionId} inputDecimals=${product.inputTokenDecimals} min=${product.minimumInvestment}`);
console.log(`chart: ${product.backtestChart ? 'present' : 'null'}`);

console.log('══ positions.getPositions({ user: WALLET_ADDRESS }) ══');
const accountPositions = await cesto.positions.getPositions({ user: solWallet });
console.log(`positions=${accountPositions.positions.length} pendingClose=${accountPositions.pendingClosePositions.length}`);

console.log('══ users.get(evmWalletAddress) ══');
const managed = await cesto.users.get(evmWalletAddress);
console.log(managed);

console.log(`══ positions.getPosition({ user: managed.solanaAddress, slug }) ══`);
const position = await cesto.positions.getPosition({ user: managed.solanaAddress, slug });
console.log(`hasPosition=${position.hasPosition} totalValueUsd=$${position.totalValueUsd} holdings=${position.holdings.length} lastExecution=${position.lastExecution?.status ?? 'null'}`);

if (transferId) {
  console.log(`══ bridge.getTransfer(${transferId}) ══`);
  const transfer = await cesto.bridge.getTransfer(transferId);
  console.log(`status=${transfer.status} netOut=${transfer.netOut} mintTx=${transfer.mintTxHash ?? 'pending'}`);
} else {
  console.log('(skip bridge.getTransfer — pass a transferId arg)');
}

if (executionId) {
  console.log(`══ positions.getExecution(${executionId}) ══`);
  const execution = await cesto.positions.getExecution(executionId);
  console.log(`status=${execution.status} legs=${execution.transactions.length}`);
} else {
  console.log('(skip positions.getExecution — pass an executionId arg)');
}

console.log('\nAll GET endpoints OK.');
