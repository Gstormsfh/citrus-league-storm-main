/**
 * WHICH SEASON EACH HALF OF THE PLAYER CARD IS ABOUT (2026-09-04).
 *
 * Reported from the device, the night before archive: "schedule in the game
 * log is still showing 2025 - we need to have it show THIS year, and
 * projections - and not all of prior year combined. However their stats and
 * advanced metrics need to be prior year for now until the season starts."
 *
 * That is one card asking two different questions of the calendar, and the
 * modal was asking both with `getCurrentSeason()`:
 *
 *   SCHEDULE + PROJECTIONS  look FORWARD.  getProjectionsSeason() -> 2026
 *   SEASON STATS + ADVANCED look BACK.     getCurrentSeason()     -> 2025
 *
 * They agree from the opener onward and disagree for the whole summer, which
 * is why this shipped: it was correct in-season and wrong for the twenty-five
 * days that happen to contain TestFlight.
 *
 * Measured on production the same day, which is what makes the split a fact
 * rather than a preference:
 *   player_projected_stats   66,024 rows for season 2026 (2026-09-29..2027-04-10)
 *                            72,060 rows for season 2025, all in the past
 *   player_season_stats           0 rows for season 2026, 1,063 for 2025
 *   nhl_games                 1,344 games on or after 2026-09-29
 *
 * So stats CANNOT come from 2026 - there are none - and projections cannot
 * come from 2025 without being last season's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCurrentSeason, getProjectionsSeason, getSeasonYearForDate } from '@citrus/shared';

const here = dirname(fileURLToPath(import.meta.url));
const MODAL = readFileSync(resolve(here, '../PlayerStatsModal.tsx'), 'utf-8');

/**
 * Source with the prose taken out.
 *
 * Every check below greps for a call that the fix REMOVED, and the comments
 * explaining the fix name that call - so a naive grep would match the note
 * describing the repair and report the bug as still present.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The game-log effect body, where the schedule window is chosen. */
function gameLogEffect(): string {
  const at = MODAL.indexOf('const fetchGameLog = async () => {');
  expect(at, 'the game-log fetch is gone from PlayerStatsModal').toBeGreaterThan(-1);
  return stripComments(MODAL.slice(at, MODAL.indexOf('fetchGameLog();', at)));
}

describe('the two seasons disagree exactly when it matters', () => {
  it('splits during the run-up to the opener', () => {
    // 2026-09-04, the day this was reported.
    const d = new Date('2026-09-04T12:00:00Z');
    expect(getSeasonYearForDate(d), 'the season being played').toBe(2025);
    expect(getProjectionsSeason(d), 'the season being projected').toBe(2026);
  });

  it('agrees again from the opener onward, so nothing changes in-season', () => {
    for (const day of ['2026-09-29', '2026-10-15', '2027-01-20', '2027-04-10']) {
      const d = new Date(`${day}T12:00:00Z`);
      expect(getProjectionsSeason(d), `${day}: the two must agree in-season`).toBe(
        getSeasonYearForDate(d),
      );
    }
  });

  it('does not double-count the flip', () => {
    // The early-start entry moves getSeasonYearForDate to 2026 on the opener.
    // If getProjectionsSeason still added a year on top, the card would jump
    // to 2027 for the whole of September.
    expect(getProjectionsSeason(new Date('2026-09-29T12:00:00Z'))).toBe(2026);
    expect(getProjectionsSeason(new Date('2026-09-30T12:00:00Z'))).toBe(2026);
  });

  it('both helpers answer for today without throwing', () => {
    expect(Number.isInteger(getCurrentSeason())).toBe(true);
    expect(Number.isInteger(getProjectionsSeason())).toBe(true);
  });
});

describe('the reader can pick the season, and lands on the right one', () => {
  it('opens on the season ahead', () => {
    // "it needs to show this years schedule in game log unless they choose
    // 2025-2026." The default is the initializer, not an effect that corrects
    // itself a render later.
    expect(MODAL).toMatch(/useState<number>\(\(\) => getProjectionsSeason\(\)\)/);
  });

  it('offers exactly two seasons, this one and the one behind it', () => {
    expect(MODAL).toMatch(/\[getProjectionsSeason\(\), getProjectionsSeason\(\) - 1\]/);
    expect(MODAL).toContain('data-testid={`gamelog-season-${yr}`}');
    expect(MODAL).toContain('aria-pressed={active}');
  });

  it('labels them the way a season is written everywhere else', () => {
    expect(MODAL).toContain('seasonLabel(yr)');
    expect(MODAL).toMatch(/String\(\(season \+ 1\) % 100\)\.padStart\(2, '0'\)/);
  });

  it('refetches when the season changes, rather than serving the other one', () => {
    // The identity key carries the season; without it the ref short-circuits
    // and the picker moves the highlight and nothing else.
    expect(MODAL).toMatch(/const playerKey = `\$\{gameLogPlayer\.id\}-\$\{gameLogPlayer\.team\}-\$\{logSeason\}`/);
    expect(MODAL).toMatch(/\}, \[isOpen, gameLogPlayer, logSeason\]\)/);
  });

  it('bounds the window at both ends', () => {
    // Start only, and asking for 2025 also returns every 2026-27 game: the
    // "all of prior year combined" shape, in reverse.
    const body = gameLogEffect();
    expect(body).toContain('seasonWindow(logSeason)');
    expect(body).toMatch(/getGamesForTeam\(teamAbbrev, windowStart, windowEnd\)/);
    expect(MODAL).toContain('const nextStart = getSeasonStartDate(season + 1);');
  });

  it('keeps the regular season only: the playoff run inside the window is dropped (2026-09-05)', () => {
    // The window runs to the eve of the next opener, so a full playoff run
    // sat in the log (Quinn Hughes: "93 Games", May dates). Fantasy is the
    // regular season; the schedule rows carry game_type and the stats map is
    // keyed by those rows' dates, so the playoff stats fall away with them.
    const body = gameLogEffect();
    expect(body).toMatch(/game_type === 'regular'/);
    expect(body).toMatch(/const games = \(scheduled \?\? \[\]\)\.filter\(/);
  });

  it('the picker survives the loading state', () => {
    // A reader who lands on the wrong season must be able to leave it without
    // waiting for it to arrive.
    const picker = MODAL.indexOf('aria-label="Season"');
    const spinner = MODAL.indexOf('{gameLogLoading ? (');
    expect(picker).toBeGreaterThan(-1);
    expect(spinner).toBeGreaterThan(-1);
    expect(picker, 'the picker renders inside the loading branch').toBeLessThan(spinner);
  });

  it('the empty state says WHICH season is empty', () => {
    expect(MODAL).toContain('No games in {seasonLabel(logSeason)}');
  });

  it('a new player opens on the season ahead again', () => {
    expect(MODAL).toContain('setLogSeason(getProjectionsSeason());');
  });
});

describe('the game log asks the forward-looking question', () => {
  it('builds its window from the projections season, not the played one', () => {
    const body = gameLogEffect();
    expect(MODAL).toContain('getProjectionsSeason()');
    expect(
      body.includes('getCurrentSeason()'),
      'the schedule is back on the season being played; all summer it will show the season that just ended',
    ).toBe(false);
    expect(body).toContain('seasonWindow(logSeason)');
  });

  it('the played season is only ever LABELLED, never used to fetch anything', () => {
    // Belt to that suspender. The modal does still import getCurrentSeason -
    // the Overview and Detailed headers have to name the season those stats
    // came from - so the guard cannot be "it is absent". It is: every call
    // site is a label or the comparison that drives one. Strike those two
    // shapes out and nothing may remain, so no future read can quietly go
    // back to the season being played to ask for data.
    const executable = stripComments(MODAL);
    const leftovers = executable
      .replace(/seasonLabel\(getCurrentSeason\(\)\)/g, '')
      .replace(/getProjectionsSeason\(\) !== getCurrentSeason\(\)/g, '');
    expect(
      leftovers.includes('getCurrentSeason()'),
      'getCurrentSeason() is being read for something other than a season label',
    ).toBe(false);
    // And the labels really are there, so this does not pass by deletion.
    expect(executable).toContain('seasonLabel(getCurrentSeason())');
  });

  it('opens the window at the real opener, not a hardcoded September 1st', () => {
    expect(MODAL).toContain("getSeasonStartDate(season) ?? `${season}-09-01`");
    expect(
      /new Date\(`\$\{seasonYear\}-09-01/.test(MODAL),
      'the window is hardcoded to September 1st again',
    ).toBe(false);
  });
});

describe('every tab says which season it is showing', () => {
  it('Overview and Detailed name the season they read', () => {
    // They have no picker because there is nothing to pick between:
    // production 2026-09-04 holds 1,063 season-stat rows and 940 talent-metric
    // rows for 2025, and none of either for 2026. What they must not do is
    // let a stat line with no year on it be read as "this season" - which is
    // exactly wrong during the run-up.
    expect(MODAL).toContain('data-testid="overview-season-label"');
    expect(MODAL).toContain('data-testid="advanced-season-label"');
    expect(MODAL).toMatch(/\{seasonLabel\(getCurrentSeason\(\)\)\} season/);
  });

  it('tells the reader when the other season starts, but only while they differ', () => {
    expect(MODAL).toMatch(/getProjectionsSeason\(\) !== getCurrentSeason\(\)/);
    expect(MODAL).toContain('openerLabel');
  });

  it('the game log and the stat tabs read DIFFERENT seasons, on purpose', () => {
    // The whole point of the split. If these ever collapse to one call the
    // card is lying on one half or the other for twenty-five days a year.
    expect(MODAL).toContain('getProjectionsSeason()');
    expect(MODAL).toContain('getCurrentSeason()');
  });
});

describe('the card never wears the previous player\'s numbers', () => {
  it('clears the log and the totals when the player changes, not only on close', () => {
    // `heroProjectedPts` reads `totalProjected` straight out of state and
    // renders it at the top of the card in the largest type on the screen,
    // outside any loading gate. Leaving it set across a player change put the
    // LAST player's projection under this one's name.
    const at = MODAL.indexOf('fetchedForPlayerRef.current = playerKey;');
    expect(at).toBeGreaterThan(-1);
    const afterKeying = MODAL.slice(at, MODAL.indexOf('const fetchGameLog', at));
    for (const reset of [
      'setGameLog([])',
      'setTotalProjected(0)',
      'setTotalActual(0)',
      'setGoalieStartsRemaining(null)',
      'setGameLogLoading(true)',
    ]) {
      expect(afterKeying, `${reset} does not run when the player changes`).toContain(reset);
    }
  });

  it('refuses to let a superseded response write', () => {
    // Two players opened in quick succession: the first request can land
    // second and repaint the card with the wrong man's season.
    expect(MODAL).toContain('let cancelled = false;');
    expect(MODAL).toMatch(/if \(cancelled\) return;\s*\n\s*setGameLog\(entries\)/);
    expect(MODAL).toContain('if (!cancelled) setGameLogLoading(false);');
    expect(MODAL).toMatch(/return \(\) => \{\s*\n\s*cancelled = true;/);
  });

  it('cannot leave the spinner running when the player has no team', () => {
    // That early return used to fire before the loading flag was ever set,
    // which is how the card could sit on stale content indefinitely.
    const body = gameLogEffect();
    expect(body).toMatch(/if \(!teamAbbrev\) \{\s*\n\s*setGameLogLoading\(false\);/);
  });
});
