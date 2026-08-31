/**
 * MOCK DRAFT NAVIGATION (2026-08-31) — reported from the Capacitor build as
 * "I tried to jump into a mock draft and it totally failed."
 *
 * Every "Mock Draft" affordance in the navigation pointed at /draft: the
 * retired v1 league draft room, behind ProtectedRoute. An anonymous user was
 * bounced to /auth under a card that promised "No signup". A signed-in user
 * reached a page whose own fence declares v1 retired and which dead-ends on
 * "No league ID provided" when arriving without ?league= — which is exactly
 * what a nav link produces. Nothing on that path could ever reach the actual
 * simulator, which lives at /armchair-gm (public) under the mockdraft tab.
 *
 * These are source contracts: the invariant is that mock-draft navigation
 * points at a page that exists, is public, and can select the tab from the
 * URL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');

const MOCK_TARGET = '/armchair-gm?tab=mockdraft';

describe('mock draft navigation', () => {
  it('sends the footer Mock Draft link to the simulator, not the retired draft room', () => {
    const footer = read('../components/citrus2/HockeyFooter.tsx');
    expect(footer).toContain(`{ label: 'Mock Draft', to: '${MOCK_TARGET}' }`);
    expect(footer).not.toContain("{ label: 'Mock Draft', to: '/draft' }");
  });

  it('sends every homepage mock-draft affordance to the simulator', () => {
    const home = read('../components/citrus2/Homepage.tsx');
    expect(home).not.toContain("'/draft'");
    const targets = home.split(MOCK_TARGET).length - 1;
    expect(targets).toBeGreaterThanOrEqual(3);
  });

  it('lets ArmchairGM open on the tab the URL asked for', () => {
    const gm = read('../pages/ArmchairGM.tsx');
    expect(gm).toContain('useSearchParams');
    expect(gm).toMatch(/searchParams\.get\('tab'\)/);
    expect(gm).toMatch(/GM_TAB_IDS\.includes\(requestedTab\)/);
  });

  it('keeps the simulator route public — the cards promise no signup', () => {
    const app = read('../App.tsx');
    const armchairLine = app.split('\n').find((l) => l.includes('"/armchair-gm"') || l.includes("'/armchair-gm'")) ?? '';
    expect(armchairLine).not.toContain('ProtectedRoute');
  });
});
