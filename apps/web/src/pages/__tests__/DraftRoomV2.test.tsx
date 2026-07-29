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
// vi.hoisted hoists mock-state init above imports so the vi.mock
// factory body can reference these names safely.

const {
  connectMock,
  disconnectMock,
  subscribeMock,
  getStateMock,
  requestResyncForGapMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  subscribeMock: vi.fn(() => () => {}),
  getStateMock: vi.fn(() => ({ kind: 'idle' as const })),
  requestResyncForGapMock: vi.fn(),
}));

vi.mock('@/lib/draftClient/runner', () => ({
  // Constructor must be a real `class` (or `function` with prototype)
  // for `new DraftClientRunner()` to work — `vi.fn().mockImplementation`
  // returns an arrow function which can't be `new`'d.
  DraftClientRunner: class {
    connect = connectMock;
    disconnect = disconnectMock;
    subscribe = subscribeMock;
    getState = getStateMock;
    requestResyncForGap = requestResyncForGapMock;
  },
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
      ] as [(state: unknown) => void];
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
      expect(label.textContent).toMatch(/in_progress/);
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
      expect(label.textContent).toMatch(/not_started/);
      expect(label.textContent).toMatch(/0 \/ 36/);

      // Simulate the first pick landing.
      await act(async () => {
        callbacks().onEvent(pickEvent(1, 'team-1', 1, 1));
        await Promise.resolve();
      });
      expect(label.textContent).toMatch(/in_progress/);
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
});
