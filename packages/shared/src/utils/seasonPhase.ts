/**
 * IS THERE HOCKEY RIGHT NOW — one answer, shared by the API server and the
 * browser so the two cannot drift.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Audited 2026-09-02, mid-offseason, four weeks before the season opens.
 * Every empty-state gate in the app asked *"is the list empty?"* — and in the
 * offseason the lists are full while the schedule is not. A drafted roster is
 * thirteen real players; a matchup is two real teams. Nothing was empty, so
 * nothing rendered an empty state, and the product asserted things that were
 * not true:
 *
 *   TodayStrip        "0/13 starters play · proj 0.0"     — a projection
 *                     claim, not an absence claim. Reads as a broken lineup
 *                     rather than an empty schedule, and directly contradicts
 *                     the rows beneath it, which correctly print "No Game".
 *   AutoLineupSheet   "Everyone with a game is already starting. Nothing to
 *                     change tonight."                    — nobody has a game.
 *   ScoreCard         "Win chance 50%" and "0 left"       — for a matchup that
 *                     cannot occur for another 27 days.
 *   StickyScoreBar    "Final" over "0.0 - 0.0"            — a matchup that has
 *                     never been played, labelled complete.
 *   Standings         a full 0-0-0 / .000 table           — a populated
 *                     scoreboard for a season with zero games.
 *
 * `Scores.tsx` was the ONLY screen that behaved, for one reason: its query
 * returns the schedule fact itself (`nearestDateWithGames`), so it can say
 * where the season went and offer one tap to get there. This module makes
 * that fact available to every other surface instead of one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE SCHEDULE ACTUALLY HOLDS (measured 2026-09-02, production)
 *
 *   game_type  season  games  first        last
 *   regular    2025    1312   2025-10-07   2026-04-16
 *   playoff    2025      82   2026-04-18   2026-06-14
 *   regular    2026    1344   2026-09-29   2027-04-10
 *
 * Three facts follow, and the phase vocabulary below is exactly these and
 * nothing more:
 *
 *   1. There is NO preseason in this table. The 2026 season opens 2026-09-29
 *      as `regular`. So there is no 'preseason' phase here — inventing one
 *      would be a label the data cannot support.
 *   2. The offseason is not a date range, it is a GAP. 2026-06-14 to
 *      2026-09-29 is 107 days with no rows. Hard-coding "June to September"
 *      would be wrong the first year the schedule shifts; asking the
 *      schedule is right every year.
 *   3. `playoff` is a real, distinct phase and the app already renders it
 *      (PoolPlayoffHub, NHLPlayoffBracket). It is not folded into `regular`.
 */

/**
 * The phases the schedule can actually support. No 'preseason': see fact 1
 * above. `unknown` is the honest answer when the schedule has not loaded —
 * it is NOT a synonym for offseason, and the UI must not draw an offseason
 * state from it. A screen that cannot tell should say nothing, not guess.
 */
export type SeasonPhase = 'regular' | 'playoffs' | 'offseason' | 'unknown';

/**
 * The raw schedule facts, as a server reads them out of `nhl_games`. Dates
 * are 'YYYY-MM-DD' in Mountain Time, matching `game_date` and the rest of
 * the app (see `timezone.ts` — the league runs on MT and game dates are
 * stored as MT calendar days, not instants).
 */
export interface ScheduleFacts {
  /** Today, MT, 'YYYY-MM-DD'. */
  today: string;
  /** Games scheduled on `today`, whatever their status. */
  gamesToday: number;
  /** Most recent date on or before today that has games. Null if none ever. */
  lastGameDate: string | null;
  /** Nearest date strictly after today that has games. Null if none scheduled. */
  nextGameDate: string | null;
  /** `game_type` of the games on `nextGameDate`, when known. */
  nextGameType?: string | null;
  /** `game_type` of the games on `lastGameDate`, when known. */
  lastGameType?: string | null;
}

/** What every surface asks, derived once. */
export interface SeasonStatus {
  phase: SeasonPhase;
  /** The only question most components need. */
  hasGamesToday: boolean;
  lastGameDate: string | null;
  nextGameDate: string | null;
  /** Whole days from today to `nextGameDate`. Null when nothing is scheduled. */
  daysUntilNextGame: number | null;
  /** Whole days since `lastGameDate`. Null when nothing has been played. */
  daysSinceLastGame: number | null;
  /**
   * True when there is no hockey today AND none tomorrow either — the state
   * in which "tonight", "live", "this week" and a points total are all lies.
   *
   * Deliberately NOT `phase === 'offseason'`: an All-Star break, a two-day
   * gap in February and the 107-day summer are the same problem for a screen
   * that says "proj 0.0 tonight". The phase is for copy ("Season opens
   * Sep 29" vs "No games today"); THIS is for suppression.
   */
  isDormant: boolean;
}

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → UTC midnight. Calendar days only; never an instant. */
function parseDay(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Whole calendar days between two 'YYYY-MM-DD' strings, `to - from`.
 * Both are parsed at UTC midnight, so DST never enters: the difference is
 * always an exact multiple of a day and no rounding is needed. (The MT
 * conversion happens upstream, when `today` is produced.)
 */
export function daysBetween(from: string, to: string): number | null {
  const a = parseDay(from);
  const b = parseDay(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * How long a gap has to be before a screen stops saying "today" and starts
 * explaining where the season went. One day: if there is hockey tomorrow,
 * "no games today" is the whole story and needs no essay.
 */
const DORMANT_AFTER_DAYS = 1;

/**
 * The line between "a break inside a season" and "the offseason", measured
 * as the WHOLE gap — days since the last game plus days until the next —
 * not the distance to either edge on its own.
 *
 * Why the whole gap. On 2026-09-02 the next game is 27 days out, which on a
 * forward-looking test alone would read as "the season is nearly here, call
 * it regular". But the last game was 80 days ago. Neither number decides it;
 * 107 does. Inside the Olympic break the two are ~10 and ~10, and the total
 * never approaches it.
 *
 * The threshold comes from the real 2025 schedule (measured 2026-09-02), not
 * from taste. Every gap of 3+ days in that season:
 *
 *   2026-02-05 → 2026-02-25   20 days   Milan Olympic break  (the longest)
 *   2025-12-23 → 2025-12-27    4 days   Christmas
 *   2026-05-29 → 2026-06-02    4 days   between playoff rounds
 *   2026-06-06 → 2026-06-09    3 days   between playoff rounds
 *   2026-06-11 → 2026-06-14    3 days   between playoff rounds
 *
 * versus the offseason itself: 2026-06-14 → 2026-09-29, 107 days.
 *
 * 30 sits with 10 days of margin above the longest in-season break and 77
 * below the shortest offseason. A break would have to grow half again as
 * long, or an offseason shrink to a third, before this is wrong.
 */
const OFFSEASON_TOTAL_GAP_DAYS = 30;

/**
 * Derive the one status every surface reads.
 *
 * Pure, total, and defensive about its input: a missing or malformed date
 * yields `unknown` rather than a guess, because the cost of guessing wrong
 * here is the product asserting there is no season during the season.
 */
export function deriveSeasonStatus(facts: ScheduleFacts | null | undefined): SeasonStatus {
  const unknown: SeasonStatus = {
    phase: 'unknown',
    hasGamesToday: false,
    lastGameDate: null,
    nextGameDate: null,
    daysUntilNextGame: null,
    daysSinceLastGame: null,
    // `unknown` must not trigger offseason copy. A screen that cannot tell
    // shows its normal self and says nothing about the season.
    isDormant: false,
  };

  if (!facts || parseDay(facts.today) === null) return unknown;

  const hasGamesToday = (facts.gamesToday ?? 0) > 0;
  const daysUntilNextGame = facts.nextGameDate
    ? daysBetween(facts.today, facts.nextGameDate)
    : null;
  const daysSinceLastGame = facts.lastGameDate
    ? daysBetween(facts.lastGameDate, facts.today)
    : null;

  const isDormant =
    !hasGamesToday && (daysUntilNextGame === null || daysUntilNextGame > DORMANT_AFTER_DAYS);

  // Which season surrounds this moment, ignoring whether it is dormant.
  // Today's games win; otherwise the nearest scheduled game names it, and
  // failing that the last one played does.
  const surrounding: SeasonPhase = hasGamesToday
    ? typePhase(facts.lastGameType)
    : daysUntilNextGame !== null
      ? typePhase(facts.nextGameType)
      : typePhase(facts.lastGameType);

  // The whole gap, not either edge. See OFFSEASON_TOTAL_GAP_DAYS.
  // A null on either side means "nothing on that side of the calendar",
  // which is unbounded, not zero — Infinity is the honest stand-in.
  const totalGap = hasGamesToday
    ? 0
    : (daysSinceLastGame ?? Number.POSITIVE_INFINITY) +
      (daysUntilNextGame ?? Number.POSITIVE_INFINITY);

  const phase: SeasonPhase =
    totalGap > OFFSEASON_TOTAL_GAP_DAYS ? 'offseason' : surrounding;

  return {
    phase,
    hasGamesToday,
    lastGameDate: facts.lastGameDate ?? null,
    nextGameDate: facts.nextGameDate ?? null,
    daysUntilNextGame,
    daysSinceLastGame,
    isDormant,
  };
}

function typePhase(t: string | null | undefined): SeasonPhase {
  return (t ?? '').trim().toLowerCase() === 'playoff' ? 'playoffs' : 'regular';
}

/**
 * The one line a dormant screen shows instead of a number it cannot justify.
 *
 * Returns null when there is hockey today — the caller renders its normal
 * content. A helper that returned "" would tempt a caller into rendering an
 * empty label, which is how a blank strip ships.
 *
 * The offseason and a mid-season break need different sentences. "Season
 * resumes in 3 days" over Christmas is alarming; "No games today" on
 * September 2nd is useless. The phase picks which one.
 */
export function dormantHeadline(status: SeasonStatus): string | null {
  if (!status.isDormant || status.phase === 'unknown') return null;

  if (status.phase !== 'offseason') {
    // A break inside a season. The reader knows the season is on; all they
    // need is that tonight is dark.
    const d = status.daysUntilNextGame;
    return d !== null && d > 1 ? `No games today — back in ${d} days` : 'No games today';
  }

  const d = status.daysUntilNextGame;
  if (!status.nextGameDate || d === null) return 'No games scheduled';
  if (d <= 0) return 'No games today';
  return d === 1 ? 'Season opens tomorrow' : `Season opens in ${d} days`;
}
