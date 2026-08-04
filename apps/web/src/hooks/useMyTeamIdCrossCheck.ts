// F14(b) (2026-08-03) — client-side myTeamId ↔ draft-order-matrix
// cross-check with fail-loud recovery.
//
// The F14 incident (2026-07-31) proved that a stale membership cache
// could serve a myTeamId that isn't in the draft. The pre-fix room
// let the user sit there with a healthy-looking header + clock but
// silently could not draft — invariant I1 violation ("never lose a
// pick"). This hook enforces the invariant on the client side.
//
// Rule (architect ruling 2026-07-31):
//   1. When the draft is ACTIVE (`draftStatus === 'in_progress'`) AND
//      both myTeamId + matrix are resolved, verify myTeamId appears
//      somewhere in the matrix.
//   2. If missing: re-resolve myTeamId ONCE via `GET /api/leagues/:id/
//      my-team` (bypasses any client-side cache; server-side cache
//      handling is F14(a)'s job).
//   3. If STILL missing after re-resolve: set `identityFailure` in
//      the store. The room's JSX gates draft controls off this flag
//      and renders a hard-error banner. Silent-degrade-to-can't-draft
//      is unacceptable.
//
// Server-side coverage (F14(a)) is orthogonal: the server MUST bypass
// its cache on the my-team endpoint so this hook's re-resolve reaches
// authoritative state. The client's cross-check is defence in depth
// against ANY future divergence — cache, race, migration, etc.

import { useEffect, useRef } from 'react';
import type { DraftOrderSlot } from '@/lib/draftClient/fetchDraftOrderMatrix';
import { useDraftClientStore } from '@/stores/draftClientStore';

interface UseMyTeamIdCrossCheckOptions {
  leagueId: string;
}

export function useMyTeamIdCrossCheck({
  leagueId,
}: UseMyTeamIdCrossCheckOptions): void {
  const myTeamId = useDraftClientStore((s) => s.myTeamId);
  const matrix = useDraftClientStore((s) => s.matrix);
  const draftStatus = useDraftClientStore(
    (s) => s.derivedState?.draftStatus ?? null,
  );

  // Track (myTeamId, matrix-identity) pairs we've already re-resolved
  // for, so a single mismatch triggers exactly one re-resolve rather
  // than a hot loop. Cleared implicitly when either value changes.
  const reresolvedForRef = useRef<{
    myTeamId: string | null;
    matrix: ReadonlyArray<DraftOrderSlot> | null;
  }>({ myTeamId: null, matrix: null });

  useEffect(() => {
    // Cross-check only meaningful during an ACTIVE draft. A member
    // sitting in the room before the draft starts is legitimate
    // (draft_order may not exist yet). Architect ruling: check on
    // mount AND on not_started → in_progress transition — the
    // useEffect naturally re-fires on every draftStatus change,
    // covering the transition.
    if (draftStatus !== 'in_progress') return;
    if (matrix === null) return;         // Matrix hasn't loaded — nothing to check.
    if (myTeamId === null) return;       // Spectator flow — nothing to check.

    const teamInMatrix = matrix.some((slot) => slot.teamId === myTeamId);
    if (teamInMatrix) {
      // All good. Clear any previous failure state so a fresh matrix
      // that DOES include the team un-latches the banner.
      const current = useDraftClientStore.getState().identityFailure;
      if (current !== null) {
        useDraftClientStore.getState().setIdentityFailure(null);
      }
      return;
    }

    // Mismatch. Have we already re-resolved for this exact (myTeamId,
    // matrix) pair? If yes, escalate to identityFailure. If no,
    // re-resolve once.
    const alreadyReresolved =
      reresolvedForRef.current.myTeamId === myTeamId &&
      reresolvedForRef.current.matrix === matrix;

    if (alreadyReresolved) {
      // Second observation of the mismatch → confirmed failure.
      useDraftClientStore.getState().setIdentityFailure({
        reason: 'my_team_not_in_matrix',
      });
      return;
    }

    // First observation — re-resolve. Marker the ref BEFORE the async
    // fetch to prevent a re-render mid-fetch from double-firing.
    reresolvedForRef.current = { myTeamId, matrix };

    let cancelled = false;
    void (async () => {
      try {
        const { apiClient } = await import('@/api/client');
        const path = `/api/leagues/${encodeURIComponent(leagueId)}/my-team`;
        const response = await apiClient.get<{ id?: string }>(path);
        if (cancelled) return;
        const payload =
          response.data ?? (response as unknown as { id?: string });
        const freshTeamId =
          payload && typeof payload === 'object' && typeof payload.id === 'string'
            ? payload.id
            : null;

        if (freshTeamId === null) {
          // No team owned in this league at all — legitimate spectator.
          // Clear failure state; the submit control is already gated
          // on myTeamId != null.
          useDraftClientStore.getState().setMyTeamId(null);
          useDraftClientStore
            .getState()
            .setIdentityFailure(null);
          return;
        }

        // Update myTeamId. If the fresh value is DIFFERENT, the store
        // update triggers a re-run of this effect, which re-checks
        // matrix membership and either clears the failure (fresh id
        // is in matrix) OR sees alreadyReresolved and sets failure
        // (fresh id still isn't in matrix).
        //
        // But if the fresh value is the SAME as the current one (F14
        // mechanism — server-side cache still serving stale), Zustand
        // detects no state change and does NOT re-run the effect. So
        // check membership synchronously here and set failure directly.
        useDraftClientStore.getState().setMyTeamId(freshTeamId);
        const stillMissing = !matrix.some(
          (slot) => slot.teamId === freshTeamId,
        );
        if (stillMissing) {
          useDraftClientStore.getState().setIdentityFailure({
            reason: 'my_team_not_in_matrix',
          });
        }
      } catch {
        // Re-resolve failed (network / 5xx). Distinct from a
        // confirmed mismatch (F11/F15 honest-copy lineage — do not
        // assert a fact you couldn't verify). Set a separate reason
        // so the banner can say "couldn't verify" rather than
        // "not in draft." F15's transient-503 machinery retries the
        // underlying request; this hook fires the banner immediately
        // so the user is never silently stuck while retries happen.
        if (!cancelled) {
          useDraftClientStore.getState().setIdentityFailure({
            reason: 'my_team_unverifiable',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId, myTeamId, matrix, draftStatus]);
}
