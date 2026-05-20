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

import { structuredLogger } from '@citrus/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebSocket } from 'uWebSockets.js';
import type { DraftServiceV2 } from '../services/DraftServiceV2';
import { readSystemFlag } from '../lib/systemFlags';
import { LobbyManager } from './LobbyManager';
import type {
  CommissionerAuthorizationResult,
  DraftFormat,
  DraftOrderSlot,
  DraftSocketUserData,
  TeamAuthorizationResult,
} from './types';

/**
 * Configuration the registry needs from the application layer to
 * construct a `LobbyManager`. Returned by the injected
 * `lobbyConfigLookup` callback (per chunk-6a recon Path B: the draft
 * order is loaded from `public.draft_order` rather than regenerated
 * in-engine, so the engine and `submit_pick_v2`'s on-clock check
 * validate against the identical view).
 *
 * For auction lobbies, `draftOrder` MAY be empty — auction has
 * nominations rather than slots; chunk 11g.6 / ADR-002 §3 introduces
 * auction-specific state. The LobbyManager's `processSubmitPick`
 * gates on `format === 'auction'` before consulting `draftOrder`.
 *
 * **Step 6c expansion:** the lookup also returns the timer-state
 * inputs (`pickClockSeconds`, `initialPickDeadline`,
 * `initialDraftState`) so the LobbyManager can reconstruct the
 * autopick deadline at bootstrap. The values come from the same
 * `leagues` row that supplies `format` — single query, no extra
 * round-trip per lobby. JSDoc on each field below explains the
 * column source and engine-side consumption.
 */
export interface LobbyConfig {
  format: DraftFormat;
  draftOrder: ReadonlyArray<DraftOrderSlot>;
  /**
   * Pick clock duration in seconds INCLUDING the +1s pad. Source:
   * `leagues.settings.pickTimeLimit` + 1 (the +1 mirrors
   * `submit_pick_v2`'s deadline computation at migration line
   * 896-898). Default fallback if missing: 91 (= 90 + 1).
   *
   * For auction lobbies, this is the **bid-window** duration
   * (chunk 11g.6 sub-step 6a uses `auctionNominationTime + 1` as
   * the bid window; the nomination-window/bid-window split per
   * ADR-002 §3.4 lands in 6c alongside auto-nominate).
   */
  pickClockSeconds: number;
  /**
   * Wall-clock deadline for the on-clock pick at construction
   * time, sourced from `leagues.pick_deadline`. The RPC has been
   * authoritatively maintaining this column since Phase 2;
   * bootstrap consumes it directly rather than reconstructing
   * from event timestamps. `null` for fresh / paused / completed
   * / cancelled drafts.
   */
  initialPickDeadline: Date | null;
  /**
   * Raw `leagues.draft_state` value at construction time. The
   * engine's `init()` reads this after event replay to decide
   * whether to schedule a timer. Snake/linear values:
   * `'active' | 'paused' | 'completed' | 'cancelled'` (or
   * `'pre_draft'` for fresh-start).
   */
  initialDraftState: string | null;

  // ── Auction-specific (chunk 11g.6 sub-step 6a) ──────────────────
  // Populated only for `format === 'auction'`; ignored otherwise.

  /**
   * Round-robin team rotation per ADR-002 §3.2. Sourced from the
   * existing `draft_order` table's round-1 `team_order` JSONB
   * array (same data feeds snake/linear's `draftOrder` per chunk
   * 11g.4 step 6a Path B — DB is canonical, engine consumes).
   *
   * Current nominator = `nominationOrder[nominationsCompleted % nominationOrder.length]`.
   * Auction completes when `nominationsCompleted >= nominationOrder.length × draftRounds`.
   *
   * Empty for snake/linear lobbies.
   */
  nominationOrder: ReadonlyArray<string>;
  /**
   * Per-team starting budget (`leagues.settings.auctionBudget`).
   * Default 200 per ADR-002 §4.3. Used to seed `auction_budgets`
   * at draft setup; `LobbyManager.teamBudgets` mirrors the
   * `auction_budgets.remaining_budget` column.
   */
  auctionBudget: number;
  /**
   * Minimum opening bid + minimum bid increment (flat $1 in 6a;
   * tiered increments per ADR-002 §4.3 are 6c work).
   * Default 1 per ADR-002 §4.3.
   */
  auctionMinBid: number;
  /**
   * Total roster slots per team — drives the auction completion
   * check (`nominationsCompleted >= teamCount × draftRounds`) and
   * the budget-reserve calculation (per ADR-002 §3 + v1
   * AuctionService.placeBid: `slotsRemaining = rosterSize -
   * players_won - 1`).
   */
  draftRounds: number;
  /**
   * Initial `auction_budgets` rows hydrated from the DB at
   * construction. Map keyed by team UUID.
   */
  initialTeamBudgets: ReadonlyMap<string, number>;
  /**
   * Initial `auction_budgets.players_won` per team — used to
   * compute `teamRosterSlotsRemaining = draftRounds - players_won`.
   */
  initialPlayersWon: ReadonlyMap<string, number>;
  /**
   * Active nomination row from `auction_nominations` if one exists
   * at construction time (mid-draft restart). Bootstrap will
   * derive the in-memory `currentNomination` from the event log
   * replay; this field is informational for diagnostic logging.
   */
  initialActiveNomination: {
    nominationId: string;
    playerId: string;
    nominatorTeamId: string;
    leadingBidderId: string;
    leadingBid: number;
    expiresAt: Date;
  } | null;
  /**
   * Anti-snipe configuration (chunk 11g.6 sub-step 6b per ADR-002
   * §3.3 / §4.4). Engine reads from `leagues.settings` once at
   * config lookup and threads through to the LobbyManager + every
   * `place_bid_v2` RPC call. Threshold = 0 disables anti-snipe
   * entirely (per ADR-002 §4.3 range "0-120 (0 disables)").
   *
   * Snake/linear lobbies set both to 0 — they don't make
   * `place_bid_v2` calls so the values are never used.
   */
  auctionAntiSnipeThresholdSeconds: number;
  auctionAntiSnipeExtensionSeconds: number;
  /**
   * Tiered minimum-bid-increment table per ADR-002 §4.3 (chunk
   * 11g.6 sub-step 6c2). Validated at lookup time via
   * `validateBidIncrementTiers`. Snake/linear lobbies pass the
   * default flat-$1 table (unused — no `place_bid_v2` calls).
   */
  auctionMinBidIncrementTiers: ReadonlyArray<{ below: number; increment: number }>;
  /**
   * Auction bid-window duration in seconds (chunk 11g.6 sub-step
   * 6c3 per ADR-002 §3.4 / §4.3 default 30). Pre-launch rename of
   * the legacy `auctionNominationTime` setting which was misnamed
   * — being used as bid-window despite the name implying nominator
   * clock. Snake/linear lobbies set to 0 (unused).
   */
  auctionBidWindowSeconds: number;
  /**
   * Auction nomination-window duration in seconds (chunk 11g.6
   * sub-step 6c3 per ADR-002 §3.4 default 60). Net-new in 6c3.
   * Drives the auto-nominate timer for on-clock nominators who
   * don't choose a player. Snake/linear lobbies set to 0 (unused).
   */
  auctionNominationWindowSeconds: number;
}

export interface LobbyRegistryOptions {
  /**
   * Shared `DraftServiceV2` passed to every LobbyManager constructed
   * by this registry. One instance per process — the RPC client is
   * stateless wrt lobby identity. See file-level JSDoc for the
   * deferred auth.uid() concern under admin-client mode.
   */
  draftService: DraftServiceV2;

  /**
   * Resolves the live-draft configuration for a given league.
   * Called once per lobby on first `getOrCreate`; the result feeds
   * the LobbyManager constructor and is fixed for the lobby's
   * lifetime.
   *
   * Step 6a expansion (renamed from `formatLookup`): returns both
   * `format` AND the pre-flattened `draftOrder` slot list loaded
   * from `public.draft_order`. Per chunk-6a recon Path B, this
   * keeps the engine's on-clock check aligned with what
   * `submit_pick_v2` validates — eliminates the divergence risk
   * from commissioner `customTeamOrder` overrides.
   *
   * Should throw on missing/invalid configuration so the caller
   * (the uWS upgrade handler) can close the WS cleanly. The thrown
   * error is logged at registry level and re-thrown to the caller.
   */
  lobbyConfigLookup: (leagueId: string) => Promise<LobbyConfig>;

  /**
   * Engine-side team-authorization callback per ADR-004 §5.3.
   * Forwarded into every `LobbyManager`; verified before each
   * `submit_pick_v2` call to satisfy the trusted-executor contract.
   *
   * Today: `index.ts` queries `teams.owner_id`. Switches to
   * `team_authorized()` SQL helper post-ADR-003 Phase 2 — the
   * `TeamAuthorizationResult` discriminated union is forward-compat
   * for that integration as a clean drop-in.
   */
  verifyTeamAuthorization: (
    userId: string,
    teamId: string,
  ) => Promise<TeamAuthorizationResult>;

  /**
   * Engine-side commissioner-authorization callback (chunk 11g.6
   * sub-step 6c4 per ADR-002 §4.4 + ADR-004 §5). Parallel structure
   * to `verifyTeamAuthorization`. Forwarded to every constructed
   * `LobbyManager`.
   */
  verifyCommissionerAuthorization: (
    userId: string,
    leagueId: string,
  ) => Promise<CommissionerAuthorizationResult>;

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

  /**
   * Supabase client forwarded to every constructed LobbyManager
   * for autopick read queries (player projections, already-drafted
   * lookup). Same admin client backing `DraftServiceV2`; passed
   * separately so tests can stub the projection-reads path
   * without affecting the RPC-write path.
   */
  supabase: SupabaseClient;
}

export class LobbyRegistry {
  private readonly draftService: DraftServiceV2;
  private readonly lobbyConfigLookup: (leagueId: string) => Promise<LobbyConfig>;
  private readonly verifyTeamAuthorization: (
    userId: string,
    teamId: string,
  ) => Promise<TeamAuthorizationResult>;
  private readonly verifyCommissionerAuthorization: (
    userId: string,
    leagueId: string,
  ) => Promise<CommissionerAuthorizationResult>;
  private readonly publish: (topic: string, message: string) => void;
  private readonly supabase: SupabaseClient;

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
    this.lobbyConfigLookup = opts.lobbyConfigLookup;
    this.verifyTeamAuthorization = opts.verifyTeamAuthorization;
    this.verifyCommissionerAuthorization = opts.verifyCommissionerAuthorization;
    this.publish = opts.publish;
    this.supabase = opts.supabase;
  }

  /**
   * Get the LobbyManager for `lobbyId`, constructing it lazily on
   * first call AND bootstrapping it from the durable event log
   * before returning. Concurrent same-key calls share one Promise
   * — the format lookup + LobbyManager construction + event-log
   * replay happens at most once per lobby lifetime.
   *
   * **Step 6b expanded the contract:** getOrCreate is no longer just
   * lookup-or-construct; it's lookup-or-construct-or-bootstrap. The
   * bootstrap step (`LobbyManager.init()`) reads `draft_events` and
   * walks the log to hydrate in-memory state. For typical draft
   * sizes (12-team × 21-round = 252 events) this adds ~10-50ms to
   * the WS-upgrade path; the handshake budget tolerates it.
   *
   * On error (formatLookup throws, LobbyManager constructor throws,
   * bootstrap throws — DB query rejection or log integrity error),
   * the in-flight Promise is removed from the map so the next caller
   * can retry from scratch. The original rejection is re-thrown to
   * the current caller.
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
      structuredLogger.error(
        'registry.lobby_construction_failed',
        { lobbyId, leagueId },
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
      structuredLogger.info('registry.lobby_removed', { lobbyId });
    }
  }

  /**
   * Phase 4.5 chunk 11g.10 sub-step 10b — engine-admin eviction.
   *
   * Force-close every WS connection on the lobby (with close code 4002
   * = "transient" per `apps/web/src/lib/draftClient/closeCodes.ts`,
   * which tells clients to reconnect) and remove the lobby from the
   * registry. The next client reconnect triggers fresh bootstrap from
   * durable state — no data loss because `draft_events` is the source
   * of truth.
   *
   * Returns the count of connections that were closed so the caller
   * (admin endpoint) can report it. Returns `null` if the lobby is
   * not in the registry (or is still in flight as a construction
   * Promise).
   */
  evict(lobbyId: string): { connectionsClosed: number } | null {
    const entry = this.lobbies.get(lobbyId);
    if (!(entry instanceof LobbyManager)) {
      return null;
    }
    let closed = 0;
    entry.forEachConnection((ws) => {
      try {
        // close code 4002 = transient per closeCodes.ts; clients
        // reconnect and re-bootstrap from durable state.
        ws.end(4002, 'engine_admin_eviction');
        closed += 1;
      } catch (err) {
        structuredLogger.debug(
          'registry.evict_connection_close_threw',
          { lobbyId },
          err,
        );
      }
    });
    this.lobbies.delete(lobbyId);
    structuredLogger.info('registry.lobby_evicted', {
      lobbyId,
      connectionsClosed: closed,
    });
    return { connectionsClosed: closed };
  }

  /**
   * Phase 4.5 chunk 11g.10 sub-step 10b — diagnostic summary for the
   * engine-admin `GET /api/admin/engine/registry` endpoint.
   *
   * Walks every fully-constructed lobby (skips in-flight Promise
   * placeholders), collects each LobbyManager's getDiagnosticInfo(),
   * sums up totals. Read-only; safe to call from a request handler.
   */
  getDiagnosticSummary(): {
    registries: Array<{
      lobbyId: string;
      leagueId: string;
      format: 'snake' | 'linear' | 'auction';
      connectionCount: number;
      lastAppliedSeq: number;
    }>;
    totalLobbies: number;
    totalConnections: number;
  } {
    const registries: Array<{
      lobbyId: string;
      leagueId: string;
      format: 'snake' | 'linear' | 'auction';
      connectionCount: number;
      lastAppliedSeq: number;
    }> = [];
    let totalConnections = 0;
    for (const entry of this.lobbies.values()) {
      if (entry instanceof LobbyManager) {
        const info = entry.getDiagnosticInfo();
        registries.push(info);
        totalConnections += info.connectionCount;
      }
    }
    return {
      registries,
      totalLobbies: registries.length,
      totalConnections,
    };
  }

  /**
   * Phase 4.5 chunk 11g.10 sub-step 10b — engine-admin force-snapshot.
   *
   * Schedules a snapshot write for the named lobby through the
   * LobbyManager's single-writer queue, waits for completion, and
   * returns the persisted outcome (per Q3 follow-up Decision Log
   * 2026-05-19). Returns `null` if the lobby is not in the registry.
   *
   * The `persisted` boolean distinguishes "new snapshot written" from
   * "scheduling completed but write was skipped" (state-not-in-progress,
   * write failure, etc. — see LobbyManager.scheduleSnapshot JSDoc for
   * the reason discriminator vocabulary).
   *
   * The admin endpoint queries `draft_snapshots` for the most-recent
   * row's metadata (seq, engine_version, persisted_at) regardless of
   * persisted outcome — operators want to see what's durable right
   * now even when the call didn't write anything.
   */
  async forceSnapshot(
    lobbyId: string,
  ): Promise<{ persisted: boolean; reason?: string } | null> {
    const entry = this.lobbies.get(lobbyId);
    if (!(entry instanceof LobbyManager)) {
      return null;
    }
    const result = await entry.scheduleSnapshot();
    return result;
  }

  /** Diagnostic: number of registry entries (constructed + in-flight). */
  size(): number {
    return this.lobbies.size;
  }

  /**
   * Iterate every active WebSocket connection across every constructed
   * lobby in the registry (chunk 11g.7 sub-step 7d). Used by the
   * heartbeat soft-check timer in `uws-server.ts` to scan for zombie
   * connections in a single pass.
   *
   * **Iteration safety contract.** Iterator is safe against connection
   * mutation during the walk. If a connection closes mid-scan (e.g.,
   * the soft-check force-disconnect itself triggers a uWS `close`
   * handler that calls back into `removeConnection`), iteration MUST
   * NOT throw or skip remaining entries. The lobby-level
   * `forEachConnection` snapshots its own `connections` map at
   * call-start; this method calls each lobby's iterator in turn.
   *
   * Lobbies that are still in-flight (`Promise<LobbyManager>` placeholders
   * during construction) are skipped — they have no connections yet.
   *
   * Errors thrown by `fn` propagate. Callers (typically the soft-check
   * scanner) should `try/catch` around the per-connection action so a
   * single misbehaving connection doesn't abort the entire scan.
   */
  forEachConnection(
    fn: (ws: WebSocket<DraftSocketUserData>, userData: DraftSocketUserData) => void,
  ): void {
    for (const entry of this.lobbies.values()) {
      if (entry instanceof LobbyManager) {
        entry.forEachConnection(fn);
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────

  private async constructLobby(lobbyId: string, leagueId: string): Promise<LobbyManager> {
    const config = await this.lobbyConfigLookup(leagueId);

    // Phase 4.5 chunk 11g.10 sub-step 10b — engine-side defense-in-depth
    // for the no_new_drafts flag.
    //
    // The main API discovery endpoint already refuses with 503 when the
    // flag is on AND the draft is in `not_started` state. This is the
    // engine's independent check: if a client somehow got past discovery
    // (cached token, timing window, bypassed routing), the engine
    // refuses to construct a new lobby for a not-yet-started draft.
    //
    // In-progress drafts are NOT blocked here — their LobbyManager
    // construction is the normal recovery path after engine restart,
    // and blocking that would prevent in-progress drafts from
    // continuing (the brief's "in-progress drafts continue" intent).
    //
    // 5s cache (per systemFlags.ts) absorbs the read cost; this check
    // adds at most one Postgres round-trip per cache miss.
    if (
      config.initialDraftState === 'not_started' ||
      config.initialDraftState === 'pre_draft'
    ) {
      const noNewDrafts = await readSystemFlag(this.supabase, 'no_new_drafts');
      if (noNewDrafts) {
        structuredLogger.warn('registry.refused_no_new_drafts', {
          lobbyId,
          leagueId,
          initialDraftState: config.initialDraftState,
        });
        throw new Error(
          `new_drafts_disabled: system_flags.no_new_drafts is on; refusing to construct lobby ${lobbyId} (draft state ${config.initialDraftState})`,
        );
      }
    }

    const lobby = new LobbyManager({
      lobbyId,
      format: config.format,
      leagueId,
      draftService: this.draftService,
      publish: this.publish,
      draftOrder: config.draftOrder,
      verifyTeamAuthorization: this.verifyTeamAuthorization,
      verifyCommissionerAuthorization: this.verifyCommissionerAuthorization,
      supabase: this.supabase,
      pickClockSeconds: config.pickClockSeconds,
      initialPickDeadline: config.initialPickDeadline,
      initialDraftState: config.initialDraftState,
      nominationOrder: config.nominationOrder,
      auctionBudget: config.auctionBudget,
      auctionMinBid: config.auctionMinBid,
      draftRounds: config.draftRounds,
      initialTeamBudgets: config.initialTeamBudgets,
      initialPlayersWon: config.initialPlayersWon,
      initialActiveNomination: config.initialActiveNomination,
      auctionAntiSnipeThresholdSeconds: config.auctionAntiSnipeThresholdSeconds,
      auctionAntiSnipeExtensionSeconds: config.auctionAntiSnipeExtensionSeconds,
      auctionMinBidIncrementTiers: config.auctionMinBidIncrementTiers,
      auctionBidWindowSeconds: config.auctionBidWindowSeconds,
      auctionNominationWindowSeconds: config.auctionNominationWindowSeconds,
    });
    // Step 6b: bootstrap from the durable event log BEFORE returning.
    // A failed init() throws; the existing try/catch in getOrCreate
    // deletes the placeholder and re-throws to the awaiter, so the
    // next caller can retry from scratch (chunk 11g.4 step 4 design).
    await lobby.init();
    return lobby;
  }
}
