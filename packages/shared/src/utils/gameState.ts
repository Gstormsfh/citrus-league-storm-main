/**
 * THE GAME-STATE VOCABULARY — one reading of `nhl_games`, shared by the API
 * server and the browser so the two cannot drift.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE DATABASE ACTUALLY HOLDS TODAY (audited 2026-09-02, production)
 *
 *   status        ONLY ever 'final' (1,394 rows) or 'scheduled' (1,344).
 *                 There is NO in-progress row in the table right now.
 *   period        populated for 631 of the 2025 regular games and all 82
 *                 2025 playoff games; NULL on every scheduled row.
 *   period_time   same shape as period.
 *
 * So every live branch below is unexercised by today's data. That is the
 * point of putting it here as pure functions: the live path is written
 * against what the PIPELINE WRITES, proven by fixtures, and lights up the
 * moment those columns start moving — without one fabricated game ever being
 * rendered in the product.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE PIPELINE WRITES — read out of the writer, not guessed
 *
 * `data-pipeline/acquisition/scrape_live_nhl_stats.py`
 * → `update_game_scores_in_nhl_games()` is the only code that sets these
 * columns during a game, and it is unambiguous:
 *
 *   status       'live'      when NHL gameState is LIVE / CRIT / INTERMISSION
 *                'final'     when it is OFF / FINAL
 *                'scheduled' otherwise
 *   period       '1st' | '2nd' | '3rd' | 'OT' | 'SO'
 *                (periodDescriptor.number: 4 ⇒ 'OT', >4 ⇒ 'SO')
 *   period_time  clock.timeRemaining, i.e. 'MM:SS' REMAINING in the period
 *                — NOT elapsed. The literal 'INT' during an intermission
 *                (the API freezes timeRemaining at the last whistle, so
 *                printing it would show '10:32 left in the 2nd' for
 *                eighteen minutes). NULL once the game is final.
 *
 * Everything below is derived from that contract. The one place we are
 * generous is the INPUT: `server/src/services/ScheduleService.ts` queries
 * with capitalised 'Scheduled' / 'Live' / 'Final' in two places, and
 * `server/src/routes/nhl-playoffs.ts` accepts 'in_progress' as a live
 * synonym. Reading is therefore case-insensitive and knows both spellings;
 * WRITING a state name is exact.
 */

/** The five states the UI is allowed to render. Nothing else exists. */
export type GameState = 'scheduled' | 'live' | 'final' | 'postponed' | 'unknown';

/** Raw `status` strings that mean the game is being played right now. */
const LIVE_STATUSES = new Set(['live', 'in_progress', 'in progress', 'inprogress', 'crit', 'intermission']);
const FINAL_STATUSES = new Set(['final', 'off', 'completed', 'complete']);
const SCHEDULED_STATUSES = new Set(['scheduled', 'preview', 'fut', 'pre', 'upcoming']);
const POSTPONED_STATUSES = new Set(['postponed', 'ppd', 'cancelled', 'canceled', 'suspended']);

/**
 * Map a raw `nhl_games.status` onto the rendering vocabulary.
 *
 * An unrecognised value returns 'unknown' rather than being coerced to
 * 'scheduled'. A game in a state we have never seen must render as a game we
 * cannot describe, not as one we are claiming has not started.
 */
export function normalizeGameState(status: string | null | undefined): GameState {
  if (status === null || status === undefined) return 'unknown';
  const s = String(status).trim().toLowerCase();
  if (s === '') return 'unknown';
  if (LIVE_STATUSES.has(s)) return 'live';
  if (FINAL_STATUSES.has(s)) return 'final';
  if (SCHEDULED_STATUSES.has(s)) return 'scheduled';
  if (POSTPONED_STATUSES.has(s)) return 'postponed';
  return 'unknown';
}

/** True when the clock column is the intermission marker rather than a clock. */
export function isIntermission(periodTime: string | null | undefined): boolean {
  return typeof periodTime === 'string' && periodTime.trim().toUpperCase() === 'INT';
}

/**
 * Seconds remaining in the current period, or null when the column does not
 * carry a clock (NULL, 'INT', or anything that is not MM:SS).
 *
 * Deliberately strict: 'INT' is not 0 seconds, it is "no clock", and the
 * difference decides whether the urgency treatment fires.
 */
export function secondsRemaining(periodTime: string | null | undefined): number | null {
  if (typeof periodTime !== 'string') return null;
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(periodTime.trim());
  if (!m) return null;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
  return mins * 60 + secs;
}

/** The last regulation period. Period 4 is OT, 5+ is the shootout. */
const REGULATION_PERIODS = 3;

/** Periods, as the pipeline spells them, in order. */
const PERIOD_ORDER: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3, ot: 4, so: 5 };

/** Period label → its ordinal, or null when the label is not one we write. */
export function periodOrdinal(period: string | null | undefined): number | null {
  if (!period) return null;
  const key = String(period).trim().toLowerCase();
  if (key in PERIOD_ORDER) return PERIOD_ORDER[key];
  // Tolerate a bare integer, which is what `nhl_shots.period` carries and
  // what an older ingest may have left in `nhl_games.period`.
  const n = Number(key);
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
}

/**
 * URGENCY — Real Sports' signature treatment, and the one piece of this
 * module that is a judgement call rather than a transcription.
 *
 * Fires only when ALL of: the game is live, there is a real clock (not
 * 'INT'), the clock is at or under a minute, and the period is the third or
 * later. A close game in the first period is not urgent; a minute left in
 * the third is the whole reason someone opened the app.
 *
 * The `<= 60` reading depends on `period_time` being time REMAINING. That is
 * what the scraper writes (clock.timeRemaining) and it is checked at the
 * source, not assumed — but it has never been observed end to end, because
 * no live row has ever existed in this database. First live night, look at
 * one game and confirm the clock counts DOWN. If it ever counts up, this
 * function is the single place to invert.
 */
export function isFinalMinute(
  state: GameState,
  period: string | null | undefined,
  periodTime: string | null | undefined,
): boolean {
  if (state !== 'live') return false;
  const secs = secondsRemaining(periodTime);
  if (secs === null || secs > 60) return false;
  const ord = periodOrdinal(period);
  return ord !== null && ord >= REGULATION_PERIODS;
}

/**
 * 'OT' | 'SO' for a finished game that went past regulation, else null.
 *
 * Derived ONLY from `period`, which the live scraper leaves at its last
 * value when it writes the final. A final game whose `period` is NULL — 681
 * of the 2025 regular season, ingested by the schedule loader and never
 * touched in-game — returns null and gets a plain "Final". It is not
 * knowable from this table whether those went to overtime, and a guess
 * dressed as an F/OT is exactly the fabrication this module refuses.
 */
export function finalFlag(
  state: GameState,
  period: string | null | undefined,
): 'OT' | 'SO' | null {
  if (state !== 'final') return null;
  const ord = periodOrdinal(period);
  if (ord === null) return null;
  if (ord === 4) return 'OT';
  if (ord >= 5) return 'SO';
  return null;
}

/**
 * The short status word a scoreboard row prints on its right-hand side.
 *
 * Never invents a clock: a live game with no usable `period_time` prints the
 * period alone, and a game whose state we cannot read prints an em-dash-free
 * placeholder rather than a confident lie.
 */
export function gameStateLabel(
  state: GameState,
  period: string | null | undefined,
  periodTime: string | null | undefined,
): string {
  switch (state) {
    case 'live': {
      const p = period ? String(period).trim() : '';
      if (isIntermission(periodTime)) return p ? `INT ${p}` : 'Intermission';
      const clock = secondsRemaining(periodTime) !== null ? String(periodTime).trim() : '';
      if (p && clock) return `${clock} ${p}`;
      if (p) return p;
      if (clock) return clock;
      return 'Live';
    }
    case 'final': {
      const flag = finalFlag(state, period);
      return flag ? `Final/${flag}` : 'Final';
    }
    case 'postponed':
      return 'Postponed';
    case 'scheduled':
      return 'Scheduled';
    default:
      return 'Status unavailable';
  }
}
