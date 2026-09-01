/**
 * LEAGUE DRAFT ENTRY (2026-08-31) — reported from the iOS simulator as
 * "stuck on the waiting-for-the-draft-room page."
 *
 * Every league-side "Go to Draft Room" affordance — League HQ, Matchup's
 * empty state, Roster's empty state, Trade Analyzer's empty state — sent
 * users to /draft-room: the RETIRED v1 room, kept mounted only as a
 * cutover-safety fallback. The v2 engine room (/draft-v2/:leagueId), the
 * one that actually talks to the persistent draft engine, was reachable
 * only by typing its URL by hand. The cutover switch was never flipped,
 * so a league could never reach its own live draft through the UI.
 *
 * The invariant: league navigation points at the engine room. The v1
 * routes stay mounted (legacy URLs, chunk 11g.9 retires them) but nothing
 * in the app links to them anymore.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');

const ENTRY_PAGES = [
  '../pages/LeagueDashboard.tsx',
  '../pages/Matchup.tsx',
  '../pages/TradeAnalyzer.tsx',
  '../pages/Roster.tsx',
];

describe('league draft entry points', () => {
  it('never links to the retired v1 room again', () => {
    for (const page of ENTRY_PAGES) {
      expect(read(page), `${page} still targets the retired /draft-room`).not.toMatch(
        /draft-room\?league/,
      );
    }
  });

  it('sends every entry point to the v2 engine room', () => {
    for (const page of ENTRY_PAGES) {
      expect(read(page), `${page} has no /draft-v2 target`).toMatch(/\/draft-v2\/\$\{/);
    }
  });

  it('keeps the v2 route mounted where those links land', () => {
    const app = read('../App.tsx');
    expect(app).toMatch(/path="\/draft-v2\/:leagueId\/:draftId\?"/);
  });
});
