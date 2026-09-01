/**
 * CORS ALLOW-HEADERS vs THE CLIENT'S CUSTOM HEADERS (2026-09-01)
 *
 * The first live engine draft on the iOS build failed in a way no web
 * session could ever reproduce: every human pick "couldn't be confirmed"
 * while autopick sailed through. Cloud Run's request log showed the
 * signature — a stream of 204 OPTIONS preflights and not one pick POST.
 *
 * The website calls /api/* same-origin: no preflight, no CORS, no
 * problem. The native shell is capacitor://localhost — cross-origin — so
 * any request carrying a custom header preflights first, and the browser
 * only sends the real request if the preflight response ALLOWS that
 * header. The draft mutation routes require X-Idempotency-Key; the CORS
 * allow-list didn't include it; WKWebView silently refused every pick.
 *
 * The invariant: every custom header the web client attaches to an API
 * request appears in app.ts's allowHeaders. This test scans the web
 * client's source for custom header literals and compares, so adding a
 * new header to a fetch without allowing it here is a CI failure, not a
 * native-only production outage six weeks later.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP_TS = readFileSync(resolve(here, '../app.ts'), 'utf-8');
const WEB_SRC = resolve(here, '../../../apps/web/src');

/** Standard/simple headers that never need explicit CORS allowance. */
const EXEMPT = new Set(['x-client-info']); // supabase-js metadata header, already allowed

function allowedHeaders(): Set<string> {
  const m = APP_TS.match(/allowHeaders:\s*\[([^\]]*)\]/);
  expect(m, 'app.ts must declare an explicit allowHeaders list').toBeTruthy();
  return new Set(
    [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1].toLowerCase()),
  );
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      yield* walk(p);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
      yield p;
    }
  }
}

function customHeadersUsedByWebClient(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(WEB_SRC)) {
    const src = readFileSync(file, 'utf-8');
    // Header keys written as object literals: 'X-Something': value
    for (const m of src.matchAll(/['"](X-[A-Za-z0-9-]+)['"]\s*:/g)) {
      const h = m[1].toLowerCase();
      const list = found.get(h) ?? [];
      list.push(file.slice(WEB_SRC.length + 1));
      found.set(h, list);
    }
  }
  return found;
}

describe('CORS allow-list covers every custom header the web client sends', () => {
  it('allows the draft idempotency and correlation headers explicitly', () => {
    const allowed = allowedHeaders();
    expect(allowed.has('x-idempotency-key')).toBe(true);
    expect(allowed.has('x-correlation-id')).toBe(true);
  });

  it('leaves no client-side custom header outside the allow-list', () => {
    const allowed = allowedHeaders();
    const used = customHeadersUsedByWebClient();
    const missing = [...used.entries()].filter(
      ([h]) => !allowed.has(h) && !EXEMPT.has(h),
    );
    expect(
      missing,
      `headers used by the web client but not CORS-allowed: ${missing
        .map(([h, files]) => `${h} (${files.join(', ')})`)
        .join('; ')}`,
    ).toEqual([]);
  });
});
