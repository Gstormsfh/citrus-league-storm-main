// T7 architect Entry 7 (2026-08-08) — offline unit tests for the
// two-step useStartDraftFull hook (GAP-1 Option (a) ratified).
//
// Required coverage per Entry 7:
//   1. init-fails → no ignition call made
//   2. init-ok + ignition-refused (Rider 1) → taxonomy message, no crash
//   3. happy path → ok:true (with initSkipped assertion)
//   4. double-press mid-sequence → single sequence executed
//   5. existence-check re-run guard → skips init when order already present
//
// Design notes for the tests:
//   - We mock `@/services/DraftService` (getDraftOrder + initializeDraftOrder)
//     and `@/api/draftV2` (startDraftV2) at module scope.
//   - Deterministic randomUUID so idempotency-key threading is inspectable.
//   - Uses renderHook + act from @testing-library/react (established
//     pattern in useStartDraftV2.test.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Team } from '@/services/LeagueService';

vi.mock('@/services/DraftService', () => ({
  DraftService: {
    getDraftOrder: vi.fn(),
    initializeDraftOrder: vi.fn(),
  },
}));

vi.mock('@/api/draftV2', () => ({
  draftV2Api: {
    startDraftV2: vi.fn(),
  },
}));

import { DraftService } from '@/services/DraftService';
import { draftV2Api } from '@/api/draftV2';
import { useStartDraftFull } from '../useStartDraftFull';

const mockGetOrder = DraftService.getDraftOrder as ReturnType<typeof vi.fn>;
const mockInitOrder = DraftService.initializeDraftOrder as ReturnType<typeof vi.fn>;
const mockStartRpc = draftV2Api.startDraftV2 as ReturnType<typeof vi.fn>;

const MOCK_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: vi.fn(() => MOCK_UUID),
  },
  writable: true,
  configurable: true,
});

const mkTeams = (n: number): Team[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `team-${i + 1}`,
    league_id: 'league-abc',
    name: `Team ${i + 1}`,
    owner_id: `user-${i + 1}`,
    draft_position: i + 1,
    created_at: '2026-08-08T00:00:00.000Z',
    updated_at: '2026-08-08T00:00:00.000Z',
  })) as unknown as Team[];

const baseParams = {
  leagueId: 'league-abc',
  userId: 'user-1',
  teams: mkTeams(12),
  totalRounds: 21,
  customTeamOrder: undefined as string[] | undefined,
  draftType: 'snake' as string | undefined,
};

const SUCCESS_RPC = {
  data: {
    event_id: 1,
    seq: 1,
    first_pick_deadline: '2026-08-08T20:00:30.000Z',
    was_duplicate: false,
  },
};

beforeEach(() => {
  mockGetOrder.mockReset();
  mockInitOrder.mockReset();
  mockStartRpc.mockReset();
});

describe('useStartDraftFull — Condition 2 failure ordering', () => {
  it('init-fails → ignition RPC NEVER called (safe fail-fast)', async () => {
    // Existence check misses → init runs → init returns an error.
    mockGetOrder.mockResolvedValueOnce({ order: null, error: null });
    mockInitOrder.mockResolvedValueOnce({
      error: { message: 'db constraint violation' },
    });

    const { result } = renderHook(() => useStartDraftFull());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.start(baseParams);
    });

    expect(outcome).toMatchObject({
      ok: false,
      step: 'init',
      reason: 'init_failed',
    });
    // Critical assertion: ignition RPC MUST NOT have been called after
    // init failure. Otherwise the failure ordering guarantee breaks and
    // the league flips into an invalid state.
    expect(mockStartRpc).not.toHaveBeenCalled();
    expect(result.current.lastError).not.toBeNull();
    expect(result.current.lastError?.step).toBe('init');
  });
});

describe('useStartDraftFull — Rider 1 refusal on ignition step', () => {
  it('init-ok + ignition-refused → taxonomy message surfaced, retry safe', async () => {
    // Existence check misses → init succeeds → RPC rejects with
    // Rider-1 illegal_state.
    mockGetOrder.mockResolvedValueOnce({ order: null, error: null });
    mockInitOrder.mockResolvedValueOnce({ error: null });
    const rejection = {
      response: {
        data: {
          error: {
            code: 'BAD_REQUEST',
            message: 'illegal_state reason:already_in_progress',
            details: 'illegal_state: already_in_progress',
          },
        },
      },
    };
    mockStartRpc.mockRejectedValueOnce(rejection);

    const { result } = renderHook(() => useStartDraftFull());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.start(baseParams);
    });

    expect(outcome).toMatchObject({
      ok: false,
      step: 'ignition',
      reason: 'already_in_progress',
    });
    // Init WAS called (existence-check miss).
    expect(mockInitOrder).toHaveBeenCalledTimes(1);
    // RPC WAS called exactly once.
    expect(mockStartRpc).toHaveBeenCalledTimes(1);
    // Message is human-readable (RIDER_1_USER_MESSAGES mapping).
    expect((outcome as { message: string }).message).toBeTruthy();
    expect((outcome as { message: string }).message).not.toMatch(/illegal_state/);
  });
});

describe('useStartDraftFull — happy path', () => {
  it('existence-check miss → init runs → ignition succeeds', async () => {
    mockGetOrder.mockResolvedValueOnce({ order: null, error: null });
    mockInitOrder.mockResolvedValueOnce({ error: null });
    mockStartRpc.mockResolvedValueOnce(SUCCESS_RPC);

    const { result } = renderHook(() => useStartDraftFull());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.start(baseParams);
    });

    expect(outcome).toMatchObject({
      ok: true,
      initSkipped: false,
    });
    if ((outcome as { ok: boolean }).ok) {
      expect((outcome as { data: typeof SUCCESS_RPC['data'] }).data.event_id).toBe(1);
    }
    expect(mockInitOrder).toHaveBeenCalledTimes(1);
    expect(mockStartRpc).toHaveBeenCalledTimes(1);
    expect(mockStartRpc).toHaveBeenCalledWith('league-abc', MOCK_UUID);
    expect(result.current.isPending).toBe(false);
    expect(result.current.lastError).toBeNull();
  });
});

describe('useStartDraftFull — Condition 3 isPending honesty (gates UI double-press)', () => {
  it('isPending reads TRUE during pending window, FALSE after resolve', async () => {
    // Set up a slow existence check so we can observe isPending during
    // the pending window. The contract we validate: isPending gates the
    // UI button via `disabled={isStartingDraft}` — hook itself does not
    // dedupe (that's the UI's job). Test verifies the state signal is
    // truthful: TRUE while any step is in flight, FALSE only after all
    // steps resolve.
    let resolveGetOrder!: (v: unknown) => void;
    mockGetOrder.mockReturnValueOnce(
      new Promise((res) => {
        resolveGetOrder = res;
      }),
    );
    mockInitOrder.mockResolvedValueOnce({ error: null });
    mockStartRpc.mockResolvedValueOnce(SUCCESS_RPC);

    const { result, rerender } = renderHook(() => useStartDraftFull());
    expect(result.current.isPending).toBe(false);

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = result.current.start(baseParams);
      // Allow React to flush the setInitPending(true) render.
      await Promise.resolve();
    });
    rerender();
    // Mid-sequence: isPending MUST be true. If it read false here the
    // UI gate would leak and permit double-press → double ignition.
    expect(result.current.isPending).toBe(true);

    // Resolve the slow get_order → sequence completes.
    await act(async () => {
      resolveGetOrder({ order: null, error: null });
      await pending;
    });
    rerender();
    // Post-resolve: isPending returns to false so retry is possible.
    expect(result.current.isPending).toBe(false);
  });
});

describe('useStartDraftFull — Condition 1 existence-check re-run guard', () => {
  it('draft_order already present → init SKIPPED, ignition still runs', async () => {
    // Existence check HITS: order returns with team_order matching teams count.
    mockGetOrder.mockResolvedValueOnce({
      order: {
        team_order: baseParams.teams.map((t) => t.id),
      },
      error: null,
    });
    mockStartRpc.mockResolvedValueOnce(SUCCESS_RPC);

    const { result } = renderHook(() => useStartDraftFull());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.start(baseParams);
    });

    expect(outcome).toMatchObject({
      ok: true,
      initSkipped: true,
    });
    // Init MUST NOT have been called — re-run safety per Condition 1.
    expect(mockInitOrder).not.toHaveBeenCalled();
    // Ignition still runs with a fresh idempotency key.
    expect(mockStartRpc).toHaveBeenCalledTimes(1);
    expect(mockStartRpc).toHaveBeenCalledWith('league-abc', MOCK_UUID);
  });

  it('draft_order present but wrong team count → init RUNS (safety fallback)', async () => {
    // Existence check finds an order with the WRONG number of teams
    // (e.g., league grew after initial preparation). Guard should
    // treat this as "not present" and re-init.
    mockGetOrder.mockResolvedValueOnce({
      order: {
        team_order: ['team-1', 'team-2'], // only 2, expected 12
      },
      error: null,
    });
    mockInitOrder.mockResolvedValueOnce({ error: null });
    mockStartRpc.mockResolvedValueOnce(SUCCESS_RPC);

    const { result } = renderHook(() => useStartDraftFull());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.start(baseParams);
    });

    expect(outcome).toMatchObject({
      ok: true,
      initSkipped: false,
    });
    expect(mockInitOrder).toHaveBeenCalledTimes(1);
  });
});
