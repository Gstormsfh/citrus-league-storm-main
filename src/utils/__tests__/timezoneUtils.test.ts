import { describe, it, expect } from 'vitest';
import {
  formatDateToString,
  compareDateStrings,
  isDateInRange,
  parseDateStringLocal,
} from '../timezoneUtils';

describe('formatDateToString', () => {
  it('formats a date to YYYY-MM-DD', () => {
    const date = new Date(2026, 0, 15); // Jan 15, 2026
    expect(formatDateToString(date)).toBe('2026-01-15');
  });

  it('pads single-digit month and day', () => {
    const date = new Date(2026, 2, 5); // Mar 5, 2026
    expect(formatDateToString(date)).toBe('2026-03-05');
  });

  it('handles December correctly', () => {
    const date = new Date(2025, 11, 31); // Dec 31, 2025
    expect(formatDateToString(date)).toBe('2025-12-31');
  });
});

describe('compareDateStrings', () => {
  it('returns -1 when first date is earlier', () => {
    expect(compareDateStrings('2026-01-01', '2026-01-02')).toBe(-1);
  });

  it('returns 1 when first date is later', () => {
    expect(compareDateStrings('2026-02-15', '2026-01-15')).toBe(1);
  });

  it('returns 0 when dates are equal', () => {
    expect(compareDateStrings('2026-03-01', '2026-03-01')).toBe(0);
  });

  it('handles dates with time portions (strips T...)', () => {
    expect(compareDateStrings('2026-01-01T15:30:00', '2026-01-01T08:00:00')).toBe(0);
  });

  it('compares across years correctly', () => {
    expect(compareDateStrings('2025-12-31', '2026-01-01')).toBe(-1);
  });
});

describe('isDateInRange', () => {
  it('returns true when date is within range', () => {
    expect(isDateInRange('2026-01-15', '2026-01-01', '2026-01-31')).toBe(true);
  });

  it('returns true when date equals start', () => {
    expect(isDateInRange('2026-01-01', '2026-01-01', '2026-01-31')).toBe(true);
  });

  it('returns true when date equals end', () => {
    expect(isDateInRange('2026-01-31', '2026-01-01', '2026-01-31')).toBe(true);
  });

  it('returns false when date is before range', () => {
    expect(isDateInRange('2025-12-31', '2026-01-01', '2026-01-31')).toBe(false);
  });

  it('returns false when date is after range', () => {
    expect(isDateInRange('2026-02-01', '2026-01-01', '2026-01-31')).toBe(false);
  });

  it('handles dates with time portions', () => {
    expect(isDateInRange('2026-01-15T12:00:00', '2026-01-01', '2026-01-31')).toBe(true);
  });
});

describe('parseDateStringLocal', () => {
  it('parses YYYY-MM-DD correctly at local midnight', () => {
    const date = parseDateStringLocal('2026-02-15');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(1); // February (0-indexed)
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('strips time portion from datetime strings', () => {
    const date = parseDateStringLocal('2026-03-01T15:30:00Z');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2); // March
    expect(date.getDate()).toBe(1);
  });

  it('returns Invalid Date for empty string', () => {
    const date = parseDateStringLocal('');
    expect(isNaN(date.getTime())).toBe(true);
  });

  it('returns Invalid Date for malformed input', () => {
    const date = parseDateStringLocal('not-a-date');
    expect(isNaN(date.getTime())).toBe(true);
  });

  it('avoids UTC midnight bug (the critical fix this function exists for)', () => {
    // The bug: new Date("2026-02-02") creates UTC midnight = Feb 1 in MST
    // parseDateStringLocal should always give us Feb 2 in LOCAL time
    const date = parseDateStringLocal('2026-02-02');
    expect(date.getDate()).toBe(2); // Must be 2, not 1
    expect(date.getMonth()).toBe(1); // February
  });
});
