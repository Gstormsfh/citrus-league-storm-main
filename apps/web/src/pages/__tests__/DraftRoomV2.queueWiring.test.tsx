/**
 * QUEUE-REACH (2026-08-13) — does the v2 room actually hand the queue
 * to the player pool?
 *
 * WHY THIS FILE EXISTS AS A SEPARATE FILE. `DraftRoomV2.test.tsx`
 * already renders the whole room, and it passed for weeks while the
 * queue was unreachable. It passed because its mock is
 *
 *     vi.mock('@/components/draft/PlayerPool', () => ({
 *       PlayerPool: () => <div data-testid="mock-player-pool" />,
 *     }))
 *
 * — a component that throws its props away. Every prop contract
 * between the room and the pool was therefore untestable there by
 * construction, and `onAddToQueue` (optional in PlayerPool, and the
 * gate on the per-row star existing at all) was never passed. The room
 * rendered a queue panel reading "Click the star icon on players to add
 * them to your queue" beside a pool with no stars.
 *
 * The fix is not "add an assertion" — it is "record the props". These
 * mocks capture what they receive so the SEAM between the room and its
 * children is assertable. That seam is where the bug lived, and no
 * amount of testing on either side of it would have found the bug.
 *
 * The stake: `set_draft_queue` + the autopick `queueStrategy` are both
 * driven entirely by this list. An unfillable queue means a manager who
 * misses their clock gets projections-only autopick — the thing the
 * queue exists to prevent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useDraftClientStore } from '@/stores/draftClientStore';

import {
  MockDraftClientRunner,
  runnerHandles,
} from '@/lib/draftClient/__mocks__/mockRunner';

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

const { submitPickMock, apiClientGetMock } = vi.hoisted(() => ({
  submitPickMock: vi.fn(),
  apiClientGetMock: vi.fn(),
}));
vi.mock('@/lib/draftClient/submitPick', () => ({ submitPick: submitPickMock }));
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

vi.mock('@/hooks/usePreloadedPlayers', () => ({
  usePreloadedPlayers: () => ({
    playersById: new Map(),
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
    getPlayer: vi.fn(),
    getPlayersByIds: vi.fn(),
  },
}));

// ── PROP-RECORDING mocks — the whole point of this file ────────────
type AnyProps = Record<string, unknown>;
const { poolProps, queueProps } = vi.hoisted(() => ({
  poolProps: [] as AnyProps[],
  queueProps: [] as AnyProps[],
}));

vi.mock('@/components/draft/PlayerPool', () => ({
  PlayerPool: (props: AnyProps) => {
    poolProps.push(props);
    return <div data-testid="mock-player-pool" />;
  },
}));
vi.mock('@/components/draft/DraftQueue', () => ({
  DraftQueue: (props: AnyProps) => {
    queueProps.push(props);
    return <div data-testid="mock-draft-queue" />;
  },
}));
vi.mock('@/components/draft/DraftBoard', () => ({
  DraftBoard: () => <div data-testid="mock-draft-board" />,
}));
vi.mock('@/components/draft/DraftHistory', () => ({
  DraftHistory: () => <div data-testid="mock-draft-history" />,
}));
vi.mock('@/components/draft/TeamRosters', () => ({
  TeamRosters: () => <div data-testid="mock-team-rosters" />,
}));

import DraftRoomV2 from '../DraftRoomV2';

const LEAGUE = 'league-abc';

const renderRoom = () =>
  render(
    <MemoryRouter initialEntries={[`/draft-v2/${LEAGUE}/draft-xyz`]}>
      <Routes>
        <Route path="/draft-v2/:leagueId/:draftId?" element={<DraftRoomV2 />} />
      </Routes>
    </MemoryRouter>,
  );

/**
 * Leave the loading branch. Two steps, both required: the room renders
 * the body only once the runner state has advanced past 'idle' AND a
 * snapshot has landed. Shapes mirror DraftRoomV2.test.tsx's fixtures.
 */
function openRoom() {
  const [listener] = runnerHandles.subscribe.mock.calls.at(-1) as unknown as [
    (state: unknown) => void,
  ];
  act(() => {
    listener({ kind: 'connected', wsUrl: 'wss://x', sessionId: 's1', lastSeenSeq: 0 });
  });

  const cbs = runnerHandles.connect.mock.calls.at(-1)?.[1] as
    | { onSnapshot: (s: unknown) => void }
    | undefined;
  if (!cbs) throw new Error('runner.connect was never called');
  act(() => {
    cbs.onSnapshot({
      lobbyId: 'lobby-queue',
      format: 'snake',
      recentEvents: [],
      stateSnapshot: {
        currentPickNumber: 1,
        currentRoundNumber: 1,
        onClockTeamId: 'team-1',
        picksMade: 0,
        draftStatus: 'in_progress',
        totalPicks: 36,
        currentPickDeadline: null,
      },
    });
  });
}

beforeEach(() => {
  poolProps.length = 0;
  queueProps.length = 0;
  runnerHandles.connect.mockClear();
  runnerHandles.subscribe.mockClear();
  fetchDraftOrderMatrixMock.mockReset();
  apiClientGetMock.mockReset();

  const teams = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);
  const matrix: { round: number; pickNumber: number; teamId: string }[] = [];
  let pn = 1;
  for (let round = 1; round <= 3; round++) {
    const ordered = round % 2 === 0 ? [...teams].reverse() : [...teams];
    for (const teamId of ordered) matrix.push({ round, pickNumber: pn++, teamId });
  }
  fetchDraftOrderMatrixMock.mockResolvedValue(matrix);
  apiClientGetMock.mockImplementation((path: string) => {
    if (path.includes('/my-team')) return Promise.resolve({ data: null });
    if (path.endsWith('/teams')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  useDraftClientStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

describe('DraftRoomV2 — the queue must be fillable', () => {
  it('hands PlayerPool an onAddToQueue handler (the regression)', () => {
    // THE test. Before the fix this prop was simply absent, and
    // PlayerPool renders its per-row star only `{onAddToQueue && ...}`.
    // Absent prop -> no star -> no way to queue anyone -> the
    // server-side queue and queueStrategy autopick can never be used.
    renderRoom();
    openRoom();

    const last = poolProps.at(-1);
    expect(last, 'PlayerPool never rendered').toBeTruthy();
    expect(typeof last!.onAddToQueue).toBe('function');
  });

  it('hands PlayerPool the queue array so queued rows can show as queued', () => {
    renderRoom();
    openRoom();

    const last = poolProps.at(-1)!;
    expect(Array.isArray(last.queue)).toBe(true);
  });

  it('renders the queue panel at the same time as the pool', () => {
    // Both must be mounted for the star -> queue round trip to exist.
    renderRoom();
    openRoom();

    expect(screen.getByTestId('mock-player-pool')).toBeInTheDocument();
    expect(screen.getByTestId('mock-draft-queue')).toBeInTheDocument();
  });
});

describe('DraftRoomV2 — pool and queue share ONE list', () => {
  it('both children receive the same queue array instance', () => {
    // If these ever diverge (e.g. the state slides back down into
    // SidebarPanel), starring a player in the pool would update a list
    // the queue panel cannot see, and the persisted queue would be
    // whichever copy DraftQueue happens to own.
    renderRoom();
    openRoom();

    expect(poolProps.at(-1)!.queue).toBe(queueProps.at(-1)!.queue);
  });

  it('starring a player in the pool updates the list the queue panel gets', () => {
    renderRoom();
    openRoom();

    const addToQueue = poolProps.at(-1)!.onAddToQueue as (id: string) => void;
    act(() => addToQueue('8478402'));

    expect(queueProps.at(-1)!.queue).toEqual(['8478402']);
    expect(poolProps.at(-1)!.queue).toEqual(['8478402']);
  });

  it('starring an already-queued player removes him (toggle, not duplicate)', () => {
    renderRoom();
    openRoom();

    const add = () => poolProps.at(-1)!.onAddToQueue as (id: string) => void;
    act(() => add()('8478402'));
    act(() => add()('8477934'));
    expect(queueProps.at(-1)!.queue).toEqual(['8478402', '8477934']);

    act(() => add()('8478402'));
    expect(queueProps.at(-1)!.queue).toEqual(['8477934']);
  });

  it('appends to the END, because position IS priority', () => {
    // `queueStrategy` walks the list front-to-back and takes the first
    // still-available player. Inserting anywhere but the end silently
    // reorders the manager's board — and they would only find out when
    // autopick took the wrong man.
    renderRoom();
    openRoom();

    const add = () => poolProps.at(-1)!.onAddToQueue as (id: string) => void;
    act(() => add()('first'));
    act(() => add()('second'));
    act(() => add()('third'));

    expect(queueProps.at(-1)!.queue).toEqual(['first', 'second', 'third']);
  });
});

describe('DraftRoomV2 — exactly one DraftQueue is mounted', () => {
  it('never mounts a second queue instance', () => {
    // DraftQueue owns hydration AND debounced persistence. Two
    // instances would both restore and both save; the one that renders
    // with its initial empty array would write set_draft_queue(team,
    // []) and destroy the queue the other just restored. See the first
    // test in DraftQueue.persistence.test.tsx — that hazard is real and
    // already cost us once.
    renderRoom();
    openRoom();

    expect(screen.getAllByTestId('mock-draft-queue')).toHaveLength(1);
  });
});
