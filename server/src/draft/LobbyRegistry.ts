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
import { readAllPaged } from '../lib/pagedRead';
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

  /**
   * Chunk 10c-2 batch 3 (2026-07-27): idle-lobby eviction window.
   * Maximum time a lobby can sit at `connectionCount === 0` and
   * `draftStatus !== 'in_progress'` before being evicted. Overrides
   * the `LOBBY_IDLE_EVICTION_MS` env; env overrides the 10-min
   * default. `0` disables the scanner entirely.
   */
  idleEvictionMs?: number;
  /**
   * Chunk 10c-2 batch 3 (2026-07-27): idle-eviction scan cadence.
   * How often `scanIdleLobbies` runs. Overrides
   * `LOBBY_IDLE_EVICTION_SCAN_MS` env; env overrides the 3-min
   * default. `0` disables the scanner.
   */
  idleEvictionScanMs?: number;
  /**
   * F20 Piece 3 (2026-08-02): clock-liveness scanner cadence. How
   * often `scanClockLiveness` runs. Overrides `CLOCK_LIVENESS_SCAN_MS`
   * env; env overrides the 5-second default. `0` disables.
   */
  clockLivenessScanMs?: number;
  /**
   * F20 Piece 3: how far past a pick_deadline a lobby must be to be
   * considered stalled. Overrides `CLOCK_LIVENESS_STALL_MS` env; env
   * overrides the 10-second default. Legitimate autopick lands at
   * deadline + 1s pad + ~150ms submit; under DB load that reaches
   * 3-4s past deadline. 10s has real margin — 5s sits too close to
   * normal behaviour (architect ruling 3).
   */
  clockLivenessStallMs?: number;
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
    // Chunk 10c-2 batch 3 (2026-07-27): idle-eviction config. Options
    // override env; env overrides defaults (10 min idle / 3 min scan).
    // Setting either to 0 disables the scanner (tests set both to 0
    // via the vitest setup file; local dev may also disable).
    this.idleEvictionMs =
      opts.idleEvictionMs ??
      (process.env.LOBBY_IDLE_EVICTION_MS !== undefined
        ? parseInt(process.env.LOBBY_IDLE_EVICTION_MS, 10)
        : 10 * 60 * 1000);
    this.idleEvictionScanMs =
      opts.idleEvictionScanMs ??
      (process.env.LOBBY_IDLE_EVICTION_SCAN_MS !== undefined
        ? parseInt(process.env.LOBBY_IDLE_EVICTION_SCAN_MS, 10)
        : 3 * 60 * 1000);
    // F20 Piece 3 (2026-08-02): clock-liveness scanner config. Ruling
    // 3: 5s scan / 10s stall. Env overrides for tests + local dev
    // (setting either to 0 disables — matches idleEviction pattern).
    this.clockLivenessScanMs =
      opts.clockLivenessScanMs ??
      (process.env.CLOCK_LIVENESS_SCAN_MS !== undefined
        ? parseInt(process.env.CLOCK_LIVENESS_SCAN_MS, 10)
        : 5_000);
    this.clockLivenessStallMs =
      opts.clockLivenessStallMs ??
      (process.env.CLOCK_LIVENESS_STALL_MS !== undefined
        ? parseInt(process.env.CLOCK_LIVENESS_STALL_MS, 10)
        : 10_000);
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
   * ENGINE-EAR v3 Slice 1 item 2 (E106, 2026-08-11) — BOOT-SCAN
   * RESUMES IN_PROGRESS LEAGUES.
   *
   * Pre-Slice-1 defect: engine boot did NOT resume in_progress
   * drafts. Entry 83 measured 4.7 dead minutes post-restart on
   * fad02304 (in_progress league, seq-1 on ledger, got nothing
   * until a client connected). Root cause: lobbies were LAZY,
   * created only on first WS client connect or first NOTIFY. A
   * post-restart in-progress league with no clients and no
   * pending event stalled indefinitely.
   *
   * Fix: enumerate `leagues WHERE draft_status IN
   * ('in_progress', 'paused')` at engine startup and `getOrCreate`
   * a lobby for each. Each lobby's `init()` reads
   * `leagues.pick_deadline` + replays the event log + arms the
   * timer — so post-restart in-progress drafts resume within the
   * boot-scan window (≪ 5s in practice) instead of waiting for
   * a client.
   *
   * Called once from `index.ts` after registry construction, in
   * the background (does not block the Hono/uWS listener startup —
   * the engine is serving on port before boot-scan finishes so
   * clients can still connect and force lazy-create in the
   * meantime, which is idempotent with getOrCreate's placeholder
   * pattern).
   *
   * Non-fatal: per-league construction failures log and continue;
   * one broken league can't take down the whole engine's boot.
   * The summary log at completion lets operators see how many
   * lobbies resumed cleanly.
   */
  async performBootScan(
    supabaseAdmin: SupabaseClient,
  ): Promise<{ scanned: number; resumed: number; failed: number }> {
    const startTime = Date.now();
    let scanned = 0;
    let resumed = 0;
    let failed = 0;

    try {
      // PAGED (2026-09-03). This read used to be an unbounded
      // `.select('id').eq('draft_status','in_progress')`. PostgREST
      // clamps every unbounded response at `db-max-rows` (1,000 on
      // this project) and answers HTTP 200 with a short body - no
      // error, no warning. Past 1,000 concurrent in-progress drafts
      // the boot scan would resume the first 1,000 leagues PostgREST
      // happened to hand back and leave the rest with no lobby, no
      // clock and no log line saying so. `readAllPaged` carries the
      // full write-up; `orderBy: ['id']` is the primary key, which is
      // the paging contract's requirement (a non-unique sort lets
      // adjacent windows overlap and skip).
      //
      // The `as any` cast this replaced is gone with it: the helper
      // takes an untyped `SupabaseClient`, so the `.from -> .select`
      // inference chain that used to trip the instantiation cap on
      // the wide `leagues` type never forms here.
      //
      // E109 lesson, still binding on whatever replaces this: pass
      // the CLIENT, or cast the *result* of `.from()`. Never extract
      // the method - `const untypedFrom = supabaseAdmin.from` makes
      // it a free function, `this` is undefined at call time, real
      // supabase-js reads `this.rest` and throws TypeError. The Proxy
      // at server/src/lib/supabase.ts:40 makes accidental rebinding
      // impossible. `readAllPaged` satisfies this by construction:
      // it receives the client as a value and calls
      // `supabase.from(t).select(c)` in a single expression.
      //
      // E111 lesson: `draft_status` enum in the DB is
      //   ('not_started', 'queued', 'in_progress', 'completed')
      // per supabase/migrations/20250101000001 + 20260206000000
      // — `paused` is NOT a member of this enum. Pause lives on the
      // OTHER column `leagues.draft_state='paused'` (see
      // DraftServiceV2.ts:551 + LobbyManager.ts:5523). A Postgres
      // `.in()` list containing a non-member literal is rejected
      // whole (22P02) — the scan then returns zero and resumes
      // nothing. Slice-1 contract only requires `in_progress`
      // rehydration; paused-drafts resume-via-boot-scan is a Slice-2+
      // decision.
      //
      // NOTE: the shared type `DRAFT_STATUSES` at
      // packages/shared/src/types/league.ts erroneously includes
      // 'paused'; that is a client-facing type-drift docket for
      // another cycle and is why the enum-domain mismatch survived
      // 1031 offline tests.
      const { data: rows, error } = await readAllPaged<{ id: string }>(
        supabaseAdmin,
        {
          table: 'leagues',
          columns: 'id',
          filters: [['draft_status', 'in_progress']],
          orderBy: ['id'],
        },
      );
      if (error) {
        structuredLogger.error(
          'registry.boot_scan_query_failed',
          {},
          error,
        );
        return { scanned: 0, resumed: 0, failed: 0 };
      }
      scanned = rows.length;
      structuredLogger.info('registry.boot_scan_started', {
        activeLeagues: scanned,
      });

      // Sequential await — parallel would race on the same Supabase
      // admin connection pool + each getOrCreate is fast (~50ms per
      // lobby per Entry 88 measurements) so sequential is fine for
      // the twelve-scale target. If launch scales past 100
      // concurrent in-progress leagues per engine, batch this.
      for (const row of rows) {
        try {
          // leagueId === lobbyId per Citrus's data model (see
          // server/src/routes/drafts.ts header comment).
          await this.getOrCreate(row.id, row.id);
          resumed += 1;
          structuredLogger.debug('registry.boot_scan_lobby_resumed', {
            leagueId: row.id,
          });
        } catch (err) {
          failed += 1;
          structuredLogger.warn('registry.boot_scan_lobby_failed', {
            leagueId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      structuredLogger.info('registry.boot_scan_complete', {
        scanned,
        resumed,
        failed,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      structuredLogger.error(
        'registry.boot_scan_threw',
        { scanned, resumed, failed, durationMs: Date.now() - startTime },
        err,
      );
    }

    return { scanned, resumed, failed };
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
        // structuredLogger.debug takes (event, ctx) — no third err
        // param (only info/warn/error accept one). Fold err into ctx.
        structuredLogger.debug('registry.evict_connection_close_threw', {
          lobbyId,
          err: err instanceof Error ? err.message : String(err),
        });
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

  // ── Chunk 10c-2 batch 3 (2026-07-27): idle-lobby eviction ────────
  //
  // Motivation: PROJECT_PLAN Decision Log 2026-07-27 "Snapshot
  // retention + lobby hygiene chunk — spec drafted" surfaced the
  // ghost-lobby class — a lobby whose WS clients all disconnected
  // but which stayed in memory forever, its 30-s snapshot writer
  // burning ~2,880 rows/day/lobby against `draft_snapshots`. The
  // retention chunk (batch 1) fixed the storage side via UPSERT-per-
  // league; this scanner fixes the lifecycle side by retiring the
  // idle lobby entirely.
  //
  // Design:
  //   - Every `LOBBY_IDLE_EVICTION_SCAN_MS` (default 3 min), walk
  //     every constructed lobby and evict any that satisfy ALL of:
  //       (a) `connectionCount() === 0`
  //       (b) `getDraftStatus() !== 'in_progress'`  (exemption)
  //       (c) `now - getLastActivityAt() > LOBBY_IDLE_EVICTION_MS`
  //           (default 10 min)
  //   - Evict = call `lobby.shutdown()` (stops snapshot writer,
  //     heartbeat, and any pending timers via `shutDown` flag) and
  //     remove from the registry map.
  //   - Log `registry.lobby_evicted_idle` at INFO with age +
  //     draftStatus + connectionCount context, distinct from
  //     `registry.lobby_evicted` (chunk 11g.10 sub-step 10b admin
  //     eviction) so ops filters can separate operator-initiated
  //     vs system-initiated eviction.
  //
  // Active-status exemption (from architect ratification): lobbies
  // with `draftStatus === 'in_progress'` are NEVER evicted, even at
  // `connectionCount === 0` for hours. Rationale: an in-progress
  // draft with no connected clients still has a live autopick timer
  // that must fire on schedule; evicting the lobby would cancel the
  // timer (via shutdown), and while bootstrap can reconstruct state
  // on the next connect, the AUTOPICK moment could be missed if no
  // connect happens between the eviction and the deadline. The
  // catch-up-on-connect path (LobbyManager.setPickDeadline at
  // deadline<=now clamps to 0 delayMs — verified in the S5 exposure
  // Q1 report) is safety net, not primary. Active drafts stay
  // resident until they complete or cancel.
  //
  // Env tunable via `LOBBY_IDLE_EVICTION_MS` and
  // `LOBBY_IDLE_EVICTION_SCAN_MS`. Setting either to `0` disables
  // the scanner (used in tests + local dev).

  private idleEvictionTimer: NodeJS.Timeout | null = null;
  private readonly idleEvictionMs: number;
  private readonly idleEvictionScanMs: number;

  // ── Clock-liveness scanner (F20 Piece 3, 2026-08-02) ────────────
  //
  // Global registry-side backstop for the guard-side re-arm. Iterates
  // every in-registry lobby every clockLivenessScanMs; any lobby whose
  // pick_deadline is more than clockLivenessStallMs in the past gets
  // handed to attemptClockRecovery, which re-verifies the stall under
  // its own view and re-arms if warranted.
  //
  // Per architect ruling 2: this MUST be a GLOBAL scanner, not a
  // per-lobby setInterval. A per-lobby watchdog living inside the
  // subsystem it monitors reproduces the F20 blindness pattern
  // (event_subscription.watchdog_ok fired 19 times over a dead draft).
  // The scanner sits in the registry so it can see lobbies whose own
  // machinery has wedged.
  //
  // Per architect ruling 2 (2026-08-02 addendum): UNKILLABLE. One
  // throwing lobby must not shield the others in the same scan pass,
  // and no scan error can terminate the interval.
  private clockLivenessTimer: NodeJS.Timeout | null = null;
  private readonly clockLivenessScanMs: number;
  private readonly clockLivenessStallMs: number;

  // Strike map keyed on lobbyId. Every scanner-driven recovery
  // increments count; at MAX we escalate (log ERROR + alertable) and
  // stop re-arming that lobby to prevent an infinite recovery loop
  // (architect ruling 3b: "a recovery loop that silently spins
  // forever is its own hazard").
  //
  // Hygiene (architect ruling 2, 2026-08-02):
  //   - Entries pruned when the lobby leaves the registry (start of
  //     each scan pass — cheap, covers eviction / force-purge /
  //     completion without hooking every removal path).
  //   - Entries cleared on natural recovery (a scan where the lobby
  //     shows no stall) — so an unrelated stall next week starts at
  //     zero instead of inheriting strikes from tonight.
  private clockLivenessStrikes = new Map<
    string,
    { seq: number; count: number }
  >();
  private static readonly MAX_CLOCK_LIVENESS_STRIKES = 3;

  /**
   * Start the periodic idle-eviction scanner. Idempotent — a second
   * call is a no-op. Called from engine entry-point startup after
   * the registry is constructed. If `LOBBY_IDLE_EVICTION_MS` or
   * `LOBBY_IDLE_EVICTION_SCAN_MS` is `0`, this is also a no-op
   * (scanner is disabled).
   */
  startIdleEvictionTimer(): void {
    if (this.idleEvictionTimer !== null) return;
    if (this.idleEvictionMs <= 0 || this.idleEvictionScanMs <= 0) {
      structuredLogger.info('registry.idle_eviction_timer_disabled', {
        idleEvictionMs: this.idleEvictionMs,
        idleEvictionScanMs: this.idleEvictionScanMs,
      });
      return;
    }
    this.idleEvictionTimer = setInterval(
      () => this.scanIdleLobbies(),
      this.idleEvictionScanMs,
    );
    if (typeof this.idleEvictionTimer.unref === 'function') {
      this.idleEvictionTimer.unref();
    }
    structuredLogger.info('registry.idle_eviction_timer_started', {
      idleEvictionMs: this.idleEvictionMs,
      idleEvictionScanMs: this.idleEvictionScanMs,
    });
  }

  /**
   * Cancel the periodic idle-eviction scanner. Called from the
   * engine's graceful-shutdown path (`shutdown()` in `index.ts`)
   * BEFORE closing lobbies so a late scan doesn't try to evict a
   * lobby that's already being torn down.
   */
  stopIdleEvictionTimer(): void {
    if (this.idleEvictionTimer !== null) {
      clearInterval(this.idleEvictionTimer);
      this.idleEvictionTimer = null;
      structuredLogger.info('registry.idle_eviction_timer_stopped', {});
    }
  }

  /**
   * Single scan pass. Iterates every constructed lobby (skips
   * in-flight Promise placeholders) and evicts any that meet all
   * three criteria (connectionCount=0, draftStatus!=in_progress,
   * age>idleEvictionMs). Public for tests + admin diagnostics.
   */
  scanIdleLobbies(): { scanned: number; evicted: number } {
    const now = Date.now();
    let scanned = 0;
    let evicted = 0;
    // Snapshot the entries into an array first so evicting inside
    // the loop (which mutates `this.lobbies`) doesn't corrupt the
    // Map iterator.
    const entries: Array<[string, LobbyManager]> = [];
    for (const [lobbyId, entry] of this.lobbies.entries()) {
      if (entry instanceof LobbyManager) {
        entries.push([lobbyId, entry]);
      }
    }
    for (const [lobbyId, lobby] of entries) {
      scanned += 1;
      const connectionCount = lobby.connectionCount();
      const draftStatus = lobby.getDraftStatus();
      const lastActivityAt = lobby.getLastActivityAt();
      const ageMs = now - lastActivityAt;
      if (connectionCount !== 0) continue;
      // Chunk 10c-2 batch 3 amendment (Monday 2026-07-28): evict ONLY
      // when draftStatus ∈ {not_started, completed, cancelled}. Both
      // `in_progress` and `paused` are exempt.
      //
      // Rationale — `in_progress`: an active autopick timer may still
      // need to fire; evicting cancels the timer via shutdown, and
      // while bootstrap catches up on next connect, a fully-abandoned
      // active draft has no reconstruction trigger. Self-advancement
      // policy is a Zach call (queued behind gates).
      //
      // Rationale — `paused`: a paused draft has a commissioner-owned
      // resume moment. Evicting mid-pause would race the resume RPC's
      // event delivery against the eviction; the resume path relies
      // on the lobby's in-memory `pauseState` to construct the resumed
      // deadline. Bootstrap can reconstruct from durable state, but
      // paused drafts are rare enough that eviction gain isn't worth
      // the complexity of the resume-race edge.
      if (
        draftStatus !== 'not_started' &&
        draftStatus !== 'completed' &&
        draftStatus !== 'cancelled'
      ) {
        continue;
      }
      if (ageMs <= this.idleEvictionMs) continue;

      // Eviction: shutdown the lobby (stops snapshot + heartbeat +
      // pending timers via shutDown flag), then remove from map.
      // Fire-and-forget shutdown; the promise resolves after
      // internal teardown but the map-delete can happen immediately
      // since no new lookup will find this lobbyId post-delete.
      // 2026-09-03: this catch used to log at `debug` and then throw
      // the error away with a bare `void` statement. `debug` is
      // dropped outright under the default LOG_LEVEL=INFO, so a lobby
      // whose shutdown threw left no trace at all: the timers,
      // snapshot loop and heartbeat that shutdown was supposed to
      // stop stayed armed on a lobby already removed from the map,
      // and the only evidence was a slow leak.
      //
      // Control flow is unchanged (still fire-and-forget; the map
      // delete below still happens). The error is now carried, at a
      // level that is actually emitted, using the same fold-err-into-
      // ctx idiom as `registry.evict_connection_close_threw` above.
      void lobby.shutdown().catch((err: unknown) => {
        structuredLogger.warn('registry.idle_eviction_shutdown_threw', {
          lobbyId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
      this.lobbies.delete(lobbyId);
      evicted += 1;
      structuredLogger.info('registry.lobby_evicted_idle', {
        lobbyId,
        ageMs,
        idleEvictionMs: this.idleEvictionMs,
        connectionCount,
        draftStatus,
        lastActivityAt: new Date(lastActivityAt).toISOString(),
      });
    }
    if (evicted > 0 || scanned > 0) {
      structuredLogger.debug('registry.idle_eviction_scan_completed', {
        scanned,
        evicted,
      });
    }
    return { scanned, evicted };
  }

  // ── F20 Piece 3 (2026-08-02): clock-liveness scanner ─────────────

  /**
   * Start the periodic clock-liveness scanner. Idempotent — a second
   * call is a no-op. Called from the engine entry-point startup
   * alongside startIdleEvictionTimer(). If `CLOCK_LIVENESS_SCAN_MS`
   * or `CLOCK_LIVENESS_STALL_MS` is `0` (env or options), this is a
   * no-op (scanner disabled).
   *
   * Per architect ruling 2 (2026-08-02): TOP-LEVEL TRY/CATCH inside
   * the setInterval callback ensures no scan error can ever terminate
   * the interval. The per-lobby try/catch inside scanClockLiveness
   * ensures one throwing lobby cannot shield the rest.
   */
  startClockLivenessScanner(): void {
    if (this.clockLivenessTimer !== null) return;
    if (this.clockLivenessScanMs <= 0 || this.clockLivenessStallMs <= 0) {
      structuredLogger.info('registry.clock_liveness_scanner_disabled', {
        clockLivenessScanMs: this.clockLivenessScanMs,
        clockLivenessStallMs: this.clockLivenessStallMs,
      });
      return;
    }
    this.clockLivenessTimer = setInterval(() => {
      // Top-level try/catch: unkillable. A scan error must NOT stop
      // the interval — F20's whole lesson is that the engine watched
      // the thing that didn't break; a liveness watchdog that dies
      // silently on the first malformed lobby is the same defect
      // wearing the fix's clothes.
      void this.scanClockLiveness().catch((err: unknown) => {
        structuredLogger.error('registry.clock_liveness_scan_threw', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.clockLivenessScanMs);
    if (typeof this.clockLivenessTimer.unref === 'function') {
      this.clockLivenessTimer.unref();
    }
    structuredLogger.info('registry.clock_liveness_scanner_started', {
      clockLivenessScanMs: this.clockLivenessScanMs,
      clockLivenessStallMs: this.clockLivenessStallMs,
    });
  }

  /**
   * Cancel the periodic clock-liveness scanner. Called from the
   * engine's graceful-shutdown path BEFORE closing lobbies so a late
   * scan doesn't try to recover a lobby that's already being torn
   * down. Idempotent.
   */
  stopClockLivenessScanner(): void {
    if (this.clockLivenessTimer !== null) {
      clearInterval(this.clockLivenessTimer);
      this.clockLivenessTimer = null;
      structuredLogger.info('registry.clock_liveness_scanner_stopped', {});
    }
  }

  /**
   * Single scan pass. Public for tests + admin diagnostics.
   *
   * For each in-registry lobby that is in_progress with a
   * pick_deadline more than clockLivenessStallMs in the past:
   * proposes recovery via `lobby.attemptClockRecovery(observedSeq)`;
   * the lobby has final say. Strike-map records recovery attempts
   * per-lobby; at MAX we log ERROR + alertable and stop re-arming.
   *
   * Unkillable (architect ruling 2, 2026-08-02): every lobby is
   * wrapped in its own try/catch so one throwing lobby cannot
   * shield the rest. The setInterval callback in
   * `startClockLivenessScanner` wraps this whole method in a
   * top-level catch.
   */
  async scanClockLiveness(): Promise<{
    scanned: number;
    stalled: number;
    recovered: number;
    escalated: number;
    errored: number;
  }> {
    // Strike-map hygiene (architect ruling 2, 2026-08-02): prune
    // entries whose lobbies have left the registry. One-liner at the
    // top of each scan covers eviction / force-purge / completion
    // without hooking every removal path. Slow leak F5's family.
    for (const lobbyId of Array.from(this.clockLivenessStrikes.keys())) {
      if (!this.lobbies.has(lobbyId)) {
        this.clockLivenessStrikes.delete(lobbyId);
      }
    }

    // Snapshot entries so a re-arm mid-loop that mutates timer state
    // doesn't corrupt the iterator (attemptClockRecovery may indirectly
    // touch this.lobbies via LobbyManager's internal wiring).
    const entries: Array<[string, LobbyManager]> = [];
    for (const [lobbyId, entry] of this.lobbies.entries()) {
      if (entry instanceof LobbyManager) {
        entries.push([lobbyId, entry]);
      }
    }

    let scanned = 0;
    let stalled = 0;
    let recovered = 0;
    let escalated = 0;
    let errored = 0;

    for (const [lobbyId, lobby] of entries) {
      scanned += 1;
      try {
        // Per-lobby try/catch (architect ruling 2, 2026-08-02): one
        // throwing lobby MUST NOT shield the rest. Every accessor
        // below (getDraftStatus, getCurrentTimerDeadline,
        // getTimerArmSeq, attemptClockRecovery) is a candidate for
        // "malformed lobby throws unexpectedly."
        if (lobby.getDraftStatus() !== 'in_progress') {
          this.clockLivenessStrikes.delete(lobbyId);
          continue;
        }
        const deadline = lobby.getCurrentTimerDeadline();
        if (deadline === null) {
          // Edge (a) per architect ruling: pre-first-arm window
          // (in_progress but no pick armed yet) is NOT a stall. Clear
          // any lingering strike.
          this.clockLivenessStrikes.delete(lobbyId);
          continue;
        }
        const overdueMs = Date.now() - deadline.getTime();
        if (overdueMs <= this.clockLivenessStallMs) {
          // Healthy. Natural recovery clears the strike map so a
          // future unrelated stall starts fresh.
          this.clockLivenessStrikes.delete(lobbyId);
          continue;
        }

        // STALL. Consult strike map before proposing recovery.
        stalled += 1;
        const observedSeq = lobby.getTimerArmSeq();
        const strike = this.clockLivenessStrikes.get(lobbyId);

        if (strike && strike.count >= LobbyRegistry.MAX_CLOCK_LIVENESS_STRIKES) {
          // Already escalated on a prior scan. Do NOT re-arm again —
          // recovery loop that silently spins forever is its own
          // hazard (architect ruling 3b). ERROR emitted at
          // escalation; skip here to avoid log spam.
          continue;
        }

        const result = await lobby.attemptClockRecovery(observedSeq);

        if (result.recovered) {
          recovered += 1;
          const nextCount = (strike?.count ?? 0) + 1;
          if (nextCount >= LobbyRegistry.MAX_CLOCK_LIVENESS_STRIKES) {
            // Third recovery of the same lobby without natural healing.
            // Something is preventing the re-armed timer from firing
            // (event-loop starvation, wedged autopick handler, etc.).
            // Log ERROR + alertable and refuse further recovery.
            structuredLogger.error('registry.clock_stall_giving_up', {
              lobbyId,
              alertable: true,
              consecutiveRecoveries: nextCount,
              observedSeq,
              newSeq: result.currentSeq,
              overdueMs,
            });
            escalated += 1;
            this.clockLivenessStrikes.set(lobbyId, {
              seq: result.currentSeq,
              count: LobbyRegistry.MAX_CLOCK_LIVENESS_STRIKES,
            });
          } else {
            this.clockLivenessStrikes.set(lobbyId, {
              seq: result.currentSeq,
              count: nextCount,
            });
          }
          structuredLogger.error('registry.clock_stall_recovered', {
            lobbyId,
            observedSeq,
            newSeq: result.currentSeq,
            overdueMs,
            consecutiveRecoveries: nextCount,
          });
          continue;
        }

        // Not recovered. Reason tells us what to do with strikes.
        if (
          result.reason === 'seq_advanced' ||
          result.reason === 'not_in_progress' ||
          result.reason === 'paused' ||
          result.reason === 'shut_down' ||
          result.reason === 'no_deadline' ||
          result.reason === 'no_stall'
        ) {
          // Benign: scanner was stale or lobby moved on. Clear strikes.
          this.clockLivenessStrikes.delete(lobbyId);
        }
        // submit_in_flight: leave strikes alone; next scan re-evaluates.
      } catch (err) {
        errored += 1;
        structuredLogger.error('registry.clock_liveness_scan_lobby_threw', {
          lobbyId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { scanned, stalled, recovered, escalated, errored };
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
