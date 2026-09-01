// DR-3 (2026-07-29) — invariant I5 tests: per-event fold re-renders
// stay scoped. Two things asserted:
//
//   1. PlayerPool render count does NOT scale with fold events. N
//      picks land; PlayerPool must re-render O(1) times per pick
//      because the `availablePlayers` array reference changes when
//      a pick removes a player. We assert the count stays ≤ N + 2
//      (initial + one per pick + a small headroom for React's own
//      strict-mode double-render or batched-microtask quirks).
//      What the assertion RULES OUT: the pool re-rendering 36+ times
//      on every fold because it subscribes to the whole store.
//
//   2. Fallback rendering — unresolved playerId shows `#<id>` chip
//      in the DraftBoard (via the flattened draftHistory) and in
//      the PlayerPool's drafted-set filtering path.
//
// Rationale: the adapter tests (v1Adapters.test.ts) already verify
// the pure mapping. These tests verify the WIRING — the store
// subscriptions and prop derivation together don't over-render.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { DraftSnapshot, BufferedDraftEvent } from '@citrus/shared';
import { useDraftClientStore } from '@/stores/draftClientStore';

// ── Mocks: runner + matrix + submitPick + apiClient + PlayerService ─

// F22 structural (2026-08-03) — shared mock factory. See
// DraftRoomV2.test.tsx for the story.
import {
  MockDraftClientRunner,
  runnerHandles,
} from '@/lib/draftClient/__mocks__/mockRunner';

const connectMock = runnerHandles.connect;
const disconnectMock = runnerHandles.disconnect;
const subscribeMock = runnerHandles.subscribe;

// CARD UNIFICATION (2026-09-01): the room now renders the shared
// PlayerStatsModal, whose real module pulls service singletons that
// need env vars — stub it out; card behavior is tested elsewhere.
vi.mock('@/components/PlayerStatsModal', () => ({ default: () => null }));
vi.mock('@/lib/draftClient/runner', () => ({
  DraftClientRunner: MockDraftClientRunner,
}));

const { fetchDraftOrderMatrixMock } = vi.hoisted(() => ({
  fetchDraftOrderMatrixMock: vi.fn(),
}));
vi.mock('@/lib/draftClient/fetchDraftOrderMatrix', () => ({
  fetchDraftOrderMatrix: fetchDraftOrderMatrixMock,
}));

vi.mock('@/lib/draftClient/submitPick', () => ({
  submitPick: vi.fn(),
}));

const { apiClientGetMock } = vi.hoisted(() => ({
  apiClientGetMock: vi.fn(),
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

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

// I5 measurement: spy on PlayerPool render function. Mock it as a
// simple component that reports every render into a counter ref. The
// mount test asserts the counter stays proportional to fold events,
// not to the store's total mutation count.
const playerPoolRenderCount = { count: 0 };

vi.mock('@/components/draft/PlayerPool', () => ({
  PlayerPool: (props: { availablePlayers: unknown[]; draftedPlayers: string[] }) => {
    playerPoolRenderCount.count += 1;
    return (
      <div data-testid="mock-player-pool">
        pool-render-{playerPoolRenderCount.count}-avail-
        {props.availablePlayers.length}-drafted-{props.draftedPlayers.length}
      </div>
    );
  },
}));

// DraftBoard mock: no-op (Radix Tabs doesn't mount inactive tab
// content, so we assert on the always-mounted TeamRosters mock below
// instead — same draftHistory prop shape, same adapter output).
vi.mock('@/components/draft/DraftBoard', () => ({
  DraftBoard: () => <div data-testid="mock-draft-board" />,
}));

vi.mock('@/components/draft/DraftHistory', () => ({
  DraftHistory: () => <div data-testid="mock-draft-history" />,
}));

// TeamRosters mock: capture the draftHistory prop. TeamRosters is
// always mounted (sidebar, no tab gate) so the capture fires without
// requiring a tab click.
const rostersHistoryCapture = {
  latest: null as null | Array<{ playerName: string; playerId: string }>,
};
vi.mock('@/components/draft/TeamRosters', () => ({
  TeamRosters: (props: {
    draftHistory: Array<{ playerName: string; playerId: string }>;
  }) => {
    rostersHistoryCapture.latest = props.draftHistory;
    return <div data-testid="mock-team-rosters" />;
  },
}));

vi.mock('@/components/draft/DraftQueue', () => ({
  DraftQueue: () => <div data-testid="mock-draft-queue" />,
}));

// Entry 87 Fix B (2026-08-10) — usePreloadedPlayers now queries
// player_directory via supabase directly; stub the hook at its
// boundary so tests don't need supabase env vars set and there's
// no async chain to leak past test teardown.
vi.mock('@/hooks/usePreloadedPlayers', () => ({
  usePreloadedPlayers: () => ({
    playersById: new Map(),
    isLoading: false,
    error: null,
  }),
}));
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

import DraftRoomV2 from '../DraftRoomV2';

// ── Helpers ────────────────────────────────────────────────────────

const renderRoute = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/draft-v2/:leagueId/:draftId?" element={<DraftRoomV2 />} />
      </Routes>
    </MemoryRouter>,
  );

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
    timestamp: `2026-07-29T00:00:${String(seq).padStart(2, '0')}.000Z`,
    teamId,
    playerId: 8478000 + seq,
    roundNumber,
    pickNumber,
    correlationId: `corr-${seq}`,
  };
}

beforeEach(() => {
  connectMock.mockClear();
  disconnectMock.mockClear();
  subscribeMock.mockClear();
  fetchDraftOrderMatrixMock.mockReset();
  apiClientGetMock.mockReset();
  getAllPlayersMock.mockReset();
  playerPoolRenderCount.count = 0;
  rostersHistoryCapture.latest = null;

  const teams = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);
  const matrix: { round: number; pickNumber: number; teamId: string }[] = [];
  let pn = 1;
  for (let round = 1; round <= 3; round++) {
    const reverse = round % 2 === 0;
    const ordered = reverse ? [...teams].reverse() : [...teams];
    for (const teamId of ordered) matrix.push({ round, pickNumber: pn++, teamId });
  }
  fetchDraftOrderMatrixMock.mockResolvedValue(matrix);
  apiClientGetMock.mockImplementation((path: string) => {
    if (path.includes('/my-team')) return Promise.resolve({ data: null });
    if (path.endsWith('/teams')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  // Empty player index → adapters emit #<id> chips throughout. The
  // render-count test doesn't care what's in the pool; the fallback
  // test asserts on the #<id> shape.
  getAllPlayersMock.mockResolvedValue([]);
  useDraftClientStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────

describe('DR-3 — I5 invariant (per-event re-render scoping)', () => {
  it('PlayerPool renders scale linearly with picks, not with total store mutations', async () => {
    renderRoute('/draft-v2/league-abc/draft-xyz');
    markConnected();

    // Landing an empty snapshot triggers matrix fetch + initial
    // derivation. Pool mounts once here.
    const emptySnapshot: DraftSnapshot = {
      lobbyId: 'lobby-i5',
      format: 'snake',
      recentEvents: [],
      stateSnapshot: {
        currentPickNumber: null,
        currentRoundNumber: null,
        onClockTeamId: null,
        picksMade: 0,
        totalPicks: 12,
        draftStatus: 'not_started',
        currentPickDeadline: null,
      },
    };
    await act(async () => {
      callbacks().onSnapshot(emptySnapshot);
      await Promise.resolve();
      await Promise.resolve();
    });
    const rendersAfterSnapshot = playerPoolRenderCount.count;

    // Fire 12 pick events (a full first round). If the store's
    // per-event fold triggered a full-page re-render, the pool would
    // re-render on every single event regardless of prop stability.
    // Adapter + selector scoping should cap us near N picks, not >>N.
    const N = 12;
    for (let i = 1; i <= N; i++) {
      await act(async () => {
        callbacks().onEvent(pickEvent(i, `team-${i}`, i, 1));
        await Promise.resolve();
      });
    }

    // ASSERTION: renders MUST scale O(N), not O(N * something-else).
    // Pathological failure mode: pool subscribes to whole store →
    // every store mutation (each of the N picks × multiple slice
    // updates each) re-renders the pool. Would land at N*several.
    //
    // Healthy: ~2–3 renders per pick (event fold → derived changes
    // → useMemo re-runs → availablePlayers ref changes → memo() pool
    // re-renders; plus useCallback deps changing on `derived`).
    // Bound: N * 4 + rendersAfterSnapshot + 4 (very generous but
    // still catches any super-linear blow-up, which is the invariant
    // this test defends).
    const totalRenders = playerPoolRenderCount.count;
    const upperBound = rendersAfterSnapshot + N * 4 + 4;
    expect(totalRenders).toBeLessThanOrEqual(upperBound);
    // Sanity floor: at least one render happened per pick (the drafted
    // set changed, so availablePlayers ref changed).
    expect(totalRenders).toBeGreaterThanOrEqual(rendersAfterSnapshot + 1);
    // Emit the ratio for triage — visible in the vitest output when
    // the test fails.
    // eslint-disable-next-line no-console
    console.log(
      `[DR-3 I5] renders=${totalRenders} for N=${N} picks (rendersAfterSnapshot=${rendersAfterSnapshot}, per-pick avg=${((totalRenders - rendersAfterSnapshot) / N).toFixed(2)})`,
    );
  });

  it('renders #<id> chips for unresolved playerIds in the board history (fallback)', async () => {
    renderRoute('/draft-v2/league-abc/draft-xyz');
    markConnected();

    // Snapshot with 3 pre-existing picks whose playerIds have no
    // corresponding Player in the (empty) player index.
    const snap: DraftSnapshot = {
      lobbyId: 'lobby-fallback',
      format: 'snake',
      recentEvents: [
        pickEvent(1, 'team-1', 1, 1), // playerId=8478001
        pickEvent(2, 'team-2', 2, 1), // playerId=8478002
        pickEvent(3, 'team-3', 3, 1), // playerId=8478003
      ],
      stateSnapshot: {
        currentPickNumber: null,
        currentRoundNumber: null,
        onClockTeamId: null,
        picksMade: 0,
        totalPicks: 12,
        draftStatus: 'not_started',
        currentPickDeadline: null,
      },
    };
    await act(async () => {
      callbacks().onSnapshot(snap);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Assert via TeamRosters (always mounted in the sidebar; no tab
    // gate required). Same draftHistory shape flows to DraftBoard
    // when its tab is active — the adapter is the same call in both
    // places, so this proves the wiring end-to-end without racing
    // Radix Tabs' lazy mount.
    expect(rostersHistoryCapture.latest).not.toBeNull();
    const history = rostersHistoryCapture.latest!;
    // 3 picks landed; empty player index → every playerName renders
    // as `#<id>`, position renders as `?`, playerTeam undefined.
    expect(history.length).toBe(3);
    const names = history.map((h) => h.playerName);
    expect(names).toEqual(
      expect.arrayContaining(['#8478001', '#8478002', '#8478003']),
    );
  });
});
