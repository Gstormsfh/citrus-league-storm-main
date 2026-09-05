import { describe, it, expect } from 'vitest';
import { auctionNominatorTeamId, auctionRotation, isMyNomination } from '../auctionNominator';
import type { DraftOrderSlot } from '../fetchDraftOrderMatrix';

const MATRIX: DraftOrderSlot[] = [
  { round: 1, pickNumber: 1, teamId: 'a' },
  { round: 1, pickNumber: 2, teamId: 'b' },
  { round: 1, pickNumber: 3, teamId: 'c' },
  { round: 2, pickNumber: 4, teamId: 'c' },
  { round: 2, pickNumber: 5, teamId: 'b' },
  { round: 2, pickNumber: 6, teamId: 'a' },
];
const TEAMS = [{ id: 'x' }, { id: 'y' }];
const idle = (nominationsCompleted: number) => ({ nominationsCompleted, currentNomination: null, paused: false });

describe('auction nomination rotation', () => {
  it('is round 1 of the draft order, and the team list only without a matrix', () => {
    expect(auctionRotation(MATRIX, TEAMS)).toEqual(['a', 'b', 'c']);
    expect(auctionRotation(null, TEAMS)).toEqual(['x', 'y']);
    expect(auctionRotation([], TEAMS)).toEqual(['x', 'y']);
  });

  it('the pointer is the number of lots resolved, wrapping', () => {
    expect(auctionNominatorTeamId(idle(0), MATRIX, TEAMS)).toBe('a');
    expect(auctionNominatorTeamId(idle(2), MATRIX, TEAMS)).toBe('c');
    expect(auctionNominatorTeamId(idle(4), MATRIX, TEAMS)).toBe('b');
    expect(auctionNominatorTeamId(null, MATRIX, TEAMS)).toBeNull();
    expect(auctionNominatorTeamId(idle(0), null, [])).toBeNull();
  });

  it('nobody nominates while a lot is on the block, while paused, or as a spectator', () => {
    expect(isMyNomination(idle(1), MATRIX, TEAMS, 'b')).toBe(true);
    expect(isMyNomination(idle(1), MATRIX, TEAMS, 'a')).toBe(false);
    expect(isMyNomination({ ...idle(1), paused: true }, MATRIX, TEAMS, 'b')).toBe(false);
    expect(
      isMyNomination(
        { ...idle(1), currentNomination: { nominationId: 'n' } as unknown as NonNullable<ReturnType<typeof idle>['currentNomination']> },
        MATRIX,
        TEAMS,
        'b',
      ),
    ).toBe(false);
    expect(isMyNomination(idle(1), MATRIX, TEAMS, null)).toBe(false);
  });
});
