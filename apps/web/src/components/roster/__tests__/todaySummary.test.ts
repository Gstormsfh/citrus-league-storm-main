// GAME-DAY STRIP ARITHMETIC (2026-09-01, Sleeper parity audit R1)
//
// The strip is the first thing a manager reads on a game day, so its numbers
// have to be right in every shape a roster takes: full, short a body, a
// starter with no game, a bench full of games. Pure module, no render.
import { describe, it, expect } from 'vitest';
import { computeTodaySummary } from '../todaySummary';
import type { HockeyPlayer } from '../HockeyPlayerCard';

const mk = (
  id: string,
  over: Partial<HockeyPlayer> = {},
): HockeyPlayer =>
  ({ id, name: `P${id}`, position: 'C', number: 9, starter: true, team: 'EDM', stats: {}, ...over }) as HockeyPlayer;

/** A player the page decided HAS a game on the selected date. */
const plays = (id: string, proj: number) =>
  mk(id, { projectedPoints: proj, nextGame: { opponent: 'vs CGY', isToday: true } });
/** A player with no game — the page clears nextGame and zeroes the projection. */
const idle = (id: string) => mk(id, { projectedPoints: 0, nextGame: undefined });

describe('computeTodaySummary — the numbers', () => {
  it('counts starters with a game against the slot total and sums their projections', () => {
    const s = computeTodaySummary({
      starters: [plays('1', 4.2), plays('2', 3.1), idle('3')],
      bench: [],
      starterSlots: 13,
    });
    expect(s.startersPlaying).toBe(2);
    expect(s.starterSlots).toBe(13);
    expect(s.idleStarters).toBe(1);
    expect(s.emptySlots).toBe(10);
    expect(s.projected).toBeCloseTo(7.3, 5);
  });

  it('counts bench players with a game — the points sitting on the bench', () => {
    const s = computeTodaySummary({
      starters: [plays('1', 4.2)],
      bench: [plays('4', 2.0), idle('5'), plays('6', 1.1)],
      starterSlots: 1,
    });
    expect(s.benchPlaying).toBe(2);
    // Bench projections never leak into the starters' total.
    expect(s.projected).toBeCloseTo(4.2, 5);
  });

  it('only a literal true counts as "plays" — isToday is tri-state', () => {
    const s = computeTodaySummary({
      starters: [
        mk('1', { projectedPoints: 1, nextGame: { opponent: 'x', isToday: false } }),
        mk('2', { projectedPoints: 1, nextGame: undefined }),
        mk('3', { projectedPoints: 1, nextGame: { opponent: 'x', isToday: true } }),
      ],
      bench: [],
      starterSlots: 3,
    });
    expect(s.startersPlaying).toBe(1);
    expect(s.idleStarters).toBe(2);
  });

  it('never reports negative empty slots when more starters than slots slip through', () => {
    const s = computeTodaySummary({
      starters: [plays('1', 1), plays('2', 1)],
      bench: [],
      starterSlots: 1,
    });
    expect(s.emptySlots).toBe(0);
  });

  it('treats a missing or non-finite projection as zero rather than NaN', () => {
    const s = computeTodaySummary({
      starters: [
        mk('1', { projectedPoints: undefined, nextGame: { opponent: 'x', isToday: true } }),
        mk('2', { projectedPoints: Number.NaN, nextGame: { opponent: 'x', isToday: true } }),
        plays('3', 2.5),
      ],
      bench: [],
      starterSlots: 3,
    });
    expect(s.projected).toBeCloseTo(2.5, 5);
  });

  it('counts locked players across starters, bench and IR, and only those on the roster', () => {
    const s = computeTodaySummary({
      starters: [plays('1', 1)],
      bench: [plays('2', 1)],
      ir: [mk('3')],
      starterSlots: 1,
      lockedPlayerIds: new Set(['1', '3', '999']),
    });
    expect(s.locked).toBe(2);
  });

  it('reports zero locked when no lock set is supplied (past dates pass none)', () => {
    const s = computeTodaySummary({ starters: [plays('1', 1)], bench: [], starterSlots: 1 });
    expect(s.locked).toBe(0);
  });
});

describe('computeTodaySummary — when the strip turns amber', () => {
  it('a bench player with a game while a starter slot is EMPTY', () => {
    const s = computeTodaySummary({
      starters: [plays('1', 1)],
      bench: [plays('2', 1)],
      starterSlots: 2,
    });
    expect(s.needsAttention).toBe(true);
  });

  it('a bench player with a game while a starter has NO game', () => {
    const s = computeTodaySummary({
      starters: [plays('1', 1), idle('3')],
      bench: [plays('2', 1)],
      starterSlots: 2,
    });
    expect(s.needsAttention).toBe(true);
  });

  it('stays calm when every starter plays and the lineup is full, whatever the bench holds', () => {
    const s = computeTodaySummary({
      starters: [plays('1', 1), plays('3', 1)],
      bench: [plays('2', 9), plays('4', 9)],
      starterSlots: 2,
    });
    expect(s.needsAttention).toBe(false);
  });

  it('stays calm when nobody on the bench has a game, even with holes in the lineup', () => {
    const s = computeTodaySummary({
      starters: [idle('1')],
      bench: [idle('2')],
      starterSlots: 3,
    });
    expect(s.needsAttention).toBe(false);
  });

  it('an empty roster is calm, not an alert', () => {
    const s = computeTodaySummary({ starters: [], bench: [], starterSlots: 13 });
    expect(s).toMatchObject({
      startersPlaying: 0,
      benchPlaying: 0,
      emptySlots: 13,
      projected: 0,
      needsAttention: false,
    });
  });
});
