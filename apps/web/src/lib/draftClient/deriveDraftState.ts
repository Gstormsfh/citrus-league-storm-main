// DR-1 chunk (2026-07-28) — pure state-derivation module.
//
// Kills F4 (Decision Log 2026-07-28): the store previously trusted
// `DraftSnapshot.stateSnapshot`'s convenience fields directly, so
// mid-draft rejoins with stale server-side stateSnapshot (draftStatus
// 'not_started', picksMade 0, onClockTeamId null) rendered the header
// rail as "Not started" while the events pane simultaneously showed
// picks 1..5. Convenience fields become seed-only; components read
// ONLY derived state.
//
// Replay semantics MIRROR the server exactly (Q4/Q5 ratified
// condition). Confirmed against `server/src/draft/LobbyManager.ts`:
//
//   applyPickEvent (line 3022):
//     - picksMade++
//     - not_started → in_progress on first pick
//     - → completed when picksMade === draftOrder.length
//     - server does NOT touch rosters (no server-side roster state);
//       rosters are purely client-derived from event teamId+playerId
//   applyPickUndoneEvent (line 3150):
//     - picksMade--
//     - completed → in_progress
//     - in_progress → not_started if picksMade drops to 0
//     - server does not touch rosters (as above); client removes the
//       referenced pick from the team's roster using undoneSeq to
//       locate the original pick_submitted
//   applyCommissionerOverrideEvent (line 3210):
//     - picksMade++ (same as pick_submitted)
//     - same status transitions as pick_submitted
//     - skips draftOrder validation (commissioner authority)
//     - client adds player to specified team regardless of draftOrder
//   auction_* variants (line 3247+):
//     - out of scope for DR-1; chunk 11g.6 territory. No-op with pointer.
//
// See the derivation-consumer wiring in `runner.ts` for how the store
// composes seed + matrix + events into derived state.

import type {
  BufferedDraftEvent,
  DraftSnapshot,
  LobbyStatus,
} from '@citrus/shared';
import type { DraftOrderSlot } from './fetchDraftOrderMatrix';

/**
 * One pick's contribution to a team's roster. Preserves the seq so a
 * subsequent pick_undone can find + remove the exact entry by matching
 * on undoneSeq.
 */
export interface RosterEntry {
  seq: number;
  playerId: number;
  pickNumber: number;
  roundNumber: number;
  isAutopick?: boolean;
  isOverride?: boolean;
}

/**
 * Derived state — the sole surface components should read. Everything
 * here is folded from events + the fetched draft-order matrix; nothing
 * comes from `DraftSnapshot.stateSnapshot`'s convenience fields.
 *
 * `onClockTeamId` semantics MIRROR the server's:
 *   - null when draftStatus is 'not_started', 'completed', or 'cancelled'
 *   - null when the draft-order matrix is unavailable (fetch failed —
 *     board still renders picks-made + rosters; on-clock shows '—' in UI)
 *   - draftOrder[picksMade].teamId otherwise
 */
export interface DerivedDraftState {
  currentPickNumber: number | null;
  currentRoundNumber: number | null;
  onClockTeamId: string | null;
  picksMade: number;
  totalPicks: number;
  draftStatus: LobbyStatus;
  /**
   * teamId → picks that team has made so far, in pick_number order.
   * pick_undone removes entries; commissioner_override adds them.
   */
  teamRosters: Map<string, RosterEntry[]>;
  /**
   * The highest event seq folded into this state. Idempotency check
   * for repeat events uses `seq <= foldedThroughSeq`.
   */
  foldedThroughSeq: number;
}

/**
 * Result of a fold — the new state plus any structural signals for
 * the store/runner. `gaps` lists seq values that were expected but
 * missing (the seed's ring buffer ends at seq N, a live event arrives
 * at seq N+3, positions N+1 and N+2 are the gap). Store surfaces this;
 * runner dispatches a resync per architect F3 ratification.
 *
 * `gaps` is empty on normal contiguous folds. When populated, the
 * caller should NOT continue folding subsequent events until the gap
 * is filled (resync response) — proceeding would produce an incorrect
 * roster state because the missing picks might have added players
 * that later events reference.
 */
export interface FoldResult {
  state: DerivedDraftState;
  gaps: number[];
}

/**
 * Seed values pulled from the initial `DraftSnapshot`. Distinct from
 * `stateSnapshot`'s convenience fields (which are seed-ONLY per the
 * F4 fix — we do not read them for the running state).
 *
 * `totalPicks` comes from `DraftSnapshot.stateSnapshot.totalPicks` —
 * the ONE convenience field we still trust because it derives from
 * `LobbyManager.draftOrder.length` at construction, not from stale
 * mid-draft state. If a future finding shows this field also drifts,
 * we can pivot to deriving from the matrix length instead.
 */
export interface DerivationSeed {
  totalPicks: number;
  format: DraftSnapshot['format'];
}

/**
 * Extract a `DerivationSeed` from a `DraftSnapshot`.
 */
export function seedFromSnapshot(snapshot: DraftSnapshot): DerivationSeed {
  return {
    totalPicks: snapshot.stateSnapshot.totalPicks,
    format: snapshot.format,
  };
}

/**
 * The bootstrap "empty" derived state — no events folded, no picks
 * made, status 'not_started'. Used as the starting point for a full
 * fold and as the reset target when a snapshot arrives.
 */
export function emptyDerivedState(seed: DerivationSeed): DerivedDraftState {
  return {
    currentPickNumber: null,
    currentRoundNumber: null,
    onClockTeamId: null,
    picksMade: 0,
    totalPicks: seed.totalPicks,
    draftStatus: 'not_started',
    teamRosters: new Map(),
    foldedThroughSeq: 0,
  };
}

/**
 * Fold a batch of events onto a prior state. Events must be in
 * ascending seq order (caller's responsibility — the store's ordering
 * is already guaranteed by the reduce.ts wire-message pipeline). This
 * function does NOT sort; sorting would hide gap-detection.
 *
 * Repeat events (seq <= state.foldedThroughSeq) are silently no-op'd
 * — idempotent per the join-path-robustness posture.
 *
 * Auction events are silently no-op'd (chunk 11g.6 territory).
 *
 * `matrix` may be null when the fetcher hasn't landed yet or failed;
 * in that case `onClockTeamId` stays null but picksMade / rosters /
 * status still fold correctly.
 */
export function foldEvents(
  state: DerivedDraftState,
  events: ReadonlyArray<BufferedDraftEvent>,
  matrix: ReadonlyArray<DraftOrderSlot> | null,
): FoldResult {
  let picksMade = state.picksMade;
  let draftStatus = state.draftStatus;
  let foldedThroughSeq = state.foldedThroughSeq;
  const teamRosters = new Map(
    Array.from(state.teamRosters.entries(), ([k, v]) => [k, [...v]]),
  );
  const gaps: number[] = [];

  for (const event of events) {
    // Idempotency: skip already-folded seqs.
    if (event.seq <= foldedThroughSeq) {
      continue;
    }
    // Gap detection: contiguous seqs advance foldedThroughSeq by 1
    // each. Any jump reports the missing seqs and STOPS the fold —
    // the runner's resync path must fill the gap before we can safely
    // continue (a missing pick_submitted might carry a player_id that
    // later events reference).
    const expectedNext = foldedThroughSeq + 1;
    if (event.seq > expectedNext) {
      for (let missing = expectedNext; missing < event.seq; missing++) {
        gaps.push(missing);
      }
      // Halt fold; caller resyncs and re-folds with the full range.
      break;
    }

    switch (event.kind) {
      case 'pick_submitted':
      case 'commissioner_override': {
        // Mirror LobbyManager.applyPickEvent (line 3022) +
        // applyCommissionerOverrideEvent (line 3210). Both bump
        // picksMade; both transition status the same way; both add
        // to the specified team's roster (with commissioner_override
        // trusting its own payload's teamId over the draft-order slot).
        const roster = teamRosters.get(event.teamId) ?? [];
        roster.push({
          seq: event.seq,
          playerId: event.playerId,
          pickNumber: event.pickNumber,
          roundNumber: event.roundNumber,
          ...(event.kind === 'pick_submitted' && event.isAutopick
            ? { isAutopick: true }
            : {}),
          ...(event.kind === 'commissioner_override' ? { isOverride: true } : {}),
        });
        teamRosters.set(event.teamId, roster);
        picksMade += 1;
        if (draftStatus === 'not_started') {
          draftStatus = 'in_progress';
        }
        if (picksMade >= state.totalPicks) {
          draftStatus = 'completed';
        }
        break;
      }

      case 'pick_undone': {
        // Mirror LobbyManager.applyPickUndoneEvent (line 3150).
        // Server does not touch rosters (it has no roster state) —
        // client removes the referenced pick from the team's roster
        // by matching the undoneSeq to the original pick_submitted's
        // seq in the team's roster. Fallback: if not found (should
        // not happen in a coherent stream), decrement picksMade and
        // leave the roster untouched to avoid double-removal on a
        // second undo of the same pick.
        const roster = teamRosters.get(event.teamId);
        if (roster) {
          const idx = roster.findIndex((r) => r.seq === event.undoneSeq);
          if (idx !== -1) {
            roster.splice(idx, 1);
            teamRosters.set(event.teamId, roster);
          }
        }
        picksMade -= 1;
        if (picksMade < 0) {
          // Defensive: server invariants prevent this, but the fold
          // should stay total. Clamp and continue.
          picksMade = 0;
        }
        if (draftStatus === 'completed') {
          draftStatus = 'in_progress';
        }
        if (picksMade === 0) {
          draftStatus = 'not_started';
        }
        break;
      }

      // Auction variants — chunk 11g.6 territory. LobbyManager has
      // separate handlers per event.kind (auction_nomination_started
      // etc. at LobbyManager.ts:3247+); those events do not affect
      // snake/linear derivation. When the auction UI lands, extend
      // this switch with a parallel auction-state derivation.
      case 'auction_nomination_started':
      case 'auction_bid_placed':
      case 'auction_bid_extends_timer':
      case 'auction_nomination_expired':
      case 'auction_nomination_closed':
      case 'auction_auto_nominated':
      case 'auction_paused':
      case 'auction_resumed':
      case 'auction_commissioner_override':
        // No-op — snake/linear derivation ignores auction events.
        break;
    }

    foldedThroughSeq = event.seq;
  }

  // Recompute on-clock from the matrix (or null if unavailable). The
  // ONLY place the matrix is consumed — everything else is pure event
  // folding. Server semantic: onClockTeamId is null when draftStatus
  // is 'not_started', 'completed', 'cancelled', or 'paused', else
  // draftOrder[picksMade].teamId.
  let onClockTeamId: string | null = null;
  let currentPickNumber: number | null = null;
  let currentRoundNumber: number | null = null;
  if (
    draftStatus === 'in_progress' &&
    matrix !== null &&
    picksMade < matrix.length
  ) {
    const slot = matrix[picksMade];
    onClockTeamId = slot.teamId;
    currentPickNumber = slot.pickNumber;
    currentRoundNumber = slot.round;
  }

  return {
    state: {
      currentPickNumber,
      currentRoundNumber,
      onClockTeamId,
      picksMade,
      totalPicks: state.totalPicks,
      draftStatus,
      teamRosters,
      foldedThroughSeq,
    },
    gaps,
  };
}

/**
 * Convenience: full-replay derivation from an empty seed. Equivalent
 * to `foldEvents(emptyDerivedState(seed), events, matrix)`.
 *
 * Used by the store when a fresh snapshot lands (reset the derivation
 * and re-fold the snapshot's `recentEvents` array from scratch).
 */
export function deriveFromSnapshot(
  snapshot: DraftSnapshot,
  matrix: ReadonlyArray<DraftOrderSlot> | null,
): FoldResult {
  const seed = seedFromSnapshot(snapshot);
  return foldEvents(emptyDerivedState(seed), snapshot.recentEvents, matrix);
}
