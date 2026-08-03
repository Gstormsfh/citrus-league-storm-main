// DR-4 (2026-07-30) — F11 fix (layer 2 DISAMBIGUATE) integration test.
//
// The submitPick.ts error taxonomy translates the server's
// pick_out_of_order code to reason='clock_expired' (see
// submitPick.ts:129-133) — architect DR-2 mapping. That translation
// is CORRECT for a real clock-expiry race (autopick took the slot
// mid-submit). But it is WRONG for a DOUBLE-SUBMIT: the user clicked
// Draft twice, the first submit landed, the second submit hit the
// server AFTER the pick_number had advanced, server returned
// pick_out_of_order, and the client toasted "your clock ran out —
// autopick made your choice" which is a lie (invariant I2 violation).
//
// F11 layer 2 (DraftRoomV2.tsx:handleDraftFromPool) disambiguates:
// when clock_expired arrives AND our own team's roster already has
// an entry for the pickNumber we just submitted for → it was a
// double-submit; silent (console.debug); no toast. When it arrives
// AND our roster does NOT have that pick → real expiry; toast fires.
//
// This test mounts a shim reproducing the branch and asserts both
// arms behave correctly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  act,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { DraftSnapshot, BufferedDraftEvent } from '@citrus/shared';
import { useDraftClientStore } from '@/stores/draftClientStore';

// F22 structural (2026-08-03) — shared mock factory. See
// DraftRoomV2.test.tsx for the story.
import {
  MockDraftClientRunner,
  runnerHandles,
} from '@/lib/draftClient/__mocks__/mockRunner';

const connectMock = runnerHandles.connect;
const disconnectMock = runnerHandles.disconnect;
const subscribeMock = runnerHandles.subscribe;

vi.mock('@/lib/draftClient/runner', () => ({
  DraftClientRunner: MockDraftClientRunner,
}));

const { fetchDraftOrderMatrixMock } = vi.hoisted(() => ({
  fetchDraftOrderMatrixMock: vi.fn(),
}));
vi.mock('@/lib/draftClient/fetchDraftOrderMatrix', () => ({
  fetchDraftOrderMatrix: fetchDraftOrderMatrixMock,
}));

// This is the critical mock: submitPick returns whatever we tell it.
const { submitPickMock } = vi.hoisted(() => ({
  submitPickMock: vi.fn(),
}));
vi.mock('@/lib/draftClient/submitPick', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draftClient/submitPick')>(
    '@/lib/draftClient/submitPick',
  );
  return {
    ...actual,
    submitPick: submitPickMock,
  };
});

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

const { toastErrorMock, toastInfoMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: toastErrorMock,
    success: vi.fn(),
    info: toastInfoMock,
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

// Mock v1 components to isolate the submit-branch test surface.
vi.mock('@/components/draft/DraftBoard', () => ({
  DraftBoard: () => <div data-testid="mock-draft-board" />,
}));
vi.mock('@/components/draft/PlayerPool', () => ({
  PlayerPool: (props: {
    onPlayerDraft: (p: { id: string; full_name: string }) => void;
  }) => (
    <div data-testid="mock-player-pool">
      <button
        data-testid="mock-pool-draft-click"
        onClick={() =>
          props.onPlayerDraft({ id: '8478050', full_name: 'Test Player' } as never)
        }
      >
        Draft
      </button>
    </div>
  ),
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

const MY_TEAM_ID = '77777777-7777-7777-7777-000000000003';
const MY_USER_ID = 'c4489220-de65-44c5-8236-677916f6d09c';

beforeEach(() => {
  connectMock.mockClear();
  subscribeMock.mockClear();
  submitPickMock.mockReset();
  apiClientGetMock.mockReset();
  getAllPlayersMock.mockReset();
  toastErrorMock.mockReset();
  toastInfoMock.mockReset();
  fetchDraftOrderMatrixMock.mockReset();

  const teams = Array.from({ length: 12 }, (_, i) =>
    `77777777-7777-7777-7777-${String(i + 1).padStart(12, '0')}`,
  );
  const matrix: { round: number; pickNumber: number; teamId: string }[] = [];
  let pn = 1;
  for (let round = 1; round <= 3; round++) {
    const ordered = round % 2 === 0 ? [...teams].reverse() : [...teams];
    for (const teamId of ordered) matrix.push({ round, pickNumber: pn++, teamId });
  }
  fetchDraftOrderMatrixMock.mockResolvedValue(matrix);
  apiClientGetMock.mockImplementation((path: string) => {
    if (path.includes('/my-team')) return Promise.resolve({ data: { id: MY_TEAM_ID } });
    if (path.endsWith('/teams'))
      return Promise.resolve({
        data: teams.map((id, i) => ({
          id,
          team_name: `Team ${i + 1}`,
          owner_id: i === 2 ? MY_USER_ID : null,
        })),
      });
    return Promise.resolve({ data: null });
  });
  getAllPlayersMock.mockResolvedValue([]);
  useDraftClientStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

describe('F11 layer 2 — pick_out_of_order disambiguate', () => {
  async function setupOnClock() {
    renderRoute('/draft-v2/league-abc');
    markConnected();

    // Snapshot with picks 1 and 2 already made (pick 3 = slot 3 = mine).
    const snap: DraftSnapshot = {
      lobbyId: 'lobby-f11',
      format: 'snake',
      recentEvents: [
        {
          kind: 'pick_submitted',
          seq: 1,
          timestamp: '2026-07-30T00:00:01.000Z',
          teamId: '77777777-7777-7777-7777-000000000001',
          playerId: 1001,
          roundNumber: 1,
          pickNumber: 1,
          correlationId: 'c1',
        },
        {
          kind: 'pick_submitted',
          seq: 2,
          timestamp: '2026-07-30T00:00:02.000Z',
          teamId: '77777777-7777-7777-7777-000000000002',
          playerId: 1002,
          roundNumber: 1,
          pickNumber: 2,
          correlationId: 'c2',
        },
      ],
      stateSnapshot: {
        currentPickNumber: null,
        currentRoundNumber: null,
        onClockTeamId: null,
        picksMade: 0,
        totalPicks: 36,
        draftStatus: 'not_started',
        currentPickDeadline: '2026-07-30T00:05:00.000Z',
      },
      presentUserIds: [MY_USER_ID],
    };
    await act(async () => {
      callbacks().onSnapshot(snap);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Wait for /my-team fetch to resolve + setMyTeamId to flush.
    await waitFor(() => {
      expect(useDraftClientStore.getState().myTeamId).toBe(MY_TEAM_ID);
    });
    // Wait for the derived state to reflect amIOnClock=true (matrix
    // fetch + snapshot fold need to settle).
    await waitFor(() => {
      const d = useDraftClientStore.getState().derivedState;
      expect(d?.onClockTeamId).toBe(MY_TEAM_ID);
    });
  }

  it('shows real clock-expiry toast when the pick was NOT made by us', async () => {
    await setupOnClock();

    // submitPick returns clock_expired; we have NO roster entry for
    // pick 3 (autopick took it, not us). Expect the clock-expiry toast.
    submitPickMock.mockResolvedValueOnce({
      ok: false,
      reason: 'clock_expired',
      message: 'Your clock ran out — autopick made your choice',
      statusCode: 409,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pool-draft-click'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Real clock expiry → error toast fires with the DR-2 copy.
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Your clock ran out — autopick made your choice',
    );
  });

  it('SUPPRESSES the false clock-expiry toast on a double-submit (our roster already has the pick)', async () => {
    await setupOnClock();

    // Simulate the first submit's broadcast having already landed —
    // we now have a roster entry for pick 3.
    await act(async () => {
      callbacks().onEvent({
        kind: 'pick_submitted',
        seq: 3,
        timestamp: '2026-07-30T00:00:03.000Z',
        teamId: MY_TEAM_ID,
        playerId: 8478050,
        roundNumber: 1,
        pickNumber: 3,
        correlationId: 'first-submit',
      });
      await Promise.resolve();
    });

    // Second submit (double-click) — server sees stale pick_number,
    // returns pick_out_of_order → submitPick maps to clock_expired.
    // BUT our roster already has pick 3, so F11 layer 2 catches it
    // and suppresses the false toast.
    submitPickMock.mockResolvedValueOnce({
      ok: false,
      reason: 'clock_expired',
      message: 'Your clock ran out — autopick made your choice',
      statusCode: 409,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pool-draft-click'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The false clock-expiry toast MUST NOT fire.
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      'Your clock ran out — autopick made your choice',
    );
  });
});
