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
 * The game-log effect body, where the schedule window is chosen.
 *
 * Comments are stripped: the old call is NAMED in the comment that explains
 * why it went, so a naive grep would match the prose describing the fix and
 * report the bug as still present.
 */
function gameLogEffect(): string {
  const at = MODAL.indexOf('const fetchGameLog = async () => {');
  expect(at, 'the game-log fetch is gone from PlayerStatsModal').toBeGreaterThan(-1);
  return MODAL.slice(at, MODAL.indexOf('fetchGameLog();', at))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
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
    expect(MODAL).toMatch(/const playerKey = `\$\{player\.id\}-\$\{player\.team\}-\$\{logSeason\}`/);
    expect(MODAL).toMatch(/\}, \[isOpen, player, logSeason\]\)/);
  });

  it('bounds the window at both ends', () => {
    // Start only, and asking for 2025 also returns every 2026-27 game: the
    // "all of prior year combined" shape, in reverse.
    const body = gameLogEffect();
    expect(body).toContain('seasonWindow(logSeason)');
    expect(body).toMatch(/getGamesForTeam\(teamAbbrev, windowStart, windowEnd\)/);
    expect(MODAL).toContain('const nextStart = getSeasonStartDate(season + 1);');
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
    // Belt to that suspender: the modal no longer imports it at all, so no
    // other read in this file can quietly go back to the played season.
    expect(MODAL).not.toMatch(/import \{[^}]*getCurrentSeason[^}]*\} from '@citrus\/shared'/);
  });

  it('opens the window at the real opener, not a hardcoded September 1st', () => {
    expect(MODAL).toContain("getSeasonStartDate(season) ?? `${season}-09-01`");
    expect(
      /new Date\(`\$\{seasonYear\}-09-01/.test(MODAL),
      'the window is hardcoded to September 1st again',
    ).toBe(false);
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
