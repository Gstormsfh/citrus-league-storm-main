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

// ── F28 (2026-08-08) — lifecycle event handlers ────────────────────
//
// Four acceptance cases from the ratified brief:
//   1. Apply draft_started twice → identical state (idempotency).
//   2. Snapshot in_progress + live draft_completed → completed.
//   3. draft_completed then stray pick frame → stays completed
//      (monotonicity).
//   4. Unknown kind → no throw, state unchanged.
//
// All tests are offline (pure function calls, no network, no DOM).

function makeDraftStartedEvent(seq: number): BufferedDraftEvent {
  return {
    kind: 'draft_started',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq).padStart(2, '0')}.000Z`,
    correlationId: `started-${seq}`,
    startedAt: `2026-08-08T00:00:${String(seq).padStart(2, '0')}.000Z`,
    firstPickDeadline: `2026-08-08T00:00:${String(seq + 30).padStart(2, '0')}.000Z`,
    totalRounds: 3,
    totalTeams: 12,
    pickTimeLimitSeconds: 30,
    draftFormat: 'snake',
  };
}

function makeDraftCompletedEvent(seq: number, totalPicks: number): BufferedDraftEvent {
  return {
    kind: 'draft_completed',
    seq,
    timestamp: `2026-08-08T00:00:${String(seq).padStart(2, '0')}.000Z`,
    correlationId: `completed-${seq}`,
    completedAt: `2026-08-08T00:00:${String(seq).padStart(2, '0')}.000Z`,
    totalPicks,
  };
}

describe('foldEvents — F28 draft_started handler', () => {
  it('acceptance 1: apply draft_started twice → identical state (idempotency via outer seq skip)', () => {
    // First apply: seq=1 draft_started → in_progress (from not_started).
    const events1 = [makeDraftStartedEvent(1)];
    const { state: s1 } = foldEvents(emptyDerivedState(SEED_12x3), events1, MATRIX_12x3);
    expect(s1.draftStatus).toBe('in_progress');
    expect(s1.picksMade).toBe(0);
    expect(s1.foldedThroughSeq).toBe(1);

    // Second apply of the same seq=1 draft_started: outer guard at
    // line 181 short-circuits (`seq(1) <= foldedThroughSeq(1)`).
    // State object must be byte-identical (up to Map identity —
    // teamRosters is a new Map on each fold, so compare via
    // Array.from + JSON to check content equality).
    const { state: s2, gaps } = foldEvents(s1, events1, MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(s2.draftStatus).toBe(s1.draftStatus);
    expect(s2.picksMade).toBe(s1.picksMade);
    expect(s2.foldedThroughSeq).toBe(s1.foldedThroughSeq);
    expect(s2.onClockTeamId).toBe(s1.onClockTeamId);
    expect(JSON.stringify(Array.from(s2.teamRosters.entries()))).toEqual(
      JSON.stringify(Array.from(s1.teamRosters.entries())),
    );
  });

  it('draft_started transitions not_started → in_progress', () => {
    const events = [makeDraftStartedEvent(1)];
    const { state } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(state.draftStatus).toBe('in_progress');
    // No pick yet — on-clock resolves via matrix recompute
    // (`picksMade=0` → `matrix[0]` = team-1, round 1, pick 1).
    expect(state.onClockTeamId).toBe('team-1');
    expect(state.currentPickNumber).toBe(1);
    expect(state.currentRoundNumber).toBe(1);
    expect(state.picksMade).toBe(0);
  });

  it('draft_started against already-in_progress does not revert or duplicate progress', () => {
    // Prime state with one pick → in_progress + picksMade=1.
    const primer = foldEvents(
      emptyDerivedState(SEED_12x3),
      [makePickEvent(1, MATRIX_12x3[0], 8478000)],
      MATRIX_12x3,
    );
    expect(primer.state.draftStatus).toBe('in_progress');
    expect(primer.state.picksMade).toBe(1);

    // Live draft_started arrives OUT OF ORDER at seq=2 (impossible
    // in practice — server never emits draft_started after picks —
    // but defensive test for monotonic-status guarantee).
    const evLater = makeDraftStartedEvent(2);
    const { state } = foldEvents(primer.state, [evLater], MATRIX_12x3);
    // Status unchanged (guard requires 'not_started' to fire).
    expect(state.draftStatus).toBe('in_progress');
    // picksMade unchanged (handler doesn't touch it).
    expect(state.picksMade).toBe(1);
    // Cursor advanced (event was folded).
    expect(state.foldedThroughSeq).toBe(2);
  });
});

describe('foldEvents — F28 draft_completed handler', () => {
  it('acceptance 2: snapshot in_progress + live draft_completed → completed', () => {
    // Snapshot delivered 12/12 picks (folded to 12 → auto-completed
    // via picksMade === totalPicks). But test the "authoritative
    // completion" path: prime with 11/12 picks so status is
    // in_progress, then apply draft_completed at seq=12 as the
    // authoritative signal (edge case: server autopicked the 12th
    // but only the completion frame reaches this client).
    const events = MATRIX_12x3.slice(0, 11).map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    const primer = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(primer.state.draftStatus).toBe('in_progress');
    expect(primer.state.picksMade).toBe(11);

    // Live draft_completed at seq=12 (skipping the 12th pick_submitted).
    // In production this shape is unlikely because server always emits
    // pick_submitted before draft_completed, but tests the handler
    // path that reaches 'completed' via the lifecycle frame.
    const done = makeDraftCompletedEvent(12, 36);
    const { state, gaps } = foldEvents(primer.state, [done], MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(state.draftStatus).toBe('completed');
    // On-clock clears because matrix recompute guard
    // `draftStatus === 'in_progress'` fails.
    expect(state.onClockTeamId).toBeNull();
    expect(state.currentPickNumber).toBeNull();
    expect(state.currentRoundNumber).toBeNull();
  });

  it('acceptance 3: draft_completed then stray pick frame → stays completed (monotonicity)', () => {
    // Fold all 36 picks → auto-completed via picksMade check.
    const allPicks = MATRIX_12x3.map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    const done = makeDraftCompletedEvent(37, 36);
    const primer = foldEvents(
      emptyDerivedState(SEED_12x3),
      [...allPicks, done],
      MATRIX_12x3,
    );
    expect(primer.state.draftStatus).toBe('completed');
    expect(primer.state.foldedThroughSeq).toBe(37);

    // Stray pick_submitted arrives at seq 38 (impossible per server
    // invariants — no picks after draft_completed — but this test
    // covers the defensive monotonicity guarantee from the F28 brief:
    // "a stray pick frame after completion must not un-complete
    // the room").
    const stray = makePickEvent(
      38,
      { round: 4, pickNumber: 37, teamId: 'team-1' },
      9999999,
    );
    const { state } = foldEvents(primer.state, [stray], MATRIX_12x3);
    // Status stays 'completed'. pick_submitted handler's status
    // updates: `if (draftStatus === 'not_started')` doesn't fire
    // (we're 'completed'); `if (picksMade >= totalPicks)` re-fires
    // and sets 'completed' (no change). Monotonicity preserved.
    expect(state.draftStatus).toBe('completed');
  });

  it('draft_completed is idempotent (repeat seq is skipped by outer guard)', () => {
    const done = makeDraftCompletedEvent(1, 0);
    const { state: s1 } = foldEvents(emptyDerivedState(SEED_12x3), [done], MATRIX_12x3);
    expect(s1.draftStatus).toBe('completed');
    expect(s1.foldedThroughSeq).toBe(1);
    // Second apply of same seq → outer guard skips.
    const { state: s2, gaps } = foldEvents(s1, [done], MATRIX_12x3);
    expect(gaps).toEqual([]);
    expect(s2.draftStatus).toBe('completed');
    expect(s2.foldedThroughSeq).toBe(1);
  });
});

describe('foldEvents — F28 default clause for unknown kinds', () => {
  it('acceptance 4: unknown wire kind → no throw, state unchanged (forward-compat)', () => {
    // Simulate a future engine emitting a wire kind this client
    // bundle does not know. Handler must not throw; state must
    // remain byte-identical to the pre-fold state.
    const unknownEvent = {
      kind: 'some_future_engine_variant',
      seq: 1,
      timestamp: '2026-08-08T00:00:01.000Z',
    } as unknown as BufferedDraftEvent;
    const priorState = emptyDerivedState(SEED_12x3);
    // Suppress the expected debug log during test run to keep output
    // clean. vitest doesn't fail on console.debug by default; this
    // is stylistic.
    const originalDebug = console.debug;
    console.debug = () => undefined;
    try {
      const result = foldEvents(priorState, [unknownEvent], MATRIX_12x3);
      expect(result.gaps).toEqual([]);
      expect(result.state.draftStatus).toBe(priorState.draftStatus);
      expect(result.state.picksMade).toBe(priorState.picksMade);
      // foldedThroughSeq DID advance — the event was processed
      // (defaulted through the switch) even though no state mutation
      // occurred. This matches the auction-no-op pattern and is
      // required for the outer seq-contiguity check to keep working.
      expect(result.state.foldedThroughSeq).toBe(1);
    } finally {
      console.debug = originalDebug;
    }
  });

  it('unknown kind does not throw even with subsequent contiguous events', () => {
    const unknown = {
      kind: 'future_variant',
      seq: 1,
      timestamp: '2026-08-08T00:00:01.000Z',
    } as unknown as BufferedDraftEvent;
    const pick = makePickEvent(2, MATRIX_12x3[0], 8478000);
    const originalDebug = console.debug;
    console.debug = () => undefined;
    try {
      const { state, gaps } = foldEvents(
        emptyDerivedState(SEED_12x3),
        [unknown, pick],
        MATRIX_12x3,
      );
      expect(gaps).toEqual([]);
      // Unknown at seq 1 no-ops. Pick at seq 2 folds normally.
      expect(state.picksMade).toBe(1);
      expect(state.draftStatus).toBe('in_progress');
      expect(state.foldedThroughSeq).toBe(2);
    } finally {
      console.debug = originalDebug;
    }
  });
});

// ── F28 hardening (P11 unattended-day 2026-08-08) — edge cases beyond
//    the 4 core acceptance cases ────────────────────────────────────
describe('foldEvents — F28 hardening: monotonicity under adversarial event orderings', () => {
  it('draft_completed with zero prior events → status=completed, picksMade unchanged (defensive)', () => {
    // Edge: client somehow receives ONLY the draft_completed event
    // (e.g., resync-from-late-seq that skipped past all picks). Handler
    // must set completed unconditionally — this IS an authoritative
    // completion signal, even if picksMade doesn't equal totalPicks.
    // UI can still show "Draft complete" banner correctly.
    const events = [makeDraftCompletedEvent(1, 36)];
    const { state } = foldEvents(emptyDerivedState(SEED_12x3), events, MATRIX_12x3);
    expect(state.draftStatus).toBe('completed');
    expect(state.picksMade).toBe(0); // no picks folded, but status is authoritative
    expect(state.onClockTeamId).toBeNull(); // matrix recompute skips on non-in_progress
  });

  it('draft_started arriving AFTER completion is monotonic no-op (would be a server bug but defensive)', () => {
    // Fold complete draft to 'completed', then a stray draft_started
    // arrives at seq > foldedThroughSeq. Impossible per server invariants
    // (never emits draft_started twice, never after completion), but
    // defense-in-depth: monotonicity must hold.
    const allPicks = MATRIX_12x3.map((slot, i) =>
      makePickEvent(i + 1, slot, 8478000 + i),
    );
    const done = makeDraftCompletedEvent(37, 36);
    const primer = foldEvents(
      emptyDerivedState(SEED_12x3),
      [...allPicks, done],
      MATRIX_12x3,
    );
    expect(primer.state.draftStatus).toBe('completed');

    const strayStart = makeDraftStartedEvent(38);
    const { state } = foldEvents(primer.state, [strayStart], MATRIX_12x3);
    // draft_started handler guards on 'not_started'; 'completed' is
    // not touched. Status stays completed. Monotonicity preserved.
    expect(state.draftStatus).toBe('completed');
    expect(state.foldedThroughSeq).toBe(38);
  });

  it('draft_completed after pick_undone that rewound to not_started stays completed', () => {
    // Sequence: pick (in_progress) → pick_undone (not_started) → draft_completed (completed).
    // Server-mirror pick_undone rewinds status; then a lifecycle
    // completion should still set completed authoritatively.
    const p1 = makePickEvent(1, MATRIX_12x3[0], 8478000);
    const undo = makeUndoneEvent(2, {
      kind: 'pick_submitted',
      ...p1,
    } as Extract<BufferedDraftEvent, { kind: 'pick_submitted' }>);
    const done = makeDraftCompletedEvent(3, 36);

    const { state } = foldEvents(
      emptyDerivedState(SEED_12x3),
      [p1, undo, done],
      MATRIX_12x3,
    );
    // Post-undo: not_started + picksMade=0. Then draft_completed forces
    // completed regardless (authoritative signal).
    expect(state.draftStatus).toBe('completed');
    expect(state.picksMade).toBe(0);
  });

  it('multiple lifecycle events in one fold batch (draft_started + draft_completed) yield final=completed', () => {
    // Compressed lifecycle: fresh league gets both frames in one wire batch
    // (unusual but possible via resync-from-0 on a completed league).
    const events = [
      makeDraftStartedEvent(1),
      // Some picks omitted (missing picks would gap-halt, but for THIS
      // test we simulate a snapshot re-derive that lands both lifecycle
      // events with no picks between).
      makeDraftCompletedEvent(2, 0), // totalPicks=0 in event payload; irrelevant since draft_completed sets status directly
    ];
    const { state, gaps } = foldEvents(
      emptyDerivedState(SEED_12x3),
      events,
      MATRIX_12x3,
    );
    // No gap since seqs are 1, 2 contiguous. Both apply.
    expect(gaps).toEqual([]);
    expect(state.draftStatus).toBe('completed');
    expect(state.foldedThroughSeq).toBe(2);
  });
});
