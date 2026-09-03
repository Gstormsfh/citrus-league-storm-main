// F14(b) (2026-08-03) — cross-check hook tests.
//
// Two branches architect specified explicitly:
//   1. mismatch + re-resolve succeeds  → clear failure
//   2. mismatch + re-resolve still bad → set failure
// Plus baseline behaviors:
//   - all clear: no failure, no re-resolve
//   - not_started status: no cross-check runs at all
//   - matrix null: no cross-check
//   - re-resolve throws (network): set failure (defensive)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiGetMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({
  apiClient: {
    get: apiGetMock,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Import the hook + store AFTER mocks.
import { useMyTeamIdCrossCheck } from '../useMyTeamIdCrossCheck';
import { useDraftClientStore } from '@/stores/draftClientStore';
import type { DraftOrderSlot } from '@/lib/draftClient/fetchDraftOrderMatrix';
import type { DerivedDraftState } from '@/lib/draftClient/deriveDraftState';
import type { DraftSnapshot } from '@citrus/shared';

// Store setters we manipulate directly to construct the observed state.
function primeStore(opts: {
  myTeamId: string | null;
  matrix: ReadonlyArray<DraftOrderSlot> | null;
  draftStatus: DerivedDraftState['draftStatus'] | null;
}) {
  const store = useDraftClientStore.getState();
  store.reset();
  store.setMyTeamId(opts.myTeamId);
  // setMatrix normally re-derives — but with no snapshot it just
  // stashes the matrix. That's fine for the cross-check hook which
  // reads `matrix` directly.
  store.setMatrix(opts.matrix);
  // Force a derivedState with the right draftStatus. Bypass the
  // fold pipeline — we're testing the hook's reads, not derivation.
  if (opts.draftStatus !== null) {
    useDraftClientStore.setState({
      derivedState: {
        draftStatus: opts.draftStatus,
      } as unknown as DerivedDraftState,
      snapshot: {} as DraftSnapshot,
    });
  }
}

function matrixFor(teamIds: string[]): DraftOrderSlot[] {
  return teamIds.map((teamId, i) => ({
    round: 1,
    pickNumber: i + 1,
    teamId,
  }));
}

describe('useMyTeamIdCrossCheck', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    useDraftClientStore.getState().reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('all clear: myTeamId ∈ matrix during in_progress → no failure, no re-resolve', async () => {
    primeStore({
      myTeamId: 'team-3',
      matrix: matrixFor(['team-1', 'team-2', 'team-3']),
      draftStatus: 'in_progress',
    });

    renderHook(() => useMyTeamIdCrossCheck({ leagueId: 'league-a' }));

    // Give any potential async re-resolve a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(useDraftClientStore.getState().identityFailure).toBeNull();
  });

  it('not_started status: no cross-check runs (member sitting in room before draft order exists)', async () => {
    primeStore({
      myTeamId: 'team-nowhere',
      matrix: matrixFor(['team-1', 'team-2']),
      draftStatus: 'not_started',
    });

    renderHook(() => useMyTeamIdCrossCheck({ leagueId: 'league-a' }));

    await new Promise((r) => setTimeout(r, 20));
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(useDraftClientStore.getState().identityFailure).toBeNull();
  });

  it('matrix null: no cross-check (matrix hasn\'t loaded yet)', async () => {
    primeStore({
      myTeamId: 'team-3',
      matrix: null,
      draftStatus: 'in_progress',
    });

    renderHook(() => useMyTeamIdCrossCheck({ leagueId: 'league-a' }));

    await new Promise((r) => setTimeout(r, 20));
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(useDraftClientStore.getState().identityFailure).toBeNull();
  });

  it('spectator (myTeamId null): no cross-check', async () => {
    primeStore({
      myTeamId: null,
      matrix: matrixFor(['team-1', 'team-2']),
      draftStatus: 'in_progress',
    });

    renderHook(() => useMyTeamIdCrossCheck({ leagueId: 'league-a' }));

    await new Promise((r) => setTimeout(r, 20));
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(useDraftClientStore.getState().identityFailure).toBeNull();
  });

  it('BRANCH 1: mismatch + re-resolve returns correct team → myTeamId updated, no failure', async () => {
    // Simulates the F14 mechanism: stale cache served the wrong
    // teamId; a fresh /my-team fetch returns the right one.
    apiGetMock.mockResolvedValue({ data: { id: 'team-3' } });
    primeStore({
      myTeamId: 'team-stale',
      matrix: matrixFor(['team-1', 'team-2', 'team-3']),
      draftStatus: 'in_progress',
    });

    renderHook(() => useMyTeamIdCrossCheck({ leagueId: 'league-a' }));

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith('/api/leagues/league-a/my-team');
    });
    await waitFor(() => {
      expect(useDraftClientStore.getState().myTeamId).toBe('team-3');
    });
    // After myTeamId updates, the hook re-runs and clears failure.
    await waitFor(() => {
      expect(useDraftClientStore.getState().identityFailure).toBeNull();
    });
  });

  it('BRANCH 2 (LOAD-BEARING): mismatch + re-resolve returns SAME wrong team → identityFailure SET (loud fail)', async () => {
    apiGetMock.mockResolvedValue({ data: { id: 'team-stale' } });
    primeStore({
      myTeamId: 'team-stale',
      matrix: matrixFor(['team-1', 'team-2', 'team-3']),
      draftStatus: 'in_progress',
    });

    renderHook(() => useMyTeamIdCrossCheck({ leagueId: 'league-a' }));

    await waitFor(() => {
      expect(useDraftClientStore.getState().identityFailure).toEqual({
        reason: 'my_team_not_in_matrix',
      });
    });
    // apiClient called exactly once — the ref-based guard prevents
    // a hot re-resolve loop.
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });

  it('BRANCH 2b (honest-copy — F11/F15 lineage): re-resolve THROWS → identityFailure reason=my_team_unverifiable (distinct from confirmed mismatch)', async () => {
    apiGetMock.mockRejectedValue(new Error('network is down'));
    primeStore({
      myTeamId: 'team-stale',
      matrix: matrixFor(['team-1', 'team-2', 'team-3']),
      draftStatus: 'in_progress',
    });

    renderHook(() => useMyTeamIdCrossCheck({ leagueId: 'league-a' }));

    await waitFor(() => {
      // Do NOT set 'my_team_not_in_matrix' — we didn't verify anything;
      // that would assert a fact we couldn't confirm (the F11/F15
      // honest-copy rule).
      expect(useDraftClientStore.getState().identityFailure).toEqual({
        reason: 'my_team_unverifiable',
      });
    });
  });

  it('BRANCH 1b: mismatch + re-resolve returns null (user no longer owns any team) → clears state, no failure', async () => {
    // Legitimate spectator flow — commissioner removed the user's
    // team ownership. Not an error condition; controls disappear
    // via the myTeamId=null gate downstream.
    apiGetMock.mockResolvedValue({ data: { id: null } });
    primeStore({
      myTeamId: 'team-stale',
      matrix: matrixFor(['team-1', 'team-2', 'team-3']),
      draftStatus: 'in_progress',
    });

    renderHook(() => useMyTeamIdCrossCheck({ leagueId: 'league-a' }));

    await waitFor(() => {
      expect(useDraftClientStore.getState().myTeamId).toBeNull();
    });
    expect(useDraftClientStore.getState().identityFailure).toBeNull();
  });

  it('transition path: not_started → in_progress triggers cross-check', async () => {
    // Member is sitting in the room BEFORE the draft starts. No
    // cross-check fires (matrix not consulted yet). When draftStatus
    // transitions to in_progress, the cross-check fires.
    apiGetMock.mockResolvedValue({ data: { id: 'team-stale' } });
    primeStore({
      myTeamId: 'team-stale',
      matrix: matrixFor(['team-1', 'team-2', 'team-3']),
      draftStatus: 'not_started',
    });

    const { rerender } = renderHook(() =>
      useMyTeamIdCrossCheck({ leagueId: 'league-a' }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(useDraftClientStore.getState().identityFailure).toBeNull();

    // Simulate the transition.
    useDraftClientStore.setState({
      derivedState: {
        draftStatus: 'in_progress',
      } as unknown as DerivedDraftState,
    });
    rerender();

    await waitFor(() => {
      expect(useDraftClientStore.getState().identityFailure).toEqual({
        reason: 'my_team_not_in_matrix',
      });
    });
  });
});
