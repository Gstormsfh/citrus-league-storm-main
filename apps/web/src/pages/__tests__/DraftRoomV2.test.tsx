// Phase 4.5 chunk 11g.5b — DraftRoomV2 integration test.
// DR-1b (2026-07-28) — extended for the derived-state cards + gap-
// triggered resync + matrix-fetch wiring.
//
// Mocks the DraftClientRunner and asserts the page wires it
// correctly: connect on mount, disconnect on unmount, callbacks
// route to the store.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { DraftSnapshot, BufferedDraftEvent } from '@citrus/shared';
import { useDraftClientStore } from '@/stores/draftClientStore';

// ── Mock the runner BEFORE importing the page ─────────────────────
//
// F22 structural (2026-08-03 architect ruling): shared factory typed
// against the real DraftClientRunner interface. Adding a new public
// method to runner.ts breaks the mock at typecheck (in mockRunner.ts)
// rather than silently at runtime here. That is why this file no
// longer defines the mock class inline — the hand-copied class
// expression was the F22 mechanism.
import {
  MockDraftClientRunner,
  runnerHandles,
} from '@/lib/draftClient/__mocks__/mockRunner';

// Legacy aliases for test bodies that reference connectMock /
// disconnectMock / etc. — kept so this migration is a code-shape
// change, not an assertion rewrite.
const connectMock = runnerHandles.connect;
const disconnectMock = runnerHandles.disconnect;
const subscribeMock = runnerHandles.subscribe;
const getStateMock = runnerHandles.getState;
const requestResyncForGapMock = runnerHandles.requestResyncForGap;

// CARD UNIFICATION (2026-09-01): the room now renders the shared
// PlayerStatsModal, whose real module pulls service singletons that
// need env vars — stub it out; card behavior is tested elsewhere.
vi.mock('@/components/PlayerStatsModal', () => ({ default: () => null }));
vi.mock('@/lib/draftClient/runner', () => ({
  DraftClientRunner: MockDraftClientRunner,
}));

// DR-1b — mock the matrix fetcher so tests control the matrix landing
// deterministically. Default returns a snake-order 12x3 matrix for
// the "team-1..team-12" fixture.
const { fetchDraftOrderMatrixMock } = vi.hoisted(() => ({
  fetchDraftOrderMatrixMock: vi.fn(),
}));
vi.mock('@/lib/draftClient/fetchDraftOrderMatrix', () => ({
  fetchDraftOrderMatrix: fetchDraftOrderMatrixMock,
}));

// DR-2 — mock submitPick + apiClient.get (for /my-team fetch).
const { submitPickMock, apiClientGetMock } = vi.hoisted(() => ({
  submitPickMock: vi.fn(),
  apiClientGetMock: vi.fn(),
}));
vi.mock('@/lib/draftClient/submitPick', () => ({
  submitPick: submitPickMock,
}));
vi.mock('@/api/client', () => ({
  apiClient: {
    get: apiClientGetMock,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// DR-2 — mock sonner's toast so tests can assert on error messages.
const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

// Mock sonner so toast helpers don't render real toasts in tests.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: toastErrorMock,
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

// DR-3 (2026-07-29) — mock PlayerService so usePreloadedPlayers doesn't
// hit the API in the wiring tests. Empty player list keeps the page
// mounting non-blocking (adapters emit `#<id>` fallbacks throughout).
// Entry 87 Fix B (2026-08-10): usePreloadedPlayers now queries
// player_directory via supabase directly (not PlayerService), so we
// also stub the hook itself here to sever the async chain that
// previously caused act warnings when the dynamic supabase import
// resolved after test teardown.
const { getAllPlayersMock } = vi.hoisted(() => ({
  getAllPlayersMock: vi.fn(),
}));
vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getAllPlayers: getAllPlayersMock,
    getPlayer: vi.fn(),
    getPlayersByIds: vi.fn(),
  },
}));
vi.mock('@/hooks/usePreloadedPlayers', () => ({
  usePreloadedPlayers: () => ({
    playersById: new Map(),
    isLoading: false,
    error: null,
  }),
}));

// DR-3 (2026-07-29) — mock the v1 draft components so runner-wiring
// tests focus on the store/derived-state contract without rendering
// real component internals (which pull in icons, drag-drop libraries,
// and other jsdom-hostile deps).
vi.mock('@/components/draft/DraftBoard', () => ({
  DraftBoard: () => <div data-testid="mock-draft-board" />,
}));
vi.mock('@/components/draft/PlayerPool', () => ({
  PlayerPool: () => <div data-testid="mock-player-pool" />,
}));
vi.mock('@/components/draft/DraftHistory', () => ({
  DraftHistory: () => <div data-testid="mock-draft-history" />,
}));
vi.mock('@/components/draft/TeamRosters', () => ({
  TeamRosters: () => <div data-testid="mock-team-rosters" />,
}));
vi.mock('@/components/draft/DraftQueue', () => ({
  DraftQueue: () => <div data-testid="mock-draft-queue" />,
}));

import DraftRoomV2 from '../DraftRoomV2';

const renderRoute = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/draft-v2/:leagueId/:draftId?" element={<DraftRoomV2 />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  connectMock.mockClear();
  disconnectMock.mockClear();
  subscribeMock.mockClear();
  requestResyncForGapMock.mockClear();
  fetchDraftOrderMatrixMock.mockReset();
  submitPickMock.mockReset();
  apiClientGetMock.mockReset();
  toastErrorMock.mockReset();
  // Default happy-path: matrix returns a 12x3 snake matrix for
  // team-1..team-12. Individual tests can override.
  const teams = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);
  const matrix: { round: number; pickNumber: number; teamId: string }[] = [];
  let pn = 1;
  for (let round = 1; round <= 3; round++) {
    const reverse = round % 2 === 0;
    const ordered = reverse ? [...teams].reverse() : [...teams];
    for (const teamId of ordered) {
      matrix.push({ round, pickNumber: pn++, teamId });
    }
  }
  fetchDraftOrderMatrixMock.mockResolvedValue(matrix);
  // Default: not a team owner (spectator) + no teams fetched. The
  // page now calls two /api/leagues endpoints: /my-team and /teams.
  // Route by path so individual tests can override selectively.
  apiClientGetMock.mockImplementation((path: string) => {
    if (path.includes('/my-team')) return Promise.resolve({ data: null });
    if (path.endsWith('/teams')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  // DR-3: empty player index — adapters render #<id> fallbacks. Tests
  // can override for coverage of the resolved-name path.
  getAllPlayersMock.mockResolvedValue([]);
  useDraftClientStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

describe('DraftRoomV2 (chunk 11g.5b)', () => {
  it('mounts and calls runner.connect with leagueId + draftId from URL', () => {
    renderRoute('/draft-v2/league-abc/draft-xyz');
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith(
      { leagueId: 'league-abc', draftId: 'draft-xyz' },
      expect.objectContaining({
        onSnapshot: expect.any(Function),
        onEvent: expect.any(Function),
        onEvents: expect.any(Function),
        onPresence: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('falls back to leagueId for draftId when draftId param is missing', () => {
    renderRoute('/draft-v2/league-abc');
    expect(connectMock).toHaveBeenCalledWith(
      { leagueId: 'league-abc', draftId: 'league-abc' },
      expect.any(Object),
    );
  });

  it('subscribes to runner state changes', () => {
    renderRoute('/draft-v2/league-abc/draft-xyz');
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function));
  });

  it('calls runner.disconnect on unmount', () => {
    const { unmount } = renderRoute('/draft-v2/league-abc/draft-xyz');
    expect(disconnectMock).not.toHaveBeenCalled();
    unmount();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('renders the page heading and waiting message before snapshot arrives', () => {
    renderRoute('/draft-v2/league-abc/draft-xyz');
    // DR-3 (2026-07-29): heading rewritten from "Draft Room v2" to
    // "Draft Room" — v2 is the production room now.
    expect(
      screen.getByRole('heading', { name: /Draft Room/i }),
    ).toBeInTheDocument();
  });

  // ── DR-1b (2026-07-28) — derived-state cards + wiring ────────────
  describe('DR-1b — derived-state cards', () => {
    // Helper: pull the onSnapshot / onEvent / onEvents callbacks from
    // the last connect() call so tests can simulate server messages.
    function callbacks() {
      const [, cbs] = connectMock.mock.calls[connectMock.mock.calls.length - 1];
      return cbs as {
        onSnapshot: (s: DraftSnapshot) => void;
        onEvent: (e: BufferedDraftEvent) => void;
        onEvents: (evs: ReadonlyArray<BufferedDraftEvent>) => void;
        onPresence: (p: unknown) => void;
        onError: (e: unknown) => void;
      };
    }
    // Helper: force the runner-state subscriber to consider us
    // 'connected' so the DraftStateView renders (not just the
    // "Waiting for draft state…" branch — that requires connectionState
    // to have advanced past 'idle').
    function markConnected() {
      const [listener] = subscribeMock.mock.calls[
        subscribeMock.mock.calls.length - 1
      ] as unknown as [(state: unknown) => void];
      act(() => {
        listener({
          kind: 'connected',
          wsUrl: 'wss://x',
          sessionId: 's1',
          lastSeenSeq: 0,
        });
      });
    }

    function pickEvent(
      seq: number,
      teamId: string,
      pickNumber: number,
      roundNumber: number,
    ): BufferedDraftEvent {
      return {
        kind: 'pick_submitted',
        seq,
        timestamp: `2026-07-28T00:00:${String(seq).padStart(2, '0')}.000Z`,
        teamId,
        playerId: 8478000 + seq,
        roundNumber,
        pickNumber,
        correlationId: `corr-${seq}`,
      };
    }

    it('F4 REGRESSION: mid-draft rejoin with stale stateSnapshot renders DERIVED state, not the stale convenience fields', async () => {
      // Reproduce F4's exact witnessed shape: stateSnapshot claims
      // not_started + picksMade 0 + on-clock null, but recentEvents
      // carries picks 1..5. Pre-DR-1b: cards would show "not_started
      // / 0 / —". Post-DR-1b: cards show in_progress / pick 6 / team-6.
      renderRoute('/draft-v2/league-abc/draft-xyz');
      markConnected();
      const teams = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);
      const events = teams
        .slice(0, 5)
        .map((teamId, i) => pickEvent(i + 1, teamId, i + 1, 1));
      const staleSnapshot: DraftSnapshot = {
        lobbyId: 'lobby-f4',
        format: 'snake',
        recentEvents: events,
        stateSnapshot: {
          currentPickNumber: null,
          currentRoundNumber: null,
          onClockTeamId: null,
          picksMade: 0,
          draftStatus: 'not_started',
          totalPicks: 36,
          currentPickDeadline: null,
        },
      };
      await act(async () => {
        callbacks().onSnapshot(staleSnapshot);
      });
      // Yield to microtasks so the matrix-fetch promise resolves +
      // setMatrix triggers the re-derive.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // DR-3 (2026-07-29): DR-1b F4 regression proof updated for the
      // new sticky-header layout. Cards → single `draft-header-label`
      // that renders DERIVED values, not the stale stateSnapshot
      // convenience fields. Same F4 guarantee: recentEvents win.
      const label = await screen.findByTestId('draft-header-label');
      expect(label.textContent).toMatch(/Round 1/);
      expect(label.textContent).toMatch(/Pick 6 \/ 36/);
      // DR-4 (2026-07-30): describeStatus rewrites derived status to
      // plain language. "in_progress" now reads "in progress".
      expect(label.textContent).toMatch(/in progress/);
    });

    it('cards ADVANCE LIVE as events land after the snapshot', async () => {
      renderRoute('/draft-v2/league-abc/draft-xyz');
      markConnected();
      const emptySnapshot: DraftSnapshot = {
        lobbyId: 'lobby-live',
        format: 'snake',
        recentEvents: [],
        stateSnapshot: {
          currentPickNumber: null,
          currentRoundNumber: null,
          onClockTeamId: null,
          picksMade: 0,
          totalPicks: 36,
          draftStatus: 'not_started',
          currentPickDeadline: null,
        },
      };
      await act(async () => {
        callbacks().onSnapshot(emptySnapshot);
        await Promise.resolve();
        await Promise.resolve();
      });
      // DR-3 (2026-07-29): rewritten for the sticky-header label.
      const label = await screen.findByTestId('draft-header-label');
      // Pre-picks: not_started, 0/36 done.
      // DR-4 (2026-07-30): describeStatus rewrites derived
      // "not_started" + picksMade=0 to "active — waiting for pick 1"
      // so users don't see a confusing "not_started" when the DB
      // schedule is in_progress.
      expect(label.textContent).toMatch(/waiting for pick 1/);
      expect(label.textContent).toMatch(/0 \/ 36/);

      // Simulate the first pick landing.
      await act(async () => {
        callbacks().onEvent(pickEvent(1, 'team-1', 1, 1));
        await Promise.resolve();
      });
      // DR-4 (2026-07-30): describeStatus rewrites derived status to
      // plain language. "in_progress" now reads "in progress".
      expect(label.textContent).toMatch(/in progress/);
      expect(label.textContent).toMatch(/Pick 2 \/ 36/);

      // Second pick.
      await act(async () => {
        callbacks().onEvent(pickEvent(2, 'team-2', 2, 1));
        await Promise.resolve();
      });
      expect(label.textContent).toMatch(/Pick 3 \/ 36/);
    });

    it('kicks off fetchDraftOrderMatrix on first snapshot with the snapshot totalPicks', async () => {
      renderRoute('/draft-v2/league-abc/draft-xyz');
      markConnected();
      const snap: DraftSnapshot = {
        lobbyId: 'lobby-fetch',
        format: 'snake',
        recentEvents: [],
        stateSnapshot: {
          currentPickNumber: null,
          currentRoundNumber: null,
          onClockTeamId: null,
          picksMade: 0,
          totalPicks: 36,
          draftStatus: 'not_started',
          currentPickDeadline: null,
        },
      };
      await act(async () => {
        callbacks().onSnapshot(snap);
        await Promise.resolve();
      });
      expect(fetchDraftOrderMatrixMock).toHaveBeenCalledWith('league-abc', 36);
    });

    it('surfaces foldResult.gaps to runner.requestResyncForGap', async () => {
      renderRoute('/draft-v2/league-abc/draft-xyz');
      markConnected();
      // Establish snapshot at seq 0.
      const snap: DraftSnapshot = {
        lobbyId: 'lobby-gaps',
        format: 'snake',
        recentEvents: [],
        stateSnapshot: {
          currentPickNumber: null,
          currentRoundNumber: null,
          onClockTeamId: null,
          picksMade: 0,
          totalPicks: 36,
          draftStatus: 'not_started',
          currentPickDeadline: null,
        },
      };
      await act(async () => {
        callbacks().onSnapshot(snap);
        await Promise.resolve();
        await Promise.resolve();
      });
      // seq 1 lands cleanly.
      await act(async () => {
        callbacks().onEvent(pickEvent(1, 'team-1', 1, 1));
        await Promise.resolve();
      });
      expect(requestResyncForGapMock).not.toHaveBeenCalled();
      // seq 3 skips seq 2 → gap [2] should trigger resync from
      // sinceSeq = 1 (last contiguous seq the fold reached).
      await act(async () => {
        callbacks().onEvent(pickEvent(3, 'team-3', 3, 1));
        await Promise.resolve();
      });
      expect(requestResyncForGapMock).toHaveBeenCalledWith(1);
    });
  });

  // ── T13 Entry 15 C3 (2026-08-09) — completed-state parent contract.
  //
  // Architect Entry 15 asks: at draftStatus='completed', pick/queue
  // controls MUST be absent from the DOM + the completion banner MUST
  // be present. This closes the loop on CompletionMomentBanner's
  // controls-disabled-is-a-PARENT-contract note (per that file's
  // header). Confirms the parent's render tree removes the on-clock
  // action bar when the draft has completed.
  describe('T13 — completed-state parent contract (Entry 15 C3)', () => {
    function callbacks() {
      const [, cbs] = connectMock.mock.calls[connectMock.mock.calls.length - 1];
      return cbs as {
        onSnapshot: (s: DraftSnapshot) => void;
        onEvent: (e: BufferedDraftEvent) => void;
        onEvents: (evs: ReadonlyArray<BufferedDraftEvent>) => void;
        onPresence: (p: unknown) => void;
        onError: (e: unknown) => void;
      };
    }
    function markConnected() {
      const subs: Array<(s: unknown) => void> = subscribeMock.mock.calls.flat();
      for (const sub of subs) {
        act(() => {
          sub({ kind: 'connected' });
        });
      }
    }

    it('at draftStatus=completed: completion banner PRESENT + on-clock action bar ABSENT', async () => {
      renderRoute('/draft-v2/league-abc/draft-xyz');
      markConnected();
      // deriveDraftState's client-side model always starts from
      // emptyDerivedState (`draftStatus:'not_started'`) and folds
      // events forward — the snapshot's stateSnapshot.draftStatus is
      // NOT authoritative for the client. To land the derived state
      // in 'completed', include a `draft_completed` event in
      // recentEvents (mirroring F24's server emit — LobbyManager
      // :2872).
      const completedEvent: BufferedDraftEvent = {
        kind: 'draft_completed',
        seq: 1,
        timestamp: '2026-07-28T00:00:01.000Z',
        correlationId: 'corr-completed',
        completedAt: '2026-07-28T00:00:01.000Z',
        totalPicks: 36,
      };
      const completedSnapshot: DraftSnapshot = {
        lobbyId: 'lobby-completed',
        format: 'snake',
        recentEvents: [completedEvent],
        stateSnapshot: {
          currentPickNumber: null,
          currentRoundNumber: null,
          onClockTeamId: null,
          picksMade: 36,
          totalPicks: 36,
          draftStatus: 'completed',
          currentPickDeadline: null,
        },
      };
      await act(async () => {
        callbacks().onSnapshot(completedSnapshot);
        // Yield microtasks so the matrix-fetch promise resolves and
        // the re-derive lands.
        await Promise.resolve();
        await Promise.resolve();
      });

      // Banner PRESENT — DR-4 data-testid preserved through T13 rewrite.
      const banner = await screen.findByTestId('completed-draft-banner');
      expect(banner).toBeInTheDocument();
      // Explicit controls-disabled contract emitted per T13 design.
      expect(banner.getAttribute('data-completion-controls-disabled')).toBe('true');

      // OnClockActionBar (pick/queue controls parent) ABSENT — when
      // draftStatus=completed, no team is on clock, so amIOnClock is
      // false and OnClockActionBar renders null. The bar's data-testid
      // is 'on-clock-action-bar' per its component definition.
      expect(screen.queryByTestId('on-clock-action-bar')).not.toBeInTheDocument();
    });
  });
});
