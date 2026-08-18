// DR-2 chunk (2026-07-29) — submitPick contract tests.
//
// Covers the architect's Phase 1 ratifications:
//   - Header pass-through verified (X-Idempotency-Key + X-Correlation-Id
//     BOTH the same UUID per attempt).
//   - Success path returns the normalized {eventId, seq, pickDeadline,
//     wasDuplicate} shape.
//   - Full error taxonomy → correct SubmitPickFailureReason + human copy:
//       * not_on_clock       (409)
//       * player_taken       (409)
//       * pick_out_of_order  (409) → clock_expired (translation per (a))
//       * idempotency_conflict (409)
//       * unauthorized       (403)
//       * illegal_state      (422)
//       * invalid_event_payload (400)
//       * generic server_error fallback
//   - Timeout / network failure → network_or_timeout with the
//     "check the board" copy.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiClientPostMock = vi.fn();
vi.mock('@/api/client', () => ({
  apiClient: {
    post: apiClientPostMock,
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { submitPick, isSubmitPickFailure } from '../submitPick';

const BASE = {
  leagueId: 'league-abc',
  teamId: '77777777-7777-7777-7777-000000000003',
  playerId: 8478000,
  roundNumber: 1,
  pickNumber: 3,
  attemptId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
};

beforeEach(() => {
  apiClientPostMock.mockReset();
});

describe('submitPick — happy path', () => {
  it('returns ok=true with normalized fields on 200', async () => {
    apiClientPostMock.mockResolvedValueOnce({
      data: {
        event_id: '42',
        seq: 17,
        pick_deadline: '2026-07-29T04:20:00.000Z',
        was_duplicate: false,
      },
    });
    const r = await submitPick(BASE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.eventId).toBe('42');
      expect(r.seq).toBe(17);
      expect(r.pickDeadline).toBe('2026-07-29T04:20:00.000Z');
      expect(r.wasDuplicate).toBe(false);
    }
  });

  it('surfaces was_duplicate=true when the server replays via idempotency', async () => {
    apiClientPostMock.mockResolvedValueOnce({
      data: {
        event_id: '42',
        seq: 17,
        pick_deadline: null,
        was_duplicate: true,
      },
    });
    const r = await submitPick(BASE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.wasDuplicate).toBe(true);
      expect(r.pickDeadline).toBeNull();
    }
  });

  it('accepts server response with numeric event_id (coerces to string)', async () => {
    apiClientPostMock.mockResolvedValueOnce({
      data: { event_id: 42, seq: 17, pick_deadline: null, was_duplicate: false },
    });
    const r = await submitPick(BASE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.eventId).toBe('42');
  });
});

describe('submitPick — header pass-through (Q1 architect verification)', () => {
  // ⚠️ DO NOT "FIX" THIS BY GENERATING TWO SEPARATE UUIDs.
  //
  // Sending one id as both headers looks redundant. It is load-bearing, and
  // this is the only place the coupling is enforced (PICK-LATENCY, 2026-08-12):
  //
  //   1. The client records a pending action keyed by `attemptId` and, as of
  //      the optimistic-render change, DRAWS THE PICK IMMEDIATELY under that
  //      key (see lib/draftClient/overlayPending.ts).
  //   2. The API forwards the headers to submit_pick_v2, which stores them in
  //      draft_events.idempotency_key and draft_events.correlation_id.
  //   3. The engine broadcasts the confirmation with
  //      `correlationId: event.idempotency_key ?? ''`
  //      — note: the IDEMPOTENCY KEY, not the correlation_id column
  //      (server/src/draft/LobbyManager.ts).
  //   4. The store clears the optimistic entry via
  //      reconcileOnBroadcast(pendingActions, event.correlationId), which is a
  //      plain Map key lookup.
  //
  // So the drawn pick is only ever cleared because step 1's key and step 3's
  // broadcast are THE SAME UUID. Give them separate ids and nothing errors:
  // the pick commits, the board updates from the fold — and the optimistic
  // entry never matches, hangs for the full 8s dangle timer, then rolls back
  // with "We couldn't confirm your pick" on a pick that actually succeeded.
  // Silent, and worst on the busiest turn of the night.
  //
  // Verified on staging 2026-08-12: 5 of 5 real human picks have
  // idempotency_key = correlation_id.
  it('sends both X-Idempotency-Key AND X-Correlation-Id set to attemptId', async () => {
    apiClientPostMock.mockResolvedValueOnce({
      data: { event_id: '1', seq: 1, pick_deadline: null, was_duplicate: false },
    });
    await submitPick(BASE);
    const [path, body, options] = apiClientPostMock.mock.calls[0];
    expect(path).toBe('/api/draft/v2/league/league-abc/pick');
    expect(body).toEqual({
      team_id: BASE.teamId,
      player_id: BASE.playerId,
      round: BASE.roundNumber,
      pick_number: BASE.pickNumber,
    });
    expect(options.headers).toEqual({
      'X-Idempotency-Key': BASE.attemptId,
      'X-Correlation-Id': BASE.attemptId,
    });
    // 8s timeout per architect ratification.
    expect(options.timeoutMs).toBe(8000);
  });

  it('URL-encodes leagueId', async () => {
    apiClientPostMock.mockResolvedValueOnce({
      data: { event_id: '1', seq: 1, pick_deadline: null, was_duplicate: false },
    });
    await submitPick({ ...BASE, leagueId: 'league with spaces' });
    const [path] = apiClientPostMock.mock.calls[0];
    expect(path).toBe('/api/draft/v2/league/league%20with%20spaces/pick');
  });
});

// Simulate an ApiError as thrown by apiClient. Mirrors the real
// ApiError class from api/client.ts:224 (status + message + data).
class MockApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

describe('submitPick — error taxonomy → reason + human copy', () => {
  const cases: Array<{
    label: string;
    thrown: Error;
    reason: string;
    messageContains: string;
    statusCode?: number;
  }> = [
    {
      label: 'not_on_clock (409)',
      thrown: new MockApiError('not_on_clock: team not currently on the clock', 409),
      reason: 'not_on_clock',
      messageContains: "not your turn",
      statusCode: 409,
    },
    {
      label: 'player_taken (409)',
      thrown: new MockApiError('player_taken: player 8478000 already drafted', 409),
      reason: 'player_taken',
      messageContains: 'already took that player',
      statusCode: 409,
    },
    {
      label: 'pick_out_of_order (409) → clock_expired translation',
      thrown: new MockApiError('pick_out_of_order: pick_number=3 stale, current=4', 409),
      reason: 'clock_expired',
      messageContains: 'autopick made your choice',
      statusCode: 409,
    },
    {
      label: 'idempotency_conflict (409)',
      thrown: new MockApiError('idempotency_conflict: key reused with different intent', 409),
      reason: 'idempotency_conflict',
      messageContains: 'Duplicate submit',
      statusCode: 409,
    },
    {
      label: 'unauthorized (403)',
      thrown: new MockApiError('unauthorized: user not on team', 403),
      reason: 'unauthorized',
      messageContains: "don't own this team",
      statusCode: 403,
    },
    {
      label: 'illegal_state (422)',
      thrown: new MockApiError('illegal_state: draft not active', 422),
      reason: 'illegal_state',
      messageContains: "Draft isn't open",
      statusCode: 422,
    },
    {
      label: 'invalid_event_payload (400)',
      thrown: new MockApiError('invalid_event_payload: body validation failed', 400),
      reason: 'invalid_payload',
      messageContains: 'Invalid pick',
      statusCode: 400,
    },
    {
      label: 'novel server error (500) → generic server_error fallback',
      thrown: new MockApiError('something_new_we_did_not_anticipate', 500),
      reason: 'server_error',
      messageContains: 'Server error',
      statusCode: 500,
    },
  ];

  for (const c of cases) {
    it(`${c.label} → reason=${c.reason}`, async () => {
      apiClientPostMock.mockRejectedValueOnce(c.thrown);
      const r = await submitPick(BASE);
      expect(r.ok).toBe(false);
      if (isSubmitPickFailure(r)) {
        expect(r.reason).toBe(c.reason);
        expect(r.message).toContain(c.messageContains);
        expect(r.statusCode).toBe(c.statusCode);
      }
    });
  }
});

describe('submitPick — network / timeout', () => {
  it('classifies apiClient timeout retries-exhausted (status=0 "Request timed out") as network_or_timeout', async () => {
    // Matches api/client.ts:212 — apiClient throws ApiError with
    // status=0 after retries are exhausted for timeout/network paths.
    apiClientPostMock.mockRejectedValueOnce(
      new MockApiError('Request timed out — retrying', 0),
    );
    const r = await submitPick(BASE);
    expect(r.ok).toBe(false);
    if (isSubmitPickFailure(r)) {
      expect(r.reason).toBe('network_or_timeout');
      expect(r.message).toContain('check the board');
    }
  });

  it('classifies "Network error" (status=0) as network_or_timeout', async () => {
    apiClientPostMock.mockRejectedValueOnce(
      new MockApiError('Network error occurred', 0),
    );
    const r = await submitPick(BASE);
    expect(r.ok).toBe(false);
    if (isSubmitPickFailure(r)) expect(r.reason).toBe('network_or_timeout');
  });

  it('classifies raw AbortError (name-based) as network_or_timeout', async () => {
    const abort = new Error('operation was aborted');
    abort.name = 'AbortError';
    apiClientPostMock.mockRejectedValueOnce(abort);
    const r = await submitPick(BASE);
    expect(r.ok).toBe(false);
    if (isSubmitPickFailure(r)) expect(r.reason).toBe('network_or_timeout');
  });

  it('classifies raw TimeoutError (name-based) as network_or_timeout', async () => {
    const to = new Error('timeout');
    to.name = 'TimeoutError';
    apiClientPostMock.mockRejectedValueOnce(to);
    const r = await submitPick(BASE);
    expect(r.ok).toBe(false);
    if (isSubmitPickFailure(r)) expect(r.reason).toBe('network_or_timeout');
  });

  it('classifies a bare Error with no status as network_or_timeout (safe default)', async () => {
    apiClientPostMock.mockRejectedValueOnce(new Error('unknown transport failure'));
    const r = await submitPick(BASE);
    expect(r.ok).toBe(false);
    if (isSubmitPickFailure(r)) expect(r.reason).toBe('network_or_timeout');
  });
});

describe('submitPick — unexpected shapes', () => {
  it('2xx with missing event_id → falls to server_error (safe fallback)', async () => {
    apiClientPostMock.mockResolvedValueOnce({ data: { seq: 1 } });
    const r = await submitPick(BASE);
    expect(r.ok).toBe(false);
    if (isSubmitPickFailure(r)) expect(r.reason).toBe('server_error');
  });
});
