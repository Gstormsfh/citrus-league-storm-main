/**
 * Re-export shim (2026-09-14). The week math moved to
 * `@citrus/shared` (packages/shared/src/utils/fantasyWeeks.ts) so the server
 * can generate a league's schedule at draft completion and the Matchup page
 * can stop doing it. Same names, same behaviour; import from here or from
 * '@citrus/shared' interchangeably.
 */
export {
  getDraftCompletionDate,
  WEEK_START_DAY_DOW,
  weekStartDayFor,
  weekStartDowFor,
  getTestFirstWeekStartDate,
  getFirstWeekStartDate,
  fantasyWeekAnchorFor,
  getWeekStartDate,
  getWeekEndDate,
  getCurrentWeekNumber,
  FANTASY_WEEK_START_DOW,
  weekEndDow,
  clampToSeasonStart,
  getAvailableWeeks,
  getScheduleLength,
  getWeekLabel,
  getWeekDateLabel,
  civilDateIn,
} from '@citrus/shared';
export type { WeekStartDay, FantasyWeekLeague } from '@citrus/shared';
