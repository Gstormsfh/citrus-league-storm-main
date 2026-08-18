import { describe, it, expect } from 'vitest';
import {
  CURRENT_SEASON,
  HEADSHOT_SEASON,
  SEASON_START_YEAR,
  SEASON_LABEL,
  DEFAULT_TEST_DATE,
  getHeadshotUrl,
  getSeasonGameCount,
  getSeasonYearForDate,
} from '../seasonConstants';

// =============================================================================
// Season Constants — Value Verification
// =============================================================================

describe('Season Constants', () => {
  // These constants are DERIVED from today's date (NHL seasons run Oct-Jun, so
  // months 1-9 belong to the previous calendar year). They used to be asserted
  // against the literal 2025, which meant every one of these tests was set to
  // fail on 2026-10-01 - two days after opening night. That is the exact
  // literal-pinning the shared season module was created to eliminate, so the
  // assertions now check the RULE and the FORMAT instead of a frozen year.

  it('CURRENT_SEASON follows the Oct-Jun season-year rule for today', () => {
    const now = new Date();
    const expected = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
    expect(CURRENT_SEASON).toBe(expected);
  });

  it('HEADSHOT_SEASON is the eight-digit span starting at CURRENT_SEASON', () => {
    expect(HEADSHOT_SEASON).toMatch(/^\d{8}$/);
    expect(HEADSHOT_SEASON).toBe(`${CURRENT_SEASON}${CURRENT_SEASON + 1}`);
  });

  it('SEASON_START_YEAR tracks CURRENT_SEASON', () => {
    expect(SEASON_START_YEAR).toBe(CURRENT_SEASON);
  });

  it('SEASON_LABEL is YYYY-YY and tracks CURRENT_SEASON', () => {
    expect(SEASON_LABEL).toMatch(/^\d{4}-\d{2}$/);
    expect(SEASON_LABEL).toBe(
      `${CURRENT_SEASON}-${String((CURRENT_SEASON + 1) % 100).padStart(2, '0')}`,
    );
  });

  it('DEFAULT_TEST_DATE is a mid-season date inside the current season', () => {
    expect(DEFAULT_TEST_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DEFAULT_TEST_DATE).toBe(`${CURRENT_SEASON}-12-08`);
  });

  it('CURRENT_SEASON is a number', () => {
    expect(typeof CURRENT_SEASON).toBe('number');
  });

  it('HEADSHOT_SEASON is a string', () => {
    expect(typeof HEADSHOT_SEASON).toBe('string');
  });

  it('SEASON_LABEL contains a hyphen separator', () => {
    expect(SEASON_LABEL).toContain('-');
  });

  it('DEFAULT_TEST_DATE is a valid date string', () => {
    const parsed = new Date(DEFAULT_TEST_DATE);
    expect(parsed.toString()).not.toBe('Invalid Date');
  });
});

// =============================================================================
// getHeadshotUrl
// =============================================================================

describe('getHeadshotUrl', () => {
  it('returns a correctly formatted URL for valid inputs', () => {
    const url = getHeadshotUrl('TOR', 8478483);
    expect(url).toBe(`https://assets.nhle.com/mugs/nhl/${HEADSHOT_SEASON}/TOR/8478483.png`);
  });

  it('returns the correct URL with a string playerId', () => {
    const url = getHeadshotUrl('EDM', '8479318');
    expect(url).toBe(`https://assets.nhle.com/mugs/nhl/${HEADSHOT_SEASON}/EDM/8479318.png`);
  });

  it('returns null when teamAbbrev is null', () => {
    expect(getHeadshotUrl(null, 8478483)).toBeNull();
  });

  it('returns null when teamAbbrev is undefined', () => {
    expect(getHeadshotUrl(undefined, 8478483)).toBeNull();
  });

  it('returns null when teamAbbrev is an empty string', () => {
    expect(getHeadshotUrl('', 8478483)).toBeNull();
  });

  it('returns null when playerId is null', () => {
    expect(getHeadshotUrl('TOR', null)).toBeNull();
  });

  it('returns null when playerId is undefined', () => {
    expect(getHeadshotUrl('TOR', undefined)).toBeNull();
  });

  it('returns null when both teamAbbrev and playerId are null', () => {
    expect(getHeadshotUrl(null, null)).toBeNull();
  });

  it('returns null when both teamAbbrev and playerId are undefined', () => {
    expect(getHeadshotUrl(undefined, undefined)).toBeNull();
  });

  it('includes the HEADSHOT_SEASON in the URL', () => {
    const url = getHeadshotUrl('MTL', 12345);
    expect(url).toContain(HEADSHOT_SEASON);
  });

  it('URL ends with .png', () => {
    const url = getHeadshotUrl('BOS', 99999);
    expect(url).not.toBeNull();
    expect(url!.endsWith('.png')).toBe(true);
  });

  describe('getSeasonGameCount', () => {
    it('returns 84 for the 2026-27 season', () => {
      expect(getSeasonGameCount(2026)).toBe(84);
    });

    it('returns 82 for earlier seasons', () => {
      expect(getSeasonGameCount(2025)).toBe(82);
      expect(getSeasonGameCount(2024)).toBe(82);
      expect(getSeasonGameCount(2019)).toBe(82);
    });

    it('defaults to 82 for unknown future seasons rather than throwing', () => {
      expect(getSeasonGameCount(2099)).toBe(82);
    });
  });


  describe('getSeasonYearForDate — the season boundary', () => {
    // Local Date construction on purpose: the rule reads getMonth()/getFullYear(),
    // which are local, so a UTC-constructed date would test a different question.
    const on = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    it('THE 2026-27 REGRESSION: the season opens 2026-09-29, not October 1', () => {
      // 8 regular-season games are played before Oct 1. Under the bare month
      // rule these two days resolved to 2025, so every season-scoped query
      // asked for the previous season on the two biggest nights of the year.
      expect(getSeasonYearForDate(on('2026-09-28'))).toBe(2025);
      expect(getSeasonYearForDate(on('2026-09-29'))).toBe(2026);
      expect(getSeasonYearForDate(on('2026-09-30'))).toBe(2026);
      expect(getSeasonYearForDate(on('2026-10-01'))).toBe(2026);
    });

    it('leaves normal October-start seasons alone', () => {
      expect(getSeasonYearForDate(on('2024-11-15'))).toBe(2024);
      expect(getSeasonYearForDate(on('2025-12-01'))).toBe(2025);
      expect(getSeasonYearForDate(on('2026-04-16'))).toBe(2025);
      expect(getSeasonYearForDate(on('2027-01-15'))).toBe(2026);
    });

    it('a September date in a season with no early-start entry stays on the month rule', () => {
      expect(getSeasonYearForDate(on('2027-09-29'))).toBe(2026);
      expect(getSeasonYearForDate(on('2025-09-29'))).toBe(2024);
    });

    it('CONTROL: the function actually reads its argument', () => {
      // If it ignored the date every assertion above would pass vacuously.
      const seen = new Set([
        getSeasonYearForDate(on('2024-11-15')),
        getSeasonYearForDate(on('2026-09-29')),
        getSeasonYearForDate(on('2027-01-15')),
      ]);
      expect(seen.size).toBeGreaterThan(1);
    });
  });

});
