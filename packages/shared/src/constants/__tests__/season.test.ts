import { describe, it, expect } from 'vitest';
import { getSeasonYearForDate, getProjectionsSeason, getUpcomingSeasonStartDate } from '../season';

// Local-time constructor: month is 1-based here for readability.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12, 0, 0);

describe('getSeasonYearForDate', () => {
  it('offseason summer date belongs to the completed season-year', () => {
    expect(getSeasonYearForDate(d(2026, 8, 23))).toBe(2025);
  });

  it('flips early on the explicit 2026-09-29 season start', () => {
    expect(getSeasonYearForDate(d(2026, 9, 28))).toBe(2025);
    expect(getSeasonYearForDate(d(2026, 9, 29))).toBe(2026);
  });

  it('October always belongs to the new season-year', () => {
    expect(getSeasonYearForDate(d(2026, 10, 15))).toBe(2026);
  });
});

describe('getProjectionsSeason (Proj FP offseason join fix, 2026-08-23)', () => {
  it('offseason run-up (Jul–Sep) points at the UPCOMING season', () => {
    expect(getProjectionsSeason(d(2026, 7, 10))).toBe(2026);
    expect(getProjectionsSeason(d(2026, 8, 23))).toBe(2026); // the audit date
    expect(getProjectionsSeason(d(2026, 9, 10))).toBe(2026);
  });

  it('equals the current season once play has started', () => {
    expect(getProjectionsSeason(d(2026, 9, 29))).toBe(2026); // early start day
    expect(getProjectionsSeason(d(2026, 10, 15))).toBe(2026);
    expect(getProjectionsSeason(d(2027, 2, 1))).toBe(2026); // mid-season
  });

  it('does NOT double-advance after the early-start flip', () => {
    // Sep 30 2026: derived season already 2026 via SEASON_START_DATES —
    // must stay 2026, not become 2027.
    expect(getProjectionsSeason(d(2026, 9, 30))).toBe(2026);
  });

  it('early offseason (April–June) keeps last season until new projections exist', () => {
    expect(getProjectionsSeason(d(2027, 5, 15))).toBe(2026);
    expect(getProjectionsSeason(d(2027, 6, 30))).toBe(2026);
    expect(getProjectionsSeason(d(2027, 7, 1))).toBe(2027);
  });
});

describe('getUpcomingSeasonStartDate ("Games This Week" zero-grid fix, 2026-08-25)', () => {
  it('returns the opener while the season is still ahead', () => {
    // The audit date: nhl_games holds zero fixtures for this week because it
    // is August, and the widget needs to say WHY rather than show 7 zeros.
    expect(getUpcomingSeasonStartDate(d(2026, 8, 25))).toBe('2026-09-29');
    expect(getUpcomingSeasonStartDate(d(2026, 9, 28))).toBe('2026-09-29');
  });

  it('returns null once the opener has arrived — no stale "season opens" copy', () => {
    expect(getUpcomingSeasonStartDate(d(2026, 9, 29))).toBeNull();
    expect(getUpcomingSeasonStartDate(d(2026, 12, 1))).toBeNull();
  });

  it('returns null for seasons with no early-start entry, so callers degrade', () => {
    // SEASON_START_DATES only lists pre-October openers. A caller must fall
    // back to a generic "no games scheduled" message, never assume offseason.
    expect(getUpcomingSeasonStartDate(d(2027, 8, 1))).toBeNull();
  });

  it('compares on local calendar dates, not UTC instants', () => {
    // A late-evening local time on the day before the opener must still count
    // as "upcoming"; a UTC-based comparison would already have rolled over.
    expect(getUpcomingSeasonStartDate(new Date(2026, 8, 28, 23, 30, 0))).toBe('2026-09-29');
  });
});
