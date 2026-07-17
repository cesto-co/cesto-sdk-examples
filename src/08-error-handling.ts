/**
 * Typed error handling, per-request overrides, and cancellation.
 *
 * Everything the SDK throws extends CestoError; server responses become typed
 * APIError subclasses exposed on the Cesto client for instanceof checks.
 *
 * Run: pnpm errors
 */
import { Cesto } from '@cesto/sdk';

import { createClient } from './lib/client';

const cesto = createClient();

// 1) A 404 becomes Cesto.NotFoundError.
try {
  await cesto.products.get('this-slug-does-not-exist');
} catch (err) {
  if (err instanceof Cesto.NotFoundError) {
    console.log(`NotFoundError as expected — status ${err.status}, requestId ${err.requestId}`);
  } else {
    throw err;
  }
}

// 2) Per-request overrides: a tight timeout and no retries, just for this call.
try {
  const products = await cesto.products.list({}, { timeout: 5_000, maxRetries: 0 });
  console.log(`Fetched ${products.length} products with a 5s timeout.`);
} catch (err) {
  if (err instanceof Cesto.APIConnectionTimeoutError) {
    console.log('Timed out within 5s (no retries).');
  } else {
    throw err;
  }
}

// 3) Cancellation with an AbortSignal.
const controller = new AbortController();
const pending = cesto.products.list({}, { signal: controller.signal });
controller.abort();
try {
  await pending;
} catch (err) {
  if (err instanceof Cesto.APIUserAbortError) {
    console.log('Request cancelled via AbortSignal.');
  } else {
    throw err;
  }
}

// 4) The general pattern for production code:
try {
  await cesto.products.list();
  console.log('General pattern: call succeeded.');
} catch (err) {
  if (err instanceof Cesto.AuthenticationError) {
    console.error('Check your CESTO_API_KEY.');
  } else if (err instanceof Cesto.RateLimitError) {
    console.error(`Rate limited — retry after ~${err.retryAfter ?? '?'}ms.`);
  } else if (err instanceof Cesto.APIError) {
    console.error(`API error ${err.status}: ${err.message} [${err.code ?? 'no-code'}]`);
  } else {
    throw err; // network errors, bugs — let them surface
  }
}
