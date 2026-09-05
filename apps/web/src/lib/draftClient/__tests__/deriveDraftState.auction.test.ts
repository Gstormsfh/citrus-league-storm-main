/**
 * AUCTION LOTS ARE PICKS (2026-09-05). Found live on prod, four lots into
 * the first real auction: RECENT RESULTS listed the sales, the header read
 * `0 / 168 SOLD`, the board was empty, McDavid was still in the pool and
 * MY TEAM said "No picks yet". `foldEvents` no-op'd every auction event,
 * and every one of those surfaces reads the state it folds.
 */
import { describe, it, expect } from 'vitest';
import type { BufferedDraftEvent } from '@citrus/shared';
import { emptyDerivedState, foldEvents, type DerivationSeed } from '../deriveDraftState';
import type { DraftOrderSlot } from '../fetchDraftOrderMatrix';

const SEED: DerivationSeed = { totalPicks: 4, format: 'auction' as DerivationSeed['format'] };
const MATRIX: DraftOrderSlot[] = [
  { round: 1, pickNumber: 1, teamId: 't1' },
  { round: 1, pickNumber: 2, teamId: 't2' },
  { round: 2, pickNumber: 3, teamId: 't2' },
  { round: 2, pickNumber: 4, teamId: 't1' },
];
const ts = (seq: number) => `2026-09-05T17:00:${String(seq).padStart(2, '0')}.000Z`;

const started = (seq: number, nominationId: string, playerId: string, nominatorTeamId: string): BufferedDraftEvent => ({
  kind: 'auction_nomination_started',
  seq,
  timestamp: ts(seq),
  correlationId: `c-${seq}`,
  nominationId,
  playerId,
  playerName: `Player ${playerId}`,
  nominatorTeamId,
  openingBid: 1,
  clockDeadline: ts(seq + 30),
});
const bid = (seq: number, nominationId: string, bidderTeamId: string, bidAmount: number): BufferedDraftEvent => ({
  kind: 'auction_bid_placed',
  seq,
  timestamp: ts(seq),
  correlationId: `c-${seq}`,
  nominationId,
  bidderTeamId,
  bidAmount,
  clockDeadline: ts(seq + 30),
});
const closed = (seq: number, nominationId: string, winnerTeamId: string, playerId: string, finalAmount: number): BufferedDraftEvent => ({
  kind: 'auction_nomination_closed',
  seq,
  timestamp: ts(seq),
  nominationId,
  winnerTeamId,
  finalAmount,
  totalBids: 2,
  playerId,
});

describe('foldEvents — an auction lot won is a pick', () => {
  it('a closed lot lands on the winner and counts toward the total', () => {
    const events = [
      started(1, 'n1', '8478402', 't1'),
      bid(2, 'n1', 't2', 60),
      closed(3, 'n1', 't2', '8478402', 60),
    ];
    const { state, gaps } = foldEvents(emptyDerivedState(SEED), events, MATRIX);
    expect(gaps).toEqual([]);
    expect(state.picksMade).toBe(1);
    expect(state.draftStatus).toBe('in_progress');
    expect(state.teamRosters.get('t2')).toEqual([{ seq: 3, playerId: 8478402, pickNumber: 1, roundNumber: 1 }]);
    expect(state.teamRosters.get('t1')).toBeUndefined();
    expect(state.auctionLotPlayerId).toBeNull();
    expect(state.foldedThroughSeq).toBe(3);
  });

  it('a lot that expires with no bids is not a pick', () => {
    const events: BufferedDraftEvent[] = [
      started(1, 'n1', '8478402', 't1'),
      { kind: 'auction_nomination_expired', seq: 2, timestamp: ts(2), nominationId: 'n1', reason: 'no_bids' },
    ];
    const { state } = foldEvents(emptyDerivedState(SEED), events, MATRIX);
    expect(state.picksMade).toBe(0);
    expect(state.teamRosters.size).toBe(0);
    expect(state.auctionLotPlayerId).toBeNull();
  });

  it('the commissioner awards land too, on the lot the fold remembered', () => {
    const events: BufferedDraftEvent[] = [
      started(1, 'n1', '8478402', 't1'),
      {
        kind: 'auction_commissioner_override',
        seq: 2,
        timestamp: ts(2),
        correlationId: 'c-2',
        commissionerUserId: 'u1',
        overrideAction: 'force_close_nomination',
        priorState: {},
        newState: { outcome: 'sold', winnerTeamId: 't1', finalAmount: 12 },
      },
      started(3, 'n2', '8477934', 't2'),
      {
        kind: 'auction_commissioner_override',
        seq: 4,
        timestamp: ts(4),
        correlationId: 'c-4',
        commissionerUserId: 'u1',
        overrideAction: 'award_to_team',
        priorState: {},
        newState: { awardedTeamId: 't2', awardedAmount: 5 },
      },
      started(5, 'n3', '8480069', 't1'),
      {
        kind: 'auction_commissioner_override',
        seq: 6,
        timestamp: ts(6),
        correlationId: 'c-6',
        commissionerUserId: 'u1',
        overrideAction: 'cancel_nomination',
        priorState: {},
        newState: {},
      },
    ];
    const { state } = foldEvents(emptyDerivedState(SEED), events, MATRIX);
    expect(state.picksMade).toBe(2);
    expect(state.teamRosters.get('t1')?.map((r) => r.playerId)).toEqual([8478402]);
    expect(state.teamRosters.get('t2')?.map((r) => r.playerId)).toEqual([8477934]);
    expect(state.auctionLotPlayerId).toBeNull();
  });

  it('the last lot completes the draft', () => {
    const events: BufferedDraftEvent[] = [];
    let seq = 0;
    for (let i = 0; i < 4; i++) {
      const n = `n${i}`;
      events.push(started(++seq, n, String(8478400 + i), 't1'));
      events.push(closed(++seq, n, i % 2 ? 't1' : 't2', String(8478400 + i), 1));
    }
    const { state } = foldEvents(emptyDerivedState(SEED), events, MATRIX);
    expect(state.picksMade).toBe(4);
    expect(state.draftStatus).toBe('completed');
    expect(state.onClockTeamId).toBeNull();
  });

  it('is idempotent on a replayed closed lot', () => {
    const events = [started(1, 'n1', '8478402', 't1'), closed(2, 'n1', 't2', '8478402', 60)];
    const first = foldEvents(emptyDerivedState(SEED), events, MATRIX).state;
    const second = foldEvents(first, [events[1]], MATRIX).state;
    expect(second.picksMade).toBe(1);
    expect(second.teamRosters.get('t2')).toHaveLength(1);
  });
});
