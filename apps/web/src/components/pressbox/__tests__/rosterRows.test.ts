/**
 * ROSTER ADAPTER GUARD (2026-09-04).
 *
 * The mapping between the roster payload and the Press Box row is where the
 * edge cases live, so it is a pure module and this pins its behaviour --
 * especially the four places it must NOT invent something the payload does
 * not contain.
 */
import { describe, it, expect } from 'vitest';

import { buildSlotConfig } from '@/components/roster/slotConfig';
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';

import { buildRosterRows, gameLabelFor, statLineFor, toRowPlayer } from '../rosterRows';

const p = (over: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({
    id: 'p1',
    name: 'Connor McDavid',
    position: 'C',
    number: 97,
    starter: true,
    stats: {},
    team: 'Edmonton Oilers',
    teamAbbreviation: 'EDM',
    ...over,
  }) as HockeyPlayer;

describe('the game line says only what the payload knows', () => {
  it('scheduled: opponent and time', () => {
    expect(gameLabelFor(p({ nextGame: { isToday: true, opponent: '@ DAL', gameTime: '8:30 PM', gameStatus: 'scheduled' } })))
      .toBe('@ DAL 8:30 PM');
  });

  it('live: the score if there is one, the word LIVE if there is not — never a period', () => {
    // The mock reads `vs TOR 3RD`. There is no period in this payload, so a
    // period is not printed. This is the assertion that keeps it that way.
    const withScore = gameLabelFor(p({ nextGame: { isToday: true, opponent: 'vs TOR', gameStatus: 'live', score: '2-1' } }));
    expect(withScore).toBe('vs TOR 2-1');
    expect(withScore).not.toContain('3RD');
    expect(gameLabelFor(p({ nextGame: { isToday: true, opponent: 'vs TOR', gameStatus: 'live' } }))).toBe('vs TOR LIVE');
  });

  it('final: FINAL and the score, or FINAL alone', () => {
    expect(gameLabelFor(p({ nextGame: { isToday: true, opponent: 'vs TOR', gameStatus: 'final', score: '4-2' } }))).toBe('FINAL 4-2');
    expect(gameLabelFor(p({ nextGame: { isToday: true, opponent: 'vs TOR', gameStatus: 'final' } }))).toBe('FINAL');
  });

  it('no game at all: nothing, not a placeholder', () => {
    expect(gameLabelFor(p())).toBe(undefined);
  });
});

describe('the stat line is actual stats or nothing', () => {
  it('prints what happened once a game is live', () => {
    const line = statLineFor(p({
      nextGame: { isToday: true, gameStatus: 'live' },
      daily_actual_stats: { goals: 1, assists: 2, shots_on_goal: 4 },
    }));
    expect(line).toBe('1G 2A 4 SOG');
    // The mock's `+1` is a plus/minus the daily stats object does not carry.
    expect(line).not.toContain('+');
  });

  it('prints nothing before puck drop, even with a projection sitting there', () => {
    expect(statLineFor(p({
      nextGame: { isToday: true, gameStatus: 'scheduled' },
      daily_projection: { total_projected_points: 6.9 } as HockeyPlayer['daily_projection'],
    }))).toBe(null);
  });

  it('a goalie gets goalie stats', () => {
    expect(statLineFor(p({
      position: 'Goalie',
      nextGame: { isToday: true, gameStatus: 'final' },
      daily_actual_stats: { saves: 31, goals_against: 2, wins: 1 },
    }))).toBe('31 SV 2 GA W');
  });
});

describe('tonight is a fact or a forecast, never both', () => {
  it('before the game: a projection and no actual', () => {
    const row = toRowPlayer(p({
      nextGame: { isToday: true, gameStatus: 'scheduled' },
      daily_projection: { total_projected_points: 6.9 } as HockeyPlayer['daily_projection'],
      daily_actual_points: 0,
    }));
    expect(row.isLiveOrFinal).toBe(false);
    expect(row.todayActual).toBe(null);
    expect(row.todayProjection).toBe(6.9);
  });

  it('after it starts: the actual, and a zero is a real number', () => {
    const row = toRowPlayer(p({
      nextGame: { isToday: true, gameStatus: 'final' },
      daily_actual_points: 0,
      daily_projection: { total_projected_points: 6.9 } as HockeyPlayer['daily_projection'],
    }));
    expect(row.isLiveOrFinal).toBe(true);
    expect(row.todayActual).toBe(0);
  });

  it('a goalie reads his own projection object', () => {
    const row = toRowPlayer(p({
      position: 'Goalie',
      goalieProjection: { total_projected_points: 11.2 } as HockeyPlayer['goalieProjection'],
    }));
    expect(row.todayProjection).toBe(11.2);
  });

  it('the week total is null — this payload has no weekly figure', () => {
    expect(toRowPlayer(p()).weekPoints).toBe(null);
  });
});

describe('positions beside the name only when there is more than one', () => {
  it('a single-position player prints nothing', () => {
    expect(toRowPlayer(p({ position: 'C' })).positionsLabel).toBe(undefined);
  });

  it('a dual-eligible player prints both', () => {
    const row = toRowPlayer(p({ position: 'C', eligible_positions: ['C', 'LW'] }));
    expect(row.positionsLabel).toContain('/');
  });
});

describe('the slot plan drives the rows', () => {
  const config = buildSlotConfig('individual');

  it('every league slot becomes a row, held or empty, in plan order', () => {
    const mcdavid = p({ id: 'p1' });
    const out = buildRosterRows({
      starters: [mcdavid],
      bench: [],
      slotConfig: config,
      slotAssignments: { p1: 'slot-C-1' },
    });
    expect(out.starters.length).toBe(config.allSlots.length);
    expect(out.starters.map((r) => r.slotId)).toEqual(config.allSlots);
    expect(out.starters.find((r) => r.slotId === 'slot-C-1')!.player!.name).toBe('Connor McDavid');
    expect(out.starters.find((r) => r.slotId === 'slot-C-2')!.player).toBe(null);
  });

  it('the counts are slots, not rows: one player in thirteen slots is 1/13', () => {
    const out = buildRosterRows({
      starters: [p({ id: 'p1' })],
      bench: [],
      slotConfig: config,
      slotAssignments: { p1: 'slot-C-1' },
    });
    expect(out.startersFilled).toBe(1);
    expect(out.startersRequired).toBe(config.allSlots.length);
  });

  it('an assignment pointing at nobody leaves the slot empty rather than throwing', () => {
    const out = buildRosterRows({
      starters: [],
      bench: [],
      slotConfig: config,
      slotAssignments: { ghost: 'slot-C-1' },
    });
    expect(out.starters.find((r) => r.slotId === 'slot-C-1')!.player).toBe(null);
    expect(out.startersFilled).toBe(0);
  });

  it('selection and eligibility land on the right rows', () => {
    const out = buildRosterRows({
      starters: [p({ id: 'p1' })],
      bench: [],
      slotConfig: config,
      slotAssignments: { p1: 'slot-C-1' },
      tapSelectedPlayerId: 'p1',
      tapEligibleSlots: new Set(['slot-C-2', 'slot-UTIL']),
    });
    expect(out.starters.find((r) => r.slotId === 'slot-C-1')!.selected).toBe(true);
    expect(out.starters.find((r) => r.slotId === 'slot-C-2')!.eligibleTarget).toBe(true);
    // The row the player is already in is never also a "move here" target.
    expect(out.starters.find((r) => r.slotId === 'slot-C-1')!.eligibleTarget).toBe(false);
    expect(out.starters.find((r) => r.slotId === 'slot-D-1')!.eligibleTarget).toBe(false);
  });

  it('bench rows are BN, keyed by player, and never a move target', () => {
    const out = buildRosterRows({
      starters: [],
      bench: [p({ id: 'b1' }), p({ id: 'b2', name: 'Jack Hughes' })],
      slotConfig: config,
      slotAssignments: {},
    });
    expect(out.bench.map((r) => r.slot)).toEqual(['BN', 'BN']);
    expect(out.bench.map((r) => r.slotId)).toEqual(['bench-b1', 'bench-b2']);
    expect(out.bench.every((r) => r.eligibleTarget === false)).toBe(true);
  });

  it('"playing tonight" counts games on the schedule, not projections', () => {
    // A scratched player can carry a stale projection, and a confirmed
    // starter whose team is idle must not be counted. The schedule decides.
    const out = buildRosterRows({
      starters: [],
      bench: [
        p({ id: 'b1', nextGame: { isToday: true, gameStatus: 'scheduled' } }),
        p({ id: 'b2', nextGame: { isToday: false, gameStatus: 'scheduled' } }),
        p({ id: 'b3', daily_projection: { total_projected_points: 5 } as HockeyPlayer['daily_projection'] }),
      ],
      slotConfig: config,
      slotAssignments: {},
    });
    expect(out.benchPlayingCount).toBe(1);
  });

  it('injury states tint the row', () => {
    const out = buildRosterRows({
      starters: [],
      bench: [p({ id: 'b1', status: 'GTD' }), p({ id: 'b2', status: null })],
      slotConfig: config,
      slotAssignments: {},
    });
    expect(out.bench[0].dtd).toBe(true);
    expect(out.bench[1].dtd).toBe(false);
  });
});
