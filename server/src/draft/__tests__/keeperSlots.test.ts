import { describe, it, expect } from 'vitest';
import { assignKeeperSlots, keeperEffectiveRound } from '../keeperSlots';

const T1 = 'team-1';
const T2 = 'team-2';

describe('assignKeeperSlots', () => {
  it('a round-cost keeper takes the round he was drafted in', () => {
    expect(assignKeeperSlots([{ teamId: T1, playerId: 8471214, effectiveRound: 3 }], 16)).toEqual([
      { teamId: T1, playerId: 8471214, round: 3 },
    ]);
  });

  it('two keepers on the same round: the dearer keeps it, the other takes the next round', () => {
    const slots = assignKeeperSlots(
      [
        { teamId: T1, playerId: 200, effectiveRound: 3 },
        { teamId: T1, playerId: 100, effectiveRound: 3 },
        { teamId: T1, playerId: 300, effectiveRound: 1 },
      ],
      16,
    );
    expect(slots).toEqual([
      { teamId: T1, playerId: 300, round: 1 },
      { teamId: T1, playerId: 100, round: 3 },
      { teamId: T1, playerId: 200, round: 4 },
    ]);
  });

  it('a free keeper (penalty none) takes the last round the team has left', () => {
    const slots = assignKeeperSlots(
      [
        { teamId: T1, playerId: 100, effectiveRound: null },
        { teamId: T1, playerId: 200, effectiveRound: null },
        { teamId: T2, playerId: 300, effectiveRound: null },
      ],
      12,
    );
    expect(slots).toEqual([
      { teamId: T1, playerId: 100, round: 12 },
      { teamId: T1, playerId: 200, round: 11 },
      { teamId: T2, playerId: 300, round: 12 },
    ]);
  });

  it('a round past the draft moves up to the last round; a full team gets no more slots', () => {
    expect(assignKeeperSlots([{ teamId: T1, playerId: 100, effectiveRound: 25 }], 16)).toEqual([
      { teamId: T1, playerId: 100, round: 16 },
    ]);
    const slots = assignKeeperSlots(
      [
        { teamId: T1, playerId: 1, effectiveRound: 1 },
        { teamId: T1, playerId: 2, effectiveRound: 2 },
        { teamId: T1, playerId: 3, effectiveRound: 2 },
      ],
      2,
    );
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.playerId)).toEqual([1, 2]);
  });

  it('teams never collide with each other, and no rounds means no slots', () => {
    const slots = assignKeeperSlots(
      [
        { teamId: T1, playerId: 1, effectiveRound: 4 },
        { teamId: T2, playerId: 2, effectiveRound: 4 },
      ],
      16,
    );
    expect(slots.map((s) => s.round)).toEqual([4, 4]);
    expect(assignKeeperSlots([{ teamId: T1, playerId: 1, effectiveRound: 4 }], 0)).toEqual([]);
  });
});

describe('keeperEffectiveRound mirrors get_keeper_draft_costs', () => {
  it('round-cost is the original round, round-escalation climbs one a year with a floor of 1, none is free', () => {
    expect(keeperEffectiveRound('round-cost', 5, 2)).toBe(5);
    expect(keeperEffectiveRound('round-cost', null, 0)).toBe(1);
    expect(keeperEffectiveRound('round-escalation', 5, 2)).toBe(3);
    expect(keeperEffectiveRound('round-escalation', 2, 4)).toBe(1);
    expect(keeperEffectiveRound('none', 5, 2)).toBeNull();
    expect(keeperEffectiveRound(undefined, 5, 2)).toBeNull();
  });
});
