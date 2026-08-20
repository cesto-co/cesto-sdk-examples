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

/**
 * Point the SDK at a locally-running API instead of production.
 *
 * `--local` (or `CESTO_LOCAL=1`) switches two things together, because they are
 * only ever correct together: the base URL and the credential. A production key
 * is not valid against a local database, and a local key is not valid against
 * production — mixing them yields a 401 that reads like a broken key rather
 * than a misrouted request.
 *
 * `CESTO_BASE_URL` is the SDK's only sanctioned base-URL override and it refuses
 * anything that is not plain-http localhost, so a stray value here cannot send a
 * secret key to a foreign origin.
 */
function useLocal(): boolean {
  return process.argv.includes('--local') || process.env.CESTO_LOCAL === '1';
}

/** Create a Cesto client from CESTO_API_KEY (the SDK never reads env itself — pass it explicitly). */
export function createClient(): Cesto {
  if (useLocal()) {
    const baseUrl = process.env.CESTO_BASE_URL ?? 'http://127.0.0.1:3000';
    process.env.CESTO_BASE_URL = baseUrl;
    console.log(`→ local API at ${baseUrl} (key: CESTO_API_KEY_LOCAL)`);
    // The SDK never reads env itself — pass the key explicitly.
    return new Cesto({ apiKey: requireEnv('CESTO_API_KEY_LOCAL') });
  }
  return new Cesto({ apiKey: requireEnv('CESTO_API_KEY') });
}

/**
 * Guard for examples that spend real funds. They run only with an explicit
 * `--yes` flag, e.g. `pnpm byow:open --yes`.
 */
export function confirmOrExit(description: string): void {
  if (process.argv.includes('--yes')) return;
  // `--local` does NOT make this safe: a local API still builds real mainnet
  // transactions and lands them with real money. Only the API is local.
  console.log(`This example ${description} with REAL funds on mainnet.`);
  console.log('Re-run the same command with --yes appended to proceed.');
  process.exit(0);
}
