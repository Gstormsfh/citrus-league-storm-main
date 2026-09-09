/**
 * HOW LONG A LEAGUE STAYS "THE" LEAGUE (2026-09-09).
 *
 * The app's default flow: open → league selector → pick a league → its
 * MATCHUP tab. After that the app reopens straight onto that matchup for a
 * while, because a manager checking their score twice a day should not pick
 * their league out of a list twice a day. Past that window the selector is
 * the front door again — a stale league is worse than one extra tap, and a
 * manager coming back after a few days usually wants a different league than
 * the one they last opened.
 *
 * The window is SLIDING, not fixed from first pick: every app open that lands
 * on the matchup re-stamps it. So daily use never sees the selector; a gap
 * longer than the window always does.
 *
 * Twelve hours is the founder's call (2026-09-09) and it has a shape: a
 * morning check-in and an evening one are the same session; tomorrow is not.
 *
 * Stored per user id, next to `citrus:activeLeagueId:<uid>` which holds WHICH
 * league. This file holds WHEN, and only that — no id, so it can never
 * disagree with the id key about which league is active.
 *
 * localStorage throws in private modes and some webviews; every accessor
 * swallows it and returns the safe answer (not fresh → show the selector).
 */

/** Twelve hours. */
export const LEAGUE_STICKY_MS = 12 * 60 * 60 * 1000;

const keyFor = (userId: string): string => `citrus:lastLeagueVisit:${userId}`;

/** Stamp "the user was in a league just now". */
export function markLeagueVisit(userId: string | null | undefined, now: number = Date.now()): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId), String(now));
  } catch {
    /* private mode / quota — stickiness degrades to "always show the selector" */
  }
}

/**
 * Is the last visit inside the window? False when there is no stamp, when the
 * stamp is unreadable, and when it is in the future (a clock change, or a
 * device that travelled) — a bogus stamp must not pin someone to a league
 * forever.
 */
export function isLeagueVisitFresh(
  userId: string | null | undefined,
  now: number = Date.now(),
  windowMs: number = LEAGUE_STICKY_MS,
): boolean {
  if (!userId) return false;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(keyFor(userId));
  } catch {
    return false;
  }
  if (!raw) return false;
  const stamped = Number(raw);
  if (!Number.isFinite(stamped)) return false;
  const age = now - stamped;
  if (age < 0) return false;
  return age < windowMs;
}

/** Drop the stamp, so the next open lands on the selector. */
export function clearLeagueVisit(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    /* nothing to do */
  }
}
