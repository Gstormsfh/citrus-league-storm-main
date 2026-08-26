// MATCHUP LOAD (2026-08-26) — "Matchup tab still takes painfully long."
//
// A captured waterfall showed 102 requests in a staircase at ~350ms median.
// The staircase was not one long await chain; it was several independent
// fetches awaited one after another because that is how they were written.
//
// jsdom cannot time a real network, and these paths need a page's worth of
// state to execute, so this file pins the SHAPE of the fixes at the source
// level — the same approach usePreloadedPlayers.xg.test.ts already uses for a
// select list. A source contract is a weak test in general and a good one
// here: every regression this guards against is a textual one. Somebody
// re-serialises a Promise.all, or drops a sleep back in "just to be safe".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SERVICE = readFileSync(resolve(HERE, '..', 'MatchupService.ts'), 'utf8');
const PAGE = readFileSync(resolve(HERE, '..', '..', 'pages', 'Matchup.tsx'), 'utf8');

describe('MatchupService — independent fetches run together', () => {
  it('fetches schedule, lines, week stats and projections in one Promise.all', () => {
    // Each needs only allTeams or allPlayerIds, both known before any of them.
    // Serial, they were four round trips — about 1.4s of the ten-second load.
    const block = SERVICE.match(
      /const \[gamesResult, matchupLines, matchupStatsMap, dailyProjectionsMap\] = await Promise\.all\(\[[\s\S]*?\]\);/,
    );
    expect(block, 'the four independent roster fetches are no longer batched').not.toBeNull();
    const body = block![0];
    expect(body).toContain('getGamesForTeams');
    expect(body).toContain('getMatchupLines');
    expect(body).toContain('fetchMatchupStatsForPlayers');
    expect(body).toContain('getDailyProjectionsForMatchup');
  });

  it('keeps each of those four independently recoverable', () => {
    // Promise.all is only safe here because none of the four can reject —
    // each swallows its own failure and returns an empty Map, which is what
    // preserved the page's graceful degradation when they were serial.
    const block = SERVICE.match(
      /const \[gamesResult, matchupLines, matchupStatsMap, dailyProjectionsMap\] = await Promise\.all\(\[[\s\S]*?\]\);/,
    )![0];
    expect((block.match(/catch \(error: unknown\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('looks up the previous and next week together', () => {
    // Two lookups that only decide whether an arrow is enabled. They do not
    // belong on the critical path at all, and at minimum they run in parallel.
    expect(SERVICE).toMatch(/const \[prevResult, nextResult\] = await Promise\.all\(\[/);
  });
});

describe('Matchup page — no dead wall-clock, no double load', () => {
  it('does not sleep on the generation path', () => {
    // `await new Promise(r => setTimeout(r, 2000))`, twice, "to wait for
    // database commits" that had already happened.
    expect(PAGE).not.toMatch(/setTimeout\(resolve,\s*2000\)/);
    expect(PAGE).not.toMatch(/new Promise\(resolve => setTimeout\(resolve, \d{4,}\)\)/);
  });

  it('reads back generated matchups by polling instead', () => {
    expect(PAGE).toContain('readUntilPresent');
  });

  it('backfills both teams in one round trip', () => {
    expect(PAGE).toMatch(/await Promise\.all\(\[\s*backfillTeam\(currentMatchup\.team1_id/);
  });

  it('records the matchup it actually loaded, not the one selected when it started', () => {
    // On a cold visit selectedMatchupId is null while the load runs, so the
    // cache entry was stamped null; the effect then set selectedMatchupId to
    // the matchup it had just loaded, which failed its own cache-key check AND
    // tripped the "selected matchup changed → bypass cache" branch. The entire
    // ~20-request load ran twice, every time.
    expect(SERVICE.length).toBeGreaterThan(0);
    expect(PAGE).toMatch(/matchupId: matchupData\.matchup\?\.id \?\? selectedMatchupId/);
  });

  it('does not treat adopting its own matchup id as a user-initiated change', () => {
    expect(PAGE).toMatch(
      /prevSelectedMatchupIdRef\.current = matchupData\.matchup\.id;\s*\n\s*setSelectedMatchupId\(matchupData\.matchup\.id\);/,
    );
  });

  it('depends on the VALUE of the scoring settings, not the object identity', () => {
    // scoringSettings is replaced with a fresh literal in four places. Each
    // replacement used to give fetchAllDailyStats a new identity, firing 7
    // getDailyGameStats requests and re-arming the live-refresh effect, which
    // immediately fires 9 more.
    expect(PAGE).toMatch(/const scoringSignature = React\.useMemo\(/);
    expect(PAGE).toMatch(/userLeagueState, scoringSignature, demoMyTeam, demoOpponentTeam\]/);
  });

  it('does not clear demo state that is already clear', () => {
    // Four setters handing React a fresh [] and {} on the active-user path,
    // every time that effect ran — and those identities are dependencies of
    // fetchAllDailyStats.
    expect(PAGE).toMatch(/setDemoMyTeam\(\(prev\) => \(prev\.length === 0 \? prev : \[\]\)\)/);
    expect(PAGE).toMatch(/setDemoOpponentTeam\(\(prev\) => \(prev\.length === 0 \? prev : \[\]\)\)/);
  });

  it('does not import the dead DailyRosters component', () => {
    // Never rendered, and its own 7×2 serial fetch loop is a trap for whoever
    // next profiles this page.
    expect(PAGE).not.toMatch(/import \{ DailyRosters \}/);
  });
});
