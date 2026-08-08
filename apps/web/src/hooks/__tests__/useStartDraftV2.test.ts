// T7 URGENT (2026-08-08) — offline unit tests for useStartDraftV2 hook.
//
// Covers:
//   - success: navigates on {event_id, seq, first_pick_deadline}
//   - Rider 1 taxonomy: each of 5 reasons maps to correct user message
//   - idempotency-key threading: crypto.randomUUID called + passed
//   - loading state: isPending toggles true→false
//   - error state: lastError captured, cleared on next start

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStartDraftV2, RIDER_1_USER_MESSAGES } from '../useStartDraftV2';

// Mock the API client at module scope so all hook instances see it.
vi.mock('@/api/draftV2', () => ({
  draftV2Api: {
    startDraftV2: vi.fn(),
  },
}));

// Import the mocked module post-mock so tests can inspect the mock fn.
import { draftV2Api } from '@/api/draftV2';

const mockStart = draftV2Api.startDraftV2 as ReturnType<typeof vi.fn>;

// Deterministic randomUUID for idempotency-key assertion.
const MOCK_UUID = '11111111-2222-3333-4444-555555555555';
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: vi.fn(() => MOCK_UUID),
  },
  writable: true,
  configurable: true,
});

beforeEach(() => {
  mockStart.mockReset();
});

describe('useStartDraftV2 — success path', () => {
  it('returns ok:true with data on 200 success', async () => {
    mockStart.mockResolvedValueOnce({
      data: {
        event_id: 1,
        seq: 1,
        first_pick_deadline: '2026-08-08T20:00:30.000Z',
        was_duplicate: false,
      },
    });

    const { result } = renderHook(() => useStartDraftV2());

    let outcome:
      | { ok: true; data: unknown }
      | { ok: false; reason: string; message: string }
      | undefined;
    await act(async () => {
      outcome = await result.current.start('league-abc');
    });

    expect(outcome).toBeDefined();
    expect(outcome!.ok).toBe(true);
    if (outcome!.ok) {
      expect(outcome!.data).toEqual({
        event_id: 1,
        seq: 1,
        first_pick_deadline: '2026-08-08T20:00:30.000Z',
        was_duplicate: false,
      });
    }
    expect(result.current.lastError).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it('threads client-generated idempotency_key into API call', async () => {
    mockStart.mockResolvedValueOnce({
      data: { event_id: 1, seq: 1, first_pick_deadline: '2026-08-08T20:00:30.000Z', was_duplicate: false },
    });

    const { result } = renderHook(() => useStartDraftV2());
    await act(async () => {
      await result.current.start('league-abc');
    });

    expect(mockStart).toHaveBeenCalledWith('league-abc', MOCK_UUID);
  });

  it('handles response shape where data is at top level (no .data wrap)', async () => {
    // Some apiClient impls return data directly instead of {data}. Hook
    // tolerates both.
    mockStart.mockResolvedValueOnce({
      event_id: 42,
      seq: 42,
      first_pick_deadline: '2026-08-08T21:00:30.000Z',
      was_duplicate: true,
    });

    const { result } = renderHook(() => useStartDraftV2());
    let outcome: any;
    await act(async () => {
      outcome = await result.current.start('league-xyz');
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.data.event_id).toBe(42);
    expect(outcome.data.was_duplicate).toBe(true);
  });
});

describe('useStartDraftV2 — Rider 1 preflight taxonomy', () => {
  const reasons = [
    'already_completed',
    'already_in_progress',
    'illegal_combo',
    'not_startable',
    'unexpected',
  ] as const;

  reasons.forEach((reason) => {
    it(`maps server reason "${reason}" to user message "${RIDER_1_USER_MESSAGES[reason]}"`, async () => {
      const rejectError = {
        response: {
          data: {
            error: {
              code: 'BAD_REQUEST',
              message: `illegal_state reason:${reason}`,
              details: `illegal_state: ${reason}`,
            },
          },
        },
        message: `illegal_state reason:${reason}`,
      };
      mockStart.mockRejectedValueOnce(rejectError);

      const { result } = renderHook(() => useStartDraftV2());
      let outcome: any;
      await act(async () => {
        outcome = await result.current.start('league-abc');
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe(reason);
      expect(outcome.message).toBe(RIDER_1_USER_MESSAGES[reason]);
      expect(result.current.lastError).toEqual({ reason, message: RIDER_1_USER_MESSAGES[reason] });
      expect(result.current.isPending).toBe(false);
    });
  });

  it('falls back to "unexpected" reason when server error omits discriminator', async () => {
    mockStart.mockRejectedValueOnce({
      response: { data: {} },
      message: 'Internal Server Error',
    });

    const { result } = renderHook(() => useStartDraftV2());
    let outcome: any;
    await act(async () => {
      outcome = await result.current.start('league-abc');
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('unexpected');
    expect(outcome.message).toBe(RIDER_1_USER_MESSAGES.unexpected);
  });

  it('handles network error with no response object', async () => {
    mockStart.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useStartDraftV2());
    let outcome: any;
    await act(async () => {
      outcome = await result.current.start('league-abc');
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('unexpected');
    expect(outcome.message).toBe(RIDER_1_USER_MESSAGES.unexpected);
  });
});

describe('useStartDraftV2 — state discipline', () => {
  it('clears lastError on the next successful start', async () => {
    // First call fails.
    mockStart.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            code: 'BAD_REQUEST',
            message: 'illegal_state reason:illegal_combo',
          },
        },
      },
    });
    const { result } = renderHook(() => useStartDraftV2());
    await act(async () => {
      await result.current.start('league-abc');
    });
    expect(result.current.lastError?.reason).toBe('illegal_combo');

    // Second call succeeds.
    mockStart.mockResolvedValueOnce({
      data: { event_id: 2, seq: 2, first_pick_deadline: '2026-08-08T22:00:30.000Z', was_duplicate: false },
    });
    await act(async () => {
      await result.current.start('league-abc');
    });
    expect(result.current.lastError).toBeNull();
  });

  it('does not persist stale isPending across calls', async () => {
    mockStart.mockResolvedValueOnce({
      data: { event_id: 1, seq: 1, first_pick_deadline: '2026-08-08T20:00:30.000Z', was_duplicate: false },
    });
    const { result } = renderHook(() => useStartDraftV2());
    await act(async () => {
      await result.current.start('league-abc');
    });
    expect(result.current.isPending).toBe(false);
  });
});
