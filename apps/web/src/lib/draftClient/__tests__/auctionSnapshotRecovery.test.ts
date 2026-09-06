import { describe, expect, it } from 'vitest';
import type { DraftSnapshot } from '@citrus/shared';
import { seedAuctionState, foldAuctionEvents } from '../deriveAuctionState';
import { deriveFromSnapshot } from '../deriveDraftState';

const snapshot: DraftSnapshot = {
  lobbyId: 'l1', format: 'auction',
  stateSnapshot: { totalPicks: 28, picksMade: 1, draftStatus: 'paused', currentPickNumber: 2, currentRoundNumber: 1, onClockTeamId: 't2', currentPickDeadline: null },
  auctionState: { currentNomination: null, nominationsCompleted: 1, teamBudgets: { t1: 180 }, teamRosterSlotsRemaining: { t1: 13 } },
  recentEvents: [
    { kind: 'draft_started', seq: 1, timestamp: '', correlationId: '', startedAt: '', firstPickDeadline: '', totalRounds: 14, totalTeams: 2, pickTimeLimitSeconds: 30, draftFormat: 'auction' },
    { kind: 'auction_nomination_closed', seq: 2, timestamp: '', nominationId: 'n1', playerId: '8478402', winnerTeamId: 't1', finalAmount: 20, totalBids: 1 },
  ],
};

describe('returning to an auction', () => {
  it('restores prior sales without deducting the snapshot budget twice', () => {
    const state = seedAuctionState(snapshot)!;
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({ playerId: '8478402', amount: 20, teamId: 't1' });
    expect(state.wonPlayerIds.has('8478402')).toBe(true);
    expect(state.budgets.get('t1')).toEqual({ remaining: 180, slotsRemaining: 13 });
    expect(state.paused).toBe(true);
    expect(foldAuctionEvents(state, snapshot.recentEvents)).toEqual(state);
  });
  it('reconstructs the saved pick when the start event survives the API snapshot', () => {
    const result = deriveFromSnapshot(snapshot, null);
    expect(result.gaps).toEqual([]);
    expect(result.state.picksMade).toBe(1);
    expect(result.state.teamRosters.get('t1')?.[0].playerId).toBe(8478402);
  });
});
