/**
 * Balance check — prints Base ETH/USDC for EVM_WALLET_ADDRESS and
 * SOL/USDC for WALLET_ADDRESS. Read-only.
 *
 * Run: pnpm managed:balances
 */
import { formatEther } from 'viem';

import { evmBalances, makeBaseClient, usdc } from '../lib/bridge';
import { requireEnv } from '../lib/client';

const evm = requireEnv('EVM_WALLET_ADDRESS').trim() as `0x${string}`;
const sol = requireEnv('WALLET_ADDRESS').trim();

const base = makeBaseClient();
const [eth, usdcBase] = await evmBalances(base, evm);
console.log(`EVM  ${evm}`);
console.log(`  Base ETH : ${formatEther(eth)}`);
console.log(`  Base USDC: ${usdc(usdcBase)}`);

const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
const conn = new Connection(
  process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com',
);
const solLamports = await conn.getBalance(new PublicKey(sol));
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
let solUsdc = 0n;
try {
  const accounts = await conn.getTokenAccountsByOwner(new PublicKey(sol), { mint: USDC_MINT });
  for (const { account } of accounts.value) {
    // SPL token account: amount is u64 little-endian at offset 64.
    const bytes = account.data.subarray(64, 72);
    let amount = 0n;
    for (let i = 7; i >= 0; i--) amount = (amount << 8n) | BigInt(bytes[i]!);
    solUsdc += amount;
  }
} catch {
  /* no token accounts */
}
console.log(`SOL  ${sol}`);
console.log(`  SOL : ${solLamports / LAMPORTS_PER_SOL}`);
console.log(`  USDC: ${usdc(solUsdc)}`);
