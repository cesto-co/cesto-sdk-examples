# Cesto SDK Examples

Runnable TypeScript examples for [`@cesto/sdk`](https://www.npmjs.com/package/@cesto/sdk) —
the typed, server-side TypeScript client for the [Cesto](https://cesto.co) API.

Full documentation: **[docs.cesto.co/sdk/overview](https://docs.cesto.co/sdk/overview)**

## Examples

| Example | Script | What it shows |
| --- | --- | --- |
| [`01-list-products.ts`](src/01-list-products.ts) | `pnpm products` | List baskets, with backtested performance |
| [`02-product-detail.ts`](src/02-product-detail.ts) | `pnpm product` | Fetch one basket + its backtest chart (union type guard) |
| [`03-get-positions.ts`](src/03-get-positions.ts) | `pnpm positions` | A user's Cesto-account positions by wallet |
| [`04-get-position.ts`](src/04-get-position.ts) | `pnpm position` | Live on-chain position in one basket (the SDK position view) |
| [`05-open-position.ts`](src/05-open-position.ts) | `pnpm open --yes` | Open a position — one-call `open.execute` with local signing |
| [`06-close-position.ts`](src/06-close-position.ts) | `pnpm close --yes` | Close the full holding — one-call `close.execute` |
| [`07-split-flow.ts`](src/07-split-flow.ts) | `pnpm split-flow --yes` | The explicit prepare → sign → submit → poll flow (what a web app does) |
| [`08-error-handling.ts`](src/08-error-handling.ts) | `pnpm errors` | Typed errors, per-request overrides, cancellation |
| [`09-bridge-base-to-solana.ts`](src/09-bridge-base-to-solana.ts) | `pnpm bridge:base-to-solana --yes` | Bridge USDC Base → Solana via CCTP (relayer-paid destination) |
| [`10-bridge-solana-to-base.ts`](src/10-bridge-solana-to-base.ts) | `pnpm bridge:solana-to-base --yes` | Bridge USDC Solana → Base via CCTP (relayer-paid destination) |

Shared helpers live in [`src/lib/`](src/lib): client setup and the
`signTransactions` callback used by the write examples.

## Setup

Requires **Node.js 20.6+** (the scripts run TypeScript directly via [`tsx`](https://tsx.is) with `node --env-file`).

```bash
pnpm install
cp .env.example .env   # then fill it in
```

| Variable | Needed by | Notes |
| --- | --- | --- |
| `CESTO_API_KEY` | all | `cesto_sk_…`. Write examples (05–07) need a **write-scoped** key. |
| `PRODUCT_SLUG` | 02, 04–07 | Basket to use. |
| `WALLET_ADDRESS` | 03, 04, 09, 10 | Any Solana address to read; 09 checks the signing key derives it. |
| `WALLET_SECRET_KEY` | 05–07, 10 | Base58 string or JSON byte array. A wallet **you** control. |
| `OPEN_AMOUNT_BASE_UNITS` | 05, 07 | Input amount in base units (e.g. 5 USDC = `5000000`). |
| `BRIDGE_AMOUNT_BASE_UNITS` | 09, 10 | USDC per bridge leg (default `1000000` = 1 USDC). |
| `BRIDGE_MODE` | 09, 10 | `fast` (default) or `standard`. |
| `EVM_USER_PRIVATE_KEY` | 09 | 0x-prefixed key of the EVM wallet used on Base. |
| `EVM_WALLET_ADDRESS` | 09, 10 | The EVM wallet's address — 09 verifies the key derives it; 10 bridges to it. |

Examples 09/10 bridge **real USDC on mainnet** in both directions. Each
needs only its source-chain key — 09 signs with `EVM_USER_PRIVATE_KEY` (Base,
plus a little ETH for burn gas), 10 with `WALLET_SECRET_KEY` (Solana); the
destination leg is always gasless (relayer-paid, ATA rent included). Set
`WALLET_ADDRESS` / `EVM_WALLET_ADDRESS` to the funded addresses — the scripts
refuse to run when a key derives a different address. Recover an interrupted
transfer (burn landed but the run died) with `--resume <transferId>
[burnTxHash]` on either script.

No self-serve portal yet — request an API key via the
[Cesto community](https://t.me/cesto_co).

## ⚠️ The write examples spend real funds

Examples 05–07 execute **real swaps on Solana mainnet** from the wallet in
`WALLET_SECRET_KEY`, which pays its own gas (it must hold SOL). They refuse to
run without an explicit `--yes` flag:

```bash
pnpm open --yes
```

Use a dedicated test wallet with small amounts. Never commit `.env`.

## How the write flow works

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
