vi.mock('@/hooks/useLeagueScoringContext', () => ({ useLeagueScoringContext: () => ({ scoring: null, ready: true }) }));
// ACTIVE-LEAGUE CLAIM vs PRACTICE LEAGUES (2026-09-18, prod QA).
//
// The room claims the active league once on entry. A practice league
// (mock draft, the draft canary) must never be claimed: the league list
// hides it by design, so LeagueContext would treat the claim as an
// outsider and bounce the manager into the join flow mid-draft. That is
// exactly what happened on a cold load without ?mock=1: the claim raced
// the league-row fetch that is the only thing saying "practice".
//
// Asserted here:
//   1. Practice league, no ?mock=1: setActiveLeagueId is never called,
//      even once the row has landed.
//   2. Ordinary league: setActiveLeagueId is called exactly once, and
//      only after the row has landed (never before).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useDraftClientStore } from '@/stores/draftClientStore';
import {
  MockDraftClientRunner,
  runnerHandles,
} from '@/lib/draftClient/__mocks__/mockRunner';

const { setActiveLeagueIdMock } = vi.hoisted(() => ({
  setActiveLeagueIdMock: vi.fn(),
}));
vi.mock('@/contexts/LeagueContext', () => ({
  useLeague: () => ({ activeLeagueId: null, setActiveLeagueId: setActiveLeagueIdMock, loading: false }),
}));
vi.mock('@/components/PlayerStatsModal', () => ({ default: () => null }));
// The league-row fetch under test goes through `import('@/api/client')`
// inside the room, which vitest does not route to the apiClient mock below
// (the room's other dynamic imports of it are swallowed the same way in the
// sibling tests). So the row is answered one level down: a session for
// getAuthToken and a fetch stub for the row's path. Everything else the room
// fetches at mount still goes through the mocked apiClient.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'x.eyJleHAiOjQxMDI0NDQ4MDB9.x' } } }) } },
}));
vi.mock('@/lib/draftClient/runner', () => ({
  DraftClientRunner: MockDraftClientRunner,
}));
vi.mock('@/lib/draftClient/fetchDraftOrderMatrix', () => ({
  fetchDraftOrderMatrix: vi.fn().mockResolvedValue([]),
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
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/components/draft/PlayerPool', () => ({ PlayerPool: () => <div /> }));
vi.mock('@/components/draft/DraftBoard', () => ({ DraftBoard: () => <div /> }));
vi.mock('@/components/draft/DraftHistory', () => ({ DraftHistory: () => <div /> }));
vi.mock('@/components/draft/TeamRosters', () => ({ TeamRosters: () => <div /> }));
vi.mock('@/components/draft/DraftQueue', () => ({ DraftQueue: () => <div /> }));
vi.mock('@/hooks/usePreloadedPlayers', () => ({
  usePreloadedPlayers: () => ({ playersById: new Map(), isLoading: false, error: null }),
}));
vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
    getPlayer: vi.fn(),
    getPlayersByIds: vi.fn(),
  },
}));

import DraftRoomV2 from '../DraftRoomV2';

const LEAGUE = 'league-claim-test';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderRoom(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/draft-v2/:leagueId/:draftId?" element={<DraftRoomV2 />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

let leagueRow: Deferred<{ data: unknown }>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  runnerHandles.connect.mockClear();
  runnerHandles.disconnect.mockClear();
  runnerHandles.subscribe.mockClear();
  setActiveLeagueIdMock.mockReset();
  apiClientGetMock.mockReset();
  leagueRow = deferred<{ data: unknown }>();
  apiClientGetMock.mockImplementation((path: string) => {
    if (path.includes('/my-team')) return Promise.resolve({ data: null });
    if (path.endsWith('/teams')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/api/leagues/${LEAGUE}`)) {
      const body = await leagueRow.promise;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: null }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  useDraftClientStore.getState().reset();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe('DraftRoomV2 — claiming the active league', () => {
  it('never claims a practice league, even on a cold load without ?mock=1', async () => {
    renderRoom(`/draft-v2/${LEAGUE}`);
    await flush();
    expect(setActiveLeagueIdMock).not.toHaveBeenCalled();

    await act(async () => {
      leagueRow.resolve({ data: { name: 'Mock Draft', settings: { practice: true, practiceOf: null } } });
      await leagueRow.promise;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(setActiveLeagueIdMock).not.toHaveBeenCalled();
  });

  it('claims an ordinary league exactly once, and only after its row has landed', async () => {
    renderRoom(`/draft-v2/${LEAGUE}`);
    await flush();
    // Row still in flight: no claim yet. This is the race that bounced
    // managers out of practice rooms.
    expect(setActiveLeagueIdMock).not.toHaveBeenCalled();

    await act(async () => {
      leagueRow.resolve({ data: { name: 'Real League', settings: { leagueType: 'fantasy' } } });
      await leagueRow.promise;
    });
    await waitFor(() => expect(setActiveLeagueIdMock).toHaveBeenCalledTimes(1));
    expect(setActiveLeagueIdMock).toHaveBeenCalledWith(LEAGUE);
  });
});
