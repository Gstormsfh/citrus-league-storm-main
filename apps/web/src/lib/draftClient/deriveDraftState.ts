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
  /**
   * PICK-LATENCY (2026-08-12) — true ONLY on synthetic entries injected
   * by `overlayPendingPicks` for a pick the user has submitted but the
   * server has not yet confirmed.
   *
   * The fold NEVER sets this: `deriveDraftState` produces exclusively
   * server-confirmed entries, so anything carrying `isPending` came from
   * the optimistic overlay and will be replaced by a real entry (or
   * removed by rollback) within a few hundred milliseconds. Consumers
   * that must not count unconfirmed picks should filter on it.
   */
  isPending?: boolean;
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

    // ── S7-Q1 (2026-08-08 evening ARCHITECT ruling) — absorbing
    //    terminal states ─────────────────────────────────────────
    // "Once completed OR cancelled, no frame transitions the client
    // out of it (each ignored with debug log). Completed never
    // overwrites cancelled, nor the reverse."
    //
    // This is a GENERALIZED monotonicity guard, stricter than the
    // prior conservative per-case checks. Once draftStatus enters a
    // terminal state, EVERY subsequent wire kind is silently ignored
    // — pick_submitted / pick_undone / commissioner_override /
    // draft_started / draft_completed / draft_cancelled / auction_*
    // / unknown future kinds — with a debug-log breadcrumb.
    //
    // Divergence from server (deliberate): server's applyPickUndoneEvent
    // (LobbyManager.ts:3483) reverts completed→in_progress on
    // pick_undone. Post-Q1 the client refuses that revert mid-flight;
    // if a legitimate undo happens post-completion (rare — commissioner
    // action), a fresh snapshot re-derive from empty state correctly
    // folds all events including the undo. Client UX guarantees
    // monotonic-forward rendering; server owns pick history authority.
    //
    // foldedThroughSeq still advances so subsequent events pass the
    // seq-contiguity check at :189 and outer idempotency at :181.
    if (
      draftStatus === 'completed' ||
      draftStatus === 'cancelled'
    ) {
      if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        console.debug(
          '[deriveDraftState] absorbing terminal state; ignoring frame',
          {
            terminalStatus: draftStatus,
            kind: event.kind,
            seq: event.seq,
          },
        );
      }
      foldedThroughSeq = event.seq;
      continue;
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

      // ── F28 (2026-08-08) — lifecycle event handlers ──────────────
      // Ratified brief: deriveDraftState handles draft_started /
      // draft_completed, IDEMPOTENT + MONOTONIC (completed never
      // reverts to in_progress; a stray pick frame after completion
      // must not un-complete the room).
      //
      // Idempotency is inherited from the outer seq-skip guard at
      // line 181 (`if (event.seq <= foldedThroughSeq) continue`).
      // F27b-2 defect (bootstrapFullEventReplay leaves lastAppliedSeq
      // at 0; first post-bootstrap NOTIFY re-fetches + re-applies seq 1)
      // means a client can plausibly receive the same draft_started
      // twice. First apply advances foldedThroughSeq to 1; second
      // apply short-circuits at the outer guard. Handler body below
      // is idempotent by construction — pure conditional set.
      //
      // Monotonicity for draft_completed: 'completed' is a terminal
      // status in this reducer. A stray pick_submitted arriving at
      // seq > completion's seq (impossible per server invariants but
      // defensive) falls into the pick_submitted case above whose
      // `if (draftStatus === 'not_started')` guard does NOT touch
      // 'completed'; the `picksMade >= totalPicks` re-assertion
      // keeps status at 'completed'. Legitimate pick_undone still
      // reverts (server-mirror semantic; see :251-256).
      case 'draft_started': {
        // Server mirror: LobbyManager.applyDraftStartedEventState
        // (:3333) transitions 'not_started' → 'in_progress' + arms
        // the first pick timer. Client mirror: transition status only.
        // Deadline surface lives OUT of DerivedDraftState (the timer
        // reads `snapshot.stateSnapshot.currentPickDeadline`); this
        // reducer manages status + picksMade + rosters + on-clock.
        //
        // Monotonicity: only advance not_started → in_progress. If
        // status is already 'in_progress' / 'paused' / 'completed' /
        // 'cancelled' (stale or reordered event), leave unchanged.
        // The `if` guard is doing both the idempotency-on-repeat and
        // the monotonicity check in one condition.
        if (draftStatus === 'not_started') {
          draftStatus = 'in_progress';
        }
        break;
      }

      case 'draft_completed': {
        // Server mirror: LobbyManager `case 'draft_completed'` at
        // :2872 sets `draftStatus='completed'`, cancels the pick
        // timer, nulls `currentTimerDeadline`. Client mirror: set
        // status. Timer clears automatically because DraftTimerV2
        // (:118) hides when `draftStatus !== 'in_progress' &&
        // draftStatus !== 'paused'`. On-clock team clears via the
        // matrix-recompute below (`if (draftStatus === 'in_progress'
        // && ...)` at :289).
        //
        // Unconditional overwrite (consistent with the `if (picksMade
        // >= totalPicks) draftStatus = 'completed'` pattern at :222
        // that also overwrites any non-cancelled prior status). Repeat
        // frames are skipped at the outer seq guard, so the terminal
        // set fires at most once per unique seq.
        //
        // MONOTONICITY GUARANTEE: after this fires, the only path
        // that can revert to a non-'completed' status is pick_undone
        // (server-mirror semantic — user explicitly undoes a pick).
        // Stray pick_submitted post-completion cannot un-complete
        // (see pick_submitted case guards + trailing totals check).
        draftStatus = 'completed';
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
      case 'auction_nomination_skipped':
      case 'auction_paused':
      case 'auction_resumed':
      case 'auction_commissioner_override':
        // No-op — snake/linear derivation ignores auction events.
        // F28 (2026-08-08): added `auction_nomination_skipped` to
        // this group (previously missing; had fallen through to
        // implicit no-op with foldedThroughSeq advance — same
        // effective behavior but now explicit for reviewer clarity
        // and to keep the F28-added `default` clause below reserved
        // for truly-unknown forward-compat kinds).
        break;

      default: {
        // F28 (2026-08-08) — forward-compat default. Unknown wire
        // `kind` values are silently ignored (never throw) with a
        // debug-log breadcrumb so future engine additions don't break
        // old client bundles. INS-16 pattern: pave the safe path,
        // surface via observability, never block on unknown types.
        //
        // At compile time `event` is typed `never` here (all union
        // variants above are handled); the cast is only for the log
        // payload. If a new variant is added to BufferedDraftEvent
        // and NOT wired into the switch above, this default catches
        // it silently — TypeScript will not flag the omission
        // (which is deliberate: additive union changes stay backward-
        // compatible with old client bundles).
        const unknown = event as { kind: string; seq: number };
        if (typeof console !== 'undefined' && typeof console.debug === 'function') {
          console.debug(
            '[deriveDraftState] unknown event kind ignored',
            { kind: unknown.kind, seq: unknown.seq },
          );
        }
        break;
      }
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
 *
 * Entry 103 F2b (2026-08-11): when `snapshot.picks` is present
 * (terminal-league HTTP snapshot path), derive teamRosters +
 * picksMade + draftStatus DIRECTLY from the authoritative picks
 * projection, bypassing the recentEvents fold. Root cause: engine
 * lobby eviction post-completion leaves recentEvents empty; the
 * fold would produce picksMade=0 + draftStatus='not_started' →
 * header renders "0/N picks · waiting for pick 1" instead of the
 * completed board. The route enriches terminal responses with a
 * `picks` array queried from `draft_picks_v2` (the trigger-
 * maintained projection — spec §3.2, principle P6); this path
 * consumes it directly per architect ratification: the projection
 * IS the source of truth, not the event log.
 */
export function deriveFromSnapshot(
  snapshot: DraftSnapshot,
  matrix: ReadonlyArray<DraftOrderSlot> | null,
): FoldResult {
  const seed = seedFromSnapshot(snapshot);
  if (snapshot.picks && snapshot.picks.length > 0) {
    return deriveFromTerminalPicks(snapshot, seed);
  }
  return foldEvents(emptyDerivedState(seed), snapshot.recentEvents, matrix);
}

/**
 * Entry 103 F2b — build a `DerivedDraftState` from the terminal
 * snapshot's authoritative picks projection.
 *
 * Synthesizes the same shape `foldEvents` would produce from a
 * complete pick_submitted event stream:
 *   - `teamRosters`: teamId → RosterEntry[] in pick_number order,
 *     with `seq` set to the pick_number itself (no draft_events
 *     seqs are available; pick_number is a stable within-league
 *     ordering key that satisfies RosterEntry's role in v1Adapters).
 *   - `picksMade`: picks.length (one row per pick by draft_picks_v2's
 *     PRIMARY KEY (league_id, pick_number) invariant).
 *   - `draftStatus`: 'completed' when picksMade >= totalPicks, else
 *     'in_progress' (matches foldEvents pick_submitted transitions).
 *     Terminal-cancelled leagues carry draftStatus='cancelled' via
 *     the route's E99 decoration through `snapshot.stateSnapshot`;
 *     this helper seeds from picks-count and lets the store's
 *     stateSnapshot patch (reduce.ts E99 fix c) override if needed
 *     for cancelled variant.
 *   - `foldedThroughSeq`: 0 — no draft_events were folded. Any
 *     subsequent WS event would be a re-connection race (rare for
 *     terminal leagues); the outer seq-contiguity check would
 *     naturally treat it as a fresh fold starting from seq 1.
 *   - `onClockTeamId`: always null for terminal (matches foldEvents
 *     semantic for completed).
 */
function deriveFromTerminalPicks(
  snapshot: DraftSnapshot,
  seed: DerivationSeed,
): FoldResult {
  const picks = snapshot.picks ?? [];
  const teamRosters = new Map<string, RosterEntry[]>();
  for (const pick of picks) {
    const roster = teamRosters.get(pick.teamId) ?? [];
    roster.push({
      seq: pick.pickNumber,
      playerId: pick.playerId,
      pickNumber: pick.pickNumber,
      roundNumber: pick.roundNumber,
      ...(pick.isAutopick ? { isAutopick: true } : {}),
    });
    teamRosters.set(pick.teamId, roster);
  }
  // Sort each team's roster by pickNumber to guarantee display order
  // independent of the picks array's incoming order (which is
  // route-guaranteed ASC but explicit here is cheaper than trusting).
  for (const roster of teamRosters.values()) {
    roster.sort((a, b) => a.pickNumber - b.pickNumber);
  }
  const picksMade = picks.length;
  // Prefer the route-decorated stateSnapshot.draftStatus (E99 fix b)
  // when it's terminal — the cancelled variant lives there. Fall
  // through to computed status otherwise.
  const stateSnapshotStatus = snapshot.stateSnapshot.draftStatus;
  const draftStatus: LobbyStatus =
    stateSnapshotStatus === 'cancelled'
      ? 'cancelled'
      : picksMade >= seed.totalPicks
        ? 'completed'
        : stateSnapshotStatus === 'completed'
          ? 'completed'
          : 'in_progress';
  return {
    state: {
      currentPickNumber: null,
      currentRoundNumber: null,
      onClockTeamId: null,
      picksMade,
      totalPicks: seed.totalPicks,
      draftStatus,
      teamRosters,
      foldedThroughSeq: 0,
    },
    gaps: [],
  };
}
