/**
 * MATCHUP LOAD EFFICIENCY (2026-09-01) — the founder opened the Matchup
 * page on the iPhone simulator and hit the 15-second timeout ("Loading
 * took too long"), then "Matchup is incredibly slow" on retry, and "the
 * daily score projections do not show in any matchup tabs."
 *
 * Root causes, each pinned here so a future edit cannot quietly undo it:
 *
 * 1. THE DATABASE DID FULL-CAREER SCANS PER WEEK. get_matchup_stats
 *    joined player_game_stats on player_id alone and zeroed non-week
 *    rows in CASE arms — 4,107ms measured for one league. The
 *    week-bounded rewrite (29-57ms) ships as a migration; the guard
 *    checks the migration exists and stays week-first.
 *
 * 2. A FULL-LEAGUE SCORE RECOMPUTE BLOCKED FIRST PAINT. The page
 *    awaited updateMatchupScores before rendering anything. It now
 *    fires in the background; stored scores render immediately, the
 *    way Yahoo/ESPN treat a score cache.
 *
 * 3. WEEK REDIRECTS RELOADED THE WHOLE APP. Landing on /matchup with
 *    no week (the bottom-nav tab) redirected via window.location.href —
 *    a full SPA re-download and re-boot on the page's most common
 *    entry. Client-side navigate keeps the booted app.
 *
 * 4. SIX OF SEVEN DAY CHIPS COULD NEVER SHOW A PROJECTION. The weekly
 *    strip computes a projected score for every day, but only the
 *    selected day's projections were ever fetched — and a single
 *    boolean in-flight guard dropped concurrent date fetches. The page
 *    now fetches the whole viewed week with a per-date guard.
 *
 * jsdom has no network or layout; these are source contracts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MATCHUP = readFileSync(resolve(here, '../pages/Matchup.tsx'), 'utf-8');
const MIGRATION = resolve(
  here,
  '../../../../supabase/migrations/20260901040000_fix_get_matchup_stats_week_bounded.sql',
);

describe('the matchup week-stats RPC stays week-bounded', () => {
  it('ships the week-bounded get_matchup_stats migration', () => {
    expect(existsSync(MIGRATION), 'migration file missing').toBe(true);
    const sql = readFileSync(MIGRATION, 'utf-8');
    // The load-bearing shape: the week slice materializes BEFORE any
    // player join, so no plan can walk a player's full career.
    expect(sql).toMatch(/week_rows AS MATERIALIZED/);
    expect(sql).toMatch(/JOIN filtered_games ng ON pgs\.game_id = ng\.game_id/);
    expect(sql).not.toMatch(/LEFT JOIN public\.player_game_stats pgs ON pl\.player_id = pgs\.player_id/);
  });
});

describe('nothing blocks the matchup first paint that can land later', () => {
  it('the league-wide score recompute is fire-and-forget on the LOAD path', () => {
    // Scope to the loader: the periodic live-refresh interval may await
    // its own recompute — that runs in the background by construction.
    const loaderStart = MATCHUP.indexOf('const loadMatchupData = async ()');
    const loaderEnd = MATCHUP.indexOf('loadMatchupData();', loaderStart);
    expect(loaderStart).toBeGreaterThan(-1);
    const loader = MATCHUP.slice(loaderStart, loaderEnd);
    expect(loader).toMatch(/void MatchupService\.updateMatchupScores/);
    expect(loader).not.toMatch(/await MatchupService\.updateMatchupScores/);
  });

  it('nothing on this page reloads the whole app to reach a matchup URL', () => {
    const reloadRedirects = MATCHUP.match(/window\.location\.href\s*=\s*`\/matchup/g) ?? [];
    expect(reloadRedirects, 'a matchup navigation regressed to a full page reload').toEqual([]);
    // Week browsing must be client-side navigation with week-scoped state reset.
    const weekChange = MATCHUP.slice(MATCHUP.indexOf('const handleWeekChange'));
    expect(weekChange).toMatch(/setSelectedMatchupId\(null\)/);
    expect(weekChange).toMatch(/navigate\(`\/matchup\/\$\{leagueId\}\/\$\{weekNumber\}`\)/);
  });

  it('the inner matchup-data timeout fires before the page-level one', () => {
    // Inner 12s < outer 15s, so the SPECIFIC error surfaces, not the
    // generic "Loading took too long".
    expect(MATCHUP).toContain('timed out after 12 seconds');
    expect(MATCHUP).not.toContain('timed out after 20 seconds');
  });
});

describe('every day of the viewed week gets projections', () => {
  it('the fetch effect walks the whole matchup week', () => {
    expect(MATCHUP).toMatch(/weekDates\.map\(d => fetchProjectionsForDate\(d\)\)/);
  });

  it('the in-flight guard is per-date, not a single boolean', () => {
    expect(MATCHUP).toMatch(/projectionsLoadingRef = useRef<Set<string>>/);
    expect(MATCHUP).toMatch(/projectionsLoadingRef\.current\.has\(date\)/);
    expect(MATCHUP).toMatch(/projectionsLoadingRef\.current\.delete\(date\)/);
  });
});
