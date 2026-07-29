// DR-1 chunk (2026-07-28) — tests for the pure derivation module.
//
// Covers the acceptance spec:
//   - Fold correctness across snake boundaries (pick 12→13 reversal
//     for a 12-team draft).
//   - Mid-draft seed + incremental events == full-replay equivalence.
//   - Duplicate seq idempotence.
//   - Out-of-order guard (gap detection surfaces missing seqs and
//     halts the fold; caller resyncs).
//   - Server-mirror semantics for pick_undone (roster rewind, status
//     rewind) and commissioner_override (bypasses draftOrder, still
//     advances picksMade + status).
//   - Auction variants no-op (chunk 11g.6 territory).
//   - Matrix-unavailable fallback: picksMade + rosters still fold;
//     onClockTeamId stays null.

import { describe, it, expect } from 'vitest';
import type { BufferedDraftEvent, DraftSnapshot } from '@citrus/shared';
import {
  emptyDerivedState,
  foldEvents,
  deriveFromSnapshot,
  seedFromSnapshot,
  type DerivationSeed,
} from '../deriveDraftState';
import type { DraftOrderSlot } from '../fetchDraftOrderMatrix';

// ── Test fixtures ──────────────────────────────────────────────────
// Per DR-1 F2 architect ratification (2026-07-28): snake math is
// inlined here as TEST-FIXTURE generation only. Production truth is
// the fetched matrix from `fetchDraftOrderMatrix.ts`. Mirrors
// `server/src/draft/draftOrderGenerator.ts:68` byte-for-byte to keep
// the test-vs-server semantic aligned.
function makeSnakeMatrix(teamIds: string[], rounds: number): DraftOrderSlot[] {
  const slots: DraftOrderSlot[] = [];
  let pickNumber = 1;
  for (let round = 1; round <= rounds; round++) {
    const reverse = round % 2 === 0; // even rounds reversed — snake
    const ordered = reverse ? [...teamIds].reverse() : [...teamIds];
    for (const teamId of ordered) {
      slots.push({ round, pickNumber, teamId });
      pickNumber++;
    }
  }
  return slots;
}

function makePickEvent(
  seq: number,
  slot: DraftOrderSlot,
  playerId: number,
): BufferedDraftEvent {
  return {
    kind: 'pick_submitted',
    seq,
    timestamp: `2026-07-28T00:00:${String(seq).padStart(2, '0')}.000Z`,
    teamId: slot.teamId,
    playerId,
    roundNumber: slot.round,
    pickNumber: slot.pickNumber,
    correlationId: `corr-${seq}`,
  };
}

function makeUndoneEvent(
  seq: number,
  original: Extract<BufferedDraftEvent, { kind: 'pick_submitted' }>,
): BufferedDraftEvent {
  return {
    kind: 'pick_undone',
    seq,
    timestamp: `2026-07-28T00:00:${String(seq).padStart(2, '0')}.000Z`,
    teamId: original.teamId,
    playerId: original.playerId,
    roundNumber: original.roundNumber,
    pickNumber: original.pickNumber,
    correlationId: `undo-${seq}`,
    undoneSeq: original.seq,
  };
}

function makeOverrideEvent(
  seq: number,
  teamId: string,
  playerId: number,
  roundNumber: number,
  pickNumber: number,
): BufferedDraftEvent {
  return {
    kind: 'commissioner_override',
    seq,
    timestamp: `2026-07-28T00:00:${String(seq).padStart(2, '0')}.000Z`,
    teamId,
    playerId,
    roundNumber,
    pickNumber,
    correlationId: `over-${seq}`,
    reason: 'commissioner set',
  };
}

const TEAMS_12 = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);
const MATRIX_12x3 = makeSnakeMatrix(TEAMS_12, 3);

const SEED_12x3: DerivationSeed = {
  totalPicks: 36,
  format: 'snake',
};

// ── Empty / bootstrap ──────────────────────────────────────────────

describe('emptyDerivedState', () => {
  it('returns not_started zero-progress state from the seed', () => {
    const state = emptyDerivedState(SEED_12x3);
    expect(state.draftStatus).toBe('not_started');
    expect(state.picksMade).toBe(0);
    expect(state.totalPicks).toBe(36);
    expect(state.currentPickNumber).toBeNull();
    expect(state.currentRoundNumber).toBeNull();
    expect(state.onClockTeamId).toBeNull();
    expect(state.teamRosters.size).toBe(0);
    expect(state.foldedThroughSeq).toBe(0);
  });
});

// ── Basic fold ──────────────────────────────────────────────────────

describe('foldEvents — snake basics', () => {
  it('single pick: picksMade=1, status→in_progress, on-clock advances to pick 2', () => {
    const events = [makePickEvent(1, MATRIX_12x3[0], 8478000)];
    const { state, gaps } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(state.picksMade).toBe(1);
    expect(state.draftStatus).toBe('in_progress');
    expect(state.foldedThroughSeq).toBe(1);
    // Pick 2 slot = MATRIX_12x3[1] = round 1 pick 2, team-2
    expect(state.currentPickNumber).toBe(2);
    expect(state.currentRoundNumber).toBe(1);
    expect(state.onClockTeamId).toBe('team-2');
    // Roster
    expect(state.teamRosters.get('team-1')).toEqual([
      { seq: 1, playerId: 8478000, pickNumber: 1, roundNumber: 1 },
    ]);
  });

  it('advances onClockTeamId to pick 13 = round 2 pick 1 = team-12 (snake reversal)', () => {
    // Fold picks 1..12 (all of round 1). Pick 13 = round 2, first pick,
    // which for snake is team-12 (last team in round 1's forward order).
    const events = MATRIX_12x3.slice(0, 12).map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    const { state, gaps } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(state.picksMade).toBe(12);
    expect(state.currentPickNumber).toBe(13);
    expect(state.currentRoundNumber).toBe(2);
    expect(state.onClockTeamId).toBe('team-12');
  });

  it('advances onClockTeamId to pick 25 = round 3 pick 1 = team-1 (back to round-1 order)', () => {
    // Fold picks 1..24 (rounds 1+2). Pick 25 = round 3, first pick,
    // which for snake is team-1 (round 3 = round 1 order).
    const events = MATRIX_12x3.slice(0, 24).map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    const { state, gaps } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(state.picksMade).toBe(24);
    expect(state.currentPickNumber).toBe(25);
    expect(state.currentRoundNumber).toBe(3);
    expect(state.onClockTeamId).toBe('team-1');
  });

  it('final pick → status = completed, no on-clock', () => {
    const events = MATRIX_12x3.map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    const { state } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(state.picksMade).toBe(36);
    expect(state.draftStatus).toBe('completed');
    expect(state.currentPickNumber).toBeNull();
    expect(state.currentRoundNumber).toBeNull();
    expect(state.onClockTeamId).toBeNull();
  });
});

// ── Idempotency + gap detection ────────────────────────────────────

describe('foldEvents — idempotency', () => {
  it('repeat events (seq <= foldedThroughSeq) are silently no-op', () => {
    const events1 = [
      makePickEvent(1, MATRIX_12x3[0], 8478000),
      makePickEvent(2, MATRIX_12x3[1], 8478001),
    ];
    const { state: s1 } = foldEvents(emptyDerivedState(SEED_12x3), events1, MATRIX_12x3);
    // Replay the same events on top of s1 — should be a no-op.
    const { state: s2, gaps } = foldEvents(s1, events1, MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(s2.picksMade).toBe(s1.picksMade);
    expect(s2.foldedThroughSeq).toBe(s1.foldedThroughSeq);
    expect(s2.teamRosters.get('team-1')?.length).toBe(1);
    expect(s2.teamRosters.get('team-2')?.length).toBe(1);
  });

  it('mixed old + new events: only new ones fold', () => {
    const events1 = [makePickEvent(1, MATRIX_12x3[0], 8478000)];
    const { state: s1 } = foldEvents(emptyDerivedState(SEED_12x3), events1, MATRIX_12x3);
    const events2 = [
      makePickEvent(1, MATRIX_12x3[0], 8478000), // repeat
      makePickEvent(2, MATRIX_12x3[1], 8478001), // new
    ];
    const { state: s2, gaps } = foldEvents(s1, events2, MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(s2.picksMade).toBe(2);
    expect(s2.foldedThroughSeq).toBe(2);
  });
});

describe('foldEvents — gap detection', () => {
  it('detects a single missing seq and halts the fold', () => {
    const events = [
      makePickEvent(1, MATRIX_12x3[0], 8478000),
      // seq 2 missing
      makePickEvent(3, MATRIX_12x3[2], 8478002),
    ];
    const { state, gaps } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(gaps).toEqual([2]);
    // Fold halted at seq 1 — seq 3 not applied.
    expect(state.picksMade).toBe(1);
    expect(state.foldedThroughSeq).toBe(1);
  });

  it('reports every missing seq in a wider gap', () => {
    const events = [
      makePickEvent(1, MATRIX_12x3[0], 8478000),
      // seq 2, 3, 4 missing
      makePickEvent(5, MATRIX_12x3[4], 8478004),
    ];
    const { gaps, state } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(gaps).toEqual([2, 3, 4]);
    expect(state.picksMade).toBe(1);
  });

  it('resumes cleanly after a resync fills the gap', () => {
    const first = [makePickEvent(1, MATRIX_12x3[0], 8478000)];
    const { state: s1 } = foldEvents(emptyDerivedState(SEED_12x3), first, MATRIX_12x3);
    // Fresh resync brings back the full contiguous range 2..5.
    const backfilled = [
      makePickEvent(2, MATRIX_12x3[1], 8478001),
      makePickEvent(3, MATRIX_12x3[2], 8478002),
      makePickEvent(4, MATRIX_12x3[3], 8478003),
      makePickEvent(5, MATRIX_12x3[4], 8478004),
    ];
    const { state: s2, gaps } = foldEvents(s1, backfilled, MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(s2.picksMade).toBe(5);
    expect(s2.foldedThroughSeq).toBe(5);
  });
});

// ── Mid-draft seed + incremental == full-replay ─────────────────────

describe('foldEvents — mid-draft equivalence', () => {
  it('seed + incremental events produce identical state to a single full-replay fold', () => {
    const fullEvents = MATRIX_12x3.slice(0, 20).map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    // Full replay in one call.
    const fullReplay = foldEvents(
      emptyDerivedState(SEED_12x3),
      fullEvents,
      MATRIX_12x3,
    );
    // Incremental: first 10, then 11..20.
    const first10 = foldEvents(
      emptyDerivedState(SEED_12x3),
      fullEvents.slice(0, 10),
      MATRIX_12x3,
    );
    const last10 = foldEvents(first10.state, fullEvents.slice(10), MATRIX_12x3);
    expect(last10.state.picksMade).toBe(fullReplay.state.picksMade);
    expect(last10.state.foldedThroughSeq).toBe(fullReplay.state.foldedThroughSeq);
    expect(last10.state.onClockTeamId).toBe(fullReplay.state.onClockTeamId);
    expect(last10.state.currentPickNumber).toBe(fullReplay.state.currentPickNumber);
    expect(last10.state.currentRoundNumber).toBe(fullReplay.state.currentRoundNumber);
    expect(last10.state.draftStatus).toBe(fullReplay.state.draftStatus);
    // Per-team rosters — spot-check size + content.
    for (const teamId of TEAMS_12) {
      const a = last10.state.teamRosters.get(teamId) ?? [];
      const b = fullReplay.state.teamRosters.get(teamId) ?? [];
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toEqual(b[i]);
      }
    }
  });
});

// ── pick_undone semantics (server-mirror) ───────────────────────────

describe('foldEvents — pick_undone mirrors server replay', () => {
  it('removes the referenced pick from the team roster (matched by undoneSeq)', () => {
    const pick1 = makePickEvent(1, MATRIX_12x3[0], 8478000);
    const pick2 = makePickEvent(2, MATRIX_12x3[1], 8478001);
    const undo = makeUndoneEvent(3, pick2 as Extract<BufferedDraftEvent, { kind: 'pick_submitted' }>);
    const { state } = foldEvents(
      emptyDerivedState(SEED_12x3),
      [pick1, pick2, undo],
      MATRIX_12x3,
    );
    expect(state.picksMade).toBe(1);
    expect(state.foldedThroughSeq).toBe(3);
    expect(state.teamRosters.get('team-1')?.length).toBe(1);
    expect(state.teamRosters.get('team-2')?.length ?? 0).toBe(0);
    // Status transitioned in_progress → in_progress (still picks made > 0),
    // and on-clock rewound to pick 2 = team-2.
    expect(state.draftStatus).toBe('in_progress');
    expect(state.currentPickNumber).toBe(2);
    expect(state.onClockTeamId).toBe('team-2');
  });

  it('undo of the only pick rewinds status to not_started', () => {
    const pick1 = makePickEvent(1, MATRIX_12x3[0], 8478000);
    const undo = makeUndoneEvent(2, pick1 as Extract<BufferedDraftEvent, { kind: 'pick_submitted' }>);
    const { state } = foldEvents(
      emptyDerivedState(SEED_12x3),
      [pick1, undo],
      MATRIX_12x3,
    );
    expect(state.picksMade).toBe(0);
    expect(state.draftStatus).toBe('not_started');
    // On-clock is null in not_started per server semantic.
    expect(state.onClockTeamId).toBeNull();
    expect(state.currentPickNumber).toBeNull();
  });

  it('undo of the final pick rewinds status: completed → in_progress', () => {
    // Fold entire draft, then undo the last pick.
    const events: BufferedDraftEvent[] = MATRIX_12x3.map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    const finalPick = events[events.length - 1] as Extract<
      BufferedDraftEvent,
      { kind: 'pick_submitted' }
    >;
    events.push(makeUndoneEvent(37, finalPick));
    const { state } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(state.picksMade).toBe(35);
    expect(state.draftStatus).toBe('in_progress');
    // On-clock rewound to the final slot.
    expect(state.currentPickNumber).toBe(36);
  });
});

// ── commissioner_override semantics (server-mirror) ─────────────────

describe('foldEvents — commissioner_override mirrors server replay', () => {
  it('advances picksMade and adds to the specified team regardless of draftOrder', () => {
    // Commissioner overrides pick 1 with team-5 (skipping team-1 who
    // was originally on the clock). Server accepts; client mirrors.
    const override = makeOverrideEvent(1, 'team-5', 8479999, 1, 1);
    const { state } = foldEvents(
      emptyDerivedState(SEED_12x3),
      [override],
      MATRIX_12x3,
    );
    expect(state.picksMade).toBe(1);
    expect(state.draftStatus).toBe('in_progress');
    expect(state.teamRosters.get('team-5')).toEqual([
      { seq: 1, playerId: 8479999, pickNumber: 1, roundNumber: 1, isOverride: true },
    ]);
    // Team-1's roster is untouched (they didn't actually pick).
    expect(state.teamRosters.get('team-1')?.length ?? 0).toBe(0);
    // On-clock advances via the matrix — next slot is matrix[1] = team-2.
    expect(state.currentPickNumber).toBe(2);
    expect(state.onClockTeamId).toBe('team-2');
  });
});

// ── isAutopick flag propagation ────────────────────────────────────

describe('foldEvents — isAutopick badge propagation', () => {
  it('surfaces isAutopick from the wire event to the roster entry', () => {
    const auto: BufferedDraftEvent = {
      ...(makePickEvent(1, MATRIX_12x3[0], 8478000) as Extract<
        BufferedDraftEvent,
        { kind: 'pick_submitted' }
      >),
      isAutopick: true,
    };
    const { state } = foldEvents(emptyDerivedState(SEED_12x3), [auto], MATRIX_12x3);
    expect(state.teamRosters.get('team-1')?.[0]?.isAutopick).toBe(true);
  });
});

// ── Auction variants no-op ─────────────────────────────────────────

describe('foldEvents — auction variants no-op (chunk 11g.6 territory)', () => {
  it('does not change picksMade or status for auction events', () => {
    const nomination: BufferedDraftEvent = {
      kind: 'auction_nomination_started',
      seq: 1,
      timestamp: '2026-07-28T00:00:00.000Z',
      correlationId: 'nom-1',
      nominationId: 'n1',
      playerId: 'p1',
      playerName: 'Player One',
      nominatorTeamId: 'team-1',
      openingBid: 1,
      clockDeadline: '2026-07-28T00:00:30.000Z',
    };
    const { state } = foldEvents(
      emptyDerivedState(SEED_12x3),
      [nomination],
      MATRIX_12x3,
    );
    // The event was consumed for seq bookkeeping but had no effect on
    // snake/linear state.
    expect(state.picksMade).toBe(0);
    expect(state.draftStatus).toBe('not_started');
    expect(state.foldedThroughSeq).toBe(1);
  });
});

// ── Matrix-unavailable fallback ────────────────────────────────────

describe('foldEvents — matrix unavailable', () => {
  it('folds picksMade + rosters but leaves on-clock/next-pick null', () => {
    const events = [
      makePickEvent(1, MATRIX_12x3[0], 8478000),
      makePickEvent(2, MATRIX_12x3[1], 8478001),
    ];
    // matrix = null simulates the fetcher not having landed yet.
    const { state } = foldEvents(emptyDerivedState(SEED_12x3), events, null);
    expect(state.picksMade).toBe(2);
    expect(state.draftStatus).toBe('in_progress');
    // Rosters still filled — event.teamId + event.playerId are enough.
    expect(state.teamRosters.get('team-1')?.length).toBe(1);
    expect(state.teamRosters.get('team-2')?.length).toBe(1);
    // On-clock left null per the "picks-made + rosters render, next
    // shows '—' until matrix lands" fallback.
    expect(state.currentPickNumber).toBeNull();
    expect(state.currentRoundNumber).toBeNull();
    expect(state.onClockTeamId).toBeNull();
  });
});

// ── F4 regression lock — the whole point of DR-1 ───────────────────

describe('deriveFromSnapshot — F4 (2026-07-28 Decision Log)', () => {
  it('mid-draft REJOIN: stale stateSnapshot ignored, derived state matches events', () => {
    // Reproduce F4's exact witnessed shape: stateSnapshot claims
    // not_started + picksMade=0 + onClockTeamId=null, but recentEvents
    // carries the first 5 picks. Pre-DR-1 code trusted stateSnapshot
    // and rendered "Not started" while events pane showed 5 picks.
    // Post-DR-1: derived state ignores the convenience fields and
    // computes from events.
    const events: BufferedDraftEvent[] = MATRIX_12x3.slice(0, 5).map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    const staleSnapshot: DraftSnapshot = {
      lobbyId: 'lobby-f4',
      format: 'snake',
      recentEvents: events,
      stateSnapshot: {
        // F4-witnessed stale values:
        currentPickNumber: null,
        currentRoundNumber: null,
        onClockTeamId: null,
        picksMade: 0,
        draftStatus: 'not_started',
        totalPicks: 36,
        currentPickDeadline: null,
      },
    };
    const { state, gaps } = deriveFromSnapshot(staleSnapshot, MATRIX_12x3);
    expect(gaps).toEqual([]);
    // Derived state matches the events, NOT the stale stateSnapshot.
    expect(state.picksMade).toBe(5);
    expect(state.draftStatus).toBe('in_progress');
    expect(state.currentPickNumber).toBe(6);
    expect(state.currentRoundNumber).toBe(1);
    expect(state.onClockTeamId).toBe('team-6');
    // The convenience-field extraction is seed-only — the seed uses
    // totalPicks (which is trustworthy per LobbyManager construction).
    const seed = seedFromSnapshot(staleSnapshot);
    expect(seed.totalPicks).toBe(36);
    expect(seed.format).toBe('snake');
  });
});
