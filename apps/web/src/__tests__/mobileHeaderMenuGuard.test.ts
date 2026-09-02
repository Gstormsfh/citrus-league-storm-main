/**
 * MOBILE HEADER MENU (2026-09-01) — iOS sim: League HQ, Profile, Trade
 * Center, Analytics, Team View, Playoffs, Schedule, Stormy, and Create
 * League all rendered the mobile chrome header as a centered title with
 * no hamburger — from those screens there was NO path to the league
 * switcher, Create / Join League, News, or Contact. Only half the app's
 * pages carried the menu, so navigation depended on which tab you
 * happened to be standing on.
 *
 * Contract: every page that renders the shared mobile chrome header
 * must mount MobileMenuButton inside that header. jsdom has no layout
 * engine; this is a source contract across src/pages.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = resolve(here, '../pages');

// The shared mobile chrome header (core-page pattern). `z-page-header` is
// the rung, not a number: src/styles/zLayers.ts owns the scale and
// zLayerScaleGuard fails any layer that stacks off it.
const HEADER = 'lg:hidden sticky top-0 z-page-header bg-[#0F1F15]/95';

const pagesWithHeader: Array<[string, string]> = readdirSync(pagesDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => [f, readFileSync(join(pagesDir, f), 'utf-8')] as [string, string])
  .filter(([, text]) => text.includes(HEADER));

describe('every mobile chrome header carries the menu button', () => {
  it('the header pattern is in use', () => {
    expect(pagesWithHeader.length).toBeGreaterThanOrEqual(9);
  });

  it.each(pagesWithHeader.map(([f]) => [f] as const))(
    '%s mounts MobileMenuButton in each mobile header',
    (file) => {
      const text = pagesWithHeader.find(([f]) => f === file)![1];
      let from = 0;
      let headers = 0;
      for (;;) {
        const start = text.indexOf(HEADER, from);
        if (start === -1) break;
        headers += 1;
        // The header block is small — title row + affordances; the
        // richest (Roster: team name, league subtitle, record) sits
        // within ~800 chars. A missing button cannot hide inside 1200.
        const slice = text.slice(start, start + 1200);
        expect(slice, `${file} header #${headers} lacks the menu button`).toContain('<MobileMenuButton />');
        from = start + 1;
      }
      expect(headers).toBeGreaterThan(0);
    },
  );
});
