import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * ANDROID SAFE AREA (2026-09-09, Play Store prep).
 *
 * On iOS `env(safe-area-inset-*)` carries the notch and home indicator. In
 * an Android WebView it is 0 while Capacitor 8 draws the app edge to edge,
 * so every header painted with a bare env() sat under the status bar, the
 * same bug fixed on iPhone in #428. Capacitor's SystemBars plugin injects
 * `--safe-area-inset-*` on the document instead, so every inset in the app
 * is written as `var(--safe-area-inset-X,env(safe-area-inset-X))`: the
 * injected variable when Android sets it, env() everywhere else.
 *
 * This guard refuses any new bare env(safe-area-inset-*) in app source.
 */
const SRC = resolve(__dirname, '..');
const SKIP = new Set(['__tests__']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

describe('safe-area insets are Android-safe', () => {
  it('no bare env(safe-area-inset-*) outside the var() fallback', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      const bare = src.match(/(?<!,)env\(safe-area-inset-(top|bottom|left|right)\)/g);
      if (bare) offenders.push(`${file.replace(SRC, 'src')}: ${bare.length}`);
    }
    expect(offenders, 'write var(--safe-area-inset-X,env(safe-area-inset-X)) instead').toEqual([]);
  });

  it('the index.html shell and the app share the pattern', () => {
    const html = readFileSync(resolve(SRC, '..', 'index.html'), 'utf8');
    const bare = html.match(/(?<!,)env\(safe-area-inset-/g) ?? [];
    expect(bare).toEqual([]);
  });
});
