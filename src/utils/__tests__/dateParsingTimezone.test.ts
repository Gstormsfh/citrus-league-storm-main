import { describe, it, expect } from 'vitest';

/**
 * Regression tests for the timezone bug where new Date("YYYY-MM-DD") parses as
 * UTC midnight, which in timezones west of UTC (e.g., MST = UTC-7) becomes the
 * PREVIOUS day in local time. This caused:
 * - Player cards showing games from outside the matchup week
 * - Game day names (Sun/Mon/etc.) off by one day
 * - Schedule optimizer showing wrong games
 *
 * Fix: Always append 'T00:00:00' to force local-time parsing, or use string
 * comparison for YYYY-MM-DD dates instead of Date objects.
 */

describe('Date parsing timezone safety', () => {
  describe('new Date("YYYY-MM-DD") vs new Date("YYYY-MM-DDT00:00:00")', () => {
    it('should demonstrate the UTC parsing issue with date-only strings', () => {
      // new Date("2026-03-01") is parsed as UTC midnight
      const utcParsed = new Date('2026-03-01');
      expect(utcParsed.toISOString()).toBe('2026-03-01T00:00:00.000Z');

      // In any timezone west of UTC, getDate() returns the PREVIOUS day
      // We verify the fix works: appending T00:00:00 forces local-time parsing
      const localParsed = new Date('2026-03-01T00:00:00');
      expect(localParsed.getDate()).toBe(1); // Always March 1 in local time
      expect(localParsed.getMonth()).toBe(2); // March (0-indexed)
      expect(localParsed.getFullYear()).toBe(2026);
    });

    it('should give correct getDay() with T00:00:00 suffix', () => {
      // March 1, 2026 is a Sunday
      const date = new Date('2026-03-01T00:00:00');
      expect(date.getDay()).toBe(0); // Sunday
    });

    it('should give correct getDay() for Saturday end of week', () => {
      // March 7, 2026 is a Saturday
      const date = new Date('2026-03-07T00:00:00');
      expect(date.getDay()).toBe(6); // Saturday
    });
  });

  describe('formatDateLocal helper produces correct date strings', () => {
    const formatDateLocal = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    it('should produce correct date string with T00:00:00 parsed dates', () => {
      const date = new Date('2026-03-01T00:00:00');
      expect(formatDateLocal(date)).toBe('2026-03-01');
    });

    it('should produce correct boundary dates for a week', () => {
      const weekStart = new Date('2026-03-01T00:00:00');
      const weekEnd = new Date('2026-03-07T00:00:00');
      expect(formatDateLocal(weekStart)).toBe('2026-03-01');
      expect(formatDateLocal(weekEnd)).toBe('2026-03-07');
    });

    it('should handle month boundaries correctly', () => {
      // Week spanning Feb-Mar
      const weekStart = new Date('2026-02-22T00:00:00');
      const weekEnd = new Date('2026-02-28T00:00:00');
      expect(formatDateLocal(weekStart)).toBe('2026-02-22');
      expect(formatDateLocal(weekEnd)).toBe('2026-02-28');
    });
  });

  describe('game date filtering uses correct week boundaries', () => {
    it('should correctly filter games to Sun-Sat week using string comparison', () => {
      const weekStartStr = '2026-03-01'; // Sunday
      const weekEndStr = '2026-03-07';   // Saturday

      const games = [
        { game_date: '2026-02-27' }, // Previous week Friday — should be excluded
        { game_date: '2026-02-28' }, // Previous week Saturday — should be excluded
        { game_date: '2026-03-01' }, // Sunday — should be included
        { game_date: '2026-03-03' }, // Tuesday — should be included
        { game_date: '2026-03-07' }, // Saturday — should be included
        { game_date: '2026-03-08' }, // Next week Sunday — should be excluded
      ];

      const filtered = games.filter(g => {
        const gameDateStr = g.game_date.split('T')[0];
        return gameDateStr >= weekStartStr && gameDateStr <= weekEndStr;
      });

      expect(filtered).toHaveLength(3);
      expect(filtered[0].game_date).toBe('2026-03-01');
      expect(filtered[1].game_date).toBe('2026-03-03');
      expect(filtered[2].game_date).toBe('2026-03-07');
    });

    it('should not include previous week games when boundaries are correct', () => {
      // This was the actual bug: Feb 27 and Feb 28 games showing on Mar 1-7 week
      const weekStartStr = '2026-03-01';
      const weekEndStr = '2026-03-07';

      const feb27 = '2026-02-27';
      const feb28 = '2026-02-28';

      expect(feb27 >= weekStartStr).toBe(false);
      expect(feb28 >= weekStartStr).toBe(false);
    });
  });

  describe('game day name mapping', () => {
    it('should produce correct day names with T00:00:00 suffix', () => {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      // Week of Mar 1-7, 2026
      const testCases = [
        { date: '2026-03-01', expected: 'Sun' },
        { date: '2026-03-02', expected: 'Mon' },
        { date: '2026-03-03', expected: 'Tue' },
        { date: '2026-03-04', expected: 'Wed' },
        { date: '2026-03-05', expected: 'Thu' },
        { date: '2026-03-06', expected: 'Fri' },
        { date: '2026-03-07', expected: 'Sat' },
      ];

      testCases.forEach(({ date, expected }) => {
        const gameDate = new Date(date.split('T')[0] + 'T00:00:00');
        expect(dayNames[gameDate.getDay()]).toBe(expected);
      });
    });
  });
});
