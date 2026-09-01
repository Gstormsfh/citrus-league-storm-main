/**
 * INVITE SHARE GUARD (2026-09-01) — iOS: "no real way for me to send the
 * code/text/email." Two defects, both banned here at the source level:
 *
 * 1. Invite links were built from the runtime origin, which inside the
 *    native shell is capacitor://localhost — unopenable off the device.
 * 2. Send buttons navigated to mail/text URL schemes, which the iOS
 *    WKWebView silently drops — the buttons did nothing.
 *
 * Contract: every invite surface delegates to utils/inviteShare (public
 * https origin, OS share sheet first) and contains NO runtime-origin
 * link construction and NO raw mail/text scheme strings of its own.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf-8');

const SURFACES: Array<[string, string]> = [
  ['LeagueDashboard.tsx', read('../pages/LeagueDashboard.tsx')],
  ['DraftLobby.tsx', read('../components/draft/DraftLobby.tsx')],
  ['InvitePlayersButton.tsx', read('../components/InvitePlayersButton.tsx')],
  ['PoolPlayoffHub.tsx', read('../pages/PoolPlayoffHub.tsx')],
];

const UTILITY = read('../utils/inviteShare.ts');

describe('every invite surface delegates to inviteShare', () => {
  it.each(SURFACES.map(([f]) => [f] as const))('%s imports the utility', (file) => {
    const text = SURFACES.find(([f]) => f === file)![1];
    expect(text).toContain("from '@/utils/inviteShare'");
  });

  it.each(SURFACES.map(([f]) => [f] as const))(
    '%s builds no links on the runtime origin',
    (file) => {
      const text = SURFACES.find(([f]) => f === file)![1];
      expect(text).not.toContain('window.location.origin');
    },
  );

  it.each(SURFACES.map(([f]) => [f] as const))(
    '%s carries no raw mail/text scheme strings',
    (file) => {
      const text = SURFACES.find(([f]) => f === file)![1];
      expect(text).not.toMatch(/mailto:/);
      expect(text).not.toMatch(/`sms:|"sms:|'sms:/);
    },
  );
});

describe('the utility holds the invariants', () => {
  it('pins the public https origin', () => {
    expect(UTILITY).toContain("export const SITE_ORIGIN = 'https://citrusfantasysports.com'");
  });

  it('leads with the OS share sheet', () => {
    expect(UTILITY).toContain('navigator.share(');
  });

  it('URL-encodes the join code into the link', () => {
    expect(UTILITY).toMatch(/code=\$\{encodeURIComponent\(joinCode\)\}/);
  });

  it('gates scheme senders as web-only in their contract', () => {
    // Both scheme senders document the native gate; surfaces enforce it
    // with isNativeApp() at the call site.
    const gates = UTILITY.match(/Dead in the native shell/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(2);
  });
});
