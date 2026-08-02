# Cesto SDK Examples

Runnable TypeScript examples for [`@cesto/sdk`](https://www.npmjs.com/package/@cesto/sdk) —
the typed, server-side TypeScript client for the [Cesto](https://cesto.co) API.

Full documentation: **[docs.cesto.co/sdk/overview](https://docs.cesto.co/sdk/overview)**

## Two integration tracks

The examples are split by custody model — pick the one that matches your product:

- **`src/byow/` — Bring Your Own Wallet (self-custody).** The end user's Solana
  wallet signs every transaction locally; Cesto builds unsigned transactions,
  byte-verifies the signatures, and lands them. Cesto never holds the key.
  This is the flow a web app wires to a wallet adapter.
- **`src/managed/` — Managed wallets (custodial).** Cesto provisions a Privy
  Solana wallet per user and signs everything server-side (sponsor pays gas).
  The user only ever needs an EVM wallet — funding is a Base USDC transfer,
  and the full custody loop is `managed:fund` → `managed:open` →
  `managed:close` (which also withdraws the proceeds back to Base).

Server-signed execution is one method across both — `open.start(…)`,
`close.start(…)`, `rebalance.start(…)`, plus the `…AndWait` variants that poll to
a terminal status. What differs is the `consent` field: a Cesto account holder
signs a challenge (`open.createChallenge`) to authorize each action, while a
managed user has no key of their own, so your API key is the sole authority and
`consent` is simply omitted — as in `src/managed/` below.

Shared helpers (client setup, wallet loading, bridge utilities) live in
[`src/lib/`](src/lib).

## Quickstart

Requires **Node.js 20.6+** (the scripts run TypeScript directly via [`tsx`](https://tsx.is) with `node --env-file`).

```bash
pnpm install
cp .env.example .env   # then fill it in
pnpm byow:products     # read-only smoke test
```

### BYOW track

| Script | What it does | Required `.env` vars | Spends real funds? |
| --- | --- | --- | --- |
| `pnpm byow:products` | List baskets, with backtested performance | `CESTO_API_KEY` | no |
| `pnpm byow:product` | Fetch one basket + its backtest chart | `CESTO_API_KEY`, `PRODUCT_SLUG` | no |
| `pnpm byow:positions` | A user's Cesto-account positions by wallet | `CESTO_API_KEY`, `WALLET_ADDRESS` | no |
| `pnpm byow:position` | Live on-chain position in one basket | `CESTO_API_KEY`, `WALLET_ADDRESS`, `PRODUCT_SLUG` | no |
| `pnpm byow:open --yes` | Open a position — one-call `open.execute` with local signing | + `WALLET_SECRET_KEY`, `OPEN_AMOUNT_BASE_UNITS` | **yes** (Solana swaps + gas) |
| `pnpm byow:close --yes` | Close the full holding — one-call `close.execute` | + `WALLET_SECRET_KEY` | **yes** |
| `pnpm byow:split-flow --yes` | The explicit prepare → sign → submit → poll flow | same as `byow:open` | **yes** |
| `pnpm byow:errors` | Typed errors, per-request overrides, cancellation | `CESTO_API_KEY` | no |
| `pnpm byow:bridge:base-to-solana --yes` | Bridge USDC Base → Solana via CCTP (EVM-signed burn) | `CESTO_API_KEY` (write), `EVM_USER_PRIVATE_KEY`, `EVM_WALLET_ADDRESS` | **yes** (USDC + a little Base ETH) |
| `pnpm byow:bridge:solana-to-base --yes` | Bridge USDC Solana → Base via CCTP (locally signed burn) | `CESTO_API_KEY` (write), `WALLET_SECRET_KEY`, `WALLET_ADDRESS`, `EVM_WALLET_ADDRESS` | **yes** (USDC + SOL — see below) |

Bridge extras: `BRIDGE_AMOUNT_BASE_UNITS` (default `1000000` = 1 USDC) and
`BRIDGE_MODE` (`fast` default, or `standard`). Recover an interrupted transfer
with `--resume <transferId> [burnTxHash]` on either bridge script.

> **Solana-source burns need SOL.** The Solana → Base burn creates a fresh
> CCTP message account per transfer — keep **~0.005 SOL** in
> `WALLET_ADDRESS` for rent + the transaction fee. (Managed Solana burns are
> sponsor-paid, so the managed track needs no SOL at all.)

### Managed track

| Script | What it does | Required `.env` vars | Spends real funds? |
| --- | --- | --- | --- |
| `pnpm managed:user` | Provision the managed Solana wallet (idempotent) | `CESTO_API_KEY`, `EVM_WALLET_ADDRESS` | no |
| `pnpm managed:balances` | Print Base ETH/USDC + Solana SOL/USDC balances | `EVM_WALLET_ADDRESS`, `WALLET_ADDRESS` | no |
| `pnpm managed:fund --yes` | Bridge USDC Base → the managed Solana wallet (EVM-signed burn) | `CESTO_API_KEY` (write), `EVM_USER_PRIVATE_KEY`, `EVM_WALLET_ADDRESS` | **yes** (USDC + a little Base ETH) |
| `pnpm managed:open --yes` | Open a position — server-signed `open.startAndWait` (no `consent`) | `CESTO_API_KEY` (write), `EVM_WALLET_ADDRESS`, `PRODUCT_SLUG`, `OPEN_AMOUNT_BASE_UNITS` (or a numeric CLI arg) | **yes** |
| `pnpm managed:gets` | Exercise every SDK GET endpoint | `CESTO_API_KEY`, `EVM_WALLET_ADDRESS`, `WALLET_ADDRESS`, `PRODUCT_SLUG` | no |
| `pnpm managed:close --yes` | Close the position AND withdraw — `close.startAndWait` → auto-signed Solana→Base burn → USDC lands on the EVM wallet | `CESTO_API_KEY` (write), `EVM_WALLET_ADDRESS`, `PRODUCT_SLUG` | **yes** |

## Security

- **Keys come from `.env` only.** `.env` is gitignored — never commit it, and
  never hardcode keys in source. The scripts read secrets from the environment
  and never print them.
- **Write examples execute real mainnet transactions.** Solana swaps, Base
  approvals/burns, and bridge transfers move actual USDC. Every write example
  refuses to run without an explicit `--yes` flag.
- **API keys are server-side only.** `CESTO_API_KEY` must never ship to a
  browser or mobile client — call the Cesto API from your backend. Write
  examples need a **write-scoped** key.
- **Use a dedicated test wallet with small balances.** Do not point these
  examples at a wallet holding meaningful funds.

No self-serve portal yet — request an API key via the
[Cesto community](https://t.me/cesto_co).

## How the BYOW write flow works

The end-user's wallet signs its own transactions — Cesto never holds the key:

```
1. prepare   Cesto builds all unsigned txs → { executionId, transactions, expiresAt (~60s) }
2. sign      the wallet signs each transaction locally
3. submit    Cesto byte-verifies (only signatures may be added), then lands them
4. poll      until COMPLETED / PARTIALLY_COMPLETED / FAILED
```

See [Open a Position](https://docs.cesto.co/sdk/open-position) and
[Close a Position](https://docs.cesto.co/sdk/close-position) for the full
security model and error reference.

## License

[MIT](LICENSE)
