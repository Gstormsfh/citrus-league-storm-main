// Phase 4.5 chunk 11g.7 sub-step 7a — engine-side log-call
// assertions on critical error paths.
//
// Per the recon's recommendation: assert log calls only on ERROR-
// level emits in critical paths (RPC failures, bootstrap failures,
// auth callback exceptions). Don't add log assertions to INFO/DEBUG
// happy-path emits — keeps tests focused on behavior, not log shape.
//
// The structured-logger singleton is normally no-op under
// LOG_LEVEL=SILENT (vitest setup file). These tests use vi.spyOn
// to assert against it AT the singleton level — the spy intercepts
// calls regardless of the active level filter.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { structuredLogger } from '@citrus/shared';
import { LobbyManager, type LobbyManagerOptions } from '../draft/LobbyManager';
import { LobbyRegistry } from '../draft/LobbyRegistry';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CommissionerAuthorizationResult,
  TeamAuthorizationResult,
} from '../draft/types';
import type {
  DraftEventRow,
  DraftServiceV2,
  SubmitPickResult,
} from '../services/DraftServiceV2';

let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(structuredLogger, 'error');
  infoSpy = vi.spyOn(structuredLogger, 'info');
});

afterEach(() => {
  errorSpy.mockRestore();
  infoSpy.mockRestore();
});

const ALLOW_ALL_AUTH: (
  userId: string,
  teamId: string,
) => Promise<TeamAuthorizationResult> = async () => ({ authorized: true });
const ALLOW_ALL_COMMISH_AUTH: (
  userId: string,
  leagueId: string,
) => Promise<CommissionerAuthorizationResult> = async () => ({ authorized: true });

function makeStubSupabase(): SupabaseClient {
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

function makeLobbyOptions(
  overrides: Partial<LobbyManagerOptions> = {},
): LobbyManagerOptions {
  const submitPick = vi.fn().mockResolvedValue({
    event_id: 1,
    seq: 1,
    pick_deadline: null,
    was_duplicate: false,
  } satisfies SubmitPickResult);
  const listDraftEvents = vi.fn(async () => [] as DraftEventRow[]);
  return {
    lobbyId: 'lobby-1',
    format: 'snake',
    leagueId: 'league-1',
    draftService: { submitPick, listDraftEvents } as unknown as DraftServiceV2,
    publish: vi.fn(),
    draftOrder: [
      { round: 1, pickNumber: 1, teamId: 'team-1' },
      { round: 1, pickNumber: 2, teamId: 'team-2' },
    ],
    verifyTeamAuthorization: ALLOW_ALL_AUTH,
    verifyCommissionerAuthorization: ALLOW_ALL_COMMISH_AUTH,
    supabase: makeStubSupabase(),
    pickClockSeconds: 91,
    initialPickDeadline: null,
    initialDraftState: null,
    nominationOrder: [],
    auctionBudget: 0,
    auctionMinBid: 0,
    draftRounds: 0,
    initialTeamBudgets: new Map(),
    initialPlayersWon: new Map(),
    initialActiveNomination: null,
    auctionAntiSnipeThresholdSeconds: 0,
    auctionAntiSnipeExtensionSeconds: 0,
    auctionMinBidIncrementTiers: [
      { below: Number.MAX_SAFE_INTEGER, increment: 1 },
    ],
    auctionBidWindowSeconds: 0,
    auctionNominationWindowSeconds: 0,
    ...overrides,
  };
}

describe('Engine error-path log assertions (chunk 11g.7 sub-step 7a)', () => {
  it('processSubmitPick non-AppError throw → structuredLogger.error called with engine context', async () => {
    const submitPick = vi.fn().mockRejectedValue(new Error('synthetic crash'));
    const opts = makeLobbyOptions({
      draftService: {
        submitPick,
        listDraftEvents: vi.fn(async () => [] as DraftEventRow[]),
      } as unknown as DraftServiceV2,
    });
    const lobby = new LobbyManager(opts);
    await lobby.init();

    const result = await lobby.enqueueAction({
      kind: 'submit_pick',
      teamId: 'team-1',
      playerId: '8478402',
      userId: 'user-1',
      sessionId: 'sess-1',
      idempotencyKey: 'idem-1',
      actorKind: 'user',
    });

    expect(result).toEqual({ ok: false, reason: 'internal_error' });
    expect(errorSpy).toHaveBeenCalled();
    // The first error call should be the unexpected-throw site.
    // We don't assert exact event name (free-text holdover from the
    // bulk-rename pass; future commits restructure to canonical
    // dot-namespaced names), but DO assert that the error was logged
    // with the synthetic Error as the err arg — which is the load-
    // bearing piece for ops alerting (stack trace lands in `err.stack`).
    const found = errorSpy.mock.calls.some((call) => {
      const arg3 = call[2]; // 3rd positional = err
      return arg3 instanceof Error && arg3.message === 'synthetic crash';
    });
    expect(found).toBe(true);
  });

  it('LobbyRegistry construction failure → structuredLogger.error called with lobbyId + leagueId context', async () => {
    const draftService = {
      submitPick: vi.fn(),
      listDraftEvents: vi.fn(),
    } as unknown as DraftServiceV2;
    const lobbyConfigLookup = vi
      .fn()
      .mockRejectedValue(new Error('league config not found'));
    const registry = new LobbyRegistry({
      draftService,
      lobbyConfigLookup,
      publish: vi.fn(),
      verifyTeamAuthorization: ALLOW_ALL_AUTH,
      verifyCommissionerAuthorization: ALLOW_ALL_COMMISH_AUTH,
      supabase: makeStubSupabase(),
    });

    await expect(
      registry.getOrCreate('lobby-fail-1', 'league-1'),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    const call = errorSpy.mock.calls.find((c) => {
      const ctx = c[1] as Record<string, unknown> | undefined;
      return ctx?.lobbyId === 'lobby-fail-1' && ctx?.leagueId === 'league-1';
    });
    expect(call).toBeDefined();
    // 3rd positional must be the original Error
    expect(call?.[2]).toBeInstanceOf(Error);
  });

  it('verifyTeamAuthorization callback throw is logged at error level', async () => {
    const verifyTeamAuthorization: (
      userId: string,
      teamId: string,
    ) => Promise<TeamAuthorizationResult> = vi
      .fn()
      .mockRejectedValue(new Error('auth backend down'));
    const opts = makeLobbyOptions({ verifyTeamAuthorization });
    const lobby = new LobbyManager(opts);
    await lobby.init();

    const result = await lobby.enqueueAction({
      kind: 'submit_pick',
      teamId: 'team-1',
      playerId: '8478402',
      userId: 'user-1',
      sessionId: 'sess-1',
      idempotencyKey: 'idem-2',
      actorKind: 'user',
    });

    expect(result).toEqual({ ok: false, reason: 'internal_error' });
    expect(errorSpy).toHaveBeenCalled();
    const found = errorSpy.mock.calls.some((call) => {
      const arg3 = call[2];
      return arg3 instanceof Error && arg3.message === 'auth backend down';
    });
    expect(found).toBe(true);
  });

  it('init() called twice is a no-op — does NOT emit error (regression: idempotent init)', async () => {
    const opts = makeLobbyOptions();
    const lobby = new LobbyManager(opts);
    await lobby.init();
    await lobby.init(); // second call is a no-op
    // No error-level log on the no-op path.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('enqueueAction without init() throws AND logs error', async () => {
    const opts = makeLobbyOptions();
    const lobby = new LobbyManager(opts);
    // Do NOT await init().

    await expect(
      lobby.enqueueAction({
        kind: 'submit_pick',
        teamId: 'team-1',
        playerId: '8478402',
        userId: 'user-1',
        sessionId: 'sess-1',
        idempotencyKey: 'idem-3',
        actorKind: 'user',
      }),
    ).rejects.toThrow(/before init/);

    expect(errorSpy).toHaveBeenCalled();
  });
});
