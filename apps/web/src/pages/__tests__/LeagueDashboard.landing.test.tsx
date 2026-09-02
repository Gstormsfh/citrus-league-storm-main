// T12P-4 (Entry 39 hostile pass, 2026-08-10) — LeagueDashboard landing
// corridor for a brand-new member.
//
// SCOPE: what a brand-new member sees the FIRST time they land here
// after auto-join deposits them (CreateLeague :628 routeToLeague ->
// /league/:leagueId). All hostile probes were rendered mentally against
// the source; the load-bearing dockets are UNRELATED to this commit
// and captured in R78. This test locks two COPY_VOICE contracts on the
// landing surface: the wrong-league toast and the load-failure fallback.
//
// The corridor's other visible sites (empty rink at :1691, timeline
// empty at LeagueTimelineCard :217, StormyLoading, status badges) are
// already at COPY_VOICE bar and don't need locks this cycle.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const DASH_PATH = resolve(HERE, '..', 'LeagueDashboard.tsx');

describe('LeagueDashboard — T12P-4 landing COPY_VOICE conformance (Entry 39)', () => {
  const source = readFileSync(DASH_PATH, 'utf8');

  it('wrong-league toast uses state-name title (not banned "Access Denied")', () => {
    // COPY_VOICE.md hard-ban list drops the "55x Error" pattern; the
    // corollary is that generic-wall titles ("Access Denied", "Not
    // Authorized") should be state names too. Pre-fix title was
    // "Access Denied" — a wall. Post-fix: "Wrong League" — the state.
    expect(source).not.toMatch(/title:\s*["']Access Denied["']/);
    expect(source).toMatch(/title:\s*["']Wrong League["']/);
  });

  it('wrong-league description drops "You are not a member" wall + offers a door', () => {
    // COPY_VOICE rule 3: errors own the blame; rule 4: doors not walls.
    // Pre-fix: "You are not a member of this league." — wall, no door.
    // Post-fix: "This one's not on your list — check the invite link
    // or pick one from GM Office." — owns the framing + door offered.
    expect(source).not.toMatch(/["']You are not a member of this league\.["']/);
    expect(source).toMatch(/check the invite link/);
  });

  it('load-failure setError fallback drops banned "Failed to load"', () => {
    // COPY_VOICE hard-ban: naked "Failed to" copy. This is the catch-
    // all at :229 — the branch that fires when getLeague / getUserTeam
    // / getLeagueTeams throws without a specific error message. The
    // brand-new member scenario: replica lag right after auto-join
    // could produce this on first landing.
    // Pre-fix: 'Failed to load league data'
    // Post-fix: "Couldn't load the league — refresh to try again."
    // Match: no setError call with the banned "Failed to load".
    expect(source).not.toMatch(/setError\([^)]*["']Failed to load league data["']/);
    // Post-fix must retain a retry door in the same setError branch.
    expect(source).toMatch(/setError\([^)]*refresh to try again/);
  });
});
