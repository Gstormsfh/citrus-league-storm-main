// PICK-LATENCY (2026-08-12) — tests for the optimistic pending-pick overlay.
//
// The contract under test is narrow but load-bearing: the manager's own
// pick must appear on every view the instant they click, must never
// appear twice, must never survive a rollback, and must never move the
// clock. Each of those is a separate failure mode with a separate test.

import { describe, it, expect } from 'vitest';
import {
  overlayPendingPicks,
  hasPendingOverlay,
} from '../overlayPending';
import type { DerivedDraftState, RosterEntry } from '../deriveDraftState';
import type { PendingAction } from '../optimistic';
import {
  toAvailablePlayers,
  toDraftedPlayerIds,
} from '../v1Adapters';

const TEAM_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEAM_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function makeDerived(
  rosters: Record<string, RosterEntry[]> = {},
): DerivedDraftState {
  return {
    currentPickNumber: 5,
    currentRoundNumber: 1,
    onClockTeamId: TEAM_A,
    picksMade: 4,
    totalPicks: 144,
    draftStatus: 'in_progress' as DerivedDraftState['draftStatus'],
    teamRosters: new Map(Object.entries(rosters)),
    foldedThroughSeq: 12,
  };
}

function pending(over: Partial<PendingAction> = {}): PendingAction {
  return {
    correlationId: 'corr-1',
    teamId: TEAM_A,
    playerId: 8478402,
    submittedAt: 1_700_000_000_000,
    optimisticState: 'pending',
    pickNumber: 5,
    roundNumber: 1,
    ...over,
  };
}

function mapOf(...actions: PendingAction[]): Map<string, PendingAction> {
  return new Map(actions.map((a) => [a.correlationId, a]));
}

describe('overlayPendingPicks — identity preservation', () => {
  it('returns null when derived is null', () => {
    expect(overlayPendingPicks(null, mapOf(pending()))).toBeNull();
  });

  it('returns the SAME reference when there are no pending actions', () => {
    const d = makeDerived();
    expect(overlayPendingPicks(d, new Map())).toBe(d);
  });

  it('returns the SAME reference when every action is rolled_back', () => {
    const d = makeDerived();
    const rolled = pending({ optimisticState: 'rolled_back' });
    // Referential equality is the contract, not just deep equality:
    // a new object here would invalidate every downstream useMemo on
    // the draft room's hottest render path.
    expect(overlayPendingPicks(d, mapOf(rolled))).toBe(d);
  });
});

describe('overlayPendingPicks — the optimistic entry', () => {
  it('adds the pending pick to the submitting team roster', () => {
    const d = makeDerived({ [TEAM_A]: [] });
    const out = overlayPendingPicks(d, mapOf(pending()))!;
    const roster = out.teamRosters.get(TEAM_A)!;

    expect(roster).toHaveLength(1);
    expect(roster[0].playerId).toBe(8478402);
    expect(roster[0].isPending).toBe(true);
  });

  it('places it at the pick slot captured at click time', () => {
    const d = makeDerived({ [TEAM_A]: [] });
    // derived says pick 5 / round 1; the action says 9 / 2. The action
    // wins — it recorded the truth at click time.
    const out = overlayPendingPicks(
      d,
      mapOf(pending({ pickNumber: 9, roundNumber: 2 })),
    )!;
    const entry = out.teamRosters.get(TEAM_A)![0];

    expect(entry.pickNumber).toBe(9);
    expect(entry.roundNumber).toBe(2);
  });

  it('falls back to derived coordinates when the action omits them', () => {
    const d = makeDerived({ [TEAM_A]: [] });
    const legacy = pending({ pickNumber: undefined, roundNumber: undefined });
    const entry = overlayPendingPicks(d, mapOf(legacy))!.teamRosters.get(
      TEAM_A,
    )![0];

    expect(entry.pickNumber).toBe(5);
    expect(entry.roundNumber).toBe(1);
  });

  it('appends after existing confirmed picks, preserving order', () => {
    const confirmed: RosterEntry = {
      seq: 3,
      playerId: 8477492,
      pickNumber: 1,
      roundNumber: 1,
    };
    const d = makeDerived({ [TEAM_A]: [confirmed] });
    const roster = overlayPendingPicks(d, mapOf(pending()))!.teamRosters.get(
      TEAM_A,
    )!;

    expect(roster.map((r) => r.pickNumber)).toEqual([1, 5]);
    expect(roster[0].isPending).toBeUndefined();
    expect(roster[1].isPending).toBe(true);
  });

  it('does not mutate the input state', () => {
    const d = makeDerived({ [TEAM_A]: [] });
    overlayPendingPicks(d, mapOf(pending()));

    expect(d.teamRosters.get(TEAM_A)).toHaveLength(0);
  });
});

describe('overlayPendingPicks — the duplicate guard', () => {
  it('skips a pick the server has already confirmed for that team', () => {
    // The frame between "pick event folded" and "pending entry
    // reconciled away". Without the guard the manager sees their
    // player twice, at the exact moment they are watching hardest.
    const confirmed: RosterEntry = {
      seq: 13,
      playerId: 8478402,
      pickNumber: 5,
      roundNumber: 1,
    };
    const d = makeDerived({ [TEAM_A]: [confirmed] });
    const out = overlayPendingPicks(d, mapOf(pending()))!;

    expect(out).toBe(d);
    expect(out.teamRosters.get(TEAM_A)).toHaveLength(1);
  });

  it('skips a player another team already holds', () => {
    // Our submission is doomed and player_taken is inbound. Drawing it
    // on our roster meanwhile would be a false statement.
    const d = makeDerived({
      [TEAM_A]: [],
      [TEAM_B]: [
        { seq: 11, playerId: 8478402, pickNumber: 4, roundNumber: 1 },
      ],
    });
    const out = overlayPendingPicks(d, mapOf(pending()))!;

    expect(out).toBe(d);
    expect(out.teamRosters.get(TEAM_A)).toHaveLength(0);
  });
});

describe('overlayPendingPicks — clock safety', () => {
  it('leaves every clock and turn field untouched', () => {
    const d = makeDerived({ [TEAM_A]: [] });
    const out = overlayPendingPicks(d, mapOf(pending()))!;

    expect(out.currentPickNumber).toBe(d.currentPickNumber);
    expect(out.currentRoundNumber).toBe(d.currentRoundNumber);
    expect(out.onClockTeamId).toBe(d.onClockTeamId);
    expect(out.picksMade).toBe(d.picksMade);
    expect(out.foldedThroughSeq).toBe(d.foldedThroughSeq);
    expect(out.draftStatus).toBe(d.draftStatus);
  });
});

describe('overlayPendingPicks — what the manager actually sees', () => {
  const players = new Map([
    // `team` is load-bearing: toAvailablePlayers excludes anyone without an
    // NHL club (PLAYER-POOL 2026-08-12).
    ['8478402', { id: '8478402', name: 'Connor McDavid', team: 'EDM' }],
    ['8477492', { id: '8477492', name: 'Nathan MacKinnon', team: 'COL' }],
  ]) as unknown as ReadonlyMap<
    string,
    Parameters<typeof toAvailablePlayers>[0] extends ReadonlyMap<
      string,
      infer P
    >
      ? P
      : never
  >;

  it('removes the picked player from the pool immediately', () => {
    const d = makeDerived({ [TEAM_A]: [] });

    const before = toAvailablePlayers(players, d).map((p) => p.id);
    expect(before).toContain('8478402');

    const after = toAvailablePlayers(
      players,
      overlayPendingPicks(d, mapOf(pending()))!,
    ).map((p) => p.id);

    // THE headline behaviour: the player leaves the pool on click,
    // not ~1.9s later when the server answers.
    expect(after).not.toContain('8478402');
    expect(after).toContain('8477492');
  });

  it('counts the pending pick as drafted', () => {
    const d = makeDerived({ [TEAM_A]: [] });
    const ids = toDraftedPlayerIds(overlayPendingPicks(d, mapOf(pending()))!);
    expect(ids).toContain('8478402');
  });

  it('puts the player back in the pool after a rollback', () => {
    const d = makeDerived({ [TEAM_A]: [] });
    const rolledBack = mapOf(
      pending({ optimisticState: 'rolled_back', rejectionReason: 'taken' }),
    );

    const after = toAvailablePlayers(
      players,
      overlayPendingPicks(d, rolledBack)!,
    ).map((p) => p.id);

    expect(after).toContain('8478402');
  });
});

describe('hasPendingOverlay', () => {
  it('is false for null and for fully-confirmed state', () => {
    expect(hasPendingOverlay(null)).toBe(false);
    expect(
      hasPendingOverlay(
        makeDerived({
          [TEAM_A]: [
            { seq: 3, playerId: 8477492, pickNumber: 1, roundNumber: 1 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('is true once an optimistic entry is present', () => {
    const d = makeDerived({ [TEAM_A]: [] });
    expect(hasPendingOverlay(overlayPendingPicks(d, mapOf(pending())))).toBe(
      true,
    );
  });
});
