/**
 * Draft Engine v2 — DraftServiceV2 unit tests.
 *
 * Chunk 9a coverage:
 *   submitPick:
 *     - Success: returns RPC result {event_id, seq, pick_deadline, was_duplicate}.
 *     - Idempotent replay (was_duplicate=true) returned to caller as-is.
 *     - Each spec §11.1 RPC error prefix maps to the correct AppError
 *       (status + code).
 *     - Unknown RPC error message → 500 INTERNAL_ERROR.
 *     - payload_hash sent to the RPC matches strict spec §7.3 4-field
 *       canonicalization (order-independent input → same hash).
 *     - p_correlation_id passed through; null when not supplied.
 *
 *   broadcastEvent:
 *     - was_duplicate=true → no fetch, no broadcast (early return).
 *     - was_duplicate=false → fetches the event row and broadcasts
 *       full row on draft_events_v2:${leagueId}.
 *     - Fetch error → swallowed, no broadcast attempted.
 *
 *   Note on broadcast timing: KI-001 (channel-never-SUBSCRIBED hang)
 *   tests will land in chunk 9c when the Promise.race fix ships.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computePickPayloadHash } from '@citrus/shared';
import { DraftServiceV2, type SubmitPickParams } from '../services/DraftServiceV2';
import { AppError } from '../lib/errors';

// ── Test fixtures ────────────────────────────────────────────────────

const validParams: SubmitPickParams = {
  leagueId:       '11111111-1111-1111-1111-111111111111',
  teamId:         '33333333-3333-3333-3333-000000000001',
  playerId:       8478402,
  round:          1,
  pickNumber:     1,
  sessionId:      '22222222-2222-2222-2222-222222222222',
  idempotencyKey: '44444444-4444-4444-4444-444444444444',
  actor:          { kind: 'user', id: 'user-1', session_id: 's-1' },
  correlationId:  null,
};

function makeMockSupabase(rpcResult: { data?: unknown; error?: { message?: string; code?: string } }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return {
    rpc,
    from: vi.fn(),
  } as any;
}

// ── submitPick ───────────────────────────────────────────────────────

describe('DraftServiceV2.submitPick', () => {
  let service: DraftServiceV2;
  let supabase: any;

  it('returns RPC result on success', async () => {
    const rpcReturn = {
      event_id:      4711,
      seq:           1,
      pick_deadline: '2026-04-25T20:00:30Z',
      was_duplicate: false,
    };
    supabase = makeMockSupabase({ data: rpcReturn, error: null });
    service  = new DraftServiceV2(supabase);

    const result = await service.submitPick(validParams);

    expect(result).toEqual(rpcReturn);
    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith('submit_pick_v2', expect.objectContaining({
      p_league_id:       validParams.leagueId,
      p_team_id:         validParams.teamId,
      p_player_id:       validParams.playerId,
      p_round:           validParams.round,
      p_pick_number:     validParams.pickNumber,
      p_session_id:      validParams.sessionId,
      p_idempotency_key: validParams.idempotencyKey,
      p_actor:           validParams.actor,
      p_correlation_id:  null,
    }));
  });

  it('returns idempotent replay as-is (was_duplicate=true)', async () => {
    const replay = {
      event_id:      4711,
      seq:           1,
      pick_deadline: '2026-04-25T20:00:30Z',
      was_duplicate: true,
    };
    supabase = makeMockSupabase({ data: replay, error: null });
    service  = new DraftServiceV2(supabase);

    const result = await service.submitPick(validParams);
    expect(result.was_duplicate).toBe(true);
    expect(result).toEqual(replay);
  });

  it('passes through caller-supplied correlationId', async () => {
    supabase = makeMockSupabase({
      data: { event_id: 1, seq: 1, pick_deadline: null, was_duplicate: false },
      error: null,
    });
    service = new DraftServiceV2(supabase);

    await service.submitPick({
      ...validParams,
      correlationId: '55555555-5555-5555-5555-555555555555',
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'submit_pick_v2',
      expect.objectContaining({
        p_correlation_id: '55555555-5555-5555-5555-555555555555',
      }),
    );
  });

  it('computes payload_hash strictly per spec §7.3 (4 fields, order-independent)', async () => {
    supabase = makeMockSupabase({
      data: { event_id: 1, seq: 1, pick_deadline: null, was_duplicate: false },
      error: null,
    });
    service = new DraftServiceV2(supabase);
    await service.submitPick(validParams);

    // Independently compute the expected hash from the 4 spec fields only.
    const expectedHash = await computePickPayloadHash({
      pick_number: validParams.pickNumber,
      round:       validParams.round,
      team_id:     validParams.teamId,
      player_id:   validParams.playerId,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'submit_pick_v2',
      expect.objectContaining({ p_payload_hash: expectedHash }),
    );

    // And: hash format is `sha256:<hex>` per the shared util contract.
    const callArgs = supabase.rpc.mock.calls[0][1];
    expect(callArgs.p_payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // Spec §11.1 error mapping coverage — one case per documented prefix.
  const errorCases: Array<{ prefix: string; expectedStatus: number; expectedCode: string }> = [
    { prefix: 'idempotency_conflict',     expectedStatus: 409, expectedCode: 'CONFLICT' },
    { prefix: 'pick_out_of_order',        expectedStatus: 409, expectedCode: 'CONFLICT' },
    { prefix: 'not_on_clock',             expectedStatus: 409, expectedCode: 'CONFLICT' },
    { prefix: 'player_taken',             expectedStatus: 409, expectedCode: 'CONFLICT' },
    { prefix: 'unauthorized',             expectedStatus: 403, expectedCode: 'FORBIDDEN' },
    { prefix: 'shadow_guard_violated',    expectedStatus: 500, expectedCode: 'INTERNAL_ERROR' },
    { prefix: 'illegal_state_transition', expectedStatus: 500, expectedCode: 'INTERNAL_ERROR' },
    { prefix: 'illegal_state',            expectedStatus: 422, expectedCode: 'VALIDATION_ERROR' },
    { prefix: 'invalid_event_payload',    expectedStatus: 400, expectedCode: 'VALIDATION_ERROR' },
  ];

  for (const { prefix, expectedStatus, expectedCode } of errorCases) {
    it(`maps RPC error "${prefix}: ..." → ${expectedStatus} ${expectedCode}`, async () => {
      supabase = makeMockSupabase({
        data: null,
        error: { message: `${prefix}: synthetic test detail`, code: '23505' },
      });
      service = new DraftServiceV2(supabase);

      let thrown: AppError | null = null;
      try {
        await service.submitPick(validParams);
      } catch (e) {
        thrown = e as AppError;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown!.status).toBe(expectedStatus);
      expect(thrown!.code).toBe(expectedCode);
      // Original prefix preserved in message so the client can parse the
      // exact spec §11.1 code if desired.
      expect(thrown!.message).toContain(prefix);
    });
  }

  it('falls through to 500 INTERNAL_ERROR for unknown RPC error prefix', async () => {
    supabase = makeMockSupabase({
      data: null,
      error: { message: 'totally_unrecognized: oops', code: 'XX000' },
    });
    service = new DraftServiceV2(supabase);

    let thrown: AppError | null = null;
    try {
      await service.submitPick(validParams);
    } catch (e) {
      thrown = e as AppError;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown!.status).toBe(500);
    expect(thrown!.code).toBe('INTERNAL_ERROR');
  });

  // Ordering check: 'illegal_state_transition' MUST match before
  // 'illegal_state' (longer prefix first), or we'd lose the 500-vs-422
  // distinction. Verified by the dedicated case above (which raises
  // with 'illegal_state_transition: ...' and asserts 500), but called
  // out here so a future reordering of mapRpcError doesn't break it
  // silently.
  it('illegal_state_transition resolves to 500, NOT 422 (ordering check)', async () => {
    supabase = makeMockSupabase({
      data: null,
      error: { message: 'illegal_state_transition: not paused', code: '23514' },
    });
    service = new DraftServiceV2(supabase);
    await expect(service.submitPick(validParams)).rejects.toThrowError(
      expect.objectContaining({ status: 500 }),
    );
  });
});

// ── broadcastEvent ───────────────────────────────────────────────────

describe('DraftServiceV2.broadcastEvent', () => {
  it('skips fetch + broadcast entirely when wasDuplicate=true', async () => {
    const admin = { from: vi.fn(), channel: vi.fn() } as any;
    const service = new DraftServiceV2({} as any);

    await service.broadcastEvent({
      admin,
      leagueId: validParams.leagueId,
      eventId: 4711,
      wasDuplicate: true,
    });

    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.channel).not.toHaveBeenCalled();
  });

  it('swallows fetch error without throwing', async () => {
    const fromChain = {
      select:  vi.fn().mockReturnThis(),
      eq:      vi.fn().mockReturnThis(),
      single:  vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'fetch failed' },
      }),
    };
    const admin = {
      from: vi.fn(() => fromChain),
      channel: vi.fn(),
    } as any;
    const service = new DraftServiceV2({} as any);

    await expect(
      service.broadcastEvent({
        admin,
        leagueId: validParams.leagueId,
        eventId: 4711,
        wasDuplicate: false,
      }),
    ).resolves.toBeUndefined();

    // Fetch was attempted; broadcast was NOT (failed gracefully).
    expect(admin.from).toHaveBeenCalledWith('draft_events');
    expect(admin.channel).not.toHaveBeenCalled();
  });

  it('subscribes + sends on the spec §6.14 channel name when fetch succeeds', async () => {
    const eventRow = {
      id: 4711,
      league_id: validParams.leagueId,
      seq: 1,
      event_type: 'pick',
      payload: { pick_number: 1 },
      payload_hash: 'sha256:abc',
      idempotency_key: validParams.idempotencyKey,
      actor: validParams.actor,
      correlation_id: validParams.correlationId ?? '00000000-0000-0000-0000-000000000000',
      created_at: '2026-04-25T20:00:00Z',
    };
    const fromChain = {
      select:  vi.fn().mockReturnThis(),
      eq:      vi.fn().mockReturnThis(),
      single:  vi.fn().mockResolvedValue({ data: eventRow, error: null }),
    };
    const send = vi.fn().mockResolvedValue(undefined);
    const subscribe = vi.fn((cb: (status: string) => void) => {
      // Synchronously fire SUBSCRIBED so the inner Promise resolves.
      // Use queueMicrotask to keep the await/resolve sequencing realistic.
      queueMicrotask(() => cb('SUBSCRIBED'));
      return { unsubscribe: vi.fn() };
    });
    const channel = { subscribe, send };
    const removeChannel = vi.fn().mockResolvedValue(undefined);
    const admin = {
      from:          vi.fn(() => fromChain),
      channel:       vi.fn(() => channel),
      removeChannel,
    } as any;
    const service = new DraftServiceV2({} as any);

    await service.broadcastEvent({
      admin,
      leagueId: validParams.leagueId,
      eventId: 4711,
      wasDuplicate: false,
    });

    expect(admin.channel).toHaveBeenCalledWith(
      `draft_events_v2:${validParams.leagueId}`,
      expect.objectContaining({ config: expect.any(Object) }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'event',
        payload: eventRow,
      }),
    );
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
