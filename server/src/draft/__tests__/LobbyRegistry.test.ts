// Phase 4.5 chunk 11g.4 step 4 — LobbyRegistry unit tests.
// Step 6a — `formatLookup` renamed to `lobbyConfigLookup` (returns
// `{ format, draftOrder }`) and `verifyTeamAuthorization` callback
// added. Existing tests adjusted; new test verifies forwarding.
//
// `makeRegistry` factory at top eliminates constructor boilerplate
// per test. The DraftServiceV2 is mocked via `as unknown as` since
// the registry never calls into it (it just hands the reference to
// each LobbyManager constructor).

import { describe, it, expect, vi } from 'vitest';
import { LobbyRegistry, type LobbyConfig } from '../LobbyRegistry';
import { LobbyManager } from '../LobbyManager';
import type { DraftServiceV2 } from '../../services/DraftServiceV2';
import type { DraftFormat, TeamAuthorizationResult } from '../types';
import { generateDraftOrder } from '../draftOrderGenerator';

// ── Test helpers ─────────────────────────────────────────────────────

const DEFAULT_DRAFT_ORDER = generateDraftOrder(
  ['team-1', 'team-2', 'team-3'],
  3,
  'snake',
);

const ALLOW_ALL_AUTH: (
  userId: string,
  teamId: string,
) => Promise<TeamAuthorizationResult> = async () => ({ authorized: true });

interface MakeRegistryOpts {
  lobbyConfigLookup?: (leagueId: string) => Promise<LobbyConfig>;
  publish?: (topic: string, message: string) => void;
  verifyTeamAuthorization?: (
    userId: string,
    teamId: string,
  ) => Promise<TeamAuthorizationResult>;
}

function makeRegistry(opts: MakeRegistryOpts = {}) {
  const submitPick = vi.fn();
  const draftService = { submitPick } as unknown as DraftServiceV2;
  const lobbyConfigLookup =
    opts.lobbyConfigLookup ??
    vi.fn(
      async (_leagueId: string) =>
        ({ format: 'snake' as DraftFormat, draftOrder: DEFAULT_DRAFT_ORDER }) satisfies LobbyConfig,
    );
  const publish = opts.publish ?? vi.fn();
  const verifyTeamAuthorization = opts.verifyTeamAuthorization ?? ALLOW_ALL_AUTH;
  const registry = new LobbyRegistry({
    draftService,
    lobbyConfigLookup,
    publish,
    verifyTeamAuthorization,
  });
  return { registry, lobbyConfigLookup, draftService, publish, verifyTeamAuthorization };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('LobbyRegistry (chunk 11g.4 step 4)', () => {
  it('lazily constructs a LobbyManager on first getOrCreate', async () => {
    const { registry, lobbyConfigLookup } = makeRegistry();

    const lobby = await registry.getOrCreate('lobby-A', 'league-1');

    expect(lobby).toBeInstanceOf(LobbyManager);
    expect(lobby.lobbyId).toBe('lobby-A');
    expect(lobby.format).toBe('snake');
    expect(lobby.leagueId).toBe('league-1');
    expect(lobbyConfigLookup).toHaveBeenCalledTimes(1);
    expect(lobbyConfigLookup).toHaveBeenCalledWith('league-1');
    expect(registry.size()).toBe(1);
  });

  it('returns the same instance for sequential calls with the same lobbyId', async () => {
    const { registry, lobbyConfigLookup } = makeRegistry();

    const a = await registry.getOrCreate('lobby-A', 'league-1');
    const b = await registry.getOrCreate('lobby-A', 'league-1');

    expect(b).toBe(a);
    expect(lobbyConfigLookup).toHaveBeenCalledTimes(1);
  });

  it('returns the same instance for concurrent calls with the same lobbyId (singleton-race fix)', async () => {
    const { registry, lobbyConfigLookup } = makeRegistry();

    const [a, b, c] = await Promise.all([
      registry.getOrCreate('lobby-A', 'league-1'),
      registry.getOrCreate('lobby-A', 'league-1'),
      registry.getOrCreate('lobby-A', 'league-1'),
    ]);

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(lobbyConfigLookup).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(1);
  });

  it('returns different instances for different lobbyIds', async () => {
    const { registry, lobbyConfigLookup } = makeRegistry();

    const a = await registry.getOrCreate('lobby-A', 'league-1');
    const b = await registry.getOrCreate('lobby-B', 'league-2');

    expect(a).not.toBe(b);
    expect(a.lobbyId).toBe('lobby-A');
    expect(b.lobbyId).toBe('lobby-B');
    expect(lobbyConfigLookup).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(2);
  });

  it('clears the in-flight entry on construction failure so retry can succeed', async () => {
    let callCount = 0;
    const lobbyConfigLookup = vi.fn(async (_leagueId: string) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('synthetic format lookup failure');
      }
      return { format: 'snake' as DraftFormat, draftOrder: DEFAULT_DRAFT_ORDER };
    });
    const { registry } = makeRegistry({ lobbyConfigLookup });

    await expect(registry.getOrCreate('lobby-A', 'league-1')).rejects.toThrow(
      'synthetic format lookup failure',
    );
    // Failed entry cleaned up so the next caller can retry.
    expect(registry.size()).toBe(0);

    const lobby = await registry.getOrCreate('lobby-A', 'league-1');
    expect(lobby).toBeInstanceOf(LobbyManager);
    expect(lobby.format).toBe('snake');
    expect(lobbyConfigLookup).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(1);
  });

  it('get() returns the constructed instance, undefined for missing or in-flight; remove() clears the entry', async () => {
    // Slow format lookup so we can observe the in-flight state
    // synchronously between getOrCreate and its resolution.
    const { registry } = makeRegistry({
      lobbyConfigLookup: () =>
        new Promise<LobbyConfig>((resolve) =>
          setTimeout(
            () => resolve({ format: 'snake', draftOrder: DEFAULT_DRAFT_ORDER }),
            5,
          ),
        ),
    });

    expect(registry.get('lobby-A')).toBeUndefined(); // missing

    const inFlight = registry.getOrCreate('lobby-A', 'league-1');
    // Synchronously after getOrCreate but before await: entry is a
    // Promise placeholder, so get() returns undefined.
    expect(registry.get('lobby-A')).toBeUndefined();

    const lobby = await inFlight;
    expect(registry.get('lobby-A')).toBe(lobby); // constructed
    expect(registry.size()).toBe(1);

    registry.remove('lobby-A');
    expect(registry.get('lobby-A')).toBeUndefined();
    expect(registry.size()).toBe(0);

    // remove() of a missing key is a safe no-op.
    expect(() => registry.remove('lobby-nonexistent')).not.toThrow();
  });

  it('singleton-race regression: 5 concurrent getOrCreate calls share one slow lobbyConfigLookup invocation', async () => {
    const lobbyConfigLookup = vi.fn(
      () =>
        new Promise<LobbyConfig>((resolve) =>
          setTimeout(
            () => resolve({ format: 'snake', draftOrder: DEFAULT_DRAFT_ORDER }),
            20,
          ),
        ),
    );
    const { registry } = makeRegistry({ lobbyConfigLookup });

    const promises = Array.from({ length: 5 }, () =>
      registry.getOrCreate('lobby-A', 'league-1'),
    );
    const results = await Promise.all(promises);

    const first = results[0];
    for (const r of results) {
      expect(r).toBe(first);
    }
    expect(lobbyConfigLookup).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(1);
  });

  // ── Step-5 new test (publish callback forwarding) ──────────────────

  it('forwards the publish callback to constructed LobbyManagers (step 5)', async () => {
    // We can't read LobbyManager's private `publish` field directly,
    // but we can prove the forwarding by exercising broadcast via a
    // submit_pick. The registry's draftService is mocked to return
    // a successful SubmitPickResult; the LobbyManager will then
    // broadcast, which calls the registry's publish callback.
    const publish = vi.fn();
    const submitPick = vi.fn().mockResolvedValue({
      event_id: 1,
      seq: 1,
      pick_deadline: null,
      was_duplicate: false,
    });
    const draftService = { submitPick } as unknown as DraftServiceV2;
    const lobbyConfigLookup = vi.fn(async () => ({
      format: 'snake' as DraftFormat,
      draftOrder: DEFAULT_DRAFT_ORDER,
    }));
    const registry = new LobbyRegistry({
      draftService,
      lobbyConfigLookup,
      publish,
      verifyTeamAuthorization: ALLOW_ALL_AUTH,
    });

    const lobby = await registry.getOrCreate('lobby-fwd-1', 'league-1');
    await lobby.enqueueAction({
      kind: 'submit_pick',
      teamId: 'team-1',
      playerId: '8478402',
      userId: 'user-1',
      sessionId: 'session-1',
      idempotencyKey: 'idem-fwd-1',
    });

    expect(publish).toHaveBeenCalled();
    const [topic] = publish.mock.calls[0];
    expect(topic).toBe('draft:lobby-fwd-1');
  });

  // ── Step-6a new tests (lobbyConfigLookup + verifyTeamAuthorization forwarding) ──

  it('forwards verifyTeamAuthorization to constructed LobbyManagers (step 6a, ADR-004 §5.3)', async () => {
    // Prove forwarding by exercising the auth check path: a denying
    // verifyTeamAuthorization should cause the LobbyManager to reject
    // submit_pick with 'unauthorized' and never call the RPC.
    const submitPick = vi.fn();
    const verifyTeamAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'not_owner' as const,
    }));
    const draftService = { submitPick } as unknown as DraftServiceV2;
    const lobbyConfigLookup = vi.fn(async () => ({
      format: 'snake' as DraftFormat,
      draftOrder: DEFAULT_DRAFT_ORDER,
    }));
    const registry = new LobbyRegistry({
      draftService,
      lobbyConfigLookup,
      publish: vi.fn(),
      verifyTeamAuthorization,
    });

    const lobby = await registry.getOrCreate('lobby-auth-fwd-1', 'league-1');
    const result = await lobby.enqueueAction({
      kind: 'submit_pick',
      teamId: 'team-1',
      playerId: '8478402',
      userId: 'user-1',
      sessionId: 'session-1',
      idempotencyKey: 'idem-auth-fwd-1',
    });

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(verifyTeamAuthorization).toHaveBeenCalledWith('user-1', 'team-1');
    expect(submitPick).not.toHaveBeenCalled();
  });

  it('forwards lobbyConfigLookup result (format + draftOrder) to constructed LobbyManagers', async () => {
    // Concrete proof that draftOrder is forwarded: the LobbyManager's
    // getCurrentState reflects the totalPicks length we put into the
    // config callback's return value.
    const customOrder = generateDraftOrder(['t-A', 't-B', 't-C', 't-D'], 5, 'snake');
    const lobbyConfigLookup = vi.fn(async () => ({
      format: 'snake' as DraftFormat,
      draftOrder: customOrder,
    }));
    const { registry } = makeRegistry({ lobbyConfigLookup });

    const lobby = await registry.getOrCreate('lobby-cfg-fwd-1', 'league-1');
    expect(lobby.getCurrentState().totalPicks).toBe(20); // 4 teams × 5 rounds
    expect(lobby.format).toBe('snake');
  });
});
