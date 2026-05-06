// Phase 4.5 chunk 11g.4 step 4 — LobbyRegistry unit tests.
//
// 7 tests covering: lazy first-call construction, sequential reuse,
// concurrent same-key singleton-race fix, different-key isolation,
// failed-lookup recovery (in-flight Promise cleared on error),
// get/remove/size shape, and an explicit slow-formatLookup race
// regression that pins the singleton behavior.
//
// `makeRegistry` factory at top eliminates constructor boilerplate
// per test. The DraftServiceV2 is mocked via `as unknown as` since
// the registry never calls into it (it just hands the reference to
// each LobbyManager constructor).

import { describe, it, expect, vi } from 'vitest';
import { LobbyRegistry } from '../LobbyRegistry';
import { LobbyManager } from '../LobbyManager';
import type { DraftServiceV2 } from '../../services/DraftServiceV2';
import type { DraftFormat } from '../types';

// ── Test helpers ─────────────────────────────────────────────────────

interface MakeRegistryOpts {
  formatLookup?: (leagueId: string) => Promise<DraftFormat>;
  publish?: (topic: string, message: string) => void;
}

function makeRegistry(opts: MakeRegistryOpts = {}) {
  const submitPick = vi.fn();
  const draftService = { submitPick } as unknown as DraftServiceV2;
  const formatLookup =
    opts.formatLookup ?? vi.fn(async (_leagueId: string) => 'snake' as DraftFormat);
  const publish = opts.publish ?? vi.fn();
  const registry = new LobbyRegistry({ draftService, formatLookup, publish });
  return { registry, formatLookup, draftService, publish };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('LobbyRegistry (chunk 11g.4 step 4)', () => {
  it('lazily constructs a LobbyManager on first getOrCreate', async () => {
    const { registry, formatLookup } = makeRegistry();

    const lobby = await registry.getOrCreate('lobby-A', 'league-1');

    expect(lobby).toBeInstanceOf(LobbyManager);
    expect(lobby.lobbyId).toBe('lobby-A');
    expect(lobby.format).toBe('snake');
    expect(lobby.leagueId).toBe('league-1');
    expect(formatLookup).toHaveBeenCalledTimes(1);
    expect(formatLookup).toHaveBeenCalledWith('league-1');
    expect(registry.size()).toBe(1);
  });

  it('returns the same instance for sequential calls with the same lobbyId', async () => {
    const { registry, formatLookup } = makeRegistry();

    const a = await registry.getOrCreate('lobby-A', 'league-1');
    const b = await registry.getOrCreate('lobby-A', 'league-1');

    expect(b).toBe(a);
    expect(formatLookup).toHaveBeenCalledTimes(1);
  });

  it('returns the same instance for concurrent calls with the same lobbyId (singleton-race fix)', async () => {
    const { registry, formatLookup } = makeRegistry();

    const [a, b, c] = await Promise.all([
      registry.getOrCreate('lobby-A', 'league-1'),
      registry.getOrCreate('lobby-A', 'league-1'),
      registry.getOrCreate('lobby-A', 'league-1'),
    ]);

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(formatLookup).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(1);
  });

  it('returns different instances for different lobbyIds', async () => {
    const { registry, formatLookup } = makeRegistry();

    const a = await registry.getOrCreate('lobby-A', 'league-1');
    const b = await registry.getOrCreate('lobby-B', 'league-2');

    expect(a).not.toBe(b);
    expect(a.lobbyId).toBe('lobby-A');
    expect(b.lobbyId).toBe('lobby-B');
    expect(formatLookup).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(2);
  });

  it('clears the in-flight entry on construction failure so retry can succeed', async () => {
    let callCount = 0;
    const formatLookup = vi.fn(async (_leagueId: string) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('synthetic format lookup failure');
      }
      return 'snake' as DraftFormat;
    });
    const { registry } = makeRegistry({ formatLookup });

    await expect(registry.getOrCreate('lobby-A', 'league-1')).rejects.toThrow(
      'synthetic format lookup failure',
    );
    // Failed entry cleaned up so the next caller can retry.
    expect(registry.size()).toBe(0);

    const lobby = await registry.getOrCreate('lobby-A', 'league-1');
    expect(lobby).toBeInstanceOf(LobbyManager);
    expect(lobby.format).toBe('snake');
    expect(formatLookup).toHaveBeenCalledTimes(2);
    expect(registry.size()).toBe(1);
  });

  it('get() returns the constructed instance, undefined for missing or in-flight; remove() clears the entry', async () => {
    // Slow format lookup so we can observe the in-flight state
    // synchronously between getOrCreate and its resolution.
    const { registry } = makeRegistry({
      formatLookup: () =>
        new Promise<DraftFormat>((resolve) => setTimeout(() => resolve('snake'), 5)),
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

  it('singleton-race regression: 5 concurrent getOrCreate calls share one slow formatLookup invocation', async () => {
    const formatLookup = vi.fn(
      () =>
        new Promise<DraftFormat>((resolve) => setTimeout(() => resolve('snake'), 20)),
    );
    const { registry } = makeRegistry({ formatLookup });

    const promises = Array.from({ length: 5 }, () =>
      registry.getOrCreate('lobby-A', 'league-1'),
    );
    const results = await Promise.all(promises);

    const first = results[0];
    for (const r of results) {
      expect(r).toBe(first);
    }
    expect(formatLookup).toHaveBeenCalledTimes(1);
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
    const formatLookup = vi.fn(async () => 'snake' as DraftFormat);
    const registry = new LobbyRegistry({ draftService, formatLookup, publish });

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
});
