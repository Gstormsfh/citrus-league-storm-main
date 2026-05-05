// Phase 4.5 chunk 11g.4 step 2 — LobbyManager queue + submit_pick tests.
//
// 12 tests total: 5 retained from step 1 (instantiate × 3, getSnapshot,
// addConnection/removeConnection no-ops), 7 new (queue serialization,
// idempotency, error swallowing, snake/linear submit_pick dispatch,
// auction-format wrong-format-for-action rejection, place_bid + nominate
// chunk-11g.6 stubs).
//
// `makeLobby` factory at top eliminates constructor boilerplate per test.

import { describe, it, expect, vi } from 'vitest';
import { LobbyManager, type LobbyManagerOptions } from '../LobbyManager';
import { AppError } from '../../lib/errors';
import type { DraftServiceV2, SubmitPickResult } from '../../services/DraftServiceV2';
import type { DraftAction, DraftSocketUserData } from '../types';

// ── Test helpers ─────────────────────────────────────────────────────

interface MakeLobbyOpts extends Partial<Omit<LobbyManagerOptions, 'draftService'>> {
  submitPick?: (params: unknown) => Promise<SubmitPickResult>;
}

function makeLobby(opts: MakeLobbyOpts = {}): LobbyManager {
  const submitPick = opts.submitPick ?? vi.fn().mockResolvedValue({
    event_id: 1,
    seq: 1,
    pick_deadline: null,
    was_duplicate: false,
  } satisfies SubmitPickResult);

  const draftService = { submitPick } as unknown as DraftServiceV2;
  return new LobbyManager({
    lobbyId: opts.lobbyId ?? 'lobby-1',
    format: opts.format ?? 'snake',
    leagueId: opts.leagueId ?? 'league-1',
    draftService,
  });
}

function makeSubmitPick(
  overrides: Partial<Extract<DraftAction, { kind: 'submit_pick' }>> = {},
): DraftAction {
  return {
    kind: 'submit_pick',
    teamId: 'team-1',
    playerId: '8478402', // McDavid, NHL player id format (string at the wire)
    userId: 'user-1',
    sessionId: 'session-1',
    idempotencyKey: '00000000-0000-0000-0000-000000000001',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('LobbyManager (chunk 11g.4 step 2)', () => {
  // ── Step-1 retained tests ────────────────────────────────────────

  it('instantiates with snake format', () => {
    const lobby = makeLobby({ lobbyId: 'lobby-snake-1', format: 'snake', leagueId: 'league-1' });
    expect(lobby.lobbyId).toBe('lobby-snake-1');
    expect(lobby.format).toBe('snake');
    expect(lobby.leagueId).toBe('league-1');
  });

  it('instantiates with linear format', () => {
    const lobby = makeLobby({ format: 'linear' });
    expect(lobby.format).toBe('linear');
  });

  it('instantiates with auction format', () => {
    const lobby = makeLobby({ format: 'auction' });
    expect(lobby.format).toBe('auction');
  });

  it('getSnapshot returns identity-matching snapshot', () => {
    const lobby = makeLobby({ lobbyId: 'lobby-snap-1', format: 'auction', leagueId: 'league-2' });
    const snap = lobby.getSnapshot();
    expect(snap.lobbyId).toBe('lobby-snap-1');
    expect(snap.format).toBe('auction');
    expect(Array.isArray(snap.recentEvents)).toBe(true);
    expect(snap.recentEvents).toHaveLength(0);
  });

  it('addConnection and removeConnection are callable as no-ops', () => {
    const lobby = makeLobby();
    const fakeWs = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-1',
      userId: 'u-1',
      leagueId: 'league-1',
      draftId: 'lobby-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
    expect(() => lobby.addConnection(fakeWs, userData)).not.toThrow();
    expect(() => lobby.removeConnection(fakeWs)).not.toThrow();
  });

  // ── Step-2 new tests ─────────────────────────────────────────────

  it('serializes concurrent submit_pick actions through the single-writer queue', async () => {
    let inFlight = 0;
    const callOrder: string[] = [];
    const submitPick = vi.fn(async (params: { idempotencyKey: string }) => {
      inFlight++;
      // If two are in-flight at once, the queue is broken.
      expect(inFlight).toBe(1);
      callOrder.push(params.idempotencyKey);
      // Small delay to expose any race condition.
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return {
        event_id: callOrder.length,
        seq: callOrder.length,
        pick_deadline: null,
        was_duplicate: false,
      } satisfies SubmitPickResult;
    });

    const lobby = makeLobby({ submitPick });

    // Fire 5 concurrently — all should complete in submission order.
    const actions = Array.from({ length: 5 }, (_, i) =>
      makeSubmitPick({
        idempotencyKey: `idem-serial-${i}`,
        teamId: `team-${i}`,
      }),
    );
    const results = await Promise.all(actions.map((a) => lobby.enqueueAction(a)));

    expect(callOrder).toEqual([
      'idem-serial-0',
      'idem-serial-1',
      'idem-serial-2',
      'idem-serial-3',
      'idem-serial-4',
    ]);
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
    expect(submitPick).toHaveBeenCalledTimes(5);
  });

  it('caches idempotent action results — concurrent same-key calls run processAction once', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 42,
      seq: 42,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);

    const lobby = makeLobby({ submitPick });
    const action = makeSubmitPick({ idempotencyKey: 'idem-dedupe-1' });

    const [r1, r2, r3] = await Promise.all([
      lobby.enqueueAction(action),
      lobby.enqueueAction(action),
      lobby.enqueueAction(action),
    ]);

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    expect(r1).toEqual({ ok: true, eventSeq: 42 });
    expect(submitPick).toHaveBeenCalledTimes(1);
  });

  it('does not poison the queue on internal error — subsequent actions still run', async () => {
    let callCount = 0;
    const submitPick = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // Throw a non-AppError so it falls through to handleQueueError
        // (the catch in enqueueAction).
        throw new Error('synthetic boom');
      }
      return {
        event_id: callCount,
        seq: callCount,
        pick_deadline: null,
        was_duplicate: false,
      } satisfies SubmitPickResult;
    });

    const lobby = makeLobby({ submitPick });

    const r1 = await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-poison-1' }),
    );
    expect(r1).toEqual({ ok: false, reason: 'internal_error' });

    const r2 = await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-poison-2' }),
    );
    expect(r2).toEqual({ ok: true, eventSeq: 2 });
  });

  it('snake submit_pick dispatches to DraftServiceV2.submitPick', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 7,
      seq: 7,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);

    const lobby = makeLobby({ format: 'snake', submitPick });
    const action = makeSubmitPick({
      teamId: 'team-A',
      playerId: '8478402',
      userId: 'user-A',
      sessionId: 'sess-A',
      idempotencyKey: 'idem-snake-1',
    });

    const result = await lobby.enqueueAction(action);

    expect(result).toEqual({ ok: true, eventSeq: 7 });
    expect(submitPick).toHaveBeenCalledTimes(1);
    expect(submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        teamId: 'team-A',
        playerId: 8478402, // coerced from string at the boundary
        idempotencyKey: 'idem-snake-1',
        sessionId: 'sess-A',
        actor: { kind: 'user', id: 'user-A', session_id: 'sess-A' },
      }),
    );
  });

  it('auction format rejects submit_pick with wrong_format_for_action', async () => {
    const submitPick = vi.fn();
    const lobby = makeLobby({ format: 'auction', submitPick });

    const result = await lobby.enqueueAction(makeSubmitPick({ idempotencyKey: 'idem-wrong-fmt' }));

    expect(result).toEqual({ ok: false, reason: 'wrong_format_for_action' });
    expect(submitPick).not.toHaveBeenCalled();
  });

  it('place_bid returns not_yet_implemented_chunk_11g6 (auction stub)', async () => {
    const lobby = makeLobby({ format: 'auction' });
    const result = await lobby.enqueueAction({
      kind: 'place_bid',
      teamId: 'team-1',
      nominationId: 'nom-1',
      bidAmount: 25,
      idempotencyKey: 'idem-bid-1',
    });
    expect(result).toEqual({ ok: false, reason: 'not_yet_implemented_chunk_11g6' });
  });

  it('nominate returns not_yet_implemented_chunk_11g6 (auction stub)', async () => {
    const lobby = makeLobby({ format: 'auction' });
    const result = await lobby.enqueueAction({
      kind: 'nominate',
      teamId: 'team-1',
      playerId: '8478402',
      openingBid: 1,
      idempotencyKey: 'idem-nom-1',
    });
    expect(result).toEqual({ ok: false, reason: 'not_yet_implemented_chunk_11g6' });
  });

  it('maps RPC AppError messages to typed rejection reasons', async () => {
    const submitPick = vi.fn().mockRejectedValue(
      new AppError('not_on_clock: team team-A is not on the clock', 409, 'CONFLICT'),
    );
    const lobby = makeLobby({ format: 'snake', submitPick });

    const result = await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-not-on-clock-1' }),
    );

    expect(result).toEqual({ ok: false, reason: 'not_on_clock' });
  });
});
