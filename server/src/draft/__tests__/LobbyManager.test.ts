// Phase 4.5 chunk 11g.4 step 4 — LobbyManager queue + submit_pick +
// ring-buffer + connection-management tests.
//
// 23 tests total: 5 retained from step 1 (instantiate × 3, getSnapshot,
// addConnection/removeConnection callable smoke), 8 from step 2 (queue
// serialization, idempotency, error swallowing, snake/linear
// submit_pick dispatch, auction wrong-format rejection, place_bid +
// nominate chunk-11g.6 stubs, RPC error mapping), 6 from step 3
// (buffer append on success, no-append on duplicate/failed,
// getEventsSinceSeq strict-after semantics, empty-buffer ok-with-empty,
// getSnapshot populates recentEvents from buffer), 4 new step-4 tests
// (addConnection adds + connectionCount, removeConnection removes +
// decrements, removeConnection of unknown ws is no-op, addConnection
// same ws twice is idempotent).
//
// `makeLobby` and `makeSubmitPick` factories at top eliminate
// constructor boilerplate per test. Buffer-eviction semantics are
// covered separately in RingBuffer.test.ts; LobbyRegistry behavior
// (lazy construction, singleton-race) is covered separately in
// LobbyRegistry.test.ts.

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

describe('LobbyManager (chunk 11g.4 step 4)', () => {
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

  it('addConnection and removeConnection are callable without throwing', () => {
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

  // ── Step-3 new tests (ring buffer) ───────────────────────────────

  it('successful submit_pick appends pick_submitted event to the recent-events buffer', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 5,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);

    const lobby = makeLobby({ format: 'snake', submitPick });
    await lobby.enqueueAction(
      makeSubmitPick({
        teamId: 'team-buf-1',
        playerId: '8478402',
        idempotencyKey: 'idem-buf-append-1',
      }),
    );

    const result = lobby.getEventsSinceSeq(0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toHaveLength(1);
      const event = result.events[0];
      expect(event).toMatchObject({
        kind: 'pick_submitted',
        seq: 5,
        teamId: 'team-buf-1',
        playerId: 8478402, // coerced from string at the boundary
        roundNumber: 1,
        pickNumber: 1,
      });
      // timestamp is generated at append time; verify shape only.
      if (event.kind === 'pick_submitted') {
        expect(typeof event.timestamp).toBe('string');
        expect(() => new Date(event.timestamp).toISOString()).not.toThrow();
      }
    }
  });

  it('duplicate submit_pick (was_duplicate=true) does NOT append a second event to the buffer', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 5,
      pick_deadline: null,
      was_duplicate: true, // RPC reports duplicate idempotency key
    } satisfies SubmitPickResult);

    const lobby = makeLobby({ format: 'snake', submitPick });
    const result = await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-buf-dup-1' }),
    );

    // Action still succeeds (returns ok with the seq from the RPC).
    expect(result).toEqual({ ok: true, eventSeq: 5 });

    // But the buffer is empty — the original event is already there
    // from the prior non-retried submission; we don't double-append.
    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events).toHaveLength(0);
    }
  });

  it('failed submit_pick (RPC AppError) does NOT append to the buffer', async () => {
    const submitPick = vi.fn().mockRejectedValue(
      new AppError('player_taken: player 8478402 already drafted', 409, 'CONFLICT'),
    );
    const lobby = makeLobby({ format: 'snake', submitPick });

    const result = await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-buf-failed-1' }),
    );
    expect(result).toEqual({ ok: false, reason: 'player_taken' });

    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events).toHaveLength(0);
    }
  });

  it('getEventsSinceSeq returns ok with empty events when no actions have been processed', () => {
    const lobby = makeLobby();

    expect(lobby.getEventsSinceSeq(0)).toEqual({ ok: true, events: [] });
    expect(lobby.getEventsSinceSeq(42)).toEqual({ ok: true, events: [] });
  });

  it('getEventsSinceSeq returns events strictly after the given sinceSeq', async () => {
    let nextSeq = 10;
    const submitPick = vi.fn(async () => ({
      event_id: nextSeq,
      seq: nextSeq++,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult));

    const lobby = makeLobby({ format: 'snake', submitPick });
    // Three sequential picks → seqs 10, 11, 12 in the buffer.
    for (let i = 0; i < 3; i++) {
      await lobby.enqueueAction(
        makeSubmitPick({ idempotencyKey: `idem-buf-strictly-${i}` }),
      );
    }

    const sinceTen = lobby.getEventsSinceSeq(10);
    expect(sinceTen.ok).toBe(true);
    if (sinceTen.ok) {
      expect(sinceTen.events.map((e) => e.seq)).toEqual([11, 12]);
    }

    const sinceTwelve = lobby.getEventsSinceSeq(12);
    expect(sinceTwelve.ok).toBe(true);
    if (sinceTwelve.ok) {
      expect(sinceTwelve.events).toHaveLength(0);
    }
  });

  it('getSnapshot includes recentEvents from the buffer', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 99,
      seq: 99,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);

    const lobby = makeLobby({ format: 'snake', submitPick });

    // Empty initially.
    expect(lobby.getSnapshot().recentEvents).toHaveLength(0);

    await lobby.enqueueAction(
      makeSubmitPick({
        teamId: 'team-snap-1',
        idempotencyKey: 'idem-buf-snap-1',
      }),
    );

    const snap = lobby.getSnapshot();
    expect(snap.recentEvents).toHaveLength(1);
    expect(snap.recentEvents[0]).toMatchObject({
      kind: 'pick_submitted',
      seq: 99,
      teamId: 'team-snap-1',
    });
  });

  // ── Step-4 new tests (connection management) ─────────────────────

  it('addConnection adds the WebSocket; connectionCount() reflects the change', () => {
    const lobby = makeLobby();
    expect(lobby.connectionCount()).toBe(0);

    const ws = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-1',
      userId: 'user-conn-1',
      leagueId: 'league-1',
      draftId: 'lobby-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
    lobby.addConnection(ws, userData);
    expect(lobby.connectionCount()).toBe(1);
  });

  it('removeConnection removes the WebSocket; connectionCount() decrements', () => {
    const lobby = makeLobby();
    const ws = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-1',
      userId: 'user-conn-2',
      leagueId: 'league-1',
      draftId: 'lobby-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };

    lobby.addConnection(ws, userData);
    expect(lobby.connectionCount()).toBe(1);

    lobby.removeConnection(ws);
    expect(lobby.connectionCount()).toBe(0);
  });

  it('removeConnection for a ws not in the set is a safe no-op', () => {
    const lobby = makeLobby();
    const ws = {} as never;
    expect(() => lobby.removeConnection(ws)).not.toThrow();
    expect(lobby.connectionCount()).toBe(0);
  });

  it('addConnection for the same ws twice does not double-count (Set semantics)', () => {
    const lobby = makeLobby();
    const ws = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-1',
      userId: 'user-conn-3',
      leagueId: 'league-1',
      draftId: 'lobby-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };

    lobby.addConnection(ws, userData);
    lobby.addConnection(ws, userData);
    expect(lobby.connectionCount()).toBe(1);

    // Removing once should still bring count to 0 — the second
    // addConnection didn't double the count, so we don't need a
    // second remove.
    lobby.removeConnection(ws);
    expect(lobby.connectionCount()).toBe(0);
  });
});
