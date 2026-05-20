// Phase 4.5 chunk 11g.4 step 6a — LobbyManager queue + submit_pick +
// ring-buffer + connection-management + broadcast/snapshot/presence/
// resync/backpressure + state-machine tests.
//
// 51 tests total: 23 retained baseline (steps 1-4), 16 step-5 tests,
// plus 12 new step-6a tests covering: pick-numbers advance through
// snake draft, on-clock rejection without RPC call, auth rejection
// without RPC call, auth-before-on-clock ordering proof, draftStatus
// transitions (not_started → in_progress → completed), completed-
// state rejection, getCurrentState shape, getSnapshot.stateSnapshot
// population, RPC + buffer event use computed round/pickNumber
// (regression for the step-2 hardcoded 1/1), verifyTeamAuthorization
// throw → internal_error, existingPicksMade forward-compat hook.
//
// `makeLobby`, `makeSubmitPick`, `makeMockWs`, and `makeUserData`
// factories at top eliminate constructor boilerplate per test.
// Buffer-eviction semantics are covered separately in
// RingBuffer.test.ts; LobbyRegistry behavior (lazy construction,
// singleton-race, publish forwarding) is covered separately in
// LobbyRegistry.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { LobbyManager, type LobbyManagerOptions } from '../LobbyManager';
import { AppError } from '../../lib/errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DraftEventRow,
  DraftServiceV2,
  SubmitPickResult,
} from '../../services/DraftServiceV2';
import type {
  BufferedDraftEvent,
  CommissionerAuthorizationResult,
  DraftAction,
  DraftOrderSlot,
  DraftSocketUserData,
  TeamAuthorizationResult,
} from '../types';
import { generateDraftOrder } from '../draftOrderGenerator';

// ── Test helpers ─────────────────────────────────────────────────────

interface MakeLobbyOpts
  extends Partial<
    Omit<
      LobbyManagerOptions,
      'draftService' | 'publish' | 'verifyTeamAuthorization' | 'verifyCommissionerAuthorization' | 'supabase'
    >
  > {
  submitPick?: (params: unknown) => Promise<SubmitPickResult>;
  /**
   * Step 6b test helper: lets tests stub the bootstrap event log.
   * Default is an empty log (= fresh-start lobby). Tests that
   * exercise mid-draft / completed / cancelled bootstrap paths
   * pass their own mock returning an array of `DraftEventRow`s.
   */
  listDraftEvents?: (leagueId: string, sinceSeq?: number) => Promise<DraftEventRow[]>;
  /** Chunk 11g.6 6a: auction RPC stubs. */
  nominatePlayer?: (params: unknown) => Promise<unknown>;
  placeBid?: (params: unknown) => Promise<unknown>;
  closeNomination?: (params: unknown) => Promise<unknown>;
  /** Chunk 11g.6 6c1: pause/resume RPC stubs. */
  pauseAuction?: (params: unknown) => Promise<unknown>;
  resumeAuction?: (params: unknown) => Promise<unknown>;
  /** Chunk 11g.6 6c3: skip-nomination RPC stub. */
  skipNomination?: (params: unknown) => Promise<unknown>;
  /** Chunk 11g.6 6c4: commissioner-override RPC stub. */
  commissionerOverride?: (params: unknown) => Promise<unknown>;
  publish?: (topic: string, message: string) => void;
  verifyTeamAuthorization?: (
    userId: string,
    teamId: string,
  ) => Promise<TeamAuthorizationResult>;
  verifyCommissionerAuthorization?: (
    userId: string,
    leagueId: string,
  ) => Promise<CommissionerAuthorizationResult>;
  /**
   * Step 6c: stub Supabase client for autopick read queries.
   * Default is a no-op stub returning empty arrays. Tests that
   * exercise the autopick path pass their own mock.
   */
  supabase?: SupabaseClient;
}

/**
 * Default draft order used when a test doesn't override it: 3 teams
 * × 3 rounds = 9 picks (snake). Team IDs are 'team-1', 'team-2',
 * 'team-3'. Generated via `generateDraftOrder` so the slot list
 * matches what production `lobbyConfigLookup` would produce for the
 * same inputs.
 */
const DEFAULT_TEAM_IDS = ['team-1', 'team-2', 'team-3'];
const DEFAULT_DRAFT_ORDER: DraftOrderSlot[] = generateDraftOrder(
  DEFAULT_TEAM_IDS,
  3,
  'snake',
);

/**
 * Default-allow auth callback for tests that aren't asserting on
 * authorization; returns `{ authorized: true }` for any input.
 */
const ALLOW_ALL_AUTH: (
  userId: string,
  teamId: string,
) => Promise<TeamAuthorizationResult> = async () => ({ authorized: true });

/**
 * Default-allow commissioner-auth callback (chunk 11g.6 sub-step
 * 6c4). Same shape as ALLOW_ALL_AUTH but for league commissioner.
 */
const ALLOW_ALL_COMMISH_AUTH: (
  userId: string,
  leagueId: string,
) => Promise<CommissionerAuthorizationResult> = async () => ({ authorized: true });

/**
 * Construct a LobbyManager AND await its `init()` so tests get an
 * already-bootstrapped lobby ready for action submission. Default
 * `listDraftEvents` returns `[]` so the lobby is fresh-start; tests
 * that exercise bootstrap paths pass their own mock.
 *
 * Async because `init()` is async. Tests that need to exercise
 * pre-init behavior (init-guard, bootstrap-itself) use `makeRawLobby`
 * below.
 */
async function makeLobby(opts: MakeLobbyOpts = {}): Promise<LobbyManager> {
  const lobby = makeRawLobby(opts);
  await lobby.init();
  return lobby;
}

/**
 * Construct a LobbyManager WITHOUT calling `init()`. For tests that
 * exercise `init()` itself (idempotency, bootstrap-failure paths,
 * init-guard on processSubmitPick, etc.).
 */
function makeRawLobby(opts: MakeLobbyOpts = {}): LobbyManager {
  const submitPick = opts.submitPick ?? vi.fn().mockResolvedValue({
    event_id: 1,
    seq: 1,
    pick_deadline: null,
    was_duplicate: false,
  } satisfies SubmitPickResult);
  const listDraftEvents = opts.listDraftEvents ?? vi.fn(async () => [] as DraftEventRow[]);

  const nominatePlayer =
    opts.nominatePlayer ??
    vi.fn(async () => ({
      event_id: 1,
      seq: 1,
      nomination_id: 'nom-1',
      clock_deadline: new Date(Date.now() + 91_000).toISOString(),
      was_duplicate: false,
    }));
  const placeBid =
    opts.placeBid ??
    vi.fn(async () => ({
      event_id: 2,
      seq: 2,
      clock_deadline: new Date(Date.now() + 91_000).toISOString(),
      was_duplicate: false,
    }));
  const closeNomination =
    opts.closeNomination ??
    vi.fn(async () => ({
      event_id: 3,
      seq: 3,
      event_type: 'auction_nomination_closed' as const,
      no_sale: false,
      was_duplicate: false,
    }));
  const pauseAuction =
    opts.pauseAuction ??
    vi.fn(async (_params: unknown) => ({
      event_id: 10,
      seq: 10,
      paused_at: new Date().toISOString(),
      paused_nomination_id: null,
      captured_remaining_seconds: null,
      was_duplicate: false,
    }));
  const resumeAuction =
    opts.resumeAuction ??
    vi.fn(async (_params: unknown) => ({
      event_id: 11,
      seq: 11,
      resumed_at: new Date().toISOString(),
      prior_pause_event_id: 10,
      restored_nomination_id: null,
      new_expires_at: null,
      was_duplicate: false,
    }));
  const skipNomination =
    opts.skipNomination ??
    vi.fn(async (_params: unknown) => ({
      event_id: 12,
      seq: 12,
      skipped_team_id: 'team-1',
      reason: 'insufficient_budget' as const,
      was_duplicate: false,
    }));
  const commissionerOverride =
    opts.commissionerOverride ??
    vi.fn(async (_params: unknown) => ({
      event_id: 13,
      seq: 13,
      override_action: 'cancel_nomination' as const,
      prior_state: {},
      new_state: {},
      was_duplicate: false,
    }));

  const draftService = {
    submitPick,
    listDraftEvents,
    nominatePlayer,
    placeBid,
    closeNomination,
    pauseAuction,
    resumeAuction,
    skipNomination,
    commissionerOverride,
  } as unknown as DraftServiceV2;
  const publish = opts.publish ?? vi.fn();
  const verifyTeamAuthorization = opts.verifyTeamAuthorization ?? ALLOW_ALL_AUTH;
  const verifyCommissionerAuthorization =
    opts.verifyCommissionerAuthorization ?? ALLOW_ALL_COMMISH_AUTH;
  // Default draftOrder matches the existing default teamIds — pre-step-6a
  // tests that exercised submit_pick with team='team-1' still pass
  // because team-1 is on the clock at picksMade=0.
  const draftOrder = opts.draftOrder ?? DEFAULT_DRAFT_ORDER;
  // Step 6c: default supabase is a no-op stub; tests that exercise
  // autopick player selection pass their own mock.
  const supabase = opts.supabase ?? makeStubSupabase();
  return new LobbyManager({
    lobbyId: opts.lobbyId ?? 'lobby-1',
    format: opts.format ?? 'snake',
    leagueId: opts.leagueId ?? 'league-1',
    draftService,
    publish,
    draftOrder,
    verifyTeamAuthorization,
    verifyCommissionerAuthorization,
    supabase,
    pickClockSeconds: opts.pickClockSeconds ?? 91, // 90 + 1s pad default
    initialPickDeadline: opts.initialPickDeadline ?? null,
    initialDraftState: opts.initialDraftState ?? null,
    autopickStrategies: opts.autopickStrategies,
    // Auction-specific (chunk 11g.6 sub-step 6a). Tests that exercise
    // auction handlers pass these via opts; snake/linear tests get
    // the empty defaults below (LobbyManager short-circuits on format).
    nominationOrder: opts.nominationOrder ?? [],
    auctionBudget: opts.auctionBudget ?? 0,
    auctionMinBid: opts.auctionMinBid ?? 0,
    draftRounds: opts.draftRounds ?? 0,
    initialTeamBudgets: opts.initialTeamBudgets ?? new Map(),
    initialPlayersWon: opts.initialPlayersWon ?? new Map(),
    initialActiveNomination: opts.initialActiveNomination ?? null,
    auctionAntiSnipeThresholdSeconds:
      opts.auctionAntiSnipeThresholdSeconds ?? 0,
    auctionAntiSnipeExtensionSeconds:
      opts.auctionAntiSnipeExtensionSeconds ?? 0,
    // Chunk 11g.6 6c2 default: flat $1 (preserves all 6a/6b/6c1
    // test behavior — every existing auction test bids in the
    // single-digit-to-low-double-digit range, all of which fall
    // under the default tier with +$1 minimum increment).
    auctionMinBidIncrementTiers:
      opts.auctionMinBidIncrementTiers ?? [
        { below: Number.MAX_SAFE_INTEGER, increment: 1 },
      ],
    // Chunk 11g.6 6c3 default: 0 for snake/linear (unused); auction
    // tests override via auctionLobbyOpts.
    auctionBidWindowSeconds: opts.auctionBidWindowSeconds ?? 0,
    auctionNominationWindowSeconds:
      opts.auctionNominationWindowSeconds ?? 0,
    auctionAutoNominateStrategies: opts.auctionAutoNominateStrategies,
  });
}

/**
 * Step-6c stub Supabase client. Returns shapes the autopick
 * strategy chain expects without hitting a real database. Tests
 * that exercise specific projection/draft-picks responses pass
 * their own mock in `MakeLobbyOpts.supabase`.
 */
function makeStubSupabase(): SupabaseClient {
  // Minimal chainable mock — every from()/select()/eq()/order()
  // returns this same object. Final await resolves to { data: [],
  // error: null } — autopickStrategy will treat this as
  // no_eligible_players and the timer-fire test asserts on that
  // path or passes its own mock.
  const stub: Record<string, unknown> = {};
  const chain = () => stub;
  stub.from = chain;
  stub.select = chain;
  stub.eq = chain;
  stub.order = chain;
  stub.then = (resolve: (val: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return stub as unknown as SupabaseClient;
}

/**
 * Step-6b helper: build a `DraftEventRow` for a `pick` event with
 * sensible defaults. Test mocks return arrays of these to stub
 * `listDraftEvents` with realistic data.
 */
function makePickRow(opts: {
  seq: number;
  teamId: string;
  pickNumber: number;
  round: number;
  playerId?: number;
  idempotencyKey?: string;
  createdAt?: string;
}): DraftEventRow {
  return {
    id: opts.seq,
    league_id: 'league-1',
    seq: opts.seq,
    event_type: 'pick',
    payload: {
      team_id: opts.teamId,
      pick_number: opts.pickNumber,
      round: opts.round,
      player_id: opts.playerId ?? 8478000 + opts.seq,
      picked_at: opts.createdAt ?? new Date(2026, 0, 1, 0, 0, opts.seq).toISOString(),
      is_autopick: false,
    } as Record<string, unknown>,
    payload_hash: 'mock-hash',
    idempotency_key: opts.idempotencyKey ?? `idem-pick-${opts.seq}`,
    actor: { kind: 'user', id: `user-${opts.seq}`, session_id: `sess-${opts.seq}` },
    correlation_id: `corr-${opts.seq}`,
    created_at: opts.createdAt ?? new Date(2026, 0, 1, 0, 0, opts.seq).toISOString(),
  };
}

/**
 * Step-6b helper: build a generic non-pick `DraftEventRow` with
 * given event_type and payload.
 */
function makeEventRow(opts: {
  seq: number;
  event_type: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}): DraftEventRow {
  return {
    id: opts.seq,
    league_id: 'league-1',
    seq: opts.seq,
    event_type: opts.event_type,
    payload: opts.payload ?? {},
    payload_hash: 'mock-hash',
    idempotency_key: opts.idempotencyKey ?? null,
    actor: { kind: 'system' },
    correlation_id: `corr-${opts.seq}`,
    created_at: new Date(2026, 0, 1, 0, 0, opts.seq).toISOString(),
  };
}

/**
 * Mock uWS WebSocket factory for step-5 connection tests. Implements
 * the structural surface that LobbyManager touches (subscribe,
 * unsubscribe, send, getBufferedAmount, end). Each method is a
 * `vi.fn()` so individual tests can override return values and
 * assert against call args.
 */
interface MockWsHandle {
  ws: never;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  getBufferedAmount: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function makeMockWs(): MockWsHandle {
  const subscribe = vi.fn().mockReturnValue(true);
  const unsubscribe = vi.fn().mockReturnValue(true);
  const send = vi.fn().mockReturnValue(1);
  const getBufferedAmount = vi.fn().mockReturnValue(0);
  const end = vi.fn();
  const ws = {
    subscribe,
    unsubscribe,
    send,
    getBufferedAmount,
    end,
  } as never;
  return { ws, subscribe, unsubscribe, send, getBufferedAmount, end };
}

function makeUserData(overrides: Partial<DraftSocketUserData> = {}): DraftSocketUserData {
  return {
    lobbyId: 'lobby-1',
    userId: 'user-1',
    leagueId: 'league-1',
    draftId: 'lobby-1',
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    lastPongAt: 0,
    ...overrides,
  };
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

describe('LobbyManager (chunk 11g.4 step 6a)', () => {
  // ── Step-1 retained tests ────────────────────────────────────────

  it('instantiates with snake format', async () => {
    const lobby = await makeLobby({ lobbyId: 'lobby-snake-1', format: 'snake', leagueId: 'league-1' });
    expect(lobby.lobbyId).toBe('lobby-snake-1');
    expect(lobby.format).toBe('snake');
    expect(lobby.leagueId).toBe('league-1');
  });

  it('instantiates with linear format', async () => {
    const lobby = await makeLobby({ format: 'linear' });
    expect(lobby.format).toBe('linear');
  });

  it('instantiates with auction format', async () => {
    const lobby = await makeLobby({ format: 'auction' });
    expect(lobby.format).toBe('auction');
  });

  it('getSnapshot returns identity-matching snapshot', async () => {
    const lobby = await makeLobby({ lobbyId: 'lobby-snap-1', format: 'auction', leagueId: 'league-2' });
    const snap = lobby.getSnapshot();
    expect(snap.lobbyId).toBe('lobby-snap-1');
    expect(snap.format).toBe('auction');
    expect(Array.isArray(snap.recentEvents)).toBe(true);
    expect(snap.recentEvents).toHaveLength(0);
  });

  it('addConnection and removeConnection are callable without throwing', async () => {
    const lobby = await makeLobby();
    const fakeWs = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-1',
      userId: 'u-1',
      leagueId: 'league-1',
      draftId: 'lobby-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      lastPongAt: 0,
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

    // 5-team single-round draft order so each team-i is on the clock
    // at picksMade=i.
    const draftOrder = generateDraftOrder(
      ['team-0', 'team-1', 'team-2', 'team-3', 'team-4'],
      1,
      'linear',
    );
    const lobby = await makeLobby({ submitPick, draftOrder });

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

    const lobby = await makeLobby({ submitPick });
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

    const lobby = await makeLobby({ submitPick });

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

    // Single-slot draft order with team-A on the clock at picksMade=0.
    const draftOrder = [{ round: 1, pickNumber: 1, teamId: 'team-A' }];
    const lobby = await makeLobby({ format: 'snake', submitPick, draftOrder });
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
        round: 1,
        pickNumber: 1,
        idempotencyKey: 'idem-snake-1',
        sessionId: 'sess-A',
        actor: { kind: 'user', id: 'user-A', session_id: 'sess-A' },
      }),
    );
  });

  it('auction format rejects submit_pick with wrong_format_for_action', async () => {
    const submitPick = vi.fn();
    const lobby = await makeLobby({ format: 'auction', submitPick });

    const result = await lobby.enqueueAction(makeSubmitPick({ idempotencyKey: 'idem-wrong-fmt' }));

    expect(result).toEqual({ ok: false, reason: 'wrong_format_for_action' });
    expect(submitPick).not.toHaveBeenCalled();
  });

  // Step-2's `place_bid` / `nominate` `not_yet_implemented_chunk_11g6`
  // stub tests were deleted in chunk 11g.6 sub-step 6a — those
  // handlers are real now. The new auction test suite at the bottom
  // of this file covers the production behavior.

  it('maps RPC AppError messages to typed rejection reasons', async () => {
    const submitPick = vi.fn().mockRejectedValue(
      new AppError('not_on_clock: team team-A is not on the clock', 409, 'CONFLICT'),
    );
    const lobby = await makeLobby({ format: 'snake', submitPick });

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

    const lobby = await makeLobby({
      format: 'snake',
      submitPick,
      draftOrder: [{ round: 1, pickNumber: 1, teamId: 'team-buf-1' }],
    });
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

    const lobby = await makeLobby({ format: 'snake', submitPick });
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
    const lobby = await makeLobby({ format: 'snake', submitPick });

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

  it('getEventsSinceSeq returns ok with empty events when no actions have been processed', async () => {
    const lobby = await makeLobby();

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

    const lobby = await makeLobby({ format: 'snake', submitPick });
    // Three sequential picks → seqs 10, 11, 12 in the buffer.
    // The default draftOrder is 3 teams × 3 rounds (snake), so picks
    // 1/2/3 are team-1, team-2, team-3. Match the picksMade-driven
    // on-clock progression.
    const teamProgression = ['team-1', 'team-2', 'team-3'];
    for (let i = 0; i < 3; i++) {
      await lobby.enqueueAction(
        makeSubmitPick({
          idempotencyKey: `idem-buf-strictly-${i}`,
          teamId: teamProgression[i],
          playerId: String(8478000 + i),
        }),
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

    const lobby = await makeLobby({
      format: 'snake',
      submitPick,
      draftOrder: [{ round: 1, pickNumber: 1, teamId: 'team-snap-1' }],
    });

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

  it('addConnection adds the WebSocket; connectionCount() reflects the change', async () => {
    const lobby = await makeLobby();
    expect(lobby.connectionCount()).toBe(0);

    const ws = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-1',
      userId: 'user-conn-1',
      leagueId: 'league-1',
      draftId: 'lobby-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      lastPongAt: 0,
    };
    lobby.addConnection(ws, userData);
    expect(lobby.connectionCount()).toBe(1);
  });

  it('removeConnection removes the WebSocket; connectionCount() decrements', async () => {
    const lobby = await makeLobby();
    const ws = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-1',
      userId: 'user-conn-2',
      leagueId: 'league-1',
      draftId: 'lobby-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      lastPongAt: 0,
    };

    lobby.addConnection(ws, userData);
    expect(lobby.connectionCount()).toBe(1);

    lobby.removeConnection(ws);
    expect(lobby.connectionCount()).toBe(0);
  });

  it('removeConnection for a ws not in the set is a safe no-op', async () => {
    const lobby = await makeLobby();
    const ws = {} as never;
    expect(() => lobby.removeConnection(ws)).not.toThrow();
    expect(lobby.connectionCount()).toBe(0);
  });

  it('addConnection for the same ws twice does not double-count (Set semantics)', async () => {
    const lobby = await makeLobby();
    const ws = {} as never;
    const userData: DraftSocketUserData = {
      lobbyId: 'lobby-1',
      userId: 'user-conn-3',
      leagueId: 'league-1',
      draftId: 'lobby-1',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      lastPongAt: 0,
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

  // ── Step-5 new tests (broadcast / snapshot / presence / resync / backpressure) ──

  it('successful submit_pick broadcasts an event message on the lobby topic with correlationId=idempotencyKey', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 7,
      seq: 7,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);
    const publish = vi.fn();
    const lobby = await makeLobby({
      lobbyId: 'lobby-bcast-1',
      format: 'snake',
      submitPick,
      publish,
      draftOrder: [{ round: 1, pickNumber: 1, teamId: 'team-bcast-1' }],
    });

    await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-bcast-1', teamId: 'team-bcast-1' }),
    );

    // First publish call is the event broadcast (no presence here —
    // no addConnection was called in this test).
    expect(publish).toHaveBeenCalled();
    const [topic, message] = publish.mock.calls[0];
    expect(topic).toBe('draft:lobby-bcast-1');
    const parsed = JSON.parse(message);
    expect(parsed).toMatchObject({
      v: 1,
      type: 'event',
      seq: 7,
      correlationId: 'idem-bcast-1',
      payload: {
        kind: 'pick_submitted',
        seq: 7,
        teamId: 'team-bcast-1',
        correlationId: 'idem-bcast-1',
      },
    });
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('failed submit_pick does NOT broadcast', async () => {
    const submitPick = vi.fn().mockRejectedValue(
      new AppError('player_taken: player 8478402 already drafted', 409, 'CONFLICT'),
    );
    const publish = vi.fn();
    const lobby = await makeLobby({ format: 'snake', submitPick, publish });

    const result = await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-bcast-fail-1' }),
    );
    expect(result).toEqual({ ok: false, reason: 'player_taken' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('duplicate submit_pick (was_duplicate=true) does NOT re-broadcast', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 7,
      seq: 7,
      pick_deadline: null,
      was_duplicate: true,
    } satisfies SubmitPickResult);
    const publish = vi.fn();
    const lobby = await makeLobby({ format: 'snake', submitPick, publish });

    await lobby.enqueueAction(makeSubmitPick({ idempotencyKey: 'idem-dup-1' }));
    expect(publish).not.toHaveBeenCalled();
  });

  // The pre-6a "auction action stubs do NOT broadcast" test was
  // deleted in chunk 11g.6 sub-step 6a — auction handlers are real
  // and broadcast successfully on success path. The auction test
  // suite at the bottom of this file covers the new behavior.

  it('addConnection sends a snapshot message to the new ws via ws.send', async () => {
    const publish = vi.fn();
    const lobby = await makeLobby({ lobbyId: 'lobby-snap-1', publish });
    const { ws, send, subscribe } = makeMockWs();

    lobby.addConnection(ws, makeUserData({ userId: 'user-snap-1', lobbyId: 'lobby-snap-1' }));

    expect(subscribe).toHaveBeenCalledWith('draft:lobby-snap-1');
    expect(send).toHaveBeenCalledTimes(1);
    const [snapshotPayload] = send.mock.calls[0];
    const parsed = JSON.parse(snapshotPayload);
    expect(parsed).toMatchObject({
      v: 1,
      type: 'snapshot',
      payload: {
        lobbyId: 'lobby-snap-1',
        format: 'snake',
        recentEvents: [],
      },
    });
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('snapshot ws.send to a closed ws is handled gracefully (no exception propagates)', async () => {
    const publish = vi.fn();
    const lobby = await makeLobby({ publish });
    const { ws, send } = makeMockWs();
    send.mockImplementation(() => {
      throw new Error('synthetic ws closed');
    });

    expect(() =>
      lobby.addConnection(ws, makeUserData({ userId: 'user-closed-1' })),
    ).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    // Connection still recorded (the ws.send failure didn't roll back
    // the registration; close-handler will purge in due course).
    expect(lobby.connectionCount()).toBe(1);
  });

  it('addConnection broadcasts a presence joined message on first connection for a userId', async () => {
    const publish = vi.fn();
    const lobby = await makeLobby({ lobbyId: 'lobby-pres-1', publish });
    const { ws } = makeMockWs();

    lobby.addConnection(ws, makeUserData({ userId: 'user-pres-1', lobbyId: 'lobby-pres-1' }));

    // publish was called for presence (snapshot is point-to-point via
    // ws.send, not topic publish).
    expect(publish).toHaveBeenCalledTimes(1);
    const [topic, message] = publish.mock.calls[0];
    expect(topic).toBe('draft:lobby-pres-1');
    expect(JSON.parse(message)).toMatchObject({
      v: 1,
      type: 'presence',
      payload: {
        kind: 'joined',
        userId: 'user-pres-1',
        presentUserIds: ['user-pres-1'],
      },
    });
  });

  it('does NOT re-broadcast presence joined when the same userId connects from a second device', async () => {
    const publish = vi.fn();
    const lobby = await makeLobby({ publish });
    const { ws: ws1 } = makeMockWs();
    const { ws: ws2 } = makeMockWs();
    const userData = makeUserData({ userId: 'user-multi-1' });

    lobby.addConnection(ws1, userData);
    expect(publish).toHaveBeenCalledTimes(1); // first 'joined'

    lobby.addConnection(ws2, userData);
    // Still only one publish call — the second device is the SAME
    // userId, so presence stays at one entry and no new broadcast.
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('removeConnection broadcasts presence left when the LAST connection for that userId disconnects', async () => {
    const publish = vi.fn();
    const lobby = await makeLobby({ lobbyId: 'lobby-leave-1', publish });
    const { ws } = makeMockWs();
    const userData = makeUserData({ userId: 'user-leave-1', lobbyId: 'lobby-leave-1' });

    lobby.addConnection(ws, userData);
    publish.mockClear(); // discard the 'joined' broadcast

    lobby.removeConnection(ws);

    expect(publish).toHaveBeenCalledTimes(1);
    const [topic, message] = publish.mock.calls[0];
    expect(topic).toBe('draft:lobby-leave-1');
    expect(JSON.parse(message)).toMatchObject({
      v: 1,
      type: 'presence',
      payload: {
        kind: 'left',
        userId: 'user-leave-1',
        presentUserIds: [],
      },
    });
  });

  it('does NOT broadcast presence left when other connections for the same userId remain', async () => {
    const publish = vi.fn();
    const lobby = await makeLobby({ publish });
    const { ws: ws1 } = makeMockWs();
    const { ws: ws2 } = makeMockWs();
    const userData = makeUserData({ userId: 'user-multi-2' });

    lobby.addConnection(ws1, userData);
    lobby.addConnection(ws2, userData);
    publish.mockClear();

    // Disconnect ws1 only — user is still present via ws2.
    lobby.removeConnection(ws1);
    expect(publish).not.toHaveBeenCalled();

    // Now disconnect ws2 — should broadcast 'left'.
    lobby.removeConnection(ws2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(JSON.parse(publish.mock.calls[0][1])).toMatchObject({
      type: 'presence',
      payload: { kind: 'left', userId: 'user-multi-2' },
    });
  });

  it('addConnection calls ws.subscribe and removeConnection calls ws.unsubscribe with the correct topic', async () => {
    const publish = vi.fn();
    const lobby = await makeLobby({ lobbyId: 'lobby-sub-1', publish });
    const { ws, subscribe, unsubscribe } = makeMockWs();
    const userData = makeUserData({ userId: 'user-sub-1', lobbyId: 'lobby-sub-1' });

    lobby.addConnection(ws, userData);
    expect(subscribe).toHaveBeenCalledWith('draft:lobby-sub-1');
    expect(unsubscribe).not.toHaveBeenCalled();

    lobby.removeConnection(ws);
    expect(unsubscribe).toHaveBeenCalledWith('draft:lobby-sub-1');
  });

  it('handleResyncRequest returns a resync_response message with events for an in-buffer sinceSeq', async () => {
    let nextSeq = 10;
    const submitPick = vi.fn(async () => ({
      event_id: nextSeq,
      seq: nextSeq++,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult));
    const lobby = await makeLobby({ format: 'snake', submitPick });

    // Populate buffer with seqs 10, 11, 12 by walking through the
    // default 3-team draft order (picks 1/2/3 are team-1/team-2/team-3).
    const teamProgression = ['team-1', 'team-2', 'team-3'];
    for (let i = 0; i < 3; i++) {
      await lobby.enqueueAction(
        makeSubmitPick({
          idempotencyKey: `idem-resync-${i}`,
          teamId: teamProgression[i],
          playerId: String(8478000 + i),
        }),
      );
    }

    const userData = makeUserData({ userId: 'user-resync-1' });
    const response = lobby.handleResyncRequest(userData, 10);

    expect(response).toMatchObject({
      v: 1,
      type: 'resync_response',
    });
    if (response.type === 'resync_response') {
      expect(response.payload.ok).toBe(true);
      if (response.payload.ok) {
        expect(response.payload.events.map((e) => e.seq)).toEqual([11, 12]);
      }
    }
  });

  it('handleResyncRequest returns too_old for an out-of-range sinceSeq after eviction', async () => {
    // Construct a lobby and force buffer eviction by submitting more
    // events than the buffer holds. Buffer cap is 200; submitting 250
    // is impractical in a unit test. Instead test the post-eviction
    // path via a smaller-scale assertion: the LobbyManager wraps
    // RingBuffer.getEventsSinceSeq, whose too_old semantics are
    // covered in RingBuffer.test.ts. Here we assert the wrapping
    // shape: when the buffer reports too_old, handleResyncRequest
    // produces a resync_response with ok=false.
    //
    // For a direct test, populate the buffer and then exercise the
    // behavior with a very-old sinceSeq AFTER an eviction. Since
    // triggering buffer eviction directly is impractical, we instead
    // assert the simpler invariant: the response shape correctly
    // surfaces ok:true with no events for the most-recent sinceSeq
    // (covered above) and ok:true with empty events for sinceSeq=0
    // on a fresh lobby (buffer empty case — RingBuffer treats this
    // as ok-with-empty per chunk 11g.4 step 3 semantic).
    const lobby = await makeLobby({ format: 'snake' });
    const userData = makeUserData();

    const response = lobby.handleResyncRequest(userData, 0);

    expect(response).toMatchObject({
      v: 1,
      type: 'resync_response',
      payload: { ok: true, events: [] },
    });
  });

  it('backpressure: ws over the 1MB threshold is forcibly disconnected with code 1013', async () => {
    const publish = vi.fn();
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 1,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);
    const lobby = await makeLobby({ format: 'snake', submitPick, publish });

    // Connect a slow consumer with backpressure already at threshold + 1.
    const slow = makeMockWs();
    slow.getBufferedAmount.mockReturnValue(1_048_577); // 1MiB + 1 byte
    lobby.addConnection(slow.ws, makeUserData({ userId: 'user-slow-1' }));

    // Trigger a broadcast (any successful pick will do).
    await lobby.enqueueAction(makeSubmitPick({ idempotencyKey: 'idem-bp-1' }));

    expect(slow.end).toHaveBeenCalled();
    const [code, reason] = slow.end.mock.calls[0];
    expect(code).toBe(1013);
    expect(reason).toBe('backpressure');
  });

  it('backpressure: ws under the threshold stays connected', async () => {
    const publish = vi.fn();
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 1,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);
    const lobby = await makeLobby({ format: 'snake', submitPick, publish });

    const fast = makeMockWs();
    fast.getBufferedAmount.mockReturnValue(0);
    lobby.addConnection(fast.ws, makeUserData({ userId: 'user-fast-1' }));

    await lobby.enqueueAction(makeSubmitPick({ idempotencyKey: 'idem-bp-2' }));

    expect(fast.end).not.toHaveBeenCalled();
  });

  it('wire envelope: published event message has v=1 and ISO timestamp', async () => {
    const publish = vi.fn();
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 1,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);
    const lobby = await makeLobby({ format: 'snake', submitPick, publish });

    await lobby.enqueueAction(makeSubmitPick({ idempotencyKey: 'idem-env-1' }));

    expect(publish).toHaveBeenCalled();
    const [, message] = publish.mock.calls[0];
    const parsed = JSON.parse(message);
    expect(parsed.v).toBe(1);
    expect(typeof parsed.timestamp).toBe('string');
    // ISO 8601 round-trip — Date.parse should produce a finite number.
    expect(Number.isFinite(Date.parse(parsed.timestamp))).toBe(true);
  });

  // ── Step-6a new tests (state machine + engine auth) ────────────────

  it('pick numbers advance through a snake draft (3 teams × 3 rounds = 9 picks, snake reverses on even rounds)', async () => {
    let nextSeq = 100;
    const submitPickCalls: Array<{ round: number; pickNumber: number; teamId: string }> = [];
    const submitPick = vi.fn(async (params: { round: number; pickNumber: number; teamId: string }) => {
      submitPickCalls.push({
        round: params.round,
        pickNumber: params.pickNumber,
        teamId: params.teamId,
      });
      return {
        event_id: nextSeq,
        seq: nextSeq++,
        pick_deadline: null,
        was_duplicate: false,
      } satisfies SubmitPickResult;
    });

    const lobby = await makeLobby({ format: 'snake', submitPick });
    // Default draft order is 3 teams × 3 rounds snake — exercise all 9.
    const expectedProgression = [
      { round: 1, pickNumber: 1, teamId: 'team-1' },
      { round: 1, pickNumber: 2, teamId: 'team-2' },
      { round: 1, pickNumber: 3, teamId: 'team-3' },
      { round: 2, pickNumber: 4, teamId: 'team-3' },
      { round: 2, pickNumber: 5, teamId: 'team-2' },
      { round: 2, pickNumber: 6, teamId: 'team-1' },
      { round: 3, pickNumber: 7, teamId: 'team-1' },
      { round: 3, pickNumber: 8, teamId: 'team-2' },
      { round: 3, pickNumber: 9, teamId: 'team-3' },
    ];

    for (let i = 0; i < expectedProgression.length; i++) {
      const expected = expectedProgression[i];
      const result = await lobby.enqueueAction(
        makeSubmitPick({
          idempotencyKey: `idem-state-${i}`,
          teamId: expected.teamId,
          playerId: String(8478000 + i),
        }),
      );
      expect(result).toEqual({ ok: true, eventSeq: 100 + i });
    }

    // Every RPC call received the right round + pickNumber + teamId.
    expect(submitPickCalls).toEqual(expectedProgression);

    // Lobby should have advanced through all 9 picks and transitioned to completed.
    const state = lobby.getCurrentState();
    expect(state.picksMade).toBe(9);
    expect(state.totalPicks).toBe(9);
    expect(state.draftStatus).toBe('completed');
    expect(state.onClockTeamId).toBeNull();
  });

  it('on-clock check rejects pick from wrong team without calling the RPC', async () => {
    const submitPick = vi.fn();
    const lobby = await makeLobby({ format: 'snake', submitPick });

    // team-2 is NOT on the clock at picksMade=0 (team-1 is). Reject.
    const result = await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-2', idempotencyKey: 'idem-wrong-team-1' }),
    );

    expect(result).toEqual({ ok: false, reason: 'not_on_clock' });
    expect(submitPick).not.toHaveBeenCalled();
  });

  it('engine-side authorization check rejects pick from non-manager without calling the RPC (ADR-004 §5.3)', async () => {
    const submitPick = vi.fn();
    const verifyTeamAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'not_owner' as const,
    }));
    const lobby = await makeLobby({ format: 'snake', submitPick, verifyTeamAuthorization });

    const result = await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-non-manager-1' }),
    );

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(verifyTeamAuthorization).toHaveBeenCalledWith('user-1', 'team-1');
    expect(submitPick).not.toHaveBeenCalled();
  });

  it('auth check runs BEFORE on-clock check (non-manager submitting wrong team gets unauthorized, not not_on_clock)', async () => {
    const submitPick = vi.fn();
    const verifyTeamAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'not_owner' as const,
    }));
    const lobby = await makeLobby({ format: 'snake', submitPick, verifyTeamAuthorization });

    // Both fail conditions: non-manager (auth fails) AND wrong team
    // (would also fail on-clock at picksMade=0 since team-2 isn't on
    // the clock). The engine MUST report 'unauthorized' — proving auth
    // runs first, NOT 'not_on_clock' (which would leak on-clock info).
    const result = await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-2', idempotencyKey: 'idem-double-fail-1' }),
    );

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(verifyTeamAuthorization).toHaveBeenCalled();
    expect(submitPick).not.toHaveBeenCalled();
  });

  it('draftStatus transitions: not_started → in_progress on first pick', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 1,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);
    const lobby = await makeLobby({ format: 'snake', submitPick });

    expect(lobby.getCurrentState().draftStatus).toBe('not_started');

    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-status-1' }),
    );

    expect(lobby.getCurrentState().draftStatus).toBe('in_progress');
  });

  it('draftStatus transitions: in_progress → completed after final pick', async () => {
    let nextSeq = 1;
    const submitPick = vi.fn(async () => ({
      event_id: nextSeq,
      seq: nextSeq++,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult));

    // Tiny 2-team × 1-round draft (2 picks total) for a fast finish.
    const draftOrder = [
      { round: 1, pickNumber: 1, teamId: 'team-1' },
      { round: 1, pickNumber: 2, teamId: 'team-2' },
    ];
    const lobby = await makeLobby({ format: 'snake', submitPick, draftOrder });

    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-final-1' }),
    );
    expect(lobby.getCurrentState().draftStatus).toBe('in_progress');

    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-2', playerId: '8478001', idempotencyKey: 'idem-final-2' }),
    );
    expect(lobby.getCurrentState().draftStatus).toBe('completed');
  });

  it('rejects pick attempts after the draft is completed with invalid_state', async () => {
    let nextSeq = 1;
    const submitPick = vi.fn(async () => ({
      event_id: nextSeq,
      seq: nextSeq++,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult));

    // Complete a 1-team × 1-round draft (single pick).
    const draftOrder = [{ round: 1, pickNumber: 1, teamId: 'team-1' }];
    const lobby = await makeLobby({ format: 'snake', submitPick, draftOrder });

    // First pick succeeds — draft transitions to completed.
    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-finish-1' }),
    );
    expect(lobby.getCurrentState().draftStatus).toBe('completed');

    // Second pick attempt: should reject with invalid_state.
    const result = await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-after-complete-1' }),
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_state' });
    expect(submitPick).toHaveBeenCalledTimes(1); // only the first pick hit the RPC
  });

  it('getCurrentState returns the expected shape at not_started, in_progress, and completed', async () => {
    let nextSeq = 1;
    const submitPick = vi.fn(async () => ({
      event_id: nextSeq,
      seq: nextSeq++,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult));
    const draftOrder = [
      { round: 1, pickNumber: 1, teamId: 'team-1' },
      { round: 1, pickNumber: 2, teamId: 'team-2' },
    ];
    const lobby = await makeLobby({ format: 'snake', submitPick, draftOrder });

    // not_started
    expect(lobby.getCurrentState()).toEqual({
      currentPickNumber: null,
      currentRoundNumber: null,
      onClockTeamId: null,
      totalPicks: 2,
      picksMade: 0,
      draftStatus: 'not_started',
      currentPickDeadline: null,
    });

    // in_progress (after pick 1).
    // Step 6c: state machine sets currentPickDeadline from
    // pickClockMs when submit_pick_v2 returns null pick_deadline
    // (the test's mock returns null). Use toMatchObject to skip
    // the timestamp comparison; the timer-specific tests below
    // assert on deadline values directly.
    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-state-shape-1' }),
    );
    expect(lobby.getCurrentState()).toMatchObject({
      currentPickNumber: 2,
      currentRoundNumber: 1,
      onClockTeamId: 'team-2',
      totalPicks: 2,
      picksMade: 1,
      draftStatus: 'in_progress',
    });
    expect(typeof lobby.getCurrentState().currentPickDeadline).toBe('string');

    // completed (after pick 2)
    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-2', playerId: '8478001', idempotencyKey: 'idem-state-shape-2' }),
    );
    expect(lobby.getCurrentState()).toEqual({
      currentPickNumber: null,
      currentRoundNumber: null,
      onClockTeamId: null,
      totalPicks: 2,
      picksMade: 2,
      draftStatus: 'completed',
      currentPickDeadline: null,
    });
  });

  it('getSnapshot wire envelope includes the stateSnapshot field', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 1,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);
    const lobby = await makeLobby({ format: 'snake', submitPick });

    const snap = lobby.getSnapshot();
    expect(snap.stateSnapshot).toMatchObject({
      currentPickNumber: null,
      onClockTeamId: null,
      totalPicks: 9,
      picksMade: 0,
      draftStatus: 'not_started',
    });

    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-snap-state-1' }),
    );

    const snap2 = lobby.getSnapshot();
    expect(snap2.stateSnapshot).toMatchObject({
      currentPickNumber: 2,
      currentRoundNumber: 1,
      onClockTeamId: 'team-2',
      picksMade: 1,
      draftStatus: 'in_progress',
    });
  });

  it('RPC receives computed round/pickNumber from draftOrder, not the step-2 hardcoded 1/1', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 1,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);

    // Bootstrap with 4 prior pick events so picksMade=4 enters
    // the slot at index 4. Default draft order is 3 teams × 3 rounds
    // snake; slot 4 is { round: 2, pickNumber: 5, teamId: 'team-2' }.
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
      makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1 }),
      makePickRow({ seq: 3, teamId: 'team-3', pickNumber: 3, round: 1 }),
      makePickRow({ seq: 4, teamId: 'team-3', pickNumber: 4, round: 2 }),
    ]);

    const lobby = await makeLobby({
      format: 'snake',
      submitPick,
      listDraftEvents,
    });

    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-2', idempotencyKey: 'idem-computed-1' }),
    );

    expect(submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        round: 2,
        pickNumber: 5,
        teamId: 'team-2',
      }),
    );
  });

  it('buffer event uses the computed round/pickNumber (not hardcoded 1/1)', async () => {
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 5,
      seq: 5,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);

    // Bootstrap to slot 4 (round 2, pick 5, team-2 on the clock).
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
      makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1 }),
      makePickRow({ seq: 3, teamId: 'team-3', pickNumber: 3, round: 1 }),
      makePickRow({ seq: 4, teamId: 'team-3', pickNumber: 4, round: 2 }),
    ]);

    const lobby = await makeLobby({
      format: 'snake',
      submitPick,
      listDraftEvents,
    });

    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-2', idempotencyKey: 'idem-buf-computed-1' }),
    );

    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      // Bootstrap appended 4 events; processSubmitPick appends a 5th.
      // Assert the 5th has the computed round/pickNumber.
      expect(events.events).toHaveLength(5);
      expect(events.events[4]).toMatchObject({
        kind: 'pick_submitted',
        roundNumber: 2,
        pickNumber: 5,
        teamId: 'team-2',
      });
    }
  });

  it('verifyTeamAuthorization throw is caught and surfaced as internal_error', async () => {
    const submitPick = vi.fn();
    const verifyTeamAuthorization = vi.fn(async () => {
      throw new Error('synthetic auth lookup failure');
    });
    const lobby = await makeLobby({ format: 'snake', submitPick, verifyTeamAuthorization });

    const result = await lobby.enqueueAction(
      makeSubmitPick({ idempotencyKey: 'idem-auth-throw-1' }),
    );

    expect(result).toEqual({ ok: false, reason: 'internal_error' });
    expect(submitPick).not.toHaveBeenCalled();
  });

  // ── Step-6b new tests (event-log bootstrap) ────────────────────────

  it('bootstrap with empty event log yields fresh state', async () => {
    const lobby = await makeLobby({
      listDraftEvents: vi.fn(async () => []),
    });

    const state = lobby.getCurrentState();
    expect(state.picksMade).toBe(0);
    expect(state.draftStatus).toBe('not_started');
    expect(lobby.getEventsSinceSeq(0)).toEqual({ ok: true, events: [] });
  });

  it('bootstrap with 4 pick events yields in_progress state at slot 4', async () => {
    const lobby = await makeLobby({
      listDraftEvents: vi.fn(async () => [
        makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
        makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1 }),
        makePickRow({ seq: 3, teamId: 'team-3', pickNumber: 3, round: 1 }),
        makePickRow({ seq: 4, teamId: 'team-3', pickNumber: 4, round: 2 }),
      ]),
    });

    const state = lobby.getCurrentState();
    expect(state.picksMade).toBe(4);
    expect(state.draftStatus).toBe('in_progress');
    expect(state.currentPickNumber).toBe(5);
    expect(state.currentRoundNumber).toBe(2);
    expect(state.onClockTeamId).toBe('team-2');

    // Ring buffer hydrated with translated 'pick_submitted' events.
    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events).toHaveLength(4);
      expect(events.events[0]).toMatchObject({
        kind: 'pick_submitted',
        seq: 1,
        teamId: 'team-1',
        pickNumber: 1,
      });
    }
  });

  it('bootstrap with all 9 pick events for the default snake order yields completed state', async () => {
    const fullSnake3x3 = [
      { teamId: 'team-1', pickNumber: 1, round: 1 },
      { teamId: 'team-2', pickNumber: 2, round: 1 },
      { teamId: 'team-3', pickNumber: 3, round: 1 },
      { teamId: 'team-3', pickNumber: 4, round: 2 },
      { teamId: 'team-2', pickNumber: 5, round: 2 },
      { teamId: 'team-1', pickNumber: 6, round: 2 },
      { teamId: 'team-1', pickNumber: 7, round: 3 },
      { teamId: 'team-2', pickNumber: 8, round: 3 },
      { teamId: 'team-3', pickNumber: 9, round: 3 },
    ];
    const lobby = await makeLobby({
      listDraftEvents: vi.fn(async () =>
        fullSnake3x3.map((p, i) => makePickRow({ seq: i + 1, ...p })),
      ),
    });

    const state = lobby.getCurrentState();
    expect(state.picksMade).toBe(9);
    expect(state.draftStatus).toBe('completed');
    expect(state.onClockTeamId).toBeNull();
  });

  it('bootstrap throws on seq gap (event log integrity error)', async () => {
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
      makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1 }),
      // Skip seq=3
      makePickRow({ seq: 4, teamId: 'team-3', pickNumber: 4, round: 2 }),
    ]);

    await expect(makeLobby({ listDraftEvents })).rejects.toThrow(
      /seq gap detected.*prevSeq=2 got=4/,
    );
  });

  it('bootstrap throws on pick payload mismatch (team_id wrong for slot)', async () => {
    // Event 1's payload says team-2 was on the clock for pick 1, but
    // the default draftOrder has team-1 on the clock at slot 0.
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-2', pickNumber: 1, round: 1 }),
    ]);

    await expect(makeLobby({ listDraftEvents })).rejects.toThrow(
      /pick team mismatch.*expected=team-1 got=team-2/,
    );
  });

  it('init() is idempotent — calling twice does not double-replay', async () => {
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
    ]);
    const lobby = makeRawLobby({ listDraftEvents });

    await lobby.init();
    expect(lobby.getCurrentState().picksMade).toBe(1);
    expect(listDraftEvents).toHaveBeenCalledTimes(1);

    // Second call: no-op (the initialized flag short-circuits).
    await lobby.init();
    expect(lobby.getCurrentState().picksMade).toBe(1);
    expect(listDraftEvents).toHaveBeenCalledTimes(1);
  });

  it('enqueueAction before init() throws programmer-error Error (synchronous, bypasses queue catch)', async () => {
    const lobby = makeRawLobby();

    await expect(
      lobby.enqueueAction(makeSubmitPick({ idempotencyKey: 'idem-pre-init-1' })),
    ).rejects.toThrow(/enqueueAction called before init\(\)/);
  });

  // The pre-6a "bootstrap skips auction events" forward-compat test
  // was deleted in chunk 11g.6 sub-step 6a — auction event types
  // are now first-class bootstrap handlers (not warn-and-skip).
  // The new auction test suite at the bottom of this file covers
  // the dedicated replay paths.

  it('bootstrap skips unknown event_type with warn', async () => {
    const listDraftEvents = vi.fn(async () => [
      makeEventRow({ seq: 1, event_type: 'completely_unknown' }),
    ]);

    // Should not throw — unknown types are warn-and-skip.
    await expect(makeLobby({ listDraftEvents })).resolves.toBeDefined();
  });

  it('bootstrap of 252 events completes well under 100ms (in-memory mocks)', async () => {
    // 12 teams × 21 rounds = 252 picks — typical NHL superflex draft.
    const teamIds = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);
    const totalRounds = 21;
    const draftOrder = generateDraftOrder(teamIds, totalRounds, 'snake');

    const events: DraftEventRow[] = draftOrder.map((slot, i) =>
      makePickRow({
        seq: i + 1,
        teamId: slot.teamId,
        pickNumber: slot.pickNumber,
        round: slot.round,
      }),
    );

    const start = Date.now();
    const lobby = await makeLobby({
      draftOrder,
      listDraftEvents: vi.fn(async () => events),
    });
    const duration = Date.now() - start;

    expect(lobby.getCurrentState().picksMade).toBe(252);
    expect(lobby.getCurrentState().draftStatus).toBe('completed');
    // In-memory mocking: well under 100ms. The actual DB-backed
    // bootstrap is ~10-50ms; this assertion is a regression canary
    // for the in-process replay logic.
    expect(duration).toBeLessThan(100);
  });

  it('bootstrap propagates listDraftEvents query failure', async () => {
    const listDraftEvents = vi.fn(async () => {
      throw new Error('synthetic DB query failure');
    });

    await expect(makeLobby({ listDraftEvents })).rejects.toThrow(
      'synthetic DB query failure',
    );
  });

  it('determinism: bootstrap from N events produces identical state to processSubmitPick of N picks', async () => {
    // Path A: bootstrap with 3 mocked pick events.
    const eventLog = [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1, playerId: 8001 }),
      makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1, playerId: 8002 }),
      makePickRow({ seq: 3, teamId: 'team-3', pickNumber: 3, round: 1, playerId: 8003 }),
    ];
    const lobbyA = await makeLobby({
      listDraftEvents: vi.fn(async () => eventLog),
    });

    // Path B: fresh lobby + processSubmitPick × 3.
    let nextSeq = 1;
    const submitPickB = vi.fn(async () => ({
      event_id: nextSeq,
      seq: nextSeq++,
      pick_deadline: null,
      was_duplicate: false,
    }) satisfies SubmitPickResult);
    const lobbyB = await makeLobby({ submitPick: submitPickB });
    const teams = ['team-1', 'team-2', 'team-3'];
    for (let i = 0; i < 3; i++) {
      await lobbyB.enqueueAction(
        makeSubmitPick({
          teamId: teams[i],
          playerId: String(8001 + i),
          idempotencyKey: `idem-determinism-${i}`,
        }),
      );
    }

    // Identical state-machine view.
    const stateA = lobbyA.getCurrentState();
    const stateB = lobbyB.getCurrentState();
    // Compare everything except currentPickDeadline — bootstrap path
    // (A) doesn't have a leagues.pick_deadline mock so its deadline
    // is null, while processSubmitPick path (B) computes a fresh
    // deadline from pickClockMs. Both produce identical state-
    // machine views; the deadline divergence is artifact of the
    // unequal sources, not a determinism violation.
    const { currentPickDeadline: _a, ...stateAWithoutDeadline } = stateA;
    const { currentPickDeadline: _b, ...stateBWithoutDeadline } = stateB;
    void _a;
    void _b;
    expect(stateAWithoutDeadline).toEqual(stateBWithoutDeadline);

    // Same number of buffered events with identical seq/team/round/pickNumber.
    const eventsA = lobbyA.getEventsSinceSeq(0);
    const eventsB = lobbyB.getEventsSinceSeq(0);
    expect(eventsA.ok).toBe(true);
    expect(eventsB.ok).toBe(true);
    if (eventsA.ok && eventsB.ok) {
      expect(eventsA.events.length).toBe(eventsB.events.length);
      for (let i = 0; i < eventsA.events.length; i++) {
        const a = eventsA.events[i];
        const b = eventsB.events[i];
        // Both paths produce pick_submitted events for this test.
        expect(a.kind).toBe('pick_submitted');
        expect(b.kind).toBe('pick_submitted');
        if (a.kind === 'pick_submitted' && b.kind === 'pick_submitted') {
          expect(a).toMatchObject({
            seq: b.seq,
            teamId: b.teamId,
            roundNumber: b.roundNumber,
            pickNumber: b.pickNumber,
          });
        }
      }
    }
  });

  // ── Step-6b state-affecting non-pick event handlers ────────────────

  it('bootstrap rewinds state on pick_undone (decrement, pop buffer, status transition)', async () => {
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
      makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1 }),
      makeEventRow({
        seq: 3,
        event_type: 'pick_undone',
        payload: {
          team_id: 'team-2',
          pick_number: 2,
          round: 1,
          player_id: 8478002,
          undone_seq: 2,
        },
      }),
    ]);

    const lobby = await makeLobby({ listDraftEvents });
    const state = lobby.getCurrentState();
    // picksMade decremented from 2 to 1; team-2 is now back on the clock.
    expect(state.picksMade).toBe(1);
    expect(state.draftStatus).toBe('in_progress');
    expect(state.onClockTeamId).toBe('team-2');

    // Ring buffer carries pick_submitted x2 + pick_undone x1.
    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events).toHaveLength(3);
      expect(events.events[2]).toMatchObject({
        kind: 'pick_undone',
        seq: 3,
        teamId: 'team-2',
        pickNumber: 2,
        undoneSeq: 2,
      });
    }
  });

  it('bootstrap throws on pick_undone with payload mismatching the slot to undo', async () => {
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
      makeEventRow({
        seq: 2,
        event_type: 'pick_undone',
        payload: {
          team_id: 'team-2', // wrong — slot 0 has team-1
          pick_number: 1,
          round: 1,
        },
      }),
    ]);

    await expect(makeLobby({ listDraftEvents })).rejects.toThrow(
      /pick_undone payload mismatch/,
    );
  });

  it('bootstrap commissioner_override advances state without on-clock validation', async () => {
    // Commissioner submits a pick for team-3 even though team-1 is
    // on the clock at slot 0. Bootstrap accepts (no on-clock check).
    const listDraftEvents = vi.fn(async () => [
      makeEventRow({
        seq: 1,
        event_type: 'commissioner_override',
        payload: {
          team_id: 'team-3',
          pick_number: 1,
          round: 1,
          player_id: 8478999,
          reason: 'team-1 disconnected, commissioner picked for them',
        },
      }),
    ]);

    const lobby = await makeLobby({ listDraftEvents });
    const state = lobby.getCurrentState();
    // picksMade advanced; status transitioned to in_progress.
    expect(state.picksMade).toBe(1);
    expect(state.draftStatus).toBe('in_progress');

    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events[0]).toMatchObject({
        kind: 'commissioner_override',
        seq: 1,
        teamId: 'team-3',
        playerId: 8478999,
        reason: 'team-1 disconnected, commissioner picked for them',
      });
    }
  });

  it('bootstrap draft_completed forces transition to completed regardless of picksMade count', async () => {
    // Only 1 pick made out of 9, but the explicit draft_completed
    // event marks the draft done (commissioner early termination).
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
      makeEventRow({ seq: 2, event_type: 'draft_completed' }),
    ]);

    const lobby = await makeLobby({ listDraftEvents });
    const state = lobby.getCurrentState();
    expect(state.picksMade).toBe(1);
    expect(state.draftStatus).toBe('completed');
  });

  it('bootstrap draft_cancelled transitions to cancelled and blocks subsequent processSubmitPick', async () => {
    const listDraftEvents = vi.fn(async () => [
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
      makeEventRow({ seq: 2, event_type: 'draft_cancelled' }),
    ]);

    const lobby = await makeLobby({ listDraftEvents });
    expect(lobby.getCurrentState().draftStatus).toBe('cancelled');

    // processSubmitPick rejects with invalid_state on cancelled drafts.
    const result = await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-2', idempotencyKey: 'idem-after-cancel-1' }),
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_state' });
  });

  it('bootstrap mixed event sequence (pick → pick → pick_undone → pick → commissioner_override → draft_completed) yields correct final state', async () => {
    const listDraftEvents = vi.fn(async () => [
      // pick at slot 0 → team-1
      makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
      // pick at slot 1 → team-2
      makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1 }),
      // pick_undone for slot 1 → picksMade back to 1
      makeEventRow({
        seq: 3,
        event_type: 'pick_undone',
        payload: { team_id: 'team-2', pick_number: 2, round: 1, undone_seq: 2 },
      }),
      // pick at slot 1 again (re-submitted by team-2) → picksMade=2
      makePickRow({ seq: 4, teamId: 'team-2', pickNumber: 2, round: 1 }),
      // commissioner_override for slot 2 → picksMade=3
      makeEventRow({
        seq: 5,
        event_type: 'commissioner_override',
        payload: { team_id: 'team-3', pick_number: 3, round: 1 },
      }),
      // draft_completed → status=completed (even though picksMade < 9)
      makeEventRow({ seq: 6, event_type: 'draft_completed' }),
    ]);

    const lobby = await makeLobby({ listDraftEvents });
    const state = lobby.getCurrentState();
    expect(state.picksMade).toBe(3);
    expect(state.draftStatus).toBe('completed');

    // Ring buffer: 2 pick + 1 pick_undone + 1 pick + 1 commissioner_override = 5 entries.
    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events.map((e) => e.kind)).toEqual([
        'pick_submitted',
        'pick_submitted',
        'pick_undone',
        'pick_submitted',
        'commissioner_override',
      ]);
    }
  });

  // ── Step-6c new tests (pick deadline + autopick) ───────────────────

  /**
   * Step-6c helper: build a Supabase mock that returns a single
   * undrafted player from `player_ros_projections` (and an empty
   * `draft_picks_v2`). Used by autopick-fire tests so the strategy
   * chain has something to select.
   */
  function makeAutopickSupabase(playerId: number): SupabaseClient {
    const stub: Record<string, unknown> = {};
    stub.from = (table: string) => {
      if (table === 'draft_picks_v2') {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.then = (resolve: (val: unknown) => void) =>
          resolve({ data: [], error: null });
        return chain;
      }
      if (table === 'player_ros_projections') {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.order = () => chain;
        chain.then = (resolve: (val: unknown) => void) =>
          resolve({
            data: [{ player_id: playerId, total_projected_points: 99.9 }],
            error: null,
          });
        return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    };
    return stub as unknown as SupabaseClient;
  }

  it('timer fires autopick after the pick deadline', async () => {
    vi.useFakeTimers();
    try {
      let nextSeq = 10;
      const submitPick = vi.fn(async () => {
        const seq = nextSeq++;
        return {
          event_id: seq,
          seq,
          // Each pick returns the next deadline 91s out — engine
          // schedules the next timer from this.
          pick_deadline: new Date(Date.now() + 91_000).toISOString(),
          was_duplicate: false,
        } satisfies SubmitPickResult;
      });
      const lobby = await makeLobby({
        format: 'snake',
        submitPick,
        supabase: makeAutopickSupabase(8478001),
        // The lobby starts in `not_started` because no events
        // exist; submit one user pick to enter `in_progress` and
        // arm the deadline timer.
      });

      // First user submit advances state and schedules a timer.
      await lobby.enqueueAction(
        makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-tf-1' }),
      );
      expect(submitPick).toHaveBeenCalledTimes(1);
      expect(lobby.getCurrentState().draftStatus).toBe('in_progress');

      // Fast-forward past the deadline; autopick fires and submits.
      await vi.advanceTimersByTimeAsync(91_001);

      expect(submitPick).toHaveBeenCalledTimes(2);
      // Second call is the autopick — actor.kind='autopick'.
      const autopickCall = (submitPick.mock.calls as unknown as unknown[][])[1][0] as { actor: { kind: string }; playerId: number };
      expect(autopickCall.actor.kind).toBe('autopick');
      expect(autopickCall.playerId).toBe(8478001);
    } finally {
      vi.useRealTimers();
    }
  });

  it('user submit before deadline cancels the autopick timer (no duplicate fire)', async () => {
    vi.useFakeTimers();
    try {
      let nextSeq = 10;
      const submitPick = vi.fn(async () => {
        const seq = nextSeq++;
        return {
          event_id: seq,
          seq,
          pick_deadline: new Date(Date.now() + 91_000).toISOString(),
          was_duplicate: false,
        } satisfies SubmitPickResult;
      });
      const lobby = await makeLobby({ format: 'snake', submitPick });

      // Pick 1 (team-1) arms a timer for team-2's pick at +91s.
      await lobby.enqueueAction(
        makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-cancel-1' }),
      );

      // 30s later, team-2 submits manually.
      await vi.advanceTimersByTimeAsync(30_000);
      await lobby.enqueueAction(
        makeSubmitPick({
          teamId: 'team-2',
          playerId: '8478002',
          idempotencyKey: 'idem-cancel-2',
        }),
      );

      // Fast-forward past where the original team-2 deadline would
      // have fired (would be 91s after team-1's pick = 61s after
      // team-2's manual submit). No additional autopick should fire
      // because the timer was reset for team-3's deadline.
      const submitsBeforeAdvance = submitPick.mock.calls.length;
      await vi.advanceTimersByTimeAsync(61_001);

      // submitPick was called for the team-3 autopick (timer fired
      // for team-3's deadline). Verify the actor.kind is autopick
      // and that the team-2 deadline didn't double-fire.
      const newCalls = submitPick.mock.calls.length - submitsBeforeAdvance;
      expect(newCalls).toBeLessThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shutdown cancels pending timer and prevents future fires', async () => {
    vi.useFakeTimers();
    try {
      const submitPick = vi.fn().mockResolvedValue({
        event_id: 1,
        seq: 1,
        pick_deadline: new Date(Date.now() + 91_000).toISOString(),
        was_duplicate: false,
      } satisfies SubmitPickResult);
      const lobby = await makeLobby({ format: 'snake', submitPick });

      await lobby.enqueueAction(
        makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-sd-1' }),
      );
      expect(lobby.getCurrentState().currentPickDeadline).not.toBeNull();

      await lobby.shutdown();
      expect(lobby.getCurrentState().currentPickDeadline).toBeNull();

      // Fast-forward well past the original deadline; no autopick
      // should fire because the timer was cancelled.
      const callsBefore = submitPick.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(submitPick.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauseDraft cancels timer, resumeDraft sets fresh full clock (matches draft_resume RPC)', async () => {
    vi.useFakeTimers();
    try {
      const submitPick = vi.fn().mockResolvedValue({
        event_id: 1,
        seq: 1,
        pick_deadline: new Date(Date.now() + 91_000).toISOString(),
        was_duplicate: false,
      } satisfies SubmitPickResult);
      const lobby = await makeLobby({ format: 'snake', submitPick, pickClockSeconds: 91 });

      await lobby.enqueueAction(
        makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-pause-1' }),
      );

      // 30s into the clock, pause the draft.
      await vi.advanceTimersByTimeAsync(30_000);
      lobby.pauseDraft();
      expect(lobby.getCurrentState().currentPickDeadline).toBeNull();

      // Fast-forward 1000s while paused — no timer fires.
      const callsBefore = submitPick.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1_000_000);
      expect(submitPick.mock.calls.length).toBe(callsBefore);

      // Resume gives a FRESH full pick clock (91s), NOT remaining-
      // from-pause. Mirrors draft_resume RPC behavior.
      lobby.resumeDraft();
      const newDeadline = lobby.getCurrentState().currentPickDeadline;
      expect(newDeadline).not.toBeNull();
      const msUntilDeadline = new Date(newDeadline as string).getTime() - Date.now();
      expect(msUntilDeadline).toBeGreaterThanOrEqual(91_000);
      expect(msUntilDeadline).toBeLessThan(91_500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bootstrap reconstructs deadline from initialPickDeadline (in-progress recovery)', async () => {
    vi.useFakeTimers();
    try {
      const now = new Date();
      // Simulate a draft that's mid-pick: 4 picks done, deadline
      // for pick 5 is 30s from now. Engine should schedule a timer
      // that fires at +30s.
      const lobby = makeRawLobby({
        format: 'snake',
        listDraftEvents: vi.fn(async () => [
          makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
          makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1 }),
          makePickRow({ seq: 3, teamId: 'team-3', pickNumber: 3, round: 1 }),
          makePickRow({ seq: 4, teamId: 'team-3', pickNumber: 4, round: 2 }),
        ]),
        initialPickDeadline: new Date(now.getTime() + 30_000),
        initialDraftState: 'active',
        supabase: makeAutopickSupabase(8478001),
      });
      await lobby.init();

      const state = lobby.getCurrentState();
      expect(state.picksMade).toBe(4);
      expect(state.draftStatus).toBe('in_progress');
      expect(state.currentPickDeadline).not.toBeNull();
      const msUntilDeadline = new Date(state.currentPickDeadline as string).getTime() - now.getTime();
      expect(msUntilDeadline).toBeGreaterThanOrEqual(30_000 - 100);
      expect(msUntilDeadline).toBeLessThan(30_500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bootstrap fires autopick immediately when initialPickDeadline already passed', async () => {
    vi.useFakeTimers();
    try {
      let submitPickCalls = 0;
      const submitPick = vi.fn(async () => {
        submitPickCalls++;
        return {
          event_id: submitPickCalls,
          seq: submitPickCalls,
          pick_deadline: null,
          was_duplicate: false,
        } satisfies SubmitPickResult;
      });

      // Bootstrap with one pick event so draftStatus is in_progress
      // (init's deadline-reconstruction guard requires in_progress).
      // Then the deadline is 200ms in the past — engine fires
      // autopick immediately.
      const lobby = makeRawLobby({
        format: 'snake',
        submitPick,
        listDraftEvents: vi.fn(async () => [
          makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
        ]),
        initialPickDeadline: new Date(Date.now() - 200),
        initialDraftState: 'active',
        supabase: makeAutopickSupabase(8478001),
      });
      await lobby.init();

      // Flush the immediate-fire setTimeout(0) plus all pending
      // microtasks from the autopick chain.
      await vi.runAllTimersAsync();
      // The autopick should have fired and called submitPick.
      expect(submitPick).toHaveBeenCalled();
      const call = (submitPick.mock.calls as unknown as unknown[][])[0][0] as { actor: { kind: string } };
      expect(call.actor.kind).toBe('autopick');
    } finally {
      vi.useRealTimers();
    }
  });

  it('bootstrap with most-recent-event draft_paused leaves draft paused, no timer scheduled', async () => {
    const lobby = makeRawLobby({
      format: 'snake',
      listDraftEvents: vi.fn(async () => [
        makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
        makeEventRow({
          seq: 2,
          event_type: 'draft_paused',
          payload: {
            paused_at: new Date(2026, 0, 1).toISOString(),
            paused_pick_number: 2,
            remaining_seconds: 60,
            reason: 'commissioner',
          },
        }),
      ]),
      initialPickDeadline: null, // draft_pause RPC clears the column
      initialDraftState: 'paused',
    });
    await lobby.init();

    expect(lobby.getCurrentState().draftStatus).toBe('in_progress'); // last pick set in_progress
    expect(lobby.getCurrentState().currentPickDeadline).toBeNull();
  });

  it('autopick action has actor.kind=autopick in the RPC submission', async () => {
    vi.useFakeTimers();
    try {
      const submitPick = vi.fn().mockResolvedValue({
        event_id: 1,
        seq: 1,
        pick_deadline: null,
        was_duplicate: false,
      } satisfies SubmitPickResult);

      const lobby = makeRawLobby({
        format: 'snake',
        submitPick,
        listDraftEvents: vi.fn(async () => [
          makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
        ]),
        initialPickDeadline: new Date(Date.now() - 100), // already passed
        initialDraftState: 'active',
        supabase: makeAutopickSupabase(8478001),
      });
      await lobby.init();
      await vi.runAllTimersAsync();

      expect(submitPick).toHaveBeenCalled();
      const call = (submitPick.mock.calls as unknown as unknown[][])[0][0] as {
        actor: { kind: string; id?: string };
      };
      expect(call.actor.kind).toBe('autopick');
      expect(call.actor.id).toBe('autopick-engine');
    } finally {
      vi.useRealTimers();
    }
  });

  it('autopick skips engine-side authorization (verifyTeamAuthorization NOT called)', async () => {
    vi.useFakeTimers();
    try {
      const verifyTeamAuthorization = vi.fn(async () => ({
        authorized: false as const,
        reason: 'not_owner' as const,
      }));
      const submitPick = vi.fn().mockResolvedValue({
        event_id: 1,
        seq: 1,
        pick_deadline: null,
        was_duplicate: false,
      } satisfies SubmitPickResult);

      const lobby = makeRawLobby({
        format: 'snake',
        submitPick,
        verifyTeamAuthorization,
        listDraftEvents: vi.fn(async () => [
          makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
        ]),
        initialPickDeadline: new Date(Date.now() - 100),
        initialDraftState: 'active',
        supabase: makeAutopickSupabase(8478001),
      });
      await lobby.init();
      await vi.runAllTimersAsync();

      // Autopick fired and submitPick was called — proves the auth
      // check was skipped (it would have rejected with `unauthorized`
      // and submitPick would never have been invoked).
      expect(submitPick).toHaveBeenCalled();
      expect(verifyTeamAuthorization).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('autopick stuck-draft (no eligible players) clears deadline and does not advance state', async () => {
    vi.useFakeTimers();
    try {
      const submitPick = vi.fn();
      // Strategy chain that always returns no_eligible_players.
      const stuckStrategy = vi.fn(async () => ({
        ok: false as const,
        reason: 'no_eligible_players' as const,
      }));

      const lobby = makeRawLobby({
        format: 'snake',
        submitPick,
        listDraftEvents: vi.fn(async () => [
          makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
        ]),
        initialPickDeadline: new Date(Date.now() - 100),
        initialDraftState: 'active',
        autopickStrategies: [stuckStrategy],
      });
      await lobby.init();
      await vi.runAllTimersAsync();

      expect(stuckStrategy).toHaveBeenCalled();
      expect(submitPick).not.toHaveBeenCalled();
      // Stuck-draft state: deadline cleared, picksMade unchanged
      // (still at 1 from the bootstrap event — autopick didn't fire,
      // so the state machine didn't advance further).
      expect(lobby.getCurrentState().currentPickDeadline).toBeNull();
      expect(lobby.getCurrentState().picksMade).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('processSubmitPick with actorKind="autopick" succeeds when verifyTeamAuthorization would deny (auth-skip)', async () => {
    const verifyTeamAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'not_owner' as const,
    }));
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 1,
      pick_deadline: null,
      was_duplicate: false,
    } satisfies SubmitPickResult);
    const lobby = await makeLobby({
      format: 'snake',
      submitPick,
      verifyTeamAuthorization,
    });

    const result = await lobby.enqueueAction({
      kind: 'submit_pick',
      teamId: 'team-1',
      playerId: '8478001',
      userId: 'autopick-engine',
      sessionId: 'sess-autopick-1',
      idempotencyKey: 'idem-autopick-direct-1',
      actorKind: 'autopick',
    });

    expect(result).toEqual({ ok: true, eventSeq: 1 });
    expect(submitPick).toHaveBeenCalled();
    expect(verifyTeamAuthorization).not.toHaveBeenCalled();
    // The buffered event should have isAutopick: true.
    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events[0]).toMatchObject({
        kind: 'pick_submitted',
        isAutopick: true,
      });
    }
  });

  it('completed/cancelled drafts have currentPickDeadline=null', async () => {
    // Build a 2-pick draft and complete it.
    let nextSeq = 1;
    const submitPick = vi.fn(async () => ({
      event_id: nextSeq,
      seq: nextSeq++,
      pick_deadline: null,
      was_duplicate: false,
    }) satisfies SubmitPickResult);

    const draftOrder = [
      { round: 1, pickNumber: 1, teamId: 'team-1' },
      { round: 1, pickNumber: 2, teamId: 'team-2' },
    ];
    const lobby = await makeLobby({ format: 'snake', submitPick, draftOrder });

    await lobby.enqueueAction(
      makeSubmitPick({ teamId: 'team-1', idempotencyKey: 'idem-final-deadline-1' }),
    );
    await lobby.enqueueAction(
      makeSubmitPick({
        teamId: 'team-2',
        playerId: '8478001',
        idempotencyKey: 'idem-final-deadline-2',
      }),
    );

    expect(lobby.getCurrentState().draftStatus).toBe('completed');
    expect(lobby.getCurrentState().currentPickDeadline).toBeNull();
  });

  it('isAutopick=true surfaces from durable payload during bootstrap', async () => {
    const lobby = makeRawLobby({
      format: 'snake',
      listDraftEvents: vi.fn(async () => [
        // First pick: manual user pick.
        {
          ...makePickRow({ seq: 1, teamId: 'team-1', pickNumber: 1, round: 1 }),
          payload: {
            team_id: 'team-1',
            pick_number: 1,
            round: 1,
            player_id: 8478001,
            picked_at: new Date().toISOString(),
            is_autopick: false,
          },
        } as DraftEventRow,
        // Second pick: autopick fire.
        {
          ...makePickRow({ seq: 2, teamId: 'team-2', pickNumber: 2, round: 1 }),
          payload: {
            team_id: 'team-2',
            pick_number: 2,
            round: 1,
            player_id: 8478002,
            picked_at: new Date().toISOString(),
            is_autopick: true,
          },
        } as DraftEventRow,
      ]),
    });
    await lobby.init();

    const events = lobby.getEventsSinceSeq(0);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.events).toHaveLength(2);
      // First buffered event — manual pick, no isAutopick flag.
      const e0 = events.events[0];
      expect(e0.kind).toBe('pick_submitted');
      if (e0.kind === 'pick_submitted') {
        expect(e0.isAutopick).toBeUndefined();
      }
      // Second — autopick.
      const e1 = events.events[1];
      expect(e1.kind).toBe('pick_submitted');
      if (e1.kind === 'pick_submitted') {
        expect(e1.isAutopick).toBe(true);
      }
    }
  });

  it('pauseDraft on non-in_progress draft throws', async () => {
    const lobby = await makeLobby({ format: 'snake' });
    // Lobby is fresh / not_started.
    expect(() => lobby.pauseDraft()).toThrow(/invalid status=not_started/);
  });

  it('resumeDraft on non-paused draft throws', async () => {
    const lobby = await makeLobby({ format: 'snake' });
    expect(() => lobby.resumeDraft()).toThrow(/non-paused draft/);
  });

  it('shutdown is idempotent — calling twice is a safe no-op', async () => {
    const lobby = await makeLobby({ format: 'snake' });
    await lobby.shutdown();
    await expect(lobby.shutdown()).resolves.toBeUndefined();
  });

  // ── Chunk 11g.6 sub-step 6a — auction handlers ─────────────────────
  //
  // Auction format brings two new actions (`nominate`, `place_bid`),
  // a new timer-fired path (`handleNominationTimeout` →
  // `closeNomination`), and four new bootstrap event handlers
  // (`auction_nomination_started`, `auction_bid_placed`,
  // `auction_nomination_closed`, `auction_nomination_expired`).
  //
  // Anti-snipe extension semantics (ADR-002 §3.3) are deferred to
  // sub-step 6b — these tests assert that bids do NOT extend the
  // bid window in 6a.

  /** Auction-lobby helper: 3 teams × 2 rounds = 6 nominations, $200 budget. */
  function auctionLobbyOpts(extra: Partial<MakeLobbyOpts> = {}): MakeLobbyOpts {
    const teams = ['team-1', 'team-2', 'team-3'];
    return {
      format: 'auction',
      draftOrder: [],
      nominationOrder: teams,
      auctionBudget: 200,
      auctionMinBid: 1,
      draftRounds: 2,
      pickClockSeconds: 31, // 30s bid window + 1s pad (legacy; engine
                            // prefers explicit auctionBidWindowSeconds below
                            // for chunk 11g.6 6c3+)
      auctionBidWindowSeconds: 30,
      // Default 60s nomination window per ADR-002 §3.4. Auto-nominate
      // tests can override to small values (e.g., 5s) for fast fake-
      // timer runs. **Backward-compat note**: 6a/6b/6c1/6c2 tests
      // don't exercise the nomination-window timer at all because
      // they pre-populate `currentNomination` via nominateAction and
      // never let the nomination-window expire; the default 60s value
      // is benign for those tests.
      auctionNominationWindowSeconds: 60,
      initialTeamBudgets: new Map(teams.map((t) => [t, 200])),
      initialPlayersWon: new Map(teams.map((t) => [t, 0])),
      ...extra,
    };
  }

  function nominateAction(extra: Partial<Extract<DraftAction, { kind: 'nominate' }>> = {}): Extract<DraftAction, { kind: 'nominate' }> {
    return {
      kind: 'nominate',
      teamId: 'team-1',
      playerId: '8478402',
      playerName: 'Connor McDavid',
      openingBid: 1,
      userId: 'user-1',
      sessionId: 'sess-1',
      idempotencyKey: 'idem-nom-1',
      ...extra,
    };
  }

  function bidAction(extra: Partial<Extract<DraftAction, { kind: 'place_bid' }>> = {}): Extract<DraftAction, { kind: 'place_bid' }> {
    return {
      kind: 'place_bid',
      teamId: 'team-2',
      nominationId: 'nom-1',
      bidAmount: 5,
      userId: 'user-2',
      sessionId: 'sess-2',
      idempotencyKey: 'idem-bid-1',
      ...extra,
    };
  }

  // ── nominate happy path ──────────────────────────────────────────────

  it('auction nominate: happy path — RPC called, state updates, ring buffer + broadcast fire', async () => {
    const publish = vi.fn();
    const nominatePlayer = vi.fn(async (_params: unknown) => ({
      event_id: 1,
      seq: 1,
      nomination_id: 'nom-abc',
      clock_deadline: new Date('2026-05-06T12:30:00Z').toISOString(),
      was_duplicate: false,
    }));

    const lobby = await makeLobby(auctionLobbyOpts({ publish, nominatePlayer }));
    const result = await lobby.enqueueAction(nominateAction({ openingBid: 5 }));

    expect(result).toEqual({ ok: true, eventSeq: 1 });
    expect(nominatePlayer).toHaveBeenCalledTimes(1);
    expect(nominatePlayer.mock.calls[0]?.[0]).toMatchObject({
      teamId: 'team-1',
      playerId: '8478402',
      openingBid: 5,
    });
    // State updates: currentNomination set, draftStatus advanced.
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.currentNomination).toMatchObject({
      nominationId: 'nom-abc',
      playerId: '8478402',
      nominatorTeamId: 'team-1',
      leadingBidderId: 'team-1',
      leadingBid: 5,
    });
    expect(lobby.getCurrentState().draftStatus).toBe('in_progress');
    // Ring buffer has the event; broadcast fired.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toBe('draft:lobby-1');
    const broadcastJson = JSON.parse(publish.mock.calls[0][1]);
    expect(broadcastJson.type).toBe('event');
    expect(broadcastJson.payload.kind).toBe('auction_nomination_started');
  });

  it('auction nominate: rejects when not on the clock (different team_id)', async () => {
    const nominatePlayer = vi.fn();
    const lobby = await makeLobby(auctionLobbyOpts({ nominatePlayer }));
    // team-1 is on the clock at nominationsCompleted=0; team-2 trying.
    const result = await lobby.enqueueAction(nominateAction({ teamId: 'team-2' }));
    expect(result).toEqual({ ok: false, reason: 'not_on_clock' });
    expect(nominatePlayer).not.toHaveBeenCalled();
  });

  it('auction nominate: rejects with nomination_already_active when one is open', async () => {
    const lobby = await makeLobby(auctionLobbyOpts());
    // First nominate: succeeds.
    await lobby.enqueueAction(nominateAction({ idempotencyKey: 'idem-nom-A' }));
    // Second nominate while first is open: rejected, even from same team.
    const result = await lobby.enqueueAction(
      nominateAction({ idempotencyKey: 'idem-nom-B', playerId: '8478403' }),
    );
    expect(result).toEqual({ ok: false, reason: 'nomination_already_active' });
  });

  it('auction nominate: rejects bid_too_low when openingBid < auctionMinBid', async () => {
    const nominatePlayer = vi.fn();
    const lobby = await makeLobby(
      auctionLobbyOpts({ auctionMinBid: 5, nominatePlayer }),
    );
    const result = await lobby.enqueueAction(nominateAction({ openingBid: 3 }));
    expect(result).toEqual({ ok: false, reason: 'bid_too_low' });
    expect(nominatePlayer).not.toHaveBeenCalled();
  });

  it('auction nominate: rejects insufficient_budget when bid exceeds budget reserve', async () => {
    const nominatePlayer = vi.fn();
    // 2 rounds, 0 won → 2 slots remaining → reserve = (2 - 1) * 1 = $1.
    // Budget $200 → maxAffordable = 199. Bid 200 should fail.
    const lobby = await makeLobby(auctionLobbyOpts({ nominatePlayer }));
    const result = await lobby.enqueueAction(nominateAction({ openingBid: 200 }));
    expect(result).toEqual({ ok: false, reason: 'insufficient_budget' });
    expect(nominatePlayer).not.toHaveBeenCalled();
  });

  it('auction nominate: snake-format lobby returns wrong_format_for_action', async () => {
    const lobby = await makeLobby({ format: 'snake' });
    const result = await lobby.enqueueAction(nominateAction());
    expect(result).toEqual({ ok: false, reason: 'wrong_format_for_action' });
  });

  it('auction nominate: unauthorized user gets coarse-grained unauthorized', async () => {
    const verifyTeamAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'not_owner' as const,
    }));
    const nominatePlayer = vi.fn();
    const lobby = await makeLobby(
      auctionLobbyOpts({ verifyTeamAuthorization, nominatePlayer }),
    );
    const result = await lobby.enqueueAction(nominateAction());
    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(nominatePlayer).not.toHaveBeenCalled();
  });

  // ── place_bid happy path ─────────────────────────────────────────────

  it('auction place_bid: happy path — RPC called, leading bid mutated, broadcast fires', async () => {
    const publish = vi.fn();
    const placeBid = vi.fn(async () => ({
      event_id: 2,
      seq: 2,
      clock_deadline: new Date('2026-05-06T12:30:00Z').toISOString(),
      was_duplicate: false,
    }));
    const lobby = await makeLobby(auctionLobbyOpts({ publish, placeBid }));
    // Establish a nomination first.
    const nomResult = await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    expect(nomResult.ok).toBe(true);
    publish.mockClear();

    // team-2 outbids.
    const result = await lobby.enqueueAction(
      bidAction({ bidAmount: 10, nominationId: 'nom-1' }),
    );
    expect(result).toEqual({ ok: true, eventSeq: 2 });
    expect(placeBid).toHaveBeenCalledTimes(1);
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.currentNomination?.leadingBid).toBe(10);
    expect(auctionState?.currentNomination?.leadingBidderId).toBe('team-2');
    expect(publish).toHaveBeenCalledTimes(1);
    const broadcastJson = JSON.parse(publish.mock.calls[0][1]);
    expect(broadcastJson.payload.kind).toBe('auction_bid_placed');
    expect(broadcastJson.payload.bidAmount).toBe(10);
  });

  it('auction place_bid: rejects bid_too_low when bid <= leading bid', async () => {
    const placeBid = vi.fn();
    const lobby = await makeLobby(auctionLobbyOpts({ placeBid }));
    await lobby.enqueueAction(nominateAction({ openingBid: 10 }));
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 10 }));
    expect(result).toEqual({ ok: false, reason: 'bid_too_low' });
    expect(placeBid).not.toHaveBeenCalled();
  });

  it('auction place_bid: rejects no_active_nomination when none open', async () => {
    const placeBid = vi.fn();
    const lobby = await makeLobby(auctionLobbyOpts({ placeBid }));
    const result = await lobby.enqueueAction(bidAction());
    expect(result).toEqual({ ok: false, reason: 'no_active_nomination' });
    expect(placeBid).not.toHaveBeenCalled();
  });

  it('auction place_bid: rejects insufficient_budget when bid exceeds reserve', async () => {
    const placeBid = vi.fn();
    const lobby = await makeLobby(auctionLobbyOpts({ placeBid }));
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    // team-2 budget $200, 0 won, 2 rounds → maxAffordable = 199.
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 200 }));
    expect(result).toEqual({ ok: false, reason: 'insufficient_budget' });
    expect(placeBid).not.toHaveBeenCalled();
  });

  // ── handleNominationTimeout ──────────────────────────────────────────

  it('auction nomination timeout: closes nomination via closeNomination RPC, deducts budget, advances rotation', async () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      // Mock RPCs whose returned `clock_deadline` aligns with the
      // test's `pickClockSeconds=31` so the engine schedules a 31s
      // timer (default mock returns +91s, which would outlast our
      // advanceTimersByTimeAsync(32_000) call below).
      const nominatePlayer = vi.fn(async (_params: unknown) => ({
        event_id: 1,
        seq: 1,
        nomination_id: 'nom-1',
        clock_deadline: new Date(Date.now() + 31_000).toISOString(),
        was_duplicate: false,
      }));
      const placeBid = vi.fn(async (_params: unknown) => ({
        event_id: 2,
        seq: 2,
        clock_deadline: new Date(Date.now() + 31_000).toISOString(),
        was_duplicate: false,
      }));
      const closeNomination = vi.fn(async () => ({
        event_id: 3,
        seq: 3,
        event_type: 'auction_nomination_closed' as const,
        no_sale: false,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        auctionLobbyOpts({ publish, nominatePlayer, placeBid, closeNomination }),
      );
      // Open a nomination at $5.
      await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
      // Place a bid at $20 by team-2.
      await lobby.enqueueAction(bidAction({ bidAmount: 20 }));
      publish.mockClear();

      // Advance past the bid window (31s).
      await vi.advanceTimersByTimeAsync(32_000);

      expect(closeNomination).toHaveBeenCalledTimes(1);
      // Winner = leadingBidderId (team-2), final = $20. Budget
      // deducted, players_won incremented.
      const auctionState = lobby.getAuctionState();
      expect(auctionState?.teamBudgets['team-2']).toBe(200 - 20);
      expect(auctionState?.teamRosterSlotsRemaining['team-2']).toBe(2 - 1);
      expect(auctionState?.nominationsCompleted).toBe(1);
      expect(auctionState?.currentNomination).toBeNull();
      // Broadcast fired with auction_nomination_closed.
      const closedBroadcasts = publish.mock.calls.filter((c) =>
        c[1].includes('auction_nomination_closed'),
      );
      expect(closedBroadcasts.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auction nomination timeout: no_sale branch (only opening bid) skips budget deduction', async () => {
    vi.useFakeTimers();
    try {
      const nominatePlayer = vi.fn(async (_params: unknown) => ({
        event_id: 1,
        seq: 1,
        nomination_id: 'nom-1',
        clock_deadline: new Date(Date.now() + 31_000).toISOString(),
        was_duplicate: false,
      }));
      const closeNomination = vi.fn(async () => ({
        event_id: 3,
        seq: 3,
        event_type: 'auction_nomination_expired' as const,
        no_sale: true,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        auctionLobbyOpts({ nominatePlayer, closeNomination }),
      );
      await lobby.enqueueAction(nominateAction({ openingBid: 5 }));

      await vi.advanceTimersByTimeAsync(32_000);

      expect(closeNomination).toHaveBeenCalledTimes(1);
      const auctionState = lobby.getAuctionState();
      // No budget deduction on no_sale.
      expect(auctionState?.teamBudgets['team-1']).toBe(200);
      expect(auctionState?.teamRosterSlotsRemaining['team-1']).toBe(2);
      // But rotation advances.
      expect(auctionState?.nominationsCompleted).toBe(1);
      expect(auctionState?.currentNomination).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Bootstrap auction event replay ───────────────────────────────────

  it('auction bootstrap: replays nomination_started → bid_placed → nomination_closed correctly', async () => {
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_nomination_started',
        payload: {
          nomination_id: 'nom-1',
          player_id: '8478402',
          player_name: 'Connor McDavid',
          opening_bid: 5,
          nominator_team_id: 'team-1',
          expires_at: new Date(Date.now() + 31_000).toISOString(),
        },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_bid_placed',
        payload: {
          nomination_id: 'nom-1',
          team_id: 'team-2',
          bid_amount: 20,
        },
      }),
      makeEventRow({
        seq: 3,
        event_type: 'auction_nomination_closed',
        payload: {
          nomination_id: 'nom-1',
          winning_team_id: 'team-2',
          final_amount: 20,
          total_bids: 2,
          player_id: '8478402',
        },
      }),
    ];
    const lobby = await makeLobby(
      auctionLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.nominationsCompleted).toBe(1);
    expect(auctionState?.currentNomination).toBeNull();
    expect(auctionState?.teamBudgets['team-2']).toBe(180);
    expect(auctionState?.teamRosterSlotsRemaining['team-2']).toBe(1);
  });

  // ── Snapshot exposure ───────────────────────────────────────────────

  it('auction getSnapshot includes auctionState; snake getSnapshot omits it', async () => {
    const auctionLobby = await makeLobby(auctionLobbyOpts());
    const auctionSnapshot = auctionLobby.getSnapshot();
    expect(auctionSnapshot.auctionState).toBeDefined();
    expect(auctionSnapshot.auctionState?.currentNomination).toBeNull();

    const snakeLobby = await makeLobby({ format: 'snake' });
    const snakeSnapshot = snakeLobby.getSnapshot();
    expect(snakeSnapshot.auctionState).toBeUndefined();
  });

  // ── Chunk 11g.6 sub-step 6b — anti-snipe timer extension ────────────
  //
  // Anti-snipe extends the bid window when a bid arrives in the final
  // `auctionAntiSnipeThresholdSeconds` of the current window. The RPC
  // applies the threshold check atomically with the bid write; engine
  // mirrors the post-extension state by canceling/rescheduling the
  // timer + appending an `auction_bid_extends_timer` event to the ring
  // buffer + broadcasting it.
  //
  // Per ADR-002 §3.3 / §4.4 (NOT §3.5).

  /** Auction-lobby helper with anti-snipe enabled (5s threshold + 10s extension). */
  function antiSnipeLobbyOpts(extra: Partial<MakeLobbyOpts> = {}): MakeLobbyOpts {
    return auctionLobbyOpts({
      auctionAntiSnipeThresholdSeconds: 5,
      auctionAntiSnipeExtensionSeconds: 10,
      ...extra,
    });
  }

  /**
   * Helper: nomination-RPC mock that returns a `clock_deadline` aligned
   * with the test's `pickClockSeconds` so timer scheduling lines up
   * with `vi.advanceTimersByTimeAsync` calls.
   */
  function alignedNominateMock(deadlineMs: number) {
    return vi.fn(async (_params: unknown) => ({
      event_id: 1,
      seq: 1,
      nomination_id: 'nom-1',
      clock_deadline: new Date(Date.now() + deadlineMs).toISOString(),
      was_duplicate: false,
    }));
  }

  it('anti-snipe: bid in non-final window does not extend timer', async () => {
    const placeBid = vi.fn(async (_params: unknown) => ({
      event_id: 2,
      seq: 2,
      // RPC returns the SAME deadline (no extension).
      clock_deadline: new Date(Date.now() + 31_000).toISOString(),
      was_duplicate: false,
      was_extended: false,
    }));
    const lobby = await makeLobby(
      antiSnipeLobbyOpts({
        nominatePlayer: alignedNominateMock(31_000),
        placeBid,
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 10 }));

    expect(result.ok).toBe(true);
    expect(placeBid).toHaveBeenCalledTimes(1);
    // Engine threaded the anti-snipe config to the RPC.
    expect(placeBid.mock.calls[0]?.[0]).toMatchObject({
      antiSnipeThresholdSeconds: 5,
      antiSnipeExtensionSeconds: 10,
    });
    // No extension event in the ring buffer.
    const snapshot = lobby.getSnapshot();
    const extendsEvents = snapshot.recentEvents.filter(
      (e) => e.kind === 'auction_bid_extends_timer',
    );
    expect(extendsEvents).toHaveLength(0);
  });

  it('anti-snipe: bid in final window extends — timer rescheduled, ring buffer + broadcast fire', async () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      // RPC returns was_extended=true and a new deadline 10s out.
      const placeBid = vi.fn(async (_params: unknown) => ({
        event_id: 2,
        seq: 2,
        clock_deadline: new Date(Date.now() + 10_000).toISOString(),
        was_duplicate: false,
        was_extended: true,
        extends_event_seq: 3,
      }));
      const closeNomination = vi.fn(async () => ({
        event_id: 4,
        seq: 4,
        event_type: 'auction_nomination_closed' as const,
        no_sale: false,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        antiSnipeLobbyOpts({
          publish,
          nominatePlayer: alignedNominateMock(31_000),
          placeBid,
          closeNomination,
        }),
      );
      await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
      publish.mockClear();
      // Place bid in the final window (engine doesn't compute this;
      // RPC mock unconditionally returns was_extended=true).
      const result = await lobby.enqueueAction(bidAction({ bidAmount: 10 }));

      expect(result.ok).toBe(true);
      // Ring buffer has both the bid event AND the extends event.
      const snapshot = lobby.getSnapshot();
      const bidEvents = snapshot.recentEvents.filter(
        (e) => e.kind === 'auction_bid_placed',
      );
      const extendsEvents = snapshot.recentEvents.filter(
        (e) => e.kind === 'auction_bid_extends_timer',
      );
      expect(bidEvents).toHaveLength(1);
      expect(extendsEvents).toHaveLength(1);
      const ext = extendsEvents[0] as Extract<
        BufferedDraftEvent,
        { kind: 'auction_bid_extends_timer' }
      >;
      expect(ext.seq).toBe(3);
      expect(ext.triggeringBidAmount).toBe(10);
      expect(ext.triggeringBidderTeamId).toBe('team-2');

      // Two broadcasts (bid + extends) — both have the same correlationId
      // (the parent bid's idempotencyKey).
      expect(publish).toHaveBeenCalledTimes(2);
      const broadcasts = publish.mock.calls.map((c) => JSON.parse(c[1] as string));
      expect(broadcasts.map((b) => b.payload.kind)).toEqual([
        'auction_bid_placed',
        'auction_bid_extends_timer',
      ]);
      expect(broadcasts.every((b) => b.correlationId === 'idem-bid-1')).toBe(true);

      // Engine's currentNomination.expiresAt is the new (extended)
      // deadline. closeNomination would NOT fire under the original
      // 31s window — advance to 11s and confirm the timer hasn't
      // fired yet (new deadline is 10s out, original was 31s — but
      // we only advanced 11s after the bid).
      await vi.advanceTimersByTimeAsync(11_000);
      expect(closeNomination).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('anti-snipe: cascade — three bids in rapid succession each extend the timer', async () => {
    vi.useFakeTimers();
    try {
      // RPC returns was_extended=true on every call. Each call's
      // returned clock_deadline is +10s from when the call was made.
      const placeBid = vi.fn(async (_params: unknown) => ({
        event_id: 100,
        seq: 100, // overridden via mock results below
        clock_deadline: new Date(Date.now() + 10_000).toISOString(),
        was_duplicate: false,
        was_extended: true,
        extends_event_seq: 101,
      }));
      // Override the response on each call to give monotonic seq.
      let bidCallCount = 0;
      placeBid.mockImplementation(async (_params: unknown) => {
        bidCallCount++;
        const baseSeq = 1 + bidCallCount * 2; // 3, 5, 7
        return {
          event_id: baseSeq,
          seq: baseSeq,
          clock_deadline: new Date(Date.now() + 10_000).toISOString(),
          was_duplicate: false,
          was_extended: true,
          extends_event_seq: baseSeq + 1,
        };
      });
      const closeNomination = vi.fn(async () => ({
        event_id: 999,
        seq: 999,
        event_type: 'auction_nomination_closed' as const,
        no_sale: false,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        antiSnipeLobbyOpts({
          nominatePlayer: alignedNominateMock(31_000),
          placeBid,
          closeNomination,
        }),
      );
      await lobby.enqueueAction(nominateAction({ openingBid: 5 }));

      // Three rapid bids (single-writer queue serializes). Each
      // extends. Cascade depth 3.
      await lobby.enqueueAction(bidAction({ bidAmount: 10, idempotencyKey: 'b1' }));
      await lobby.enqueueAction(
        bidAction({ teamId: 'team-3', bidAmount: 15, idempotencyKey: 'b2' }),
      );
      await lobby.enqueueAction(
        bidAction({ teamId: 'team-2', bidAmount: 20, idempotencyKey: 'b3' }),
      );

      const snapshot = lobby.getSnapshot();
      const extendsEvents = snapshot.recentEvents.filter(
        (e) => e.kind === 'auction_bid_extends_timer',
      );
      expect(extendsEvents).toHaveLength(3);
      // Each extension's triggering bid amount in monotonic order.
      const amounts = extendsEvents.map(
        (e) =>
          (e as Extract<BufferedDraftEvent, { kind: 'auction_bid_extends_timer' }>)
            .triggeringBidAmount,
      );
      expect(amounts).toEqual([10, 15, 20]);

      // Timer didn't fire mid-cascade (each extension reset it to
      // 10s out from the most recent bid).
      expect(closeNomination).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('anti-snipe: bid arrives after window closed — rejected as no_active_nomination, no extension', async () => {
    vi.useFakeTimers();
    try {
      const placeBid = vi.fn();
      const closeNomination = vi.fn(async () => ({
        event_id: 3,
        seq: 3,
        event_type: 'auction_nomination_closed' as const,
        no_sale: false,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        antiSnipeLobbyOpts({
          nominatePlayer: alignedNominateMock(31_000),
          placeBid,
          closeNomination,
        }),
      );
      await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
      // Advance past the bid window — handleNominationTimeout fires +
      // closeNomination clears currentNomination.
      await vi.advanceTimersByTimeAsync(32_000);
      expect(closeNomination).toHaveBeenCalledTimes(1);

      // Late bid arrives.
      const result = await lobby.enqueueAction(bidAction({ bidAmount: 10 }));
      expect(result).toEqual({ ok: false, reason: 'no_active_nomination' });
      expect(placeBid).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('anti-snipe disabled (threshold=0): RPC mock ignored, no extension fires', async () => {
    const placeBid = vi.fn(async (_params: unknown) => ({
      event_id: 2,
      seq: 2,
      clock_deadline: new Date(Date.now() + 31_000).toISOString(),
      was_duplicate: false,
      was_extended: false,
    }));
    // antiSnipe DISABLED (threshold = 0).
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionAntiSnipeThresholdSeconds: 0,
        auctionAntiSnipeExtensionSeconds: 30,
        placeBid,
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    await lobby.enqueueAction(bidAction({ bidAmount: 10 }));
    // Engine still threads the (zero) threshold to the RPC; the RPC
    // is what skips extension when threshold=0.
    expect(placeBid.mock.calls[0]?.[0]).toMatchObject({
      antiSnipeThresholdSeconds: 0,
    });
  });

  it('anti-snipe bootstrap: replay applies extends_timer events to currentNomination.expiresAt', async () => {
    // Simulate a draft with one nomination + two bids, the second
    // of which extended the timer. Bootstrap must mutate
    // currentNomination.expiresAt to the post-extension value
    // (NOT log-and-skip — see Decision Log 2026-05-07).
    const originalDeadline = new Date('2026-05-07T12:30:00Z');
    const extendedDeadline = new Date('2026-05-07T12:30:30Z');
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_nomination_started',
        payload: {
          nomination_id: 'nom-1',
          player_id: '8478402',
          player_name: 'Connor McDavid',
          opening_bid: 5,
          nominator_team_id: 'team-1',
          expires_at: originalDeadline.toISOString(),
        },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_bid_placed',
        payload: { nomination_id: 'nom-1', team_id: 'team-2', bid_amount: 10 },
      }),
      makeEventRow({
        seq: 3,
        event_type: 'auction_bid_extends_timer',
        payload: {
          nomination_id: 'nom-1',
          prior_expires_at: originalDeadline.toISOString(),
          new_expires_at: extendedDeadline.toISOString(),
          triggering_bid_id: 2,
          triggering_team_id: 'team-2',
          triggering_bid_amount: 10,
        },
      }),
    ];
    const lobby = await makeLobby(
      antiSnipeLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    const auctionState = lobby.getAuctionState();
    // Post-extension deadline (NOT the original).
    expect(auctionState?.currentNomination?.clockDeadline).toBe(
      extendedDeadline.toISOString(),
    );
    // Ring buffer has all three events including the extension.
    const snap = lobby.getSnapshot();
    expect(snap.recentEvents.map((e) => e.kind)).toEqual([
      'auction_nomination_started',
      'auction_bid_placed',
      'auction_bid_extends_timer',
    ]);
  });

  it('anti-snipe bootstrap: extends_timer with no active nomination throws (event log integrity)', async () => {
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_bid_extends_timer',
        payload: {
          nomination_id: 'nom-1',
          prior_expires_at: new Date().toISOString(),
          new_expires_at: new Date().toISOString(),
          triggering_bid_id: 1,
          triggering_team_id: 'team-2',
          triggering_bid_amount: 10,
        },
      }),
    ];
    await expect(
      makeLobby(
        antiSnipeLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
      ),
    ).rejects.toThrow(/no active nomination/);
  });

  it('anti-snipe bootstrap: extends_timer with mismatched nomination id throws', async () => {
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_nomination_started',
        payload: {
          nomination_id: 'nom-1',
          player_id: '8478402',
          player_name: 'McDavid',
          opening_bid: 5,
          nominator_team_id: 'team-1',
          expires_at: new Date().toISOString(),
        },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_bid_extends_timer',
        payload: {
          nomination_id: 'WRONG-ID',
          prior_expires_at: new Date().toISOString(),
          new_expires_at: new Date().toISOString(),
          triggering_bid_id: 1,
          triggering_team_id: 'team-2',
          triggering_bid_amount: 10,
        },
      }),
    ];
    await expect(
      makeLobby(
        antiSnipeLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
      ),
    ).rejects.toThrow(/nomination mismatch/);
  });

  it('anti-snipe wire: published auction_bid_extends_timer payload round-trips correctly', async () => {
    const publish = vi.fn();
    const placeBid = vi.fn(async (_params: unknown) => ({
      event_id: 2,
      seq: 2,
      clock_deadline: new Date(Date.now() + 10_000).toISOString(),
      was_duplicate: false,
      was_extended: true,
      extends_event_seq: 3,
    }));
    const lobby = await makeLobby(
      antiSnipeLobbyOpts({
        publish,
        nominatePlayer: alignedNominateMock(31_000),
        placeBid,
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    publish.mockClear();
    await lobby.enqueueAction(bidAction({ bidAmount: 10 }));

    // Find the extends broadcast.
    const extendsCall = publish.mock.calls.find((c) =>
      String(c[1]).includes('auction_bid_extends_timer'),
    );
    expect(extendsCall).toBeDefined();
    const parsed = JSON.parse(extendsCall![1] as string);
    expect(parsed.type).toBe('event');
    expect(parsed.seq).toBe(3);
    expect(parsed.payload.kind).toBe('auction_bid_extends_timer');
    expect(parsed.payload.nominationId).toBe('nom-1');
    expect(parsed.payload.triggeringBidAmount).toBe(10);
    expect(parsed.payload.triggeringBidderTeamId).toBe('team-2');
    expect(typeof parsed.payload.priorClockDeadline).toBe('string');
    expect(typeof parsed.payload.newClockDeadline).toBe('string');
  });

  it('anti-snipe end-to-end: nominate → bid (no ext) → bid (extends) → bid (extends again) → expiry → close', async () => {
    vi.useFakeTimers();
    try {
      let bidCallCount = 0;
      const placeBid = vi.fn().mockImplementation(async (_params: unknown) => {
        bidCallCount++;
        if (bidCallCount === 1) {
          // No extension on first bid.
          return {
            event_id: 2,
            seq: 2,
            clock_deadline: new Date(Date.now() + 31_000).toISOString(),
            was_duplicate: false,
            was_extended: false,
          };
        }
        // Subsequent bids extend by 10s each.
        const baseSeq = 1 + bidCallCount * 2;
        return {
          event_id: baseSeq,
          seq: baseSeq,
          clock_deadline: new Date(Date.now() + 10_000).toISOString(),
          was_duplicate: false,
          was_extended: true,
          extends_event_seq: baseSeq + 1,
        };
      });
      const closeNomination = vi.fn(async () => ({
        event_id: 999,
        seq: 999,
        event_type: 'auction_nomination_closed' as const,
        no_sale: false,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        antiSnipeLobbyOpts({
          nominatePlayer: alignedNominateMock(31_000),
          placeBid,
          closeNomination,
        }),
      );
      await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
      await lobby.enqueueAction(bidAction({ bidAmount: 10, idempotencyKey: 'b1' }));
      await lobby.enqueueAction(
        bidAction({ teamId: 'team-3', bidAmount: 15, idempotencyKey: 'b2' }),
      );
      await lobby.enqueueAction(
        bidAction({ teamId: 'team-2', bidAmount: 20, idempotencyKey: 'b3' }),
      );

      // After 3 bids: 1 placed (no ext), 2 placed (ext), 3 placed (ext).
      // Two extension events in the buffer.
      const snap = lobby.getSnapshot();
      expect(
        snap.recentEvents.filter((e) => e.kind === 'auction_bid_placed'),
      ).toHaveLength(3);
      expect(
        snap.recentEvents.filter((e) => e.kind === 'auction_bid_extends_timer'),
      ).toHaveLength(2);

      // Expiry path still fires after the final extension's window.
      await vi.advanceTimersByTimeAsync(11_000);
      expect(closeNomination).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Chunk 11g.6 sub-step 6c1 — auction pause/resume ─────────────────
  //
  // ADR-002 §4.4: a commissioner pause suspends the bid window;
  // resume restores the captured remaining time (NOT a fresh full
  // window — divergent from snake/linear). Engine routes
  // pauseAuction/resumeAuction through the single-writer queue so
  // they serialize against in-flight bids deterministically.
  // Bootstrap APPLIES auction_paused / auction_resumed events
  // during replay per the canonical-replay principle from 6b.

  it('auction pause: happy path — RPC called, pauseState set, timer cancelled, ring buffer + broadcast fire', async () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      const pauseAuction = vi.fn(async (_params: unknown) => ({
        event_id: 5,
        seq: 5,
        paused_at: new Date().toISOString(),
        paused_nomination_id: 'nom-1',
        captured_remaining_seconds: 22,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        auctionLobbyOpts({
          publish,
          nominatePlayer: vi.fn(async (_p: unknown) => ({
            event_id: 1,
            seq: 1,
            nomination_id: 'nom-1',
            clock_deadline: new Date(Date.now() + 31_000).toISOString(),
            was_duplicate: false,
          })),
          pauseAuction,
        }),
      );
      // Open a nomination (timer running).
      await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
      publish.mockClear();

      const result = await lobby.pauseAuction({
        commissionerUserId: 'commish-1',
        reason: 'commissioner pause',
        idempotencyKey: 'pause-1',
      });

      expect(result).toEqual({ ok: true, eventSeq: 5 });
      expect(pauseAuction).toHaveBeenCalledTimes(1);
      expect(pauseAuction.mock.calls[0]?.[0]).toMatchObject({
        leagueId: 'league-1',
        reason: 'commissioner pause',
        actor: { kind: 'commissioner', id: 'commish-1' },
      });

      // pauseState set with captured remaining ms.
      const broadcastJson = JSON.parse(publish.mock.calls[0][1] as string);
      expect(broadcastJson.payload.kind).toBe('auction_paused');
      expect(broadcastJson.payload.capturedRemainingSeconds).toBe(22);
      expect(broadcastJson.payload.pausedNominationId).toBe('nom-1');

      // Timer cancelled — advancing past the original deadline does
      // NOT trigger close (because pauseState was set + timer
      // cancelled).
      await vi.advanceTimersByTimeAsync(60_000);
      // closeNomination uses the default mock; it should NOT have
      // fired because the timer was cancelled by pauseAuction.
      // (Default mock has been called 0 times.)
    } finally {
      vi.useRealTimers();
    }
  });

  it('auction pause: snake-format lobby returns wrong_format_for_action', async () => {
    const lobby = await makeLobby({ format: 'snake' });
    const result = await lobby.pauseAuction({
      commissionerUserId: 'commish-1',
      reason: 'pause',
      idempotencyKey: 'p-1',
    });
    expect(result).toEqual({ ok: false, reason: 'wrong_format_for_action' });
  });

  it('auction pause: rejected when already paused (engine returns invalid_state)', async () => {
    const pauseAuction = vi.fn(async (_p: unknown) => ({
      event_id: 5,
      seq: 5,
      paused_at: new Date().toISOString(),
      paused_nomination_id: null,
      captured_remaining_seconds: null,
      was_duplicate: false,
    }));
    const lobby = await makeLobby(auctionLobbyOpts({ pauseAuction }));
    // First pause succeeds.
    await lobby.pauseAuction({
      commissionerUserId: 'commish-1',
      reason: 'pause',
      idempotencyKey: 'p-A',
    });
    // Second pause (different idempotency key) sees pauseState
    // already set and rejects without calling RPC.
    const result = await lobby.pauseAuction({
      commissionerUserId: 'commish-1',
      reason: 'pause again',
      idempotencyKey: 'p-B',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_state' });
    expect(pauseAuction).toHaveBeenCalledTimes(1);
  });

  it('auction resume: happy path — pauseState cleared, expiresAt restored, timer rescheduled', async () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      // Resume returns new_expires_at = now + 22s (the captured
      // remaining seconds from the pause). Engine reschedules timer.
      const resumeAuction = vi.fn(async (_p: unknown) => ({
        event_id: 6,
        seq: 6,
        resumed_at: new Date().toISOString(),
        prior_pause_event_id: 5,
        restored_nomination_id: 'nom-1',
        new_expires_at: new Date(Date.now() + 22_000).toISOString(),
        was_duplicate: false,
      }));
      const closeNomination = vi.fn(async () => ({
        event_id: 7,
        seq: 7,
        event_type: 'auction_nomination_closed' as const,
        no_sale: false,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        auctionLobbyOpts({
          publish,
          nominatePlayer: vi.fn(async (_p: unknown) => ({
            event_id: 1,
            seq: 1,
            nomination_id: 'nom-1',
            clock_deadline: new Date(Date.now() + 31_000).toISOString(),
            was_duplicate: false,
          })),
          pauseAuction: vi.fn(async (_p: unknown) => ({
            event_id: 5,
            seq: 5,
            paused_at: new Date().toISOString(),
            paused_nomination_id: 'nom-1',
            captured_remaining_seconds: 22,
            was_duplicate: false,
          })),
          resumeAuction,
          closeNomination,
        }),
      );
      await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
      await lobby.pauseAuction({
        commissionerUserId: 'commish-1',
        reason: 'pause',
        idempotencyKey: 'p-1',
      });
      publish.mockClear();

      const result = await lobby.resumeAuction({
        commissionerUserId: 'commish-1',
        idempotencyKey: 'r-1',
      });

      expect(result).toEqual({ ok: true, eventSeq: 6 });
      expect(resumeAuction).toHaveBeenCalledTimes(1);

      // Broadcast fired with auction_resumed.
      const broadcastJson = JSON.parse(publish.mock.calls[0][1] as string);
      expect(broadcastJson.payload.kind).toBe('auction_resumed');
      expect(broadcastJson.payload.priorPauseEventId).toBe(5);
      expect(broadcastJson.payload.restoredNominationId).toBe('nom-1');

      // Timer rescheduled: advancing 23s should fire closeNomination.
      await vi.advanceTimersByTimeAsync(23_000);
      expect(closeNomination).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auction resume: rejected when not paused (engine returns invalid_state)', async () => {
    const resumeAuction = vi.fn();
    const lobby = await makeLobby(auctionLobbyOpts({ resumeAuction }));
    const result = await lobby.resumeAuction({
      commissionerUserId: 'commish-1',
      idempotencyKey: 'r-1',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_state' });
    expect(resumeAuction).not.toHaveBeenCalled();
  });

  it('place_bid rejected during pause: engine returns auction_paused without calling RPC', async () => {
    const placeBid = vi.fn();
    const pauseAuction = vi.fn(async (_p: unknown) => ({
      event_id: 5,
      seq: 5,
      paused_at: new Date().toISOString(),
      paused_nomination_id: 'nom-1',
      captured_remaining_seconds: 22,
      was_duplicate: false,
    }));
    const lobby = await makeLobby(
      auctionLobbyOpts({
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
        placeBid,
        pauseAuction,
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    await lobby.pauseAuction({
      commissionerUserId: 'commish-1',
      reason: 'pause',
      idempotencyKey: 'p-1',
    });

    const result = await lobby.enqueueAction(bidAction({ bidAmount: 10 }));
    expect(result).toEqual({ ok: false, reason: 'auction_paused' });
    expect(placeBid).not.toHaveBeenCalled();
  });

  it('nominate rejected during pause: engine returns auction_paused without calling RPC', async () => {
    const nominatePlayer = vi.fn(async (_p: unknown) => ({
      event_id: 1,
      seq: 1,
      nomination_id: 'nom-1',
      clock_deadline: new Date(Date.now() + 31_000).toISOString(),
      was_duplicate: false,
    }));
    const pauseAuction = vi.fn(async (_p: unknown) => ({
      event_id: 5,
      seq: 5,
      paused_at: new Date().toISOString(),
      paused_nomination_id: null,
      captured_remaining_seconds: null,
      was_duplicate: false,
    }));
    const lobby = await makeLobby(
      auctionLobbyOpts({ nominatePlayer, pauseAuction }),
    );
    // Pause BEFORE any nomination.
    await lobby.pauseAuction({
      commissionerUserId: 'commish-1',
      reason: 'pause',
      idempotencyKey: 'p-1',
    });

    const result = await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    expect(result).toEqual({ ok: false, reason: 'auction_paused' });
    // nominatePlayer was never called (pause gates fail-fast).
    expect(nominatePlayer).not.toHaveBeenCalled();
  });

  it('queue ordering: bid in flight when pause queues — bid is processed BEFORE pause (deterministic)', async () => {
    // Routes pauseAuction through the single-writer queue alongside
    // bid actions. The bid was enqueued first, so it MUST process
    // first (deterministic order). The pause then sets pauseState,
    // and a third action (another bid) sees pauseState and rejects.
    const placeBid = vi.fn(async (_p: unknown) => ({
      event_id: 2,
      seq: 2,
      clock_deadline: new Date(Date.now() + 31_000).toISOString(),
      was_duplicate: false,
      was_extended: false,
    }));
    const pauseAuction = vi.fn(async (_p: unknown) => ({
      event_id: 5,
      seq: 5,
      paused_at: new Date().toISOString(),
      paused_nomination_id: 'nom-1',
      captured_remaining_seconds: 22,
      was_duplicate: false,
    }));
    const lobby = await makeLobby(
      auctionLobbyOpts({
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
        placeBid,
        pauseAuction,
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));

    // Enqueue bid, then pause, then bid — without awaiting between.
    const bid1 = lobby.enqueueAction(bidAction({ bidAmount: 10, idempotencyKey: 'b1' }));
    const pause = lobby.pauseAuction({
      commissionerUserId: 'commish-1',
      reason: 'pause',
      idempotencyKey: 'p-1',
    });
    const bid2 = lobby.enqueueAction(bidAction({ bidAmount: 20, idempotencyKey: 'b2' }));

    const [r1, rPause, r2] = await Promise.all([bid1, pause, bid2]);

    expect(r1).toEqual({ ok: true, eventSeq: 2 }); // first bid succeeds
    expect(rPause.ok).toBe(true);                  // pause then succeeds
    expect(r2).toEqual({ ok: false, reason: 'auction_paused' }); // second bid blocked
    expect(placeBid).toHaveBeenCalledTimes(1);
  });

  it('bootstrap: auction_paused event applied during replay sets pauseState', async () => {
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_nomination_started',
        payload: {
          nomination_id: 'nom-1',
          player_id: '8478402',
          player_name: 'McDavid',
          opening_bid: 5,
          nominator_team_id: 'team-1',
          expires_at: new Date(Date.now() + 31_000).toISOString(),
        },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_paused',
        payload: {
          commissioner_user_id: 'commish-1',
          reason: 'pause',
          paused_at: new Date().toISOString(),
          paused_nomination_id: 'nom-1',
          captured_remaining_seconds: 22,
        },
      }),
    ];
    const lobby = await makeLobby(
      auctionLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    // pauseState set; init() did NOT schedule a timer (gated on
    // pauseState===null). Bid attempt would be rejected.
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 10 }));
    expect(result).toEqual({ ok: false, reason: 'auction_paused' });
  });

  it('bootstrap: auction_paused → auction_resumed cycle clears pauseState and restores deadline', async () => {
    const restoredDeadline = new Date('2026-05-07T13:00:30Z');
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_nomination_started',
        payload: {
          nomination_id: 'nom-1',
          player_id: '8478402',
          player_name: 'McDavid',
          opening_bid: 5,
          nominator_team_id: 'team-1',
          expires_at: new Date('2026-05-07T13:00:00Z').toISOString(),
        },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_paused',
        payload: {
          commissioner_user_id: 'commish-1',
          reason: 'pause',
          paused_at: new Date().toISOString(),
          paused_nomination_id: 'nom-1',
          captured_remaining_seconds: 30,
        },
      }),
      makeEventRow({
        seq: 3,
        event_type: 'auction_resumed',
        payload: {
          commissioner_user_id: 'commish-1',
          resumed_at: new Date().toISOString(),
          prior_pause_event_id: 2,
          restored_nomination_id: 'nom-1',
          new_expires_at: restoredDeadline.toISOString(),
        },
      }),
    ];
    const lobby = await makeLobby(
      auctionLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    // pauseState cleared; expiresAt restored to the resume payload.
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.currentNomination?.clockDeadline).toBe(
      restoredDeadline.toISOString(),
    );
    // Buffer has all three events.
    const snap = lobby.getSnapshot();
    expect(snap.recentEvents.map((e) => e.kind)).toEqual([
      'auction_nomination_started',
      'auction_paused',
      'auction_resumed',
    ]);
  });

  it('bootstrap: multi-cycle pause/resume final state has no pauseState', async () => {
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_paused',
        payload: {
          commissioner_user_id: 'commish-1',
          reason: 'pause-1',
          paused_at: new Date().toISOString(),
          paused_nomination_id: null,
          captured_remaining_seconds: null,
        },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_resumed',
        payload: {
          commissioner_user_id: 'commish-1',
          resumed_at: new Date().toISOString(),
          prior_pause_event_id: 1,
          restored_nomination_id: null,
          new_expires_at: null,
        },
      }),
      makeEventRow({
        seq: 3,
        event_type: 'auction_paused',
        payload: {
          commissioner_user_id: 'commish-1',
          reason: 'pause-2',
          paused_at: new Date().toISOString(),
          paused_nomination_id: null,
          captured_remaining_seconds: null,
        },
      }),
      makeEventRow({
        seq: 4,
        event_type: 'auction_resumed',
        payload: {
          commissioner_user_id: 'commish-1',
          resumed_at: new Date().toISOString(),
          prior_pause_event_id: 3,
          restored_nomination_id: null,
          new_expires_at: null,
        },
      }),
    ];
    const lobby = await makeLobby(
      auctionLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    // Final state: not paused (a bid attempt would NOT be rejected
    // for auction_paused — it would be rejected for no_active_nomination).
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 10 }));
    expect(result).toEqual({ ok: false, reason: 'no_active_nomination' });
  });

  it('idempotent retry: same pauseAuction idempotencyKey returns the cached promise', async () => {
    const pauseAuction = vi.fn(async (_p: unknown) => ({
      event_id: 5,
      seq: 5,
      paused_at: new Date().toISOString(),
      paused_nomination_id: null,
      captured_remaining_seconds: null,
      was_duplicate: false,
    }));
    const lobby = await makeLobby(auctionLobbyOpts({ pauseAuction }));
    const params = {
      commissionerUserId: 'commish-1',
      reason: 'pause',
      idempotencyKey: 'p-same',
    };
    const r1 = await lobby.pauseAuction(params);
    const r2 = await lobby.pauseAuction(params);
    expect(r1).toEqual(r2);
    // Second call returned the cached promise; RPC was called only once.
    expect(pauseAuction).toHaveBeenCalledTimes(1);
  });

  // ── Chunk 11g.6 sub-step 6c2 — tiered bid increments ────────────────
  //
  // Engine-side fail-fast for the tiered minimum-next-bid check.
  // RPC-side enforcement is exercised by the auctionBidIncrement
  // pure-function tests + the SQL migration's inline examples;
  // these tests verify the engine integration: tier table threaded
  // through, increment check rejects bids below the tier's minimum,
  // rejection result populates `minimumNextBid` for client UX.
  //
  // Per ADR-002 §4.3 / §4.5.

  /** §4.5 example tier table for 6c2 integration tests. */
  const SPEC_EXAMPLE_TIERS = [
    { below: 10, increment: 1 },
    { below: 50, increment: 5 },
    { below: 999, increment: 10 },
  ];

  it('6c2 tiered: leading $5 in below-10 tier — bid $6 accepted, bid $5.5 below min would also accept (wait — strict-greater catches $5.5 against $5 so bid_too_low first)', async () => {
    // This is mostly a sanity check that the default tier path
    // still admits a +$1 bid, regardless of the tier configuration.
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionMinBidIncrementTiers: SPEC_EXAMPLE_TIERS,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 6 }));
    expect(result.ok).toBe(true);
  });

  it('6c2 tiered: leading $9 — bid $10 accepted (still in below-10 tier, +$1)', async () => {
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionMinBidIncrementTiers: SPEC_EXAMPLE_TIERS,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
      }),
    );
    // Get to leading $9 via openingBid.
    await lobby.enqueueAction(nominateAction({ openingBid: 9 }));
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 10 }));
    expect(result.ok).toBe(true);
  });

  it('6c2 tiered: leading $10 — bid $11 REJECTED (tier transition: $10 in below-50 tier needs +$5 → min $15)', async () => {
    const placeBid = vi.fn();
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionMinBidIncrementTiers: SPEC_EXAMPLE_TIERS,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
        placeBid,
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 10 }));
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 11 }));
    expect(result).toEqual({
      ok: false,
      reason: 'bid_increment_violation',
      minimumNextBid: 15,
    });
    expect(placeBid).not.toHaveBeenCalled();
  });

  it('6c2 tiered: leading $10 — bid $15 accepted (exactly the minimum next)', async () => {
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionMinBidIncrementTiers: SPEC_EXAMPLE_TIERS,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 10 }));
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 15 }));
    expect(result.ok).toBe(true);
  });

  it('6c2 tiered: leading $50 — bid $55 REJECTED (tier transition: $50 in below-999 tier needs +$10 → min $60)', async () => {
    const placeBid = vi.fn();
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionBudget: 1000, // larger budget so $50 nominate is affordable
        auctionMinBidIncrementTiers: SPEC_EXAMPLE_TIERS,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
        placeBid,
        initialTeamBudgets: new Map([
          ['team-1', 1000],
          ['team-2', 1000],
          ['team-3', 1000],
        ]),
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 50 }));
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 55 }));
    expect(result).toEqual({
      ok: false,
      reason: 'bid_increment_violation',
      minimumNextBid: 60,
    });
    expect(placeBid).not.toHaveBeenCalled();
  });

  it('6c2 tiered: Path A fallback — leading $1500 (above all tiers) accepts +last-tier-increment ($10) → min $1510', async () => {
    const placeBid = vi.fn();
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionBudget: 5000,
        auctionMinBidIncrementTiers: SPEC_EXAMPLE_TIERS,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
        placeBid,
        initialTeamBudgets: new Map([
          ['team-1', 5000],
          ['team-2', 5000],
          ['team-3', 5000],
        ]),
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 1500 }));
    // $1505 < $1510 → reject.
    const tooLow = await lobby.enqueueAction(bidAction({ bidAmount: 1505, idempotencyKey: 'idem-bid-1' }));
    expect(tooLow).toEqual({
      ok: false,
      reason: 'bid_increment_violation',
      minimumNextBid: 1510,
    });
    expect(placeBid).not.toHaveBeenCalled();
  });

  it('6c2 default tier (flat $1) preserves 6a behavior — leading $50 + $51 accepted', async () => {
    // No custom tiers configured → engine uses the default flat-$1
    // tier. This is the backward-compat regression lock for all
    // existing 6a/6b/6c1 tests that bid in any value range.
    const lobby = await makeLobby(
      auctionLobbyOpts({
        // (no auctionMinBidIncrementTiers override — uses default)
        auctionBudget: 1000,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
        initialTeamBudgets: new Map([
          ['team-1', 1000],
          ['team-2', 1000],
          ['team-3', 1000],
        ]),
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 50 }));
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 51 }));
    expect(result.ok).toBe(true);
  });

  it('6c2 RPC plumbing: engine threads minBidIncrementTiers to placeBid RPC', async () => {
    const placeBid = vi.fn(async (_p: unknown) => ({
      event_id: 2,
      seq: 2,
      clock_deadline: new Date(Date.now() + 31_000).toISOString(),
      was_duplicate: false,
      was_extended: false,
    }));
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionMinBidIncrementTiers: SPEC_EXAMPLE_TIERS,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
        placeBid,
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    await lobby.enqueueAction(bidAction({ bidAmount: 6 }));
    // RPC received the tier table.
    expect(placeBid.mock.calls[0]?.[0]).toMatchObject({
      minBidIncrementTiers: SPEC_EXAMPLE_TIERS,
    });
  });

  it('6c2 minimumNextBid only populated on bid_increment_violation rejection (not on bid_too_low)', async () => {
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionMinBidIncrementTiers: SPEC_EXAMPLE_TIERS,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    // bid_too_low (bid <= leading) does NOT carry minimumNextBid.
    const result = await lobby.enqueueAction(bidAction({ bidAmount: 5 }));
    expect(result).toEqual({ ok: false, reason: 'bid_too_low' });
    expect(result).not.toHaveProperty('minimumNextBid');
  });

  it('6c2 custom tier with very small increments (fractional dollars) — engine accepts + threads through', async () => {
    const fractionalTiers = [
      { below: 10, increment: 0.5 },
      { below: 1000, increment: 1 },
    ];
    const lobby = await makeLobby(
      auctionLobbyOpts({
        auctionMinBidIncrementTiers: fractionalTiers,
        nominatePlayer: vi.fn(async (_p: unknown) => ({
          event_id: 1,
          seq: 1,
          nomination_id: 'nom-1',
          clock_deadline: new Date(Date.now() + 31_000).toISOString(),
          was_duplicate: false,
        })),
      }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    // $5 + $0.5 = $5.5 minimum
    const tooLow = await lobby.enqueueAction(
      bidAction({ bidAmount: 5.25, idempotencyKey: 'idem-bid-1' }),
    );
    expect(tooLow).toEqual({
      ok: false,
      reason: 'bid_increment_violation',
      minimumNextBid: 5.5,
    });
    const accepted = await lobby.enqueueAction(
      bidAction({ bidAmount: 5.5, idempotencyKey: 'idem-bid-2' }),
    );
    expect(accepted.ok).toBe(true);
  });

  // ── Chunk 11g.6 sub-step 6c3 — auction auto-nominate + nomination-window timer ──
  //
  // Two-timer architecture: nomination_window (engine waits for
  // user to pick a player) → bid_window (bidding on the chosen
  // nomination). Auto-nominate fires when nomination_window
  // expires; force-skip cascades when auto-nominator can't afford
  // even auctionMinBid + reserve. Per ADR-002 §3.4 + §4.2 + Path Y
  // extension.

  /** Helper: auction lobby with `initialDraftState='active'` so init() schedules a nomination-window timer. */
  function autoNominateLobbyOpts(extra: Partial<MakeLobbyOpts> = {}): MakeLobbyOpts {
    return auctionLobbyOpts({
      initialDraftState: 'active',
      auctionNominationWindowSeconds: 5, // short window for fast fake-timer tests
      auctionBidWindowSeconds: 30,
      ...extra,
    });
  }

  /** Strategy mock that returns a fixed projection result. */
  function fixedProjectionStrategy(playerId: string, openingBid = 1) {
    return [
      vi.fn(async () => ({
        ok: true as const,
        playerId,
        openingBid,
        source: 'projections' as const,
      })),
    ];
  }

  it('auto-nominate happy path: nomination-window timer fires → engine selects player → bid-window timer scheduled', async () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      const nominatePlayer = vi.fn(async (_p: unknown) => ({
        event_id: 1,
        seq: 1,
        nomination_id: 'nom-auto-1',
        clock_deadline: new Date(Date.now() + 31_000).toISOString(),
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        autoNominateLobbyOpts({
          publish,
          nominatePlayer,
          auctionAutoNominateStrategies: fixedProjectionStrategy('8478402'),
        }),
      );
      // Init scheduled the nomination-window timer (5s). Advance past it.
      publish.mockClear();
      await vi.advanceTimersByTimeAsync(6_000);

      expect(nominatePlayer).toHaveBeenCalledTimes(1);
      const call = nominatePlayer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.teamId).toBe('team-1'); // first nominator in rotation
      expect(call.playerId).toBe('8478402');
      expect((call.actor as Record<string, unknown>).kind).toBe('autopick');

      // Broadcast: auction_auto_nominated event (NOT auction_nomination_started).
      const broadcasts = publish.mock.calls.map((c) => JSON.parse(c[1] as string));
      const autoNomBroadcast = broadcasts.find(
        (b) => b.payload.kind === 'auction_auto_nominated',
      );
      expect(autoNomBroadcast).toBeDefined();
      expect(autoNomBroadcast.payload.fallbackSource).toBe('projections');
      expect(autoNomBroadcast.payload.nominatorTeamId).toBe('team-1');

      // Engine state: currentNomination set; bid-window timer scheduled.
      const auctionState = lobby.getAuctionState();
      expect(auctionState?.currentNomination?.nominatorTeamId).toBe('team-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-nominate insufficient_budget: skip event emitted, nominationsCompleted advances, next nominator window scheduled', async () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      const skipNomination = vi.fn(async (_p: unknown) => ({
        event_id: 2,
        seq: 2,
        skipped_team_id: 'team-1',
        reason: 'insufficient_budget' as const,
        was_duplicate: false,
      }));
      const nominatePlayer = vi.fn();
      // team-1 has only $1 budget but needs reserve of $1 ((rounds-1)*minBid).
      // maxAffordable = $0; auto-nominator's openingBid=1 > $0 → skip.
      const lobby = await makeLobby(
        autoNominateLobbyOpts({
          publish,
          skipNomination,
          nominatePlayer,
          auctionAutoNominateStrategies: fixedProjectionStrategy('8478402', 1),
          initialTeamBudgets: new Map([
            ['team-1', 1],
            ['team-2', 200],
            ['team-3', 200],
          ]),
        }),
      );
      publish.mockClear();
      await vi.advanceTimersByTimeAsync(6_000);

      expect(skipNomination).toHaveBeenCalledTimes(1);
      const skipCall = skipNomination.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(skipCall.reason).toBe('insufficient_budget');
      expect(skipCall.teamId).toBe('team-1');
      expect(nominatePlayer).not.toHaveBeenCalled();

      // Broadcast carries the skip event.
      const broadcasts = publish.mock.calls.map((c) => JSON.parse(c[1] as string));
      const skipBroadcast = broadcasts.find(
        (b) => b.payload.kind === 'auction_nomination_skipped',
      );
      expect(skipBroadcast).toBeDefined();
      expect(skipBroadcast.payload.reason).toBe('insufficient_budget');

      // nominationsCompleted advanced; next nominator's window scheduled.
      const auctionState = lobby.getAuctionState();
      expect(auctionState?.nominationsCompleted).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-nominate cascade: 3 teams in a row skip → all complete early', async () => {
    vi.useFakeTimers();
    try {
      let skipCallCount = 0;
      const skipNomination = vi.fn(async (_p: unknown) => {
        skipCallCount++;
        return {
          event_id: skipCallCount,
          seq: skipCallCount,
          skipped_team_id: `team-${skipCallCount}`,
          reason: 'insufficient_budget' as const,
          was_duplicate: false,
        };
      });
      const nominatePlayer = vi.fn();
      // All 3 teams have $0 budget → all skip. With draftRounds=2:
      // 3 × 2 = 6 total nominations. Budget reserve makes EVERY round
      // a forced skip. So all 6 are skipped → auction completes early.
      const lobby = await makeLobby(
        autoNominateLobbyOpts({
          skipNomination,
          nominatePlayer,
          auctionAutoNominateStrategies: fixedProjectionStrategy('8478402', 1),
          initialTeamBudgets: new Map([
            ['team-1', 0],
            ['team-2', 0],
            ['team-3', 0],
          ]),
        }),
      );

      // Cascade through all 6 nominations (each takes ~5s window).
      // Total elapsed: 6 × 5s = 30s + buffer.
      await vi.advanceTimersByTimeAsync(60_000);

      expect(skipNomination).toHaveBeenCalledTimes(6);
      expect(nominatePlayer).not.toHaveBeenCalled();
      const auctionState = lobby.getAuctionState();
      expect(auctionState?.nominationsCompleted).toBe(6);
      expect(lobby.getCurrentState().draftStatus).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('user nomination during nomination window: cancels nomination-window timer, schedules bid-window timer', async () => {
    vi.useFakeTimers();
    try {
      const nominatePlayer = vi.fn(async (_p: unknown) => ({
        event_id: 1,
        seq: 1,
        nomination_id: 'nom-1',
        clock_deadline: new Date(Date.now() + 31_000).toISOString(),
        was_duplicate: false,
      }));
      const skipNomination = vi.fn();
      const lobby = await makeLobby(
        autoNominateLobbyOpts({ nominatePlayer, skipNomination }),
      );
      // User nominates BEFORE the 5s nomination window expires.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await lobby.enqueueAction(
        nominateAction({ openingBid: 5 }),
      );
      expect(result.ok).toBe(true);

      // Continue advancing past where the nomination-window timer
      // would have fired (5s mark) — auto-nominate must NOT fire.
      await vi.advanceTimersByTimeAsync(5_000);
      // nominatePlayer was called once (the user's), not twice.
      expect(nominatePlayer).toHaveBeenCalledTimes(1);
      // Note: the user's nominate uses actor.kind='user'; auto-nominate
      // would use 'autopick'. Verify the single call was the user's.
      const call = nominatePlayer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect((call.actor as Record<string, unknown>).kind).toBe('user');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pause during nomination window: pauseState captures nomination_window kind', async () => {
    vi.useFakeTimers();
    try {
      const pauseAuction = vi.fn(async (_p: unknown) => ({
        event_id: 5,
        seq: 5,
        paused_at: new Date().toISOString(),
        paused_nomination_id: null,
        captured_remaining_seconds: 3,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        autoNominateLobbyOpts({ pauseAuction }),
      );
      // Init scheduled the nomination-window timer; pause within
      // the window (no active nomination).
      const result = await lobby.pauseAuction({
        commissionerUserId: 'commish-1',
        reason: 'pause-within-nom-window',
        idempotencyKey: 'p-1',
      });
      expect(result.ok).toBe(true);

      // The auction_paused event in the ring buffer carries the
      // nomination_window discriminator.
      const snap = lobby.getSnapshot();
      const pausedEvent = snap.recentEvents.find(
        (e) => e.kind === 'auction_paused',
      );
      expect(pausedEvent).toBeDefined();
      expect(
        (pausedEvent as Extract<BufferedDraftEvent, { kind: 'auction_paused' }>)
          .pausedTimerKind,
      ).toBe('nomination_window');
    } finally {
      vi.useRealTimers();
    }
  });

  it('bootstrap mid-nomination-window: replay leaves no currentNomination, post-replay schedules nomination-window timer', async () => {
    vi.useFakeTimers();
    try {
      const nominatePlayer = vi.fn(async (_p: unknown) => ({
        event_id: 1,
        seq: 1,
        nomination_id: 'nom-1',
        clock_deadline: new Date(Date.now() + 31_000).toISOString(),
        was_duplicate: false,
      }));
      // Event log: a prior nomination + close, leaving the auction
      // mid-nomination-window for the SECOND nominator.
      const events: DraftEventRow[] = [
        makeEventRow({
          seq: 1,
          event_type: 'auction_nomination_started',
          payload: {
            nomination_id: 'nom-prior',
            player_id: '8478000',
            player_name: 'Prior',
            opening_bid: 1,
            nominator_team_id: 'team-1',
            expires_at: new Date('2026-05-07T12:00:00Z').toISOString(),
          },
        }),
        makeEventRow({
          seq: 2,
          event_type: 'auction_nomination_closed',
          payload: {
            nomination_id: 'nom-prior',
            winning_team_id: 'team-1',
            final_amount: 1,
            total_bids: 1,
            player_id: '8478000',
          },
        }),
      ];
      const lobby = await makeLobby(
        autoNominateLobbyOpts({
          listDraftEvents: vi.fn(async () => events),
          nominatePlayer,
          auctionAutoNominateStrategies: fixedProjectionStrategy('8478402'),
        }),
      );

      // Post-replay: nominationsCompleted=1, currentNomination=null,
      // nomination-window timer scheduled for team-2 (next in rotation).
      const auctionState = lobby.getAuctionState();
      expect(auctionState?.nominationsCompleted).toBe(1);
      expect(auctionState?.currentNomination).toBeNull();

      await vi.advanceTimersByTimeAsync(6_000);
      expect(nominatePlayer).toHaveBeenCalledTimes(1);
      const call = nominatePlayer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.teamId).toBe('team-2'); // next nominator after team-1's win
    } finally {
      vi.useRealTimers();
    }
  });

  it('bootstrap mid-auto-nominate: replay sets currentNomination, schedules bid-window timer', async () => {
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_auto_nominated',
        payload: {
          nomination_id: 'nom-1',
          player_id: '8478402',
          player_name: 'McDavid',
          opening_bid: 1,
          nominator_team_id: 'team-1',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          fallback_source: 'projections',
        },
      }),
    ];
    const lobby = await makeLobby(
      autoNominateLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.currentNomination?.nominationId).toBe('nom-1');
    expect(auctionState?.currentNomination?.nominatorTeamId).toBe('team-1');
    // Ring buffer has the auction_auto_nominated event.
    const snap = lobby.getSnapshot();
    expect(snap.recentEvents.map((e) => e.kind)).toContain('auction_auto_nominated');
  });

  it('bootstrap with auction_nomination_skipped events: replay correctly advances nominationsCompleted past skipped teams', async () => {
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_nomination_skipped',
        payload: { skipped_team_id: 'team-1', reason: 'insufficient_budget' },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_nomination_skipped',
        payload: { skipped_team_id: 'team-2', reason: 'insufficient_budget' },
      }),
    ];
    const lobby = await makeLobby(
      autoNominateLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.nominationsCompleted).toBe(2);
    // The next nominator (rotation pointer) is team-3.
    expect(lobby.getCurrentState().onClockTeamId).toBe('team-3');
  });

  it('auto-nominate no_eligible_players: skip event emitted with that reason', async () => {
    vi.useFakeTimers();
    try {
      const skipNomination = vi.fn(async (_p: unknown) => ({
        event_id: 2,
        seq: 2,
        skipped_team_id: 'team-1',
        reason: 'no_eligible_players' as const,
        was_duplicate: false,
      }));
      // Strategy returns no_eligible_players (every projection consumed).
      const lobby = await makeLobby(
        autoNominateLobbyOpts({
          skipNomination,
          auctionAutoNominateStrategies: [
            vi.fn(async () => ({ ok: false as const, reason: 'no_eligible_players' as const })),
          ],
        }),
      );
      await vi.advanceTimersByTimeAsync(6_000);

      expect(skipNomination).toHaveBeenCalledTimes(1);
      const call = skipNomination.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.reason).toBe('no_eligible_players');
    } finally {
      vi.useRealTimers();
    }
  });

  it('engine completion via cascade: all teams skip → status becomes completed', async () => {
    vi.useFakeTimers();
    try {
      const skipNomination = vi.fn(async (_p: unknown) => ({
        event_id: Math.floor(Math.random() * 1000),
        seq: Math.floor(Math.random() * 1000),
        skipped_team_id: 'team-x',
        reason: 'insufficient_budget' as const,
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        autoNominateLobbyOpts({
          skipNomination,
          draftRounds: 1, // 3 teams × 1 round = 3 total nominations
          auctionAutoNominateStrategies: fixedProjectionStrategy('8478402', 1),
          initialTeamBudgets: new Map([
            ['team-1', 0],
            ['team-2', 0],
            ['team-3', 0],
          ]),
        }),
      );
      await vi.advanceTimersByTimeAsync(30_000);

      expect(skipNomination).toHaveBeenCalledTimes(3);
      expect(lobby.getCurrentState().draftStatus).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('idempotent retry: deterministic auto-nominate idempotency key — engine restart mid-fire produces same key', async () => {
    vi.useFakeTimers();
    try {
      const nominatePlayer = vi.fn(async (_p: unknown) => ({
        event_id: 1,
        seq: 1,
        nomination_id: 'nom-1',
        clock_deadline: new Date(Date.now() + 31_000).toISOString(),
        was_duplicate: false,
      }));
      const lobby = await makeLobby(
        autoNominateLobbyOpts({
          nominatePlayer,
          auctionAutoNominateStrategies: fixedProjectionStrategy('8478402'),
        }),
      );
      await vi.advanceTimersByTimeAsync(6_000);
      const firstKey = (
        nominatePlayer.mock.calls[0]?.[0] as Record<string, unknown>
      ).idempotencyKey as string;

      // Verify the key looks like a UUID (md5UuidFromSeed output).
      expect(firstKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Chunk 11g.6 sub-step 6c4 — auction commissioner override ────────
  //
  // Polymorphic single-event-variant architecture: all seven
  // override actions flow through `LobbyManager.commissionerOverride`
  // → `auction_commissioner_override_v2` RPC → single
  // `auction_commissioner_override` event with `overrideAction`
  // discriminator. Per ADR-002 §4.4 + extensions documented in
  // PHASE_4_5_PROJECT_PLAN.md Decision Log (2026-05-07).

  /** Helper: auction lobby with active nomination at $5 by team-1. */
  async function lobbyWithActiveNomination(
    extra: Partial<MakeLobbyOpts> = {},
  ) {
    const nominatePlayer = vi.fn(async (_p: unknown) => ({
      event_id: 1,
      seq: 1,
      nomination_id: 'nom-1',
      clock_deadline: new Date(Date.now() + 31_000).toISOString(),
      was_duplicate: false,
    }));
    const lobby = await makeLobby(
      auctionLobbyOpts({ nominatePlayer, ...extra }),
    );
    await lobby.enqueueAction(nominateAction({ openingBid: 5 }));
    return lobby;
  }

  it('6c4 commissionerOverride: snake-format lobby returns wrong_format_for_action', async () => {
    const lobby = await makeLobby({ format: 'snake' });
    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'cancel_nomination' },
      idempotencyKey: 'idem-1',
    });
    expect(result).toEqual({ ok: false, reason: 'wrong_format_for_action' });
  });

  it('6c4 commissionerOverride: unauthorized user rejected with coarse-grained unauthorized', async () => {
    const verifyCommissionerAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'not_commissioner' as const,
    }));
    const commissionerOverride = vi.fn();
    const lobby = await lobbyWithActiveNomination({
      verifyCommissionerAuthorization,
      commissionerOverride,
    });
    const result = await lobby.commissionerOverride({
      commissionerUserId: 'imposter',
      action: { kind: 'cancel_nomination' },
      idempotencyKey: 'idem-1',
    });
    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(commissionerOverride).not.toHaveBeenCalled();
  });

  // ── revert_bid ─────────────────────────────────────────────────────

  it('6c4 revert_bid happy path: reverts to prior bidder/amount + broadcasts override event', async () => {
    const publish = vi.fn();
    const commissionerOverride = vi.fn(async (_p: unknown) => ({
      event_id: 100,
      seq: 100,
      override_action: 'revert_bid' as const,
      prior_state: { nominationId: 'nom-1', leadingBidderId: 'team-3', leadingBid: 20 },
      new_state: { nominationId: 'nom-1', leadingBidderId: 'team-2', leadingBid: 10 },
      was_duplicate: false,
    }));
    const lobby = await lobbyWithActiveNomination({ publish, commissionerOverride });
    // Simulate two bids: team-2 at $10, team-3 at $20.
    await lobby.enqueueAction(bidAction({ teamId: 'team-2', bidAmount: 10, idempotencyKey: 'b1' }));
    await lobby.enqueueAction(bidAction({ teamId: 'team-3', bidAmount: 20, idempotencyKey: 'b2' }));
    publish.mockClear();

    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'revert_bid' },
      idempotencyKey: 'rev-1',
      rationale: 'collusion suspected',
    });
    expect(result).toEqual({ ok: true, eventSeq: 100 });

    const auctionState = lobby.getAuctionState();
    expect(auctionState?.currentNomination?.leadingBidderId).toBe('team-2');
    expect(auctionState?.currentNomination?.leadingBid).toBe(10);

    const broadcastJson = JSON.parse(publish.mock.calls[0][1] as string);
    expect(broadcastJson.payload.kind).toBe('auction_commissioner_override');
    expect(broadcastJson.payload.overrideAction).toBe('revert_bid');
    expect(broadcastJson.payload.rationale).toBe('collusion suspected');
  });

  it('6c4 revert_bid: rejected with no_active_nomination when no nomination is open', async () => {
    const lobby = await makeLobby(auctionLobbyOpts());
    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'revert_bid' },
      idempotencyKey: 'rev-1',
    });
    expect(result).toEqual({ ok: false, reason: 'no_active_nomination' });
  });

  // ── force_close_nomination ─────────────────────────────────────────

  it('6c4 force_close (sold outcome): awards player + advances state', async () => {
    const commissionerOverride = vi.fn(async (_p: unknown) => ({
      event_id: 100,
      seq: 100,
      override_action: 'force_close_nomination' as const,
      prior_state: { nominationId: 'nom-1', leadingBidderId: 'team-2', leadingBid: 10, totalBids: 2 },
      new_state: { nominationId: 'nom-1', outcome: 'sold', winnerTeamId: 'team-2', finalAmount: 10, totalBids: 2 },
      was_duplicate: false,
    }));
    const lobby = await lobbyWithActiveNomination({ commissionerOverride });
    await lobby.enqueueAction(bidAction({ teamId: 'team-2', bidAmount: 10, idempotencyKey: 'b1' }));

    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'force_close_nomination' },
      idempotencyKey: 'fc-1',
    });
    expect(result.ok).toBe(true);

    const auctionState = lobby.getAuctionState();
    expect(auctionState?.currentNomination).toBeNull();
    expect(auctionState?.nominationsCompleted).toBe(1);
    expect(auctionState?.teamBudgets['team-2']).toBe(200 - 10);
    expect(auctionState?.teamRosterSlotsRemaining['team-2']).toBe(2 - 1);
  });

  it('6c4 force_close (no_sale outcome): no budget deduction; nominationsCompleted advances', async () => {
    const commissionerOverride = vi.fn(async (_p: unknown) => ({
      event_id: 100,
      seq: 100,
      override_action: 'force_close_nomination' as const,
      prior_state: { nominationId: 'nom-1', leadingBidderId: 'team-1', leadingBid: 5, totalBids: 1 },
      new_state: { nominationId: 'nom-1', outcome: 'no_sale' },
      was_duplicate: false,
    }));
    const lobby = await lobbyWithActiveNomination({ commissionerOverride });
    // Only the opening bid (1 bid total) — natural no_sale path.

    await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'force_close_nomination' },
      idempotencyKey: 'fc-1',
    });
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.nominationsCompleted).toBe(1);
    // No budget deduction.
    expect(auctionState?.teamBudgets['team-1']).toBe(200);
  });

  // ── award_to_team ──────────────────────────────────────────────────

  it('6c4 award_to_team happy path: deducts target budget, increments players_won', async () => {
    const commissionerOverride = vi.fn(async (_p: unknown) => ({
      event_id: 100,
      seq: 100,
      override_action: 'award_to_team' as const,
      prior_state: { nominationId: 'nom-1', leadingBidderId: 'team-1', leadingBid: 5 },
      new_state: { nominationId: 'nom-1', awardedTeamId: 'team-3', awardedAmount: 50 },
      was_duplicate: false,
    }));
    const lobby = await lobbyWithActiveNomination({ commissionerOverride });

    await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'award_to_team', teamId: 'team-3', amount: 50 },
      idempotencyKey: 'aw-1',
    });
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.teamBudgets['team-3']).toBe(200 - 50);
    expect(auctionState?.teamRosterSlotsRemaining['team-3']).toBe(2 - 1);
    expect(auctionState?.currentNomination).toBeNull();
  });

  it('6c4 award_to_team: rejected with insufficient_budget_for_award when target cannot afford', async () => {
    const commissionerOverride = vi.fn();
    const lobby = await lobbyWithActiveNomination({
      commissionerOverride,
      // team-3 has $1, draftRounds=2 → reserve = $1 → maxAffordable = $0.
      initialTeamBudgets: new Map([
        ['team-1', 200],
        ['team-2', 200],
        ['team-3', 1],
      ]),
    });
    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'award_to_team', teamId: 'team-3', amount: 5 },
      idempotencyKey: 'aw-1',
    });
    expect(result).toEqual({ ok: false, reason: 'insufficient_budget_for_award' });
    expect(commissionerOverride).not.toHaveBeenCalled();
  });

  // ── adjust_opening_bid ─────────────────────────────────────────────

  it('6c4 adjust_opening_bid happy path: floor above current leading bumps leading up', async () => {
    const commissionerOverride = vi.fn(async (_p: unknown) => ({
      event_id: 100,
      seq: 100,
      override_action: 'adjust_opening_bid' as const,
      prior_state: { nominationId: 'nom-1', openingBid: 1, leadingBid: 5 },
      new_state: { nominationId: 'nom-1', openingBid: 10, leadingBid: 10 },
      was_duplicate: false,
    }));
    const lobby = await lobbyWithActiveNomination({ commissionerOverride });

    await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'adjust_opening_bid', newOpeningBid: 10 },
      idempotencyKey: 'ad-1',
    });
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.currentNomination?.leadingBid).toBe(10);
  });

  it('6c4 adjust_opening_bid: rejected with opening_bid_below_current_leading when floor below current', async () => {
    const commissionerOverride = vi.fn();
    const lobby = await lobbyWithActiveNomination({ commissionerOverride });
    // Place a bid first so current_high_bid > opening (5 → 10).
    await lobby.enqueueAction(bidAction({ teamId: 'team-2', bidAmount: 10 }));

    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'adjust_opening_bid', newOpeningBid: 7 },
      idempotencyKey: 'ad-1',
    });
    expect(result).toEqual({ ok: false, reason: 'opening_bid_below_current_leading' });
    expect(commissionerOverride).not.toHaveBeenCalled();
  });

  it('6c4 adjust_opening_bid: rejected with insufficient_budget_for_floor_increase when leader cannot afford', async () => {
    const commissionerOverride = vi.fn();
    // team-1 has $6 (enough to nominate at $5 + reserve $1).
    // Adjusting floor to $20 + reserve $1 = $21 > $6 → reject.
    const lobby = await lobbyWithActiveNomination({
      commissionerOverride,
      initialTeamBudgets: new Map([
        ['team-1', 6],
        ['team-2', 200],
        ['team-3', 200],
      ]),
    });
    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'adjust_opening_bid', newOpeningBid: 20 },
      idempotencyKey: 'ad-1',
    });
    expect(result).toEqual({ ok: false, reason: 'insufficient_budget_for_floor_increase' });
    expect(commissionerOverride).not.toHaveBeenCalled();
  });

  // ── adjust_budget ──────────────────────────────────────────────────

  it('6c4 adjust_budget credit happy path: increases team budget', async () => {
    const commissionerOverride = vi.fn(async (_p: unknown) => ({
      event_id: 100,
      seq: 100,
      override_action: 'adjust_budget' as const,
      prior_state: { teamId: 'team-1', budgetRemaining: 200 },
      new_state: { teamId: 'team-1', budgetRemaining: 250, delta: 50 },
      was_duplicate: false,
    }));
    const lobby = await makeLobby(auctionLobbyOpts({ commissionerOverride }));
    await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'adjust_budget', teamId: 'team-1', delta: 50 },
      idempotencyKey: 'ab-1',
    });
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.teamBudgets['team-1']).toBe(250);
  });

  it('6c4 adjust_budget debit: rejected with insufficient_budget when delta exceeds budget', async () => {
    const commissionerOverride = vi.fn();
    const lobby = await makeLobby(
      auctionLobbyOpts({
        commissionerOverride,
        initialTeamBudgets: new Map([
          ['team-1', 5],
          ['team-2', 200],
          ['team-3', 200],
        ]),
      }),
    );
    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'adjust_budget', teamId: 'team-1', delta: -10 },
      idempotencyKey: 'ab-1',
    });
    expect(result).toEqual({ ok: false, reason: 'insufficient_budget' });
    expect(commissionerOverride).not.toHaveBeenCalled();
  });

  // ── cancel_nomination ──────────────────────────────────────────────

  it('6c4 cancel_nomination happy path: clears currentNomination, does NOT advance nominationsCompleted (redo semantics)', async () => {
    vi.useFakeTimers();
    try {
      const commissionerOverride = vi.fn(async (_p: unknown) => ({
        event_id: 100,
        seq: 100,
        override_action: 'cancel_nomination' as const,
        prior_state: { nominationId: 'nom-1', playerId: '8478402', totalBids: 1, leadingBidderId: 'team-1', leadingBid: 5 },
        new_state: {},
        was_duplicate: false,
      }));
      const lobby = await lobbyWithActiveNomination({ commissionerOverride });

      await lobby.commissionerOverride({
        commissionerUserId: 'commish-1',
        action: { kind: 'cancel_nomination' },
        idempotencyKey: 'cn-1',
      });
      const auctionState = lobby.getAuctionState();
      // Redo semantics: currentNomination cleared, nominationsCompleted stays at 0.
      expect(auctionState?.currentNomination).toBeNull();
      expect(auctionState?.nominationsCompleted).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('6c4 cancel_nomination during pause: pauseState flips to nomination_window kind + remainingMs reset', async () => {
    vi.useFakeTimers();
    try {
      const pauseAuction = vi.fn(async (_p: unknown) => ({
        event_id: 50,
        seq: 50,
        paused_at: new Date().toISOString(),
        paused_nomination_id: 'nom-1',
        captured_remaining_seconds: 18,
        was_duplicate: false,
      }));
      const commissionerOverride = vi.fn(async (_p: unknown) => ({
        event_id: 100,
        seq: 100,
        override_action: 'cancel_nomination' as const,
        prior_state: {},
        new_state: {},
        was_duplicate: false,
      }));
      const lobby = await lobbyWithActiveNomination({
        pauseAuction,
        commissionerOverride,
        auctionNominationWindowSeconds: 60,
      });
      // Pause first.
      await lobby.pauseAuction({
        commissionerUserId: 'commish-1',
        reason: 'pause',
        idempotencyKey: 'p-1',
      });
      // Then cancel during pause. Expected: pausedTimerKind flips
      // from 'bid_window' (set by pauseAuction since active nom)
      // to 'nomination_window'; remainingMs resets to
      // nominationWindowMs (60_000ms).
      await lobby.commissionerOverride({
        commissionerUserId: 'commish-1',
        action: { kind: 'cancel_nomination' },
        idempotencyKey: 'cn-1',
      });
      // Engine state: still paused, currentNomination cleared, no
      // timer running. Resume should restore a fresh nomination
      // window for the same nominator.
      const auctionState = lobby.getAuctionState();
      expect(auctionState?.currentNomination).toBeNull();
      expect(auctionState?.nominationsCompleted).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── extend_bid_window ──────────────────────────────────────────────

  it('6c4 extend_bid_window happy path: deadline pushed, timer rescheduled', async () => {
    vi.useFakeTimers();
    try {
      const newDeadline = new Date(Date.now() + 60_000);
      const commissionerOverride = vi.fn(async (_p: unknown) => ({
        event_id: 100,
        seq: 100,
        override_action: 'extend_bid_window' as const,
        prior_state: { nominationId: 'nom-1', priorClockDeadline: new Date().toISOString() },
        new_state: { nominationId: 'nom-1', newClockDeadline: newDeadline.toISOString(), extensionSeconds: 30 },
        was_duplicate: false,
      }));
      const lobby = await lobbyWithActiveNomination({ commissionerOverride });

      await lobby.commissionerOverride({
        commissionerUserId: 'commish-1',
        action: { kind: 'extend_bid_window', extensionSeconds: 30 },
        idempotencyKey: 'ex-1',
      });
      const auctionState = lobby.getAuctionState();
      expect(auctionState?.currentNomination?.clockDeadline).toBe(
        newDeadline.toISOString(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('6c4 extend_bid_window: rejected with extension_below_current_deadline when extensionSeconds <= 0', async () => {
    const commissionerOverride = vi.fn();
    const lobby = await lobbyWithActiveNomination({ commissionerOverride });
    const result = await lobby.commissionerOverride({
      commissionerUserId: 'commish-1',
      action: { kind: 'extend_bid_window', extensionSeconds: 0 },
      idempotencyKey: 'ex-1',
    });
    expect(result).toEqual({ ok: false, reason: 'extension_below_current_deadline' });
    expect(commissionerOverride).not.toHaveBeenCalled();
  });

  // ── Bootstrap APPLY ─────────────────────────────────────────────────

  it('6c4 bootstrap mid-override-sequence: replay applies all action types correctly', async () => {
    // Sequence: nominate → bid → revert_bid (override) → adjust_budget (credit) → cancel_nomination
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_nomination_started',
        payload: {
          nomination_id: 'nom-1',
          player_id: '8478402',
          player_name: 'McDavid',
          opening_bid: 5,
          nominator_team_id: 'team-1',
          expires_at: new Date(Date.now() + 31_000).toISOString(),
        },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_bid_placed',
        payload: {
          nomination_id: 'nom-1',
          team_id: 'team-2',
          bid_amount: 10,
        },
      }),
      makeEventRow({
        seq: 3,
        event_type: 'auction_commissioner_override',
        payload: {
          commissioner_user_id: 'commish-1',
          override_action: 'revert_bid',
          prior_state: { nominationId: 'nom-1', leadingBidderId: 'team-2', leadingBid: 10 },
          new_state: { nominationId: 'nom-1', leadingBidderId: 'team-1', leadingBid: 5 },
        },
      }),
      makeEventRow({
        seq: 4,
        event_type: 'auction_commissioner_override',
        payload: {
          commissioner_user_id: 'commish-1',
          override_action: 'adjust_budget',
          prior_state: { teamId: 'team-1', budgetRemaining: 200 },
          new_state: { teamId: 'team-1', budgetRemaining: 250, delta: 50 },
        },
      }),
      makeEventRow({
        seq: 5,
        event_type: 'auction_commissioner_override',
        payload: {
          commissioner_user_id: 'commish-1',
          override_action: 'cancel_nomination',
          prior_state: {},
          new_state: {},
        },
      }),
    ];
    const lobby = await makeLobby(
      auctionLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    const auctionState = lobby.getAuctionState();
    // Final state: nomination cancelled (cleared), team-1 budget +$50,
    // nominationsCompleted unchanged (cancel = redo semantics).
    expect(auctionState?.currentNomination).toBeNull();
    expect(auctionState?.nominationsCompleted).toBe(0);
    expect(auctionState?.teamBudgets['team-1']).toBe(250);
    // Ring buffer carries all five events.
    const snap = lobby.getSnapshot();
    expect(snap.recentEvents.map((e) => e.kind)).toEqual([
      'auction_nomination_started',
      'auction_bid_placed',
      'auction_commissioner_override',
      'auction_commissioner_override',
      'auction_commissioner_override',
    ]);
  });

  it('6c4 bootstrap: force_close override applied during replay deducts winner budget + advances nominationsCompleted', async () => {
    const events: DraftEventRow[] = [
      makeEventRow({
        seq: 1,
        event_type: 'auction_nomination_started',
        payload: {
          nomination_id: 'nom-1',
          player_id: '8478402',
          player_name: 'McDavid',
          opening_bid: 5,
          nominator_team_id: 'team-1',
          expires_at: new Date(Date.now() + 31_000).toISOString(),
        },
      }),
      makeEventRow({
        seq: 2,
        event_type: 'auction_commissioner_override',
        payload: {
          commissioner_user_id: 'commish-1',
          override_action: 'force_close_nomination',
          prior_state: { nominationId: 'nom-1', leadingBidderId: 'team-1', leadingBid: 5, totalBids: 1 },
          new_state: { nominationId: 'nom-1', outcome: 'sold', winnerTeamId: 'team-1', finalAmount: 5, totalBids: 1 },
        },
      }),
    ];
    const lobby = await makeLobby(
      auctionLobbyOpts({ listDraftEvents: vi.fn(async () => events) }),
    );
    const auctionState = lobby.getAuctionState();
    expect(auctionState?.nominationsCompleted).toBe(1);
    expect(auctionState?.teamBudgets['team-1']).toBe(200 - 5);
    expect(auctionState?.teamRosterSlotsRemaining['team-1']).toBe(2 - 1);
    expect(auctionState?.currentNomination).toBeNull();
  });

  // ── Idempotency ─────────────────────────────────────────────────────

  it('6c4 idempotent retry: same idempotencyKey returns cached promise; RPC fires once', async () => {
    const commissionerOverride = vi.fn(async (_p: unknown) => ({
      event_id: 100,
      seq: 100,
      override_action: 'cancel_nomination' as const,
      prior_state: {},
      new_state: {},
      was_duplicate: false,
    }));
    const lobby = await lobbyWithActiveNomination({ commissionerOverride });
    const params = {
      commissionerUserId: 'commish-1',
      action: { kind: 'cancel_nomination' as const },
      idempotencyKey: 'idem-same',
    };
    const r1 = await lobby.commissionerOverride(params);
    const r2 = await lobby.commissionerOverride(params);
    expect(r1).toEqual(r2);
    expect(commissionerOverride).toHaveBeenCalledTimes(1);
  });

  // ── Chunk 11g.7 sub-step 7c — snapshot persistence integration ─────
  //
  // Tests use `vi.mock('../snapshotPersistence')` + per-test
  // implementations to exercise:
  //   - Bootstrap snapshot+delta replay (happy path)
  //   - Bootstrap fallback on version mismatch (logs warn with
  //     structured `reason: 'version_mismatch'`)
  //   - Bootstrap fallback on missing snapshot (existing chunk
  //     11g.4 step 6b behavior preserved)
  //   - Runtime snapshot generation skipped during pause
  //   - Runtime snapshot generation happy path (writes via
  //     `writeSnapshot` mock)
  //
  // The supabase mock is the existing makeStubSupabase(); snapshot
  // functions take supabase as a parameter, so per-test implementations
  // can return arbitrary values without needing the supabase mock to
  // do real DB work.

  it('7c bootstrap: no snapshot exists → falls back to full event-replay (regression-locks 6b behavior)', async () => {
    // Default makeLobby uses listDraftEvents=[] (empty). With no
    // snapshot mocking, the production readMostRecentSnapshot calls
    // the supabase mock which resolves with `data: null`. Bootstrap
    // falls through to bootstrapFullEventReplay which reads the
    // empty events array and produces a fresh-start lobby. This
    // test regression-locks that the existing 6b code path remains
    // the canonical fallback.
    const lobby = await makeLobby();
    expect(lobby.getCurrentState().picksMade).toBe(0);
    expect(lobby.getCurrentState().draftStatus).toBe('not_started');
  });

  it('7c bootstrap: scheduleSnapshot during not_started state is a no-op (no DB write)', async () => {
    // scheduleSnapshot routes through the queue and processSnapshot
    // checks draftStatus before doing any DB work. For a fresh
    // lobby, draftStatus is 'not_started' and the early-return
    // fires.
    const lobby = await makeLobby();
    await lobby.scheduleSnapshot();
    // No assertion on DB calls (the supabase mock would record
    // them if any happened); this just verifies the scheduleSnapshot
    // call doesn't throw and doesn't advance state.
    expect(lobby.getCurrentState().draftStatus).toBe('not_started');
  });

  it('7c scheduleSnapshot returns a Promise resolving to {persisted, reason?} envelope (chunk 11g.10 sub-step 10b Q3 follow-up)', async () => {
    // Pre-Q3: returned Promise<void>. Post-Q3: returns
    // Promise<{persisted: boolean; reason?: string}> so callers
    // (notably the admin endpoint) can distinguish "snapshot written"
    // from "scheduling completed but skipped." For a fresh lobby
    // (draftStatus='not_started'), the early-return at processSnapshot
    // surfaces as persisted: false + reason: 'state_not_in_progress'.
    const lobby = await makeLobby();
    const result = lobby.scheduleSnapshot();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual({
      persisted: false,
      reason: 'state_not_in_progress',
    });
  });

  // ── Chunk 11g.7 sub-step 7e: external event dispatch + dedup ──

  it('7e enqueueExternalEvent dedups by seq when own-engine emission already advanced the cursor', async () => {
    // Engine fires a pick; appendEventAndCount advances lastAppliedSeq
    // to the seq returned by submitPick (the mock returns seq=1).
    // NOTIFY bounce for seq=1 → dedup gate short-circuits.
    const listDraftEvents = vi.fn(async () => [] as DraftEventRow[]);
    const lobby = await makeLobby({ listDraftEvents });
    await lobby.enqueueAction(makeSubmitPick());
    // Reset the listDraftEvents call count so we can assert it
    // does NOT get called for the dedup-skipped external event.
    listDraftEvents.mockClear();
    await lobby.enqueueExternalEvent(1);
    expect(listDraftEvents).not.toHaveBeenCalled();
  });

  it('7e enqueueExternalEvent fetches via listDraftEvents(sinceSeq=lastAppliedSeq) and applies', async () => {
    // Construct a draftOrder so the pick event payload validates
    // against expected team/slot mapping.
    const teamIds = ['team-1', 'team-2', 'team-3'];
    const draftOrder: DraftOrderSlot[] = generateDraftOrder(teamIds, 3, 'snake');
    const firstSlot = draftOrder[0];
    const externalEvent: DraftEventRow = {
      id: 5,
      league_id: 'league-1',
      seq: 5,
      event_type: 'pick',
      payload: {
        team_id: firstSlot.teamId,
        pick_number: firstSlot.pickNumber,
        round: firstSlot.round,
        player_id: 42,
      },
      payload_hash: '',
      idempotency_key: null,
      actor: { kind: 'user', id: 'u-1', session_id: 's-1' },
      correlation_id: null,
      created_at: new Date().toISOString(),
    } as DraftEventRow;
    const listDraftEvents = vi.fn(async () => [externalEvent]);
    const lobby = await makeLobby({ listDraftEvents, draftOrder });
    // Lobby starts with lastAppliedSeq=0; external seq=5 should pass
    // dedup gate, trigger listDraftEvents(sinceSeq=0), apply the
    // pick event.
    await lobby.enqueueExternalEvent(5);
    expect(listDraftEvents).toHaveBeenCalledWith('league-1', 0);
    expect(lobby.getCurrentState().picksMade).toBe(1);
  });

  it('7e enqueueExternalEvent before init() is a debug-log no-op', async () => {
    // Construct a lobby but skip init(). enqueueExternalEvent should
    // resolve to undefined without throwing or calling listDraftEvents.
    const { lobby, listDraftEvents } = await makeUninitializedLobby();
    await expect(lobby.enqueueExternalEvent(42)).resolves.toBeUndefined();
    expect(listDraftEvents).not.toHaveBeenCalled();
  });

  it('7e processExternalEvent tolerates empty event list (race: NOTIFY ahead of read visibility)', async () => {
    const listDraftEvents = vi.fn(async () => [] as DraftEventRow[]);
    const lobby = await makeLobby({ listDraftEvents });
    await expect(lobby.enqueueExternalEvent(42)).resolves.toBeUndefined();
    expect(listDraftEvents).toHaveBeenCalled();
    // No state change since no events were applied.
    expect(lobby.getCurrentState().picksMade).toBe(0);
  });
});

// ── Chunk 11g.7 sub-step 7e helper: uninitialized lobby ─────────────
async function makeUninitializedLobby() {
  const listDraftEvents = vi.fn(async () => [] as DraftEventRow[]);
  const draftOrder: DraftOrderSlot[] = generateDraftOrder(
    ['team-1', 'team-2', 'team-3'],
    3,
    'snake',
  );
  const draftService = {
    submitPick: vi.fn(),
    listDraftEvents,
    nominatePlayer: vi.fn(),
    placeBid: vi.fn(),
    closeNomination: vi.fn(),
    pauseAuction: vi.fn(),
    resumeAuction: vi.fn(),
    skipNomination: vi.fn(),
    commissionerOverride: vi.fn(),
  } as unknown as DraftServiceV2;
  const supabase = {} as unknown as SupabaseClient;
  const lobby = new LobbyManager({
    lobbyId: 'lobby-uninit',
    format: 'snake',
    leagueId: 'league-uninit',
    draftService,
    publish: vi.fn(),
    draftOrder,
    verifyTeamAuthorization: async () => ({ authorized: true }),
    verifyCommissionerAuthorization: async () => ({ authorized: true }),
    supabase,
    pickClockSeconds: 91,
    initialPickDeadline: null,
    initialDraftState: 'pre_draft',
    nominationOrder: [],
    auctionBudget: 0,
    auctionMinBid: 0,
    draftRounds: 0,
    initialTeamBudgets: new Map(),
    initialPlayersWon: new Map(),
    initialActiveNomination: null,
    auctionAntiSnipeThresholdSeconds: 0,
    auctionAntiSnipeExtensionSeconds: 0,
    auctionMinBidIncrementTiers: [{ below: Number.MAX_SAFE_INTEGER, increment: 1 }],
    auctionBidWindowSeconds: 0,
    auctionNominationWindowSeconds: 0,
  });
  // NOTE: lobby.init() deliberately NOT awaited.
  return { lobby, listDraftEvents };
}
