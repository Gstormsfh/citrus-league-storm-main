import { describe, it, expect } from 'vitest';
import {
  getFirstWeekStartDate,
  getWeekStartDate,
  getWeekEndDate,
  getAvailableWeeks,
  getScheduleLength,
  getWeekLabel,
  getWeekDateLabel,
} from '../weekCalculator';

describe('getFirstWeekStartDate', () => {
  it('returns the same Sunday if draft completes on Sunday', () => {
    // Sunday, March 1, 2026
    const sunday = new Date(2026, 2, 1); // Month is 0-indexed
    const result = getFirstWeekStartDate(sunday);
    expect(result.getDay()).toBe(0); // Sunday
  });

  it('returns next Sunday if draft completes on a weekday', () => {
    // Wednesday, March 4, 2026
    const wednesday = new Date(2026, 2, 4);
    const result = getFirstWeekStartDate(wednesday);
    expect(result.getDay()).toBe(0); // Sunday
    expect(result.getDate()).toBe(8); // Next Sunday is March 8
  });

  it('returns next day (Sunday) if draft completes on Saturday', () => {
    // Saturday, March 7, 2026
    const saturday = new Date(2026, 2, 7);
    const result = getFirstWeekStartDate(saturday);
    expect(result.getDay()).toBe(0); // Sunday
    expect(result.getDate()).toBe(8); // Next day is Sunday March 8
  });

  it('always returns a Date at midnight', () => {
    const date = new Date(2026, 2, 4, 15, 30, 0); // 3:30 PM
    const result = getFirstWeekStartDate(date);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });
});

describe('getWeekStartDate', () => {
  const firstWeek = new Date(2026, 2, 1); // Sunday March 1

  it('returns the first week start for week 1', () => {
    const result = getWeekStartDate(1, firstWeek);
    expect(result.getTime()).toBe(firstWeek.getTime());
  });

  it('returns 7 days later for week 2', () => {
    const result = getWeekStartDate(2, firstWeek);
    expect(result.getDate()).toBe(8); // March 8
  });

  it('returns 14 days later for week 3', () => {
    const result = getWeekStartDate(3, firstWeek);
    expect(result.getDate()).toBe(15); // March 15
  });
});

describe('getWeekEndDate', () => {
  const firstWeek = new Date(2026, 2, 1); // Sunday March 1

  it('returns Saturday (6 days after Sunday) for week 1', () => {
    const result = getWeekEndDate(1, firstWeek);
    expect(result.getDay()).toBe(6); // Saturday
    expect(result.getDate()).toBe(7); // March 7
  });

  it('returns correct Saturday for week 2', () => {
    const result = getWeekEndDate(2, firstWeek);
    expect(result.getDay()).toBe(6); // Saturday
    expect(result.getDate()).toBe(14); // March 14
  });
});

describe('getAvailableWeeks', () => {
  it('returns correct number of weeks for an October start (full season)', () => {
    // Sunday October 5, 2025 → Season ends ~April 15, 2026
    const firstWeek = new Date(2025, 9, 5);
    const weeks = getAvailableWeeks(firstWeek);
    // Oct 5 to Apr 15 is about 28 weeks
    expect(weeks.length).toBeGreaterThanOrEqual(26);
    expect(weeks.length).toBeLessThanOrEqual(30);
    expect(weeks[0]).toBe(1);
    expect(weeks[weeks.length - 1]).toBe(weeks.length);
  });

  it('returns correct number of weeks for a December start (mid-season)', () => {
    // Sunday December 7, 2025 → Season ends ~April 15, 2026
    const firstWeek = new Date(2025, 11, 7);
    const weeks = getAvailableWeeks(firstWeek);
    // Dec 7 to Apr 15 is about 19 weeks
    expect(weeks.length).toBeGreaterThanOrEqual(17);
    expect(weeks.length).toBeLessThanOrEqual(21);
  });

  it('returns at least 1 week even for a late start', () => {
    const firstWeek = new Date(2026, 3, 10); // April 10, very late
    const weeks = getAvailableWeeks(firstWeek);
    expect(weeks.length).toBeGreaterThanOrEqual(1);
  });

  it('returns sequential week numbers starting at 1', () => {
    const firstWeek = new Date(2025, 10, 1); // Nov 1
    const weeks = getAvailableWeeks(firstWeek);
    weeks.forEach((w, i) => {
      expect(w).toBe(i + 1);
    });
  });
});

describe('getScheduleLength', () => {
  it('returns same length as getAvailableWeeks', () => {
    const firstWeek = new Date(2025, 9, 5);
    expect(getScheduleLength(firstWeek)).toBe(getAvailableWeeks(firstWeek).length);
  });
});

describe('getWeekLabel', () => {
  const firstWeek = new Date(2026, 0, 4); // Sunday Jan 4, 2026

  it('formats same-month weeks correctly', () => {
    // Week 1: Jan 4 - Jan 10
    const label = getWeekLabel(1, firstWeek);
    expect(label).toContain('Week 1');
    expect(label).toContain('Jan');
  });

  it('formats cross-month weeks correctly', () => {
    // Week 4: Jan 25 - Jan 31 (same month) or crossing into Feb
    // Week 5 starts Feb 1 → ends Feb 7
    const label = getWeekLabel(5, firstWeek);
    expect(label).toContain('Week 5');
    expect(label).toContain('Feb');
  });
});

describe('getWeekDateLabel', () => {
  const firstWeek = new Date(2026, 0, 4); // Sunday Jan 4, 2026

  it('returns date portion without "Week N" prefix', () => {
    const label = getWeekDateLabel(1, firstWeek);
    expect(label).not.toContain('Week');
    expect(label).toContain('Jan');
  });
});

/**
 * SCHEDULE-GEN (2026-08-16) — offseason drafts must produce a season.
 *
 * The regression these pin: an August 2026 draft computed "regular
 * season ends April 15 2026" (the PAST), yielding zero weeks and a
 * silently empty schedule for every offseason-drafted league. Found
 * live: matchups table had 0 rows platform-wide.
 */
import { describe as describe2, it as it2, expect as expect2 } from 'vitest';
import { clampToSeasonStart, getAvailableWeeks as gaw } from '../weekCalculator';

describe2('clampToSeasonStart — offseason drafts land on the season opener', () => {
  it2('THE regression: an August draft clamps to the Monday of Oct-1 week', () => {
    const clamped = clampToSeasonStart(new Date(2026, 7, 16)); // Aug 16 2026
    expect2(clamped.getMonth()).toBe(8 + 1 === 9 ? 8 : 8); // September or October Monday
    // Oct 1 2026 is a Thursday → Monday of that week is Sep 28.
    expect2(clamped.getFullYear()).toBe(2026);
    expect2([8, 9]).toContain(clamped.getMonth()); // Sep 28 = month 8
    expect2(clamped.getDay()).toBe(1); // Monday
    expect2(clamped.getDate()).toBe(28);
  });

  it2('a September draft (Yahoo prime time) also clamps forward', () => {
    const clamped = clampToSeasonStart(new Date(2026, 8, 10)); // Sep 10
    expect2(clamped.getDate()).toBe(28);
    expect2(clamped.getMonth()).toBe(8);
  });

  it2('an in-season January anchor passes through untouched', () => {
    const jan = new Date(2027, 0, 11);
    expect2(clampToSeasonStart(jan)).toBe(jan);
  });

  it2('an October anchor passes through untouched', () => {
    const oct = new Date(2026, 9, 12);
    expect2(clampToSeasonStart(oct)).toBe(oct);
  });

  it2('END TO END: august anchor now yields a real season of weeks', () => {
    // Before the fix this returned ZERO weeks (season end in the past).
    const weeks = gaw(clampToSeasonStart(new Date(2026, 7, 16)));
    expect2(weeks.length).toBeGreaterThanOrEqual(25); // Sep 28→Apr 15 = 29 weeks
    expect2(weeks.length).toBeLessThanOrEqual(31);
    expect2(weeks[0]).toBe(1);
  });

  it2('COUNTERFACTUAL: the unclamped August anchor yields the 1-week bug', () => {
    // Pins WHY the clamp exists. The season-end heuristic put the end in
    // the PAST for an August anchor; Math.max(1, …) then floored the
    // count to a single 7-day "season" — the exact "WEEK 1/1 Aug 16-22"
    // observed live on staging with zero usable schedule behind it.
    const weeks = gaw(new Date(2026, 7, 16));
    expect2(weeks.length).toBe(1);
  });
});
