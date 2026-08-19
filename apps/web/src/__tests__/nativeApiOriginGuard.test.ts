import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Native-origin guard (2026-08-18 launch audit).
 *
 * A relative `fetch('/api/...')` works fine on the web because Firebase
 * Hosting rewrites /api/* to Cloud Run. Inside the iOS Capacitor shell
 * the origin is capacitor://localhost, there is no rewrite, and every
 * such call fails as a generic network error — no 404, no useful
 * message, just a dead page on device.
 *
 * A sweep on 2026-08-15 introduced API_BASE_URL and fixed most call
 * sites, but four pool/playoff pages were missed and shipped with 19
 * relative fetches between them (NHLPlayoffBracket, PoolPlayoffHub,
 * PoolPlayoffBracket, PoolPlayoffConfidence). A one-time sweep clearly
 * does not hold; this test is the ratchet that keeps it fixed.
 *
 * api/client.ts is exempt: it DEFINES API_BASE_URL and its own
 * documentation comment contains the literal pattern.
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = resolve(HERE, '..');

const EXEMPT = new Set(['api/client.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// fetch('/api/...') or fetch(`/api/...`) — the leading slash with no
// origin in front of it is the whole problem.
const RELATIVE_FETCH = /fetch\(\s*['"`]\/api\//g;

describe('native API origin guard', () => {
  it('no source file issues a relative /api fetch', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
      if (EXEMPT.has(rel)) continue;
      if (rel.includes('__tests__/')) continue;

      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        // Skip comment lines so documentation of the anti-pattern is allowed.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        RELATIVE_FETCH.lastIndex = 0;
        if (RELATIVE_FETCH.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${trimmed.slice(0, 100)}`);
        }
      });
    }

    expect(
      offenders,
      `Relative /api fetches break the iOS build (capacitor://localhost has no ` +
        `Firebase rewrite). Prefix with \${API_BASE_URL} from '@/api/client':\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('the four pages fixed in the 2026-08-18 audit import API_BASE_URL', () => {
    const files = [
      'pages/NHLPlayoffBracket.tsx',
      'pages/PoolPlayoffHub.tsx',
      'pages/PoolPlayoffBracket.tsx',
      'pages/PoolPlayoffConfidence.tsx',
    ];
    for (const f of files) {
      const text = readFileSync(resolve(SRC, f), 'utf8');
      expect(text, `${f} must import API_BASE_URL`).toMatch(
        /import\s*\{[^}]*API_BASE_URL[^}]*\}\s*from\s*'@\/api\/client'/,
      );
    }
  });
});
