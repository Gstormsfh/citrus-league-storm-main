/**
 * Legacy re-export shim — the real source of truth lives in
 * `@citrus/shared/constants/season`. Kept because 15+ web files still
 * import from here; migrating them is a follow-up (KI-tbd).
 *
 * Do NOT add values here — add to the shared module and re-export.
 */

export {
  CURRENT_SEASON,
  SEASON_START_YEAR,
  HEADSHOT_SEASON,
  SEASON_LABEL,
  DEFAULT_TEST_DATE,
  getCurrentSeason,
  getSeasonGameCount,
  getHeadshotUrl,
} from '@citrus/shared';
