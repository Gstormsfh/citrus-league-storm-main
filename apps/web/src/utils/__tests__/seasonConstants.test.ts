import { describe, it, expect } from 'vitest';
import {
  CURRENT_SEASON,
  HEADSHOT_SEASON,
  SEASON_START_YEAR,
  SEASON_LABEL,
  DEFAULT_TEST_DATE,
  getHeadshotUrl,
} from '../seasonConstants';

// =============================================================================
// Season Constants — Value Verification
// =============================================================================

describe('Season Constants', () => {
  it('CURRENT_SEASON equals 2025', () => {
    expect(CURRENT_SEASON).toBe(2025);
  });

  it('HEADSHOT_SEASON equals "20252026"', () => {
    expect(HEADSHOT_SEASON).toBe('20252026');
  });

  it('SEASON_START_YEAR equals 2025', () => {
    expect(SEASON_START_YEAR).toBe(2025);
  });

  it('SEASON_LABEL equals "2025-26"', () => {
    expect(SEASON_LABEL).toBe('2025-26');
  });

  it('DEFAULT_TEST_DATE equals "2025-12-08"', () => {
    expect(DEFAULT_TEST_DATE).toBe('2025-12-08');
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
});
