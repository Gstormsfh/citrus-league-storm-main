/**
 * KEEPERS IN THE FOLD (2026-09-05). The snapshot names the league's locked
 * keepers and the slot each one costs. The client carries them through
 * every fold, keeps the players off the board from the first pick, and
 * names the slots for the board until the engine's own pick lands.
 */
import { describe, it, expect } from 'vitest';
import type { BufferedDraftEvent, DraftSnapshot } from '@citrus/shared';
import { deriveFromSnapshot, foldEvents } from '../deriveDraftState';
import type { DraftOrderSlot } from '../fetchDraftOrderMatrix';
import { toDraftedPlayerIds, toKeeperSlots } from '../v1Adapters';

const TEAMS = ['t1', 't2'];
const MATRIX: DraftOrderSlot[] = [
  { round: 1, pickNumber: 1, teamId: 't1' },
  { round: 1, pickNumber: 2, teamId: 't2' },
  { round: 2, pickNumber: 3, teamId: 't2' },
  { round: 2, pickNumber: 4, teamId: 't1' },
];

function pick(seq: number, slot: DraftOrderSlot, playerId: number): BufferedDraftEvent {
  return {
    kind: 'pick_submitted',
    seq,
    timestamp: `2026-09-08T00:00:${String(seq).padStart(2, '0')}.000Z`,
    teamId: slot.teamId,
    playerId,
    roundNumber: slot.round,
    pickNumber: slot.pickNumber,
    correlationId: `c${seq}`,
  };
}

const snapshot = (events: BufferedDraftEvent[]): DraftSnapshot => ({
  lobbyId: 'lobby-k',
  format: 'snake',
  recentEvents: events,
  stateSnapshot: {
    currentPickNumber: null,
    currentRoundNumber: null,
    onClockTeamId: null,
    picksMade: 0,
    draftStatus: 'not_started',
    totalPicks: TEAMS.length * 2,
    currentPickDeadline: null,
  },
  keepers: [{ teamId: 't1', playerId: '8471214', round: 2 }],
});

describe('keepers through the fold', () => {
  it('a kept player is off the board before any pick, and his slot is named', () => {
    const { state } = deriveFromSnapshot(snapshot([]), MATRIX);
    expect(state.keepers).toEqual([{ teamId: 't1', playerId: '8471214', round: 2 }]);
    expect(toDraftedPlayerIds(state)).toEqual(['8471214']);
    expect(toKeeperSlots(state).get('t1:2')).toBe('8471214');
  });

  it('survives every fold and is not doubled once the engine makes the keeper pick', () => {
    const first = deriveFromSnapshot(snapshot([pick(1, MATRIX[0], 100)]), MATRIX).state;
    expect(first.keepers).toHaveLength(1);
    const later = foldEvents(first, [pick(2, MATRIX[1], 200), pick(3, MATRIX[2], 300), pick(4, MATRIX[3], 8471214)], MATRIX).state;
    expect(later.keepers).toHaveLength(1);
    expect(later.picksMade).toBe(4);
    expect(toDraftedPlayerIds(later).filter((id) => id === '8471214')).toHaveLength(1);
    expect(later.teamRosters.get('t1')?.map((e) => e.playerId)).toEqual([100, 8471214]);
  });

  it('a league without keepers carries nothing extra', () => {
    const { keepers: _k, ...rest } = snapshot([]);
    void _k;
    const { state } = deriveFromSnapshot(rest as DraftSnapshot, MATRIX);
    expect(state.keepers).toBeUndefined();
    expect(toDraftedPlayerIds(state)).toEqual([]);
    expect(toKeeperSlots(state).size).toBe(0);
  });
});
