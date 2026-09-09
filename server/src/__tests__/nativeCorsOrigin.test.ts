// Native CORS origin lock (2026-08-25, pre-TestFlight).
//
// The iOS Capacitor build is not served from citrusfantasysports.com. WKWebView
// loads it from a custom scheme — capacitor://localhost by default, which is
// what capacitor.config.json resolves to since it sets no server.hostname or
// iosScheme — so every /api call from the app is cross-origin. If that origin
// is missing from the allowlist the server refuses every request and the app
// dies on device with a generic network error: no 404, no message, nothing in
// the UI to diagnose from.
//
// This is the CORS half of the problem nativeApiOriginGuard.test.ts solves the
// URL half of. That one stops relative `/api` fetches (fixing WHERE the request
// goes); this one keeps the server willing to ANSWER it.
//
// Reads app.ts as source rather than booting the app: the origin list is a
// module-level const evaluated at import, and the point is to pin the literal
// so a future tidy-up of that array cannot quietly drop the native entries.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_PATH = resolve(HERE, '..', 'app.ts');
const source = readFileSync(APP_PATH, 'utf8');

/** The corsOrigins array literal, comments and all. */
const originsBlock = source.match(/const corsOrigins: string\[\] = \[([\s\S]*?)\n\];/)?.[1] ?? '';

describe('CORS allowlist — native shell', () => {
  it('finds the corsOrigins array', () => {
    expect(originsBlock.length).toBeGreaterThan(0);
  });

  it("allows the iOS Capacitor origin, or TestFlight can't reach the API at all", () => {
    expect(originsBlock).toContain("'capacitor://localhost'");
  });

  it('allows the legacy ionic:// scheme too', () => {
    expect(originsBlock).toContain("'ionic://localhost'");
  });

  it('still allows the production web origins', () => {
    expect(originsBlock).toContain("'https://citrusfantasysports.com'");
    expect(originsBlock).toContain("'https://www.citrusfantasysports.com'");
  });

  it('allows the Android shell origin, https://localhost, and only that form', () => {
    // ANDROID SHIPS (2026-09-09). The August version of this test refused any
    // localhost origin so the Android entry would be a decision, not drift.
    // The decision: the API authenticates with a Bearer JWT, never a cookie,
    // so CORS is not the auth boundary and https://localhost (Capacitor's
    // default androidScheme) is safe to answer. Plain http://localhost stays
    // out of the production list; it is still pushed for non-production
    // builds below the array.
    const productionEntries = originsBlock
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(productionEntries).toContain("'https://localhost'");
    expect(productionEntries).not.toMatch(/'http:\/\/localhost/);
  });

  it('credentials mode is on, so the allowlist must stay explicit (never "*")', () => {
    // A wildcard origin is invalid with credentials:true and would be a
    // silent downgrade of the whole policy.
    expect(source).not.toMatch(/origin:\s*['"]\*['"]/);
    expect(source).toMatch(/origin:\s*corsOrigins/);
  });
});
