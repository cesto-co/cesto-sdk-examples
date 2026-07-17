import { Cesto } from '@cesto/sdk';

/** Read a required environment variable or exit with a helpful message. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

/** Create a Cesto client from CESTO_API_KEY. */
export function createClient(): Cesto {
  // The SDK also reads CESTO_API_KEY itself; passing it explicitly for clarity.
  return new Cesto({ apiKey: requireEnv('CESTO_API_KEY') });
}

/**
 * Guard for examples that spend real funds. They run only with an explicit
 * `--yes` flag, e.g. `pnpm open --yes`.
 */
export function confirmOrExit(description: string): void {
  if (process.argv.includes('--yes')) return;
  console.log(`This example ${description} with REAL funds on Solana mainnet.`);
  console.log('Re-run with --yes to proceed, e.g.:');
  console.log('  pnpm open --yes');
  process.exit(0);
}
