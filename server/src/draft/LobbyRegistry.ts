// Phase 4.5 chunk 11g.4 step 4 — LobbyRegistry: process-singleton mapping
// from `lobbyId` to a `LobbyManager` instance.
//
// One registry per Node process; one LobbyManager per active lobby.
// Keys: `lobbyId`. Values: either a fully-constructed `LobbyManager`
// OR a `Promise<LobbyManager>` while the format lookup + construction
// is in flight. The Promise placeholder is what fixes the
// "two concurrent callers, same lobbyId, both lazy-create" race —
// both find the same Promise and resolve to the same instance.
//
// Lifecycle: lobbies are created lazily on first `getOrCreate`; they
// are NOT evicted on last-disconnect. Chunk 11g.7's
// snapshot-and-bootstrap flow takes ownership of eviction (drafts
// that complete get snapshotted, then dropped via `remove`). Keeping
// the lobby alive between disconnects lets late reconnects hit the
// in-memory ring buffer instead of forcing a full Postgres resync.
//
// Format resolution: the caller injects a `formatLookup` callback so
// the registry doesn't directly depend on Supabase — testable +
// mockable. The callback throws on missing/invalid draftType
// (`autopick` and `offline` aren't live formats); the registry
// surfaces the throw to the caller and clears the in-flight entry
// so the next caller can retry.
//
// **Auth.uid() concern (deferred — tracked in
// docs/PHASE_4_5_PROJECT_PLAN.md Decision Log):** The registry hands
// every LobbyManager a SHARED `DraftServiceV2` instance backed by
// the admin Supabase client. `submit_pick_v2` enforces
// `auth.uid() = team.owner_id` when `actor.kind = 'user'` (see
// migration `20260425140000_draft_engine_v2_rpcs.sql` line 838).
// Under admin-client mode `auth.uid()` is null → unauthorized.
// Step 4 is unblocked because tests mock `submitPick`, but
// chunks 11g.5/11g.6 cannot land real picks until the auth model
// is resolved (recommended path: ADR proposing `submit_pick_v2`
// accept `service_role + actor.kind='user'` when the engine has
// independently verified the actor at WS upgrade time per chunk
// 11g.2 step 2's JWT validation).
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; LobbyManager
// principles — Principle 1 lobby-id sharding; line 145
// `Map<lobbyId, LobbyManager>`).

import { logger } from '@citrus/shared';
import type { DraftServiceV2 } from '../services/DraftServiceV2';
import { LobbyManager } from './LobbyManager';
import type { DraftFormat } from './types';

export interface LobbyRegistryOptions {
  /**
   * Shared `DraftServiceV2` passed to every LobbyManager constructed
   * by this registry. One instance per process — the RPC client is
   * stateless wrt lobby identity. See file-level JSDoc for the
   * deferred auth.uid() concern under admin-client mode.
   */
  draftService: DraftServiceV2;

  /**
   * Resolves the live-draft format for a given league. Called once
   * per lobby on first `getOrCreate`; the result is cached by the
   * LobbyManager itself (its `format` field is set at construction
   * and never mutates).
   *
   * Should throw on missing/invalid draftType so the caller (the
   * uWS upgrade handler) can close the WS cleanly. The thrown error
   * is logged at registry level and re-thrown to the caller.
   */
  formatLookup: (leagueId: string) => Promise<DraftFormat>;

  /**
   * uWS app-level publish callback — forwarded into every
   * `LobbyManager` constructed by this registry so they can
   * broadcast events to all subscribers of their `draft:${lobbyId}`
   * topic. Index.ts builds this from `app.publish.bind(app)` so the
   * LobbyManager stays uWS-agnostic for testability.
   *
   * Step 5 wires broadcast on every successful pick (event message)
   * plus presence join/leave; chunk 11g.6 will broadcast auction
   * state machine events; chunk 11g.7 will broadcast timer ticks.
   */
  publish: (topic: string, message: string) => void;
}

export class LobbyRegistry {
  private readonly draftService: DraftServiceV2;
  private readonly formatLookup: (leagueId: string) => Promise<DraftFormat>;
  private readonly publish: (topic: string, message: string) => void;

  /**
   * Lobby map: `lobbyId -> LobbyManager | Promise<LobbyManager>`.
   *
   * The union type is the singleton-race fix — `getOrCreate` inserts
   * a Promise placeholder synchronously before any `await`, so a
   * concurrent same-key call finds the in-flight Promise instead of
   * starting a second construction. Once construction resolves, the
   * Promise is replaced with the constructed instance so subsequent
   * synchronous `get` calls return it directly.
   */
  private readonly lobbies = new Map<string, LobbyManager | Promise<LobbyManager>>();

  constructor(opts: LobbyRegistryOptions) {
    this.draftService = opts.draftService;
    this.formatLookup = opts.formatLookup;
    this.publish = opts.publish;
  }

  /**
   * Get the LobbyManager for `lobbyId`, constructing it lazily on
   * first call. Concurrent same-key calls share one Promise — the
   * format lookup + LobbyManager construction happens at most once
   * per lobby lifetime.
   *
   * On error (formatLookup throws, LobbyManager constructor throws),
   * the in-flight Promise is removed from the map so the next caller
   * can retry. The original rejection is re-thrown to the current
   * caller.
   */
  async getOrCreate(lobbyId: string, leagueId: string): Promise<LobbyManager> {
    const existing = this.lobbies.get(lobbyId);
    if (existing) {
      // Either a fully-constructed LobbyManager OR an in-flight
      // Promise<LobbyManager>. `await` unwraps both consistently.
      return existing;
    }

    // Synchronously insert the in-flight Promise BEFORE any await,
    // so concurrent callers find the same Promise.
    const constructionPromise = this.constructLobby(lobbyId, leagueId);
    this.lobbies.set(lobbyId, constructionPromise);

    try {
      const lobby = await constructionPromise;
      // Replace the Promise with the resolved instance so subsequent
      // synchronous `get` calls can return it directly without
      // having to await.
      this.lobbies.set(lobbyId, lobby);
      return lobby;
    } catch (err) {
      // Failed construction — drop the entry so the next caller can
      // retry. Otherwise everyone gets the same rejected Promise
      // forever.
      this.lobbies.delete(lobbyId);
      logger.error(
        `[registry] lobby construction failed lobbyId=${lobbyId} leagueId=${leagueId}`,
        err,
      );
      throw err;
    }
  }

  /**
   * Synchronous lookup. Returns the LobbyManager instance if
   * construction has completed; returns `undefined` if no entry
   * exists OR construction is still in flight (Promise placeholder).
   *
   * Use `getOrCreate` for the await-safe version when you need to
   * be sure a lobby is ready.
   */
  get(lobbyId: string): LobbyManager | undefined {
    const entry = this.lobbies.get(lobbyId);
    if (entry instanceof LobbyManager) {
      return entry;
    }
    return undefined;
  }

  /**
   * Drop a lobby from the registry. Used by chunk 11g.7's
   * snapshot-then-evict flow when a draft completes. Has no effect
   * if no entry exists.
   *
   * Note: does NOT close active WebSocket connections — it just
   * removes the registry entry. Callers that also want to tear down
   * connections should iterate the LobbyManager's connection set
   * first (chunk 11g.7's responsibility).
   */
  remove(lobbyId: string): void {
    if (this.lobbies.delete(lobbyId)) {
      logger.info(`[registry] lobby removed lobbyId=${lobbyId}`);
    }
  }

  /** Diagnostic: number of registry entries (constructed + in-flight). */
  size(): number {
    return this.lobbies.size;
  }

  // ── Private ────────────────────────────────────────────────────

  private async constructLobby(lobbyId: string, leagueId: string): Promise<LobbyManager> {
    const format = await this.formatLookup(leagueId);
    return new LobbyManager({
      lobbyId,
      format,
      leagueId,
      draftService: this.draftService,
      publish: this.publish,
    });
  }
}
