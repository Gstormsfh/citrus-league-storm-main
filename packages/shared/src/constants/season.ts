/**
 * Central season configuration — single source of truth for all season-dependent values.
 *
 * All values are DERIVED from today's date via the same rule as the SQL
 * public.get_nhl_season_year function: NHL seasons run Oct→Jun, so
 * months 10-12 use the current calendar year and months 1-9 use the
 * previous calendar year. Prior to this file being derived, five files
 * across the codebase carried a literal "2025" that would have silently
 * broken every scoring/projection path on 2026-10-01.
 *
 * ── LIFECYCLE CAVEAT ─────────────────────────────────────────────────
 * The exported `const CURRENT_SEASON` is evaluated ONCE at module load.
 * A long-running Node/Cloud Run process that survives the Oct 1 flip
 * without restart will see the stale value. Two mitigations:
 *   1. Cloud Run auto-cycles instances; a warm instance rarely survives
 *      >24h in practice.
 *   2. For code on the hot path that MUST always see today's value —
 *      call `getCurrentSeason()` per iteration instead of importing
 *      CURRENT_SEASON.
 */

/**
 * Seasons that open BEFORE October, keyed by season year, as a local ISO date.
 *
 * The month rule below encodes "NHL seasons start in October". That is true of
 * every season in this codebase's history and false for the next one: 2026-27
 * opens 2026-09-29, and 8 regular-season games are played before October 1.
 * Without this map, CURRENT_SEASON reads 2025 on opening night and again on
 * Sept 30, flipping only on Oct 1 -- so for the first two days of the season
 * every season-scoped query asks for the previous one. player_directory holds
 * 805 players for 2026 and 1,076 for 2025; the default-lineup builder would
 * have been handed the wrong universe on the busiest night of the year.
 *
 * Explicit map rather than a derived rule, for the same reason
 * SEASON_GAME_COUNTS is one: the NHL sets this per season by agreement, and a
 * wrong value does not throw -- it silently returns last season's data.
 *
 * The SQL side does not need this map. public.get_current_season() reads the
 * loaded fixture list directly, which is strictly better; the browser cannot,
 * so it gets the table.
 */
// 2025 opened 2025-10-07, which the month rule already resolves correctly, so
// it is not needed by the derivation below. It is listed anyway because
// getSeasonStartDate() answers from this map, and a season the map does not
// know returns null rather than a date. Adding a past season is inert for the
// derivation: the lookup below only ever reads key `byCalendar + 1`.
const SEASON_START_DATES: Record<number, string> = {
  2026: '2026-09-29',
  2025: '2025-10-07',
};

/** Local-calendar ISO date. Deliberately local, not UTC, to stay on the same
 * basis as the getMonth()/getFullYear() rule below. */
function _localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _deriveNhlSeasonYear(d: Date = new Date()): number {
  // Month is 0-indexed in JS; NHL season year starts in October (month
  // 10 = index 9).
  const byCalendar = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;

  // If the NEXT season has an explicit early start and we are on or past it,
  // that season has begun regardless of the month.
  const nextStart = SEASON_START_DATES[byCalendar + 1];
  if (nextStart && _localISODate(d) >= nextStart) {
    return byCalendar + 1;
  }

  return byCalendar;
}

/** Always-fresh NHL season year. Prefer this over CURRENT_SEASON in any
 * long-lived process or hot path that must pick up the Oct 1 flip
 * without a restart. */
export function getCurrentSeason(): number {
  return _deriveNhlSeasonYear();
}

/**
 * The NHL season year for an arbitrary date.
 *
 * Exported so the rule can be tested at a specific date. Until 2026-08-11
 * there was no such entry point -- getCurrentSeason() takes no argument and
 * always reads the clock -- which is the direct reason the "seasons start in
 * October" assumption survived into a season that starts in September. A rule
 * you cannot evaluate at a date you choose is a rule you cannot test.
 */
export function getSeasonYearForDate(d: Date): number {
  return _deriveNhlSeasonYear(d);
}

/**
 * The season year that ROS PROJECTIONS describe — the season being
 * played or, in the offseason run-up (July–September, before the flip),
 * the UPCOMING one.
 *
 * Why this exists (found 2026-08-23, final pre-launch audit): actuals
 * for last season are keyed 2025 while the ingested projections for the
 * upcoming season are keyed 2026. Any query joining projections on
 * getCurrentSeason() reads zero rows all summer — the Players dashboard
 * showed "—" in Proj FP for all 974 players. In-season the two keys
 * coincide and this function equals getCurrentSeason().
 */
export function getProjectionsSeason(d: Date = new Date()): number {
  const cur = _deriveNhlSeasonYear(d);
  const byCalendar = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;
  // An explicit early start already flipped the derived season — keep it.
  if (cur > byCalendar) return cur;
  // July (6) through September (8): projections describe next season.
  return d.getMonth() >= 6 && d.getMonth() <= 8 ? cur + 1 : cur;
}

/**
 * The NHL season whose PLAYOFF RUN is the current one at a given date.
 *
 * This is a different question from getSeasonYearForDate, and the two
 * deliberately disagree for half the year. A season's playoffs are played in
 * April-June of the FOLLOWING calendar year, so:
 *   - Jan-Mar of year Y: the most recent playoffs were April-June of Y-1,
 *     which belong to season Y-2. Season Y-1's playoffs have not started.
 *   - Apr-Dec of year Y: the playoffs of April-June Y, which belong to
 *     season Y-1.
 *
 * Concretely, this returns 2025 -- the 2025-26 run, played 2026-04-18 to
 * 2026-06-14 -- for every date from 2026-04-01 until 2027-03-31, and flips to
 * 2026 on 2027-04-01 when the 2026-27 run begins.
 *
 * Why this exists (found 2026-09-03, launch audit): five call sites across
 * PoolPlayoffBracket, PoolPlayoffConfidence and PoolPlayoffHub carried a
 * literal `?season=2025` in their bracket and h2h request URLs. The literal
 * was CORRECT -- 2025 is the right playoff key until April 2027 -- and
 * "fixing" it to getCurrentSeason() would have been a regression: that
 * function flips to 2026 on 2026-09-29 when the 2026-27 REGULAR season
 * opens, and nhl_playoff_seeds/series hold nothing for season 2026 until the
 * following spring, so every playoff pool page would have gone blank
 * twenty-two days after launch. What the literal lacked was a rule and a
 * single place to change: this is that rule, and it needs no code change in
 * April 2027.
 *
 * A pool that is scoring a SPECIFIC past run should prefer the season stored
 * on the league (leagues.playoff_season, resolved server-side by
 * public.pool_playoff_season) over this date-derived default. This answers
 * "which playoff run is current" for a page with no league context.
 */
export function getPlayoffSeasonForDate(d: Date = new Date()): number {
  // getMonth() is 0-indexed: 0-2 is Jan-Mar.
  return d.getMonth() <= 2 ? d.getFullYear() - 2 : d.getFullYear() - 1;
}

/** Always-fresh current playoff-run season. See getPlayoffSeasonForDate. */
export function getCurrentPlayoffSeason(): number {
  return getPlayoffSeasonForDate();
}

/**
 * The first regular-season game date for a given season, or null when the
 * map does not carry that season. Companion to getUpcomingSeasonStartDate,
 * which answers the same question from a date rather than a season number.
 */
export function getSeasonStartDate(season: number): string | null {
  return SEASON_START_DATES[season] ?? null;
}

/**
 * Local ISO date of the next season opener still in the future, or null once
 * the season is under way.
 *
 * Why (found 2026-08-25, roster/UX audit): "Games This Week" rendered seven
 * zeros and painted every day with the red OFF-NIGHT treatment. The data was
 * correct — nhl_games holds 2,738 fixtures spanning 2025-10-07..2027-04-10
 * and exactly zero between 2026-08-18 and 2026-09-01, because it is August.
 * Correct numbers presented with no context read as a broken app, which is
 * the same failure `getProjectionsSeason` exists to fix one screen over.
 * A UI that knows a week is empty *because the season has not started* can
 * say so instead of implying the schedule failed to load.
 *
 * CAVEAT: derived from SEASON_START_DATES, which only lists seasons opening
 * BEFORE October (that map exists to correct the month rule, not to be a
 * complete fixture list). For an ordinary October opener there is no entry
 * and this returns null — callers must degrade to a generic "no games this
 * week" message rather than assuming offseason.
 */
export function getUpcomingSeasonStartDate(d: Date = new Date()): string | null {
  const today = _localISODate(d);
  const upcoming = Object.values(SEASON_START_DATES)
    .filter((iso) => iso > today)
    .sort();
  return upcoming.length > 0 ? upcoming[0] : null;
}

/** The numeric season identifier used in DB queries. Evaluated at module
 * load — see LIFECYCLE CAVEAT above. Use `getCurrentSeason()` when a
 * long-lived process must pick up the Oct 1 flip without restart. */
export const CURRENT_SEASON = _deriveNhlSeasonYear();

/** The calendar year the regular season starts (October). Same value as
 * CURRENT_SEASON — kept as a distinct export for clarity at call sites
 * where the semantic is "October start year." */
export const SEASON_START_YEAR = CURRENT_SEASON;

/** The NHL headshot asset season path segment (e.g. "20252026" for the
 * 2025-26 season). Derived. */
export const HEADSHOT_SEASON = `${CURRENT_SEASON}${CURRENT_SEASON + 1}`;

/** Human-readable season label (e.g. "2025-26"). Derived. */
export const SEASON_LABEL = `${CURRENT_SEASON}-${String((CURRENT_SEASON + 1) % 100).padStart(2, '0')}`;

/** Default test date fallback used by services when VITE_TEST_DATE is not set.
 * Derived to a mid-season date (Dec 8) of the current NHL season year. */
export const DEFAULT_TEST_DATE = `${CURRENT_SEASON}-12-08`;

/**
 * Build the NHL headshot URL for a player.
 * Falls back to null if team or playerId is missing.
 */
export function getHeadshotUrl(teamAbbrev: string | null | undefined, playerId: number | string | null | undefined): string | null {
  if (!teamAbbrev || !playerId) return null;
  return `https://assets.nhle.com/mugs/nhl/${HEADSHOT_SEASON}/${teamAbbrev}/${playerId}.png`;
}

/**
 * Number of REGULAR-SEASON games for a given NHL season.
 *
 * Mirrors the SQL `public.get_season_game_count(season)`. 2026-27 is an
 * 84-game season; every earlier season in our data is 82.
 *
 * Kept as an explicit map rather than a derived rule because the NHL sets
 * this per season by agreement, not by formula. A wrong value here does not
 * throw — it silently zeroes every rest-of-season projection once a player
 * passes the assumed game count, in the final week, when leagues are decided.
 */
const SEASON_GAME_COUNTS: Record<number, number> = {
  2026: 84,
};

/** Regular-season game count for `season`. Defaults to 82. */
export function getSeasonGameCount(season: number): number {
  return SEASON_GAME_COUNTS[season] ?? 82;
}
