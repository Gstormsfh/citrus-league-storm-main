// THE DAY THE MATCHUP PAGE OPENS ON (2026-09-03).
//
// The bug this locks: the page painted in WEEK scope and then re-assembled
// itself into DAY scope a few hundred milliseconds later, because the day was
// chosen from a daily-stats fetch that only starts after the loader finishes.
// On 2026-09-03 no matchup week in production contains today, so it happened
// on every load: the compact day strip grew its "Full week" button and pushed
// the whole lineup down, and every player row swapped its week total for a
// single day's number.
//
// The contract these cases pin is the one that makes the flicker impossible:
// for every week EXCEPT one already played, the answer does not depend on the
// stats, so it must come back with `datesWithStats: null` - i.e. before the
// first paint. The past week is the single case allowed to say "not yet", and
// when it does answer it must give the same date the old inline code did.

import { describe, it, expect } from 'vitest';
import { defaultMatchupDay } from '../matchupDefaultDay';

const WEEK = { weekStart: '2026-09-06', weekEnd: '2026-09-12' };

describe('defaultMatchupDay - decided without the stats wherever it can be', () => {
  it('today inside the week: today, with no stats in hand', () => {
    expect(
      defaultMatchupDay({ today: '2026-09-09', ...WEEK, datesWithStats: null }),
    ).toBe('2026-09-09');
  });

  it('the week boundaries count as inside it', () => {
    expect(defaultMatchupDay({ today: '2026-09-06', ...WEEK, datesWithStats: null })).toBe('2026-09-06');
    expect(defaultMatchupDay({ today: '2026-09-12', ...WEEK, datesWithStats: null })).toBe('2026-09-12');
  });

  // The regression itself. Every league drafting the week of 2026-09-03 has a
  // week 1 that has not started, and this is the call the page makes on its
  // first render - before any fetch has resolved.
  it('a week that has not started: its first day, with no stats in hand', () => {
    expect(
      defaultMatchupDay({ today: '2026-09-03', ...WEEK, datesWithStats: null }),
    ).toBe('2026-09-06');
  });

  it('a future week answers the same once stats arrive - the fetch never moved it', () => {
    expect(defaultMatchupDay({ today: '2026-09-03', ...WEEK, datesWithStats: [] })).toBe('2026-09-06');
  });

  it('a past week declines until the stats land, rather than guessing a day', () => {
    expect(
      defaultMatchupDay({ today: '2026-09-20', ...WEEK, datesWithStats: null }),
    ).toBeNull();
  });

  it('a past week opens on the most recent day anyone scored on', () => {
    expect(
      defaultMatchupDay({
        today: '2026-09-20',
        ...WEEK,
        datesWithStats: ['2026-09-07', '2026-09-10', '2026-09-08'],
      }),
    ).toBe('2026-09-10');
  });

  it('dates outside the week never win, even when they are more recent', () => {
    expect(
      defaultMatchupDay({
        today: '2026-09-20',
        ...WEEK,
        datesWithStats: ['2026-09-08', '2026-09-19'],
      }),
    ).toBe('2026-09-08');
  });

  it('a past week nobody scored in falls back to its first day', () => {
    expect(
      defaultMatchupDay({ today: '2026-09-20', ...WEEK, datesWithStats: [] }),
    ).toBe('2026-09-06');
  });

  it('a malformed week is declined, so the page keeps week scope', () => {
    expect(defaultMatchupDay({ today: '2026-09-09', weekStart: '', weekEnd: '', datesWithStats: null })).toBeNull();
    expect(
      defaultMatchupDay({ today: '2026-09-09', weekStart: '2026-09-12', weekEnd: '2026-09-06', datesWithStats: [] }),
    ).toBeNull();
  });
});
