/**
 * PR18 GUARD — the front door is Press Box below lg.
 *
 * Auth, ProfileSetup, VerifyEmail, ResetPassword and AuthCallback are the
 * signed-out screens a new manager walks through, re-skinned as ONE tree
 * with `max-lg:` classes (2026-09-05). The things that would quietly undo
 * it: a bare <Navbar /> back on the phone (the storefront hamburger), the
 * `.pb-type-phone` reset dropped (Montserrat inside every span), a card
 * that keeps its tile on the phone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');

const PAGES = ['Auth', 'ProfileSetup', 'VerifyEmail', 'ResetPassword'];

describe('the signed-out screens below lg', () => {
  it.each(PAGES)('%s hides the storefront Navbar and resets type inheritance on the phone', (page) => {
    const src = read(`pages/${page}.tsx`);
    expect(src).not.toMatch(/^\s*<Navbar \/>\s*$/m);
    expect(src).toMatch(/<div className="hidden lg:block"><Navbar \/><\/div>/);
    expect(src).toMatch(/<main className="pb-type-phone /);
    expect(src).toMatch(/max-lg:bg-pressbox-surface/);
  });

  it('AuthCallback (no Navbar by design) stands on the same ground', () => {
    const src = read('pages/AuthCallback.tsx');
    expect(src).not.toContain('<Navbar');
    expect(src).toMatch(/<main className="pb-type-phone /);
    expect(src).toMatch(/max-lg:bg-pressbox-surface/);
  });

  it('the phone reset exists and is scoped below lg', () => {
    const css = read('index.css');
    expect(css).toMatch(/@media \(max-width: 1023\.98px\) \{\s*\.pb-type-phone \{/);
    expect(css).toMatch(/\.pb-type-phone :where\(p, span, button, h1, h2, h3, h4, h5, h6\) \{\s*font-family: inherit;/);
  });

  it("Apple's button is white on the phone, as Apple draws it on a dark ground", () => {
    const src = read('pages/Auth.tsx');
    const apple = src.match(/handleOAuthSignIn\('apple'\)[^>]*className="([^"]*)"/g) ?? [];
    expect(apple.length).toBe(2);
    apple.forEach((m) => expect(m).toContain('bg-white'));
  });
});

describe('the draft lobby wears the room', () => {
  it('no Citrus 2.0 faces left in DraftLobbyV2', () => {
    const src = read('pages/DraftRoomV2.tsx');
    const start = src.indexOf('function DraftLobbyV2(');
    const end = src.indexOf('\nfunction ', start + 10);
    const lobby = src.slice(start, end === -1 ? undefined : end);
    expect(lobby).not.toContain('font-jbmono');
    expect(lobby).not.toContain('font-sans');
    expect(lobby).not.toContain('text-pastel-cream');
    expect(lobby).toContain('data-testid="draft-lobby-v2-start"');
    expect(lobby).toMatch(/draft-lobby-v2-start"[\s\S]{0,200}bg-pressbox-orange text-pressbox-orange-ink/);
  });
});
