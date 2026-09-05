/**
 * NO PAGE ZOOM (2026-09-05). From the simulator, the first morning on the
 * Press Box build: typing a league name left the whole app scaled up — the
 * right edge cut off on every screen, the number sheet's DONE below the
 * screen, the create-league page scrolled sideways. iOS zooms the page in
 * on a focused text field under 16px and does not zoom back out. The
 * viewport meta is what stops it, so the meta is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(resolve(here, '..', '..', 'index.html'), 'utf8');

describe('the app never zooms into a text field', () => {
  const meta = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(INDEX_HTML)?.[1] ?? '';

  it('index.html declares one viewport meta', () => {
    expect(meta).not.toBe('');
    expect(INDEX_HTML.match(/<meta\s+name="viewport"/g)?.length).toBe(1);
  });

  it('caps the scale at 1 and keeps the safe areas', () => {
    expect(meta).toMatch(/\bwidth=device-width\b/);
    expect(meta).toMatch(/\binitial-scale=1(\.0)?\b/);
    expect(meta).toMatch(/\bmaximum-scale=1(\.0)?\b/);
    expect(meta).toMatch(/\buser-scalable=no\b/);
    expect(meta).toMatch(/\bviewport-fit=cover\b/);
  });

  it('the Press Box text fields are 16px, not the artboard\'s 15 — belt to the meta\'s braces', () => {
    const settings = readFileSync(resolve(here, '..', 'components', 'pressbox', 'Settings.tsx'), 'utf8');
    const field = /const field = cn\(([\s\S]*?)\);/.exec(settings)?.[1] ?? '';
    expect(field).toContain('text-[16px]');
    expect(field).not.toMatch(/'[^']*\btext-\[1[0-5]px\][^']*text-pressbox-text\b/);
    const auth = readFileSync(resolve(here, '..', 'pages', 'Auth.tsx'), 'utf8');
    expect(auth).toContain('max-lg:text-[16px]');
    expect(auth).not.toContain('max-lg:text-[15px]');
  });
});
