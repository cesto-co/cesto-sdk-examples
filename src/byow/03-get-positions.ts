/**
 * Look up a user's Cesto-account positions by their external Solana wallet.
 *
 * Note: positions opened via the SDK are self-custody and do NOT appear here —
 * see 04-get-position.ts for the SDK position view.
 *
 * Run: pnpm byow:positions
 */
import { createClient, requireEnv } from '../lib/client';

const cesto = createClient();
const wallet = requireEnv('WALLET_ADDRESS');

const { positions, pendingClosePositions } = await cesto.positions.list({ wallet });

// A wallet with no Cesto account returns an empty result (not an error).
console.log(`${positions.length} open, ${pendingClosePositions.length} pending close\n`);
for (const pos of positions) {
  console.log(`• ${pos.product.name} — ${pos.investments.length} investment(s)`);
}
