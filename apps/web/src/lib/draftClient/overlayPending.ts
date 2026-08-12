// PICK-LATENCY (2026-08-12) — optimistic pending-pick overlay.
//
// WHY THIS FILE EXISTS
// --------------------
// The optimistic-submission machinery (chunk 11g.5b, `optimistic.ts`)
// has been complete and tested since July: `recordPendingAction` fires
// synchronously on click, and all four reconciliation paths — broadcast,
// resync, rejection, network-failure-then-resync — are implemented and
// covered. What was missing was the last mile: `pendingActions` never
// reached the render.
//
// Every view the manager looks at during a draft — the player pool, the
// board, the team rosters, the history — is derived from
// `DerivedDraftState.teamRosters`, which by design contains ONLY
// server-confirmed picks. So the observable behaviour of clicking Draft
// was: the button greys out, and nothing else changes until the server
// answers. Measured on staging that was ~5.9s (E145 pre-fix) and ~1.9s
// after. Either way the player sat in the pool the whole time, which is
// the entire perceptual gap against Sleeper — a gap that is NOT about
// how fast the pick commits (the RPC's read path measures 3.5ms on a
// 252-pick league) but about when we choose to draw it.
//
// THE DESIGN
// ----------
// One pure function, applied at the render boundary, that overlays
// pending picks onto the folded state. Because all four v1 adapters
// (`toAvailablePlayers`, `toDraftedPlayerIds`, `toV1Teams`,
// `toDraftHistory`) read `teamRosters` and nothing else, overlaying
// that single map fixes every view at once — with no change to the
// adapters, and therefore no change to their existing tests.
//
// WHAT IS DELIBERATELY *NOT* OVERLAID
// -----------------------------------
// `currentPickNumber`, `currentRoundNumber`, `onClockTeamId` and
// `picksMade` are left exactly as the server folded them. Advancing the
// clock optimistically would flip `amIOnClock` to false, tear down the
// on-clock action bar, and re-arm the timer against a pick the server
// has not acknowledged — trading a cosmetic delay for a lie about whose
// turn it is. The double-submit guard does not depend on it either: the
// Draft button is already disabled by `isSubmitPending` the moment
// `recordPending` lands. So the pick draws instantly, while the clock
// stays server-authoritative. That asymmetry is the point.

import type { DerivedDraftState, RosterEntry } from './deriveDraftState';
import type { PendingAction } from './optimistic';

/**
 * Overlay optimistic pending picks onto folded draft state.
 *
 * Returns `derived` BY REFERENCE when there is nothing to overlay, so
 * downstream `useMemo` dependencies do not invalidate and React does not
 * re-render on every unrelated store tick. This matters: the overlay
 * runs on the draft room's hottest render path.
 *
 * @param derived  Folded, server-confirmed state (null before first fold).
 * @param pendingActions  The store's pending-action map.
 */
export function overlayPendingPicks(
  derived: DerivedDraftState | null,
  pendingActions: ReadonlyMap<string, PendingAction>,
): DerivedDraftState | null {
  if (derived === null) return derived;
  if (pendingActions.size === 0) return derived;

  // Only `pending` entries render optimistically. `rolled_back` entries
  // linger in the map purely so the UI can play a flash-out animation;
  // they must NOT put a player back on the board.
  const live: PendingAction[] = [];
  for (const action of pendingActions.values()) {
    if (action.optimisticState === 'pending') live.push(action);
  }
  if (live.length === 0) return derived;

  // Dedupe against confirmed state. There is a real frame — however
  // brief — in which the server's pick event has been folded into
  // `teamRosters` but `reconcileOnBroadcast` has not yet dropped the
  // matching pending entry. Without this guard the manager would see
  // their player twice on that frame, which reads as a duplicate-pick
  // bug at exactly the moment they are watching most closely.
  //
  // The check spans ALL teams, not just the submitting one: if another
  // team already holds the player, our submission is doomed and the
  // rejection path will surface `player_taken` shortly. Drawing it on
  // our roster in the meantime would be an outright false statement.
  const confirmedPlayerIds = new Set<number>();
  derived.teamRosters.forEach((roster) => {
    for (const entry of roster) confirmedPlayerIds.add(entry.playerId);
  });

  const toApply = live.filter((a) => !confirmedPlayerIds.has(a.playerId));
  if (toApply.length === 0) return derived;

  // Copy-on-write: clone the outer map, and clone ONLY the roster arrays
  // that actually gain an entry. Every other array keeps its identity so
  // memoized per-team consumers downstream stay stable.
  const teamRosters = new Map(derived.teamRosters);

  for (const action of toApply) {
    const existing = teamRosters.get(action.teamId) ?? [];
    const synthetic: RosterEntry = {
      // Synthetic seq. Never persisted, never folded, never matched by
      // `pick_undone` — undo arrives as a server event and is folded
      // BEFORE this overlay is applied on top. Sits above every real
      // seq so ordering stays intuitive if anything sorts on it.
      seq: derived.foldedThroughSeq + 1,
      playerId: action.playerId,
      // Prefer the slot captured at click time; fall back to the live
      // derived values for callers predating that field.
      pickNumber: action.pickNumber ?? derived.currentPickNumber ?? 0,
      roundNumber: action.roundNumber ?? derived.currentRoundNumber ?? 0,
      isAutopick: false,
      isPending: true,
    };
    // Append rather than splice-and-sort: a pending pick is by
    // definition the pick currently on the clock, so it belongs at the
    // end of an already pick-number-ordered roster.
    teamRosters.set(action.teamId, [...existing, synthetic]);
  }

  return { ...derived, teamRosters };
}

/**
 * True when `derived` contains at least one optimistic entry. Useful for
 * components that want to distinguish "the board is settled" from "we
 * are showing something the server has not confirmed".
 */
export function hasPendingOverlay(derived: DerivedDraftState | null): boolean {
  if (derived === null) return false;
  for (const roster of derived.teamRosters.values()) {
    for (const entry of roster) {
      if (entry.isPending === true) return true;
    }
  }
  return false;
}
