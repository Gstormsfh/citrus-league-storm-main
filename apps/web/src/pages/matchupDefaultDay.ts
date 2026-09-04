/**
 * Which day of the matchup week the page opens on.
 *
 * WHY THIS IS A MODULE (2026-09-03, "matchup glitches out while it loads").
 *
 * The Matchup page answered this question in two places, and one of them
 * needed a network round trip it did not actually need.
 *
 *   * the cheap effect only handled "today is inside this week", and
 *   * the real picker was gated on `dailyStatsByDate.size === 0`, i.e. on a
 *     seven-request daily-stats fetch that only STARTS once the loader has
 *     finished and the spinner has already come down.
 *
 * So on any week that does not contain today the page painted with
 * `selectedDate === null` (WEEK scope) and then, a few hundred milliseconds
 * later, re-assembled itself into DAY scope: the compact WeeklySchedule grew
 * its "Full week" button and pushed the entire lineup down ~36px, and every
 * player row swapped its week total for that day's number. In production on
 * 2026-09-03 NO matchup week contains today (checked: zero rows), so this was
 * every load, for everyone.
 *
 * The fix is not to fetch faster, it is to notice that the fetch cannot
 * change the answer for most weeks:
 *
 *   today inside the week   -> today. Needs nothing but the matchup.
 *   week entirely in future -> its first day. No day in it CAN have stats,
 *                              so the stats-driven branch could only ever
 *                              have landed on the same date, one fetch later.
 *   week entirely in past   -> the last day of it anyone actually scored on,
 *                              which genuinely does need the stats. Until
 *                              they arrive this returns null: "ask again".
 *
 * Both callers share this function so they cannot drift into disagreeing
 * about the day, which is the other way this flicker comes back.
 *
 * All comparisons are string comparisons on YYYY-MM-DD, deliberately: the
 * page's own note says `new Date("YYYY-MM-DD")` parses as UTC midnight and
 * slides to the previous day in MST.
 */

export interface DefaultMatchupDayInput {
  /** Today in the league's timezone, YYYY-MM-DD (getTodayMST()). */
  today: string;
  /** Matchup week bounds, YYYY-MM-DD inclusive. */
  weekStart: string;
  weekEnd: string;
  /**
   * The dates inside the loaded week that have any player stats at all, or
   * `null` when the daily-stats fetch has not settled yet. `null` is the
   * only value that can make this function decline to answer, and it can
   * only do so for a week that is entirely in the past.
   */
  datesWithStats: readonly string[] | null;
}

/**
 * The day to select, or `null` meaning "not decidable yet - call again once
 * the daily stats have landed". Never returns a date outside the week.
 */
export function defaultMatchupDay({
  today,
  weekStart,
  weekEnd,
  datesWithStats,
}: DefaultMatchupDayInput): string | null {
  // A malformed week cannot be reasoned about; the caller keeps week scope.
  if (!weekStart || !weekEnd || weekStart > weekEnd) return null;

  // The week we are in: open on today.
  if (today >= weekStart && today <= weekEnd) return today;

  // A week that has not started: nothing in it has been played, so no stats
  // can exist for any of its days and the answer is already final.
  if (today < weekStart) return weekStart;

  // A past week. Which day to open on is a fact about what was played, so
  // this is the one case that has to wait for the data.
  if (datesWithStats === null) return null;

  let mostRecent: string | null = null;
  for (const date of datesWithStats) {
    if (date < weekStart || date > weekEnd) continue;
    if (mostRecent === null || date > mostRecent) mostRecent = date;
  }

  // Stats are in hand and nobody scored inside the week: open on its first
  // day, the same fallback the page has always used.
  return mostRecent ?? weekStart;
}

export default defaultMatchupDay;
