/**
 * 11 — Provision a Cesto-managed wallet for an EVM-wallet user.
 *
 * `users.create` is idempotent per (apiKey, evmWalletAddress): run it twice and
 * the second call returns the same wallet with `created: false`. No user
 * signature needed — Cesto provisions a Privy Solana wallet server-side.
 *
 * Run: pnpm managed:user
 */
import { createClient, requireEnv } from '../lib/client';

const cesto = createClient();
const evmWalletAddress = requireEnv('EVM_WALLET_ADDRESS').trim();

console.log(`Provisioning managed wallet for ${evmWalletAddress}…`);
const created = await cesto.users.create({ evmWalletAddress });
console.log('create →', created);
if (!created.created) console.log('(already provisioned — idempotent)');

console.log('\nRe-calling create to verify idempotency…');
const again = await cesto.users.create({ evmWalletAddress });
console.log(`created=${again.created} (expected false), same address: ${again.solanaAddress === created.solanaAddress}`);

console.log('\nusers.get →');
const fetched = await cesto.users.get(evmWalletAddress);
console.log(fetched);

if (fetched.solanaAddress !== created.solanaAddress) throw new Error('users.get mismatch');
console.log(`\nManaged Solana address: ${created.solanaAddress}`);
