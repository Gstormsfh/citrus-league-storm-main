import { describe, it, expect } from 'vitest';
import { getSeasonYearForDate, getProjectionsSeason, getUpcomingSeasonStartDate, getPlayoffSeasonForDate, keeperSeasonYear } from '../season';

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

describe('getPlayoffSeasonForDate (playoff pool season key, 2026-09-03)', () => {
  it('holds 2025 across the whole gap between the two playoff runs', () => {
    // The 2025-26 run was played 2026-04-18..2026-06-14. It stays "the
    // current playoffs" until the next run starts, which is why the literal
    // ?season=2025 in the playoff pool pages was correct rather than stale.
    expect(getPlayoffSeasonForDate(d(2026, 4, 18))).toBe(2025); // first game
    expect(getPlayoffSeasonForDate(d(2026, 6, 14))).toBe(2025); // last game
    expect(getPlayoffSeasonForDate(d(2026, 9, 3))).toBe(2025);  // audit date
  });

  it('does NOT flip when the 2026-27 REGULAR season opens', () => {
    // This is the whole point. getSeasonYearForDate flips to 2026 here and
    // nhl_playoff_seeds holds nothing for 2026 until the following spring,
    // so a playoff page keyed on the regular-season year goes blank.
    expect(getSeasonYearForDate(d(2026, 9, 29))).toBe(2026);
    expect(getPlayoffSeasonForDate(d(2026, 9, 29))).toBe(2025);
    expect(getPlayoffSeasonForDate(d(2026, 12, 25))).toBe(2025);
    expect(getPlayoffSeasonForDate(d(2027, 1, 15))).toBe(2025);
    expect(getPlayoffSeasonForDate(d(2027, 3, 31))).toBe(2025);
  });

  it('flips to the new run on April 1, with no code change', () => {
    expect(getPlayoffSeasonForDate(d(2027, 4, 1))).toBe(2026);
    expect(getPlayoffSeasonForDate(d(2027, 6, 20))).toBe(2026);
  });

  it('January-March belongs to the run two calendar years back', () => {
    // Jan 2026: the last playoffs played were April-June 2025, season 2024.
    expect(getPlayoffSeasonForDate(d(2026, 2, 10))).toBe(2024);
  });
});

describe('keeperSeasonYear (keepers are for the next draft, 2026-09-05)', () => {
  it('before this season’s draft, keepers are for this season; after it, next season’s', () => {
    // September 2026, draft still ahead: the 2026-27 draft.
    expect(keeperSeasonYear(false, d(2026, 9, 5))).toBe(2026);
    // Same day, league already drafted: kept into the 2027-28 draft.
    expect(keeperSeasonYear(true, d(2026, 9, 5))).toBe(2027);
    // Mid-season January, drafted: next season.
    expect(keeperSeasonYear(true, d(2027, 1, 15))).toBe(2027);
  });
});
