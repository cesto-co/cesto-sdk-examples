/**
 * 13 — Open a position from the managed wallet (custodial, no user signature).
 *
 * `open.startAndWait` fires the open server-side (Cesto signs via the managed
 * Privy wallet, sponsor pays gas) and polls until the execution is terminal.
 * The `user` ref accepts the EVM wallet, externalUserId, or managed Solana
 * address — we use the EVM wallet.
 *
 * Note what is NOT here: a `consent` field. `start`/`startAndWait` is one method
 * for both server-signed flows, and `consent` is what tells them apart — a Cesto
 * account holder signs a challenge to authorize the action, while this user has
 * no key of their own, so the API key is the sole authority. See `src/byow/` for
 * the client-signed alternative.
 *
 * Run:
 *   OPEN_AMOUNT_BASE_UNITS=4999000 pnpm managed:open --yes
 * (defaults to OPEN_AMOUNT_BASE_UNITS from .env; pass the fund step's netOut)
 */
import { confirmOrExit, createClient, requireEnv } from '../lib/client';
import { printExecution } from '../lib/wallet';

const cesto = createClient();
// No universal default — pick a basket from `pnpm byow:products` and set it in .env.
const slug = requireEnv('PRODUCT_SLUG').trim();
const amountArg = process.argv.find((a) => /^\d+$/.test(a));
const amount = BigInt(amountArg ?? requireEnv('OPEN_AMOUNT_BASE_UNITS'));
const evmWalletAddress = requireEnv('EVM_WALLET_ADDRESS').trim();

confirmOrExit(`opens a managed position in "${slug}" for ${amount} base units`);

const result = await cesto.open.startAndWait({ user: evmWalletAddress, product: slug, amount });
printExecution(result);

// Read the position back via live on-chain holdings of the managed wallet.
const managed = await cesto.users.get(evmWalletAddress);
const position = await cesto.positions.getHoldings({ wallet: managed.solanaAddress, product: slug });
console.log(`\nhasPosition=${position.hasPosition} totalValueUsd=$${position.totalValueUsd}`);
for (const h of position.holdings) {
  console.log(`  ${h.symbol}: ${h.amount} (≈$${h.valueUsd})`);
}
