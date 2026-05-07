// Phase 4.5 chunk 11g.4 — LobbyManager: in-memory state machine + single-
// writer queue per active draft.
//
// Step 6c of chunk 11g.4: pick deadline tracking + autopick on
// timeout. Per-lobby `setTimeout` fires `handleAutopickTimeout` at
// the on-clock pick's deadline; the autopick action constructs an
// engine-authored `submit_pick` (actorKind='autopick') that flows
// through the standard single-writer queue. Player selection is
// delegated to the chain-of-strategies in `autopickStrategy.ts`
// (today: `projectionsStrategy` only — highest-projected available;
// future strategies layer in via the chain). Pause/resume captures
// in-memory state mirroring the `draft_pause` / `draft_resume` RPC
// behavior (resume gives a fresh full pick clock, not remaining-
// from-pause). Bootstrap reconstructs the deadline from
// `leagues.pick_deadline` directly (the column the RPC has been
// authoritatively maintaining since Phase 2), so the engine survives
// process restarts mid-draft with timer state intact.
//
// **Chunk 11g.4 is functionally complete after this step.** The
// LobbyManager is a full live-draft engine for snake/linear
// formats: state machine, ring buffer, broadcast, snapshot,
// presence, resync primitive, backpressure, ADR-004 engine-side
// auth, bootstrap, and autopick. Auction format remains stubbed
// for chunk 11g.6 (auction state machine + anti-snipe per ADR-002).
//
// Step 6b of chunk 11g.4: bootstrap from the durable event log. The
// `init()` method (called by `LobbyRegistry.constructLobby` after
// construction) replays every `draft_events` row for the league via
// `DraftServiceV2.listDraftEvents`, dispatching on `event_type` to
// hydrate the in-memory state machine. Process restart, eviction,
// and horizontal scaling no longer cost user-visible state.
//
// Step 6b dispatches all 11 currently-shipping `event_type` values:
//   - `pick`: validate payload against `draftOrder[picksMade]`,
//     append to ring buffer (translated to application-layer kind
//     `pick_submitted`), advance state.
//   - `pick_undone`: validate payload against `draftOrder[picksMade-1]`,
//     append to ring buffer, decrement state, transition status if
//     applicable.
//   - `commissioner_override`: advance state without on-clock check
//     (commissioner authoritatively decides).
//   - `draft_completed`: explicit transition to `completed`.
//   - `draft_cancelled`: explicit transition to `cancelled`.
//   - `draft_paused` / `draft_resumed` / `draft_extended`: skip-with-
//     debug-log; chunk 11g.4 step 6c picks these up when timers land.
//   - `autopick_failed` / `generation_bumped`: skip-with-debug-log;
//     diagnostic / internal.
//   - unknown event types: skip-with-warn-log; forward-compat for
//     chunk 11g.6 auction event types and any future additions.
//
// Step 6a's `existingPicksMade` forward-compat hook is removed —
// bootstrap replaces it entirely.
//
// Future sub-steps:
//   - 6c: pick deadlines + autopick (timer per lobby; deadline
//          expiry triggers autopick via the queue)
//
// Step 5 of chunk 11g.4: live-multiplayer fundamentals.
//   - **Broadcast** on successful pick: serialized DraftServerMessage
//     of type 'event' published to `draft:${lobbyId}` via the injected
//     `publish` callback (uWS app.publish under the hood).
//   - **Snapshot-on-connect**: addConnection sends the joining client
//     a 'snapshot' message immediately so they don't need a separate
//     HTTP round-trip to know current state.
//   - **Presence**: addConnection / removeConnection broadcast
//     'presence' join/left, deduplicated per userId (co-manager case:
//     same user from multiple devices counts as one presence entry).
//   - **Resync server primitive**: handleResyncRequest wraps the step-3
//     ring buffer's getEventsSinceSeq into a 'resync_response' message
//     for chunk 11g.5's reconnect-state-machine to consume.
//   - **Backpressure sweep**: after every broadcast, iterate connections
//     and forcibly disconnect any WS whose buffered amount exceeds the
//     1MB industry threshold (slow consumer protection — one wedged
//     client cannot block the rest of the lobby).
//
// Future steps:
//   - Step 6: auction state machine (place_bid + nominate handlers, real
//             round/pickNumber computation from in-memory state)
//   - Step 7: snapshot persistence + bootstrap (chunk 11g.7) — owns
//             lobby eviction once the draft completes; step 5 does
//             NOT evict on last-disconnect.
//
// **Three step-5-adjacent concerns are deferred and tracked in
// PHASE_4_5_PROJECT_PLAN.md Decision Log (2026-05-05):**
//   - Heartbeat / keepalive — chunk 11g.7 (operations layer)
//   - Per-event-type rate limiting + prioritization — chunk 11g.11
//   - O(connections) backpressure sweep cost — chunk 11g.11 revisit
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; LobbyManager
// principles — Principle 5 single-writer per lobby; line 147 ring
// buffer specification), docs/adr/ADR-002-auction-state-machine.md
// §3.2 (format-aware single class) and §4.1 (event-types catalog),
// and docs/adr/ADR-001-persistent-node-draft-engine.md.

import type { WebSocket } from 'uWebSockets.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@citrus/shared';
import { AppError } from '../lib/errors';
import {
  DraftServiceV2,
  type DraftEventRow,
  type DraftV2Actor,
  type SubmitPickResult,
} from '../services/DraftServiceV2';
import { randomUUID } from 'node:crypto';
import { RingBuffer } from './RingBuffer';
import {
  selectAutopickPlayer,
  type AutopickStrategy,
} from './autopickStrategy';
import {
  serializeServerMessage,
  WIRE_PROTOCOL_VERSION,
  type AuctionStateSnapshot,
  type BufferedDraftEvent,
  type DraftAction,
  type DraftActionResult,
  type DraftFormat,
  type DraftOrderSlot,
  type DraftServerMessage,
  type DraftSnapshot,
  type DraftSocketUserData,
  type DraftStateSnapshot,
  type DraftStatus,
  type GetEventsSinceSeqResult,
  type TeamAuthorizationResult,
} from './types';

export interface LobbyManagerOptions {
  lobbyId: string;
  format: DraftFormat;
  leagueId: string;
  /**
   * Required dependency: the RPC wrapper that talks to
   * `submit_pick_v2` (and chunk 11g.6's auction RPCs once those
   * exist). Injected at construction so chunk 11g.4 step 4's
   * LobbyRegistry can share a single `DraftServiceV2` instance
   * across lobbies, and so unit tests can pass a mocked service.
   */
  draftService: DraftServiceV2;

  /**
   * uWS app-level publish callback. Injected (not module-imported)
   * so the LobbyManager stays uWS-agnostic — tests pass a `vi.fn()`
   * to assert broadcast behavior without spinning up a real uWS
   * server.
   *
   * Production: bound from `app.publish` in `index.ts`. Topic naming
   * follows the architecture doc convention (`draft:${lobbyId}`).
   */
  publish: (topic: string, message: string) => void;

  /**
   * Pick clock duration in seconds, INCLUDING the +1s pad that
   * `submit_pick_v2` applies (per migration line 896-898). Index.ts
   * computes this as `pickTimeLimit + 1` from `leagues.settings.pickTimeLimit`
   * (default 90 → engine sees 91).
   *
   * The +1s pad is intentional: it ensures the user-visible client
   * timer hits zero BEFORE the server-side autopick fires. Eliminates
   * the "submitted at the last millisecond and got rejected" UX bug
   * where client and server clocks diverge by sub-second amounts.
   */
  pickClockSeconds: number;

  /**
   * Initial pick deadline loaded from `leagues.pick_deadline` at
   * lobby construction time. The RPC has authoritatively maintained
   * this column since Phase 2 — bootstrap consumes it directly
   * rather than reconstructing from event timestamps + pickTimeLimit
   * (more robust against clock drift between event creation and
   * engine startup).
   *
   * `null` for fresh drafts (not yet started), paused drafts
   * (RPC clears the column), and completed/cancelled drafts.
   */
  initialPickDeadline: Date | null;

  /**
   * Initial draft state from `leagues.draft_state` at construction.
   * Used after bootstrap event replay to decide whether to schedule
   * a timer. Snake/linear values: `'active' | 'paused' | 'completed'
   * | 'cancelled'` (or `'pre_draft'` for fresh-start). The engine's
   * `DraftStatus` enum normalizes these.
   */
  initialDraftState: string | null;

  /**
   * Pre-flattened draft order loaded from `public.draft_order` by
   * `lobbyConfigLookup` in `index.ts` (Path B per chunk-6a recon).
   * One entry per pick of the entire draft; snake reversal is baked
   * into the per-round teamId ordering.
   *
   * For auction lobbies this list MAY be empty (auction has
   * nominations rather than slots — chunk 11g.6 / ADR-002 §3
   * introduces the auction-specific state); `processSubmitPick`
   * gates on `format === 'auction'` before consulting this list.
   *
   * Source-of-truth note: the same `public.draft_order` rows are
   * read by `submit_pick_v2`'s on-clock check at migration line
   * 783-799 of `20260425140000_draft_engine_v2_rpcs.sql`. Engine
   * and RPC validate against an identical view by construction.
   */
  draftOrder: ReadonlyArray<DraftOrderSlot>;

  /**
   * Engine-side team-authorization callback per ADR-004 §5.3.
   * Verifies that `userId` is authorized to act on behalf of
   * `teamId` BEFORE the engine calls `submit_pick_v2` with
   * `actor.kind = 'user'`. Required for the trusted-executor
   * contract — the RPC's relaxed permission check (per ADR-004
   * §5.1) trusts the engine to have done this verification.
   *
   * Today's `index.ts` implementation queries `teams.owner_id`
   * directly. Switches to the `team_authorized()` SQL helper once
   * ADR-003 Phase 2 ships; the callback's shape (richer
   * discriminated-union result) is forward-compat for that
   * integration as a drop-in.
   */
  verifyTeamAuthorization: (
    userId: string,
    teamId: string,
  ) => Promise<TeamAuthorizationResult>;

  /**
   * Supabase client for autopick read queries (player projections,
   * already-drafted player lookup). Distinct from `draftService`'s
   * internal client because autopick reads are unrelated to RPC
   * writes — keeping them separate lets tests stub one without the
   * other and keeps the strategy chain trivially mockable.
   *
   * Production: same admin client passed to `DraftServiceV2`. Tests
   * pass a mock with `from()` returning the right shape.
   */
  supabase: SupabaseClient;

  /**
   * Optional autopick strategy chain override. Defaults to the
   * shipping `[projectionsStrategy]` chain in
   * `autopickStrategy.ts`. Tests pass custom strategies to exercise
   * the chain semantics; commissioner UI override (future) could
   * pass a different chain too.
   */
  autopickStrategies?: ReadonlyArray<AutopickStrategy>;

  // ── Auction-specific (chunk 11g.6 sub-step 6a) ──────────────────
  // Required for `format === 'auction'`; ignored for snake/linear.
  // See `LobbyConfig` JSDoc in LobbyRegistry.ts for full semantics.

  /** Round-robin nomination rotation. Empty for snake/linear. */
  nominationOrder: ReadonlyArray<string>;
  /** Per-team starting budget (seeds `auction_budgets`). */
  auctionBudget: number;
  /** Min opening bid + min bid increment (flat $1 in 6a). */
  auctionMinBid: number;
  /** Total roster slots per team — drives auction completion + budget reserve. */
  draftRounds: number;
  /** Initial budget per team, hydrated from `auction_budgets`. */
  initialTeamBudgets: ReadonlyMap<string, number>;
  /** Initial `players_won` per team, from `auction_budgets`. */
  initialPlayersWon: ReadonlyMap<string, number>;
  /** Active nomination row at construction (informational). */
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
   * §3.3 / §4.4). Threshold = 0 disables anti-snipe entirely.
   * Engine threads these through to every `place_bid_v2` call.
   * Snake/linear lobbies set both to 0 (unused — no `place_bid_v2`
   * calls).
   */
  auctionAntiSnipeThresholdSeconds: number;
  auctionAntiSnipeExtensionSeconds: number;
}

/**
 * Maximum number of `idempotencyKey -> Promise<DraftActionResult>` entries
 * retained by the in-memory cache. FIFO eviction at this cap.
 *
 * Sized for snake/linear v1 load: a 12-team, 21-round draft tops out at
 * ~252 picks — slightly above the 200 cap, so the very first picks of a
 * long draft fall out of the cache toward the end, but those keys are
 * also unlikely to be retried that late (a retry from a mobile blip
 * usually arrives within seconds, not hours).
 *
 * **Revisit in chunk 11g.6 (auction work):** auction bid count per draft
 * easily exceeds 200 (one nomination can attract dozens of bids; a full
 * draft has 12+ team-roster nominations and many bid retries). The cap
 * may need to grow to ~1,000 or move to time-based eviction.
 */
const IDEMPOTENCY_CACHE_MAX = 200;

/**
 * Maximum number of events retained in the recent-events ring buffer.
 * Sized per docs/PHASE_4_5_ARCHITECTURE.md (line 147: "recent events
 * ring buffer (~200 events)") — covers a typical snake-draft window
 * for chunk 11g.5's `last_seen_seq` resume protocol without forcing
 * DB resync on routine reconnects.
 *
 * **Revisit in chunk 11g.6 (auction work):** auction event volume
 * may exceed snake/linear (one nomination plus many bids per roster
 * slot). If the buffer evicts before clients can resume reliably,
 * raise this cap or move to time-based retention.
 */
const EVENT_BUFFER_CAPACITY = 200;

/**
 * Backpressure threshold in bytes. Industry-standard floor for
 * WebSocket broadcast applications (Discord engineering, uWS
 * examples both cite ~1MB). When a connection's buffered amount
 * exceeds this, the LobbyManager forcibly disconnects with code
 * 1013 ("try again later") rather than letting one slow consumer
 * accumulate unbounded memory and block the rest of the lobby.
 *
 * **Revisit in chunk 11g.11 (load test):** real bandwidth profiles
 * + auction-format event volume may suggest a different threshold
 * or a tiered approach (drop chat first, preserve state events).
 * Tracked in PHASE_4_5_PROJECT_PLAN.md Decision Log (2026-05-05).
 */
const BACKPRESSURE_THRESHOLD_BYTES = 1_048_576; // 1 MiB

export class LobbyManager {
  readonly lobbyId: string;
  readonly format: DraftFormat;
  readonly leagueId: string;

  private readonly draftService: DraftServiceV2;
  private readonly publish: (topic: string, message: string) => void;
  private readonly verifyTeamAuthorization: (
    userId: string,
    teamId: string,
  ) => Promise<TeamAuthorizationResult>;
  private readonly supabase: SupabaseClient;
  private readonly autopickStrategies: ReadonlyArray<AutopickStrategy> | undefined;
  private readonly pickClockMs: number;
  private readonly initialPickDeadline: Date | null;
  private readonly initialDraftState: string | null;

  /**
   * Pre-flattened draft order — one slot per pick of the entire
   * draft. Source: `public.draft_order` rows loaded by
   * `lobbyConfigLookup` (Path B). For auction lobbies this is the
   * empty array; auction state lives in chunk 11g.6's separate
   * structures per ADR-002 §3.2.
   *
   * Read at slot index `picksMade` to determine the on-clock team
   * for the current pick. Length is `totalPicks` for the lobby.
   */
  private readonly draftOrder: ReadonlyArray<DraftOrderSlot>;

  /**
   * Number of successful, non-duplicate picks recorded so far.
   * Advances by 1 on every `processSubmitPick` success path that
   * gets a `was_duplicate=false` from the RPC. Step 6b's bootstrap
   * sets the initial value from the durable event log on `init()`.
   */
  private picksMade = 0;

  /**
   * Lifecycle phase per `DraftStatus`. Transitions:
   *   - constructor: `not_started` (always — bootstrap mutates during
   *     `init()` if the durable log shows in-progress / completed /
   *     cancelled state)
   *   - first successful pick: `not_started → in_progress`
   *   - final pick (`picksMade === draftOrder.length`):
   *     `in_progress → completed`
   *   - durable `draft_completed` event: explicit `completed`
   *   - durable `draft_cancelled` event: explicit `cancelled`
   *   - durable `pick_undone` event: rewinds picksMade and may
   *     transition `completed → in_progress` or `in_progress →
   *     not_started` if the undo was the only pick
   *
   * Auction lobbies stay at `not_started` until chunk 11g.6
   * introduces auction-specific lifecycle wiring.
   */
  private draftStatus: DraftStatus = 'not_started';

  /**
   * Bootstrap-completion flag. The constructor leaves this `false`;
   * `init()` flips it to `true` after replaying the event log.
   * `processSubmitPick` throws if invoked while `false` (programmer
   * error — caller forgot to await `init()`).
   */
  private initialized = false;

  /**
   * Step-6c timer state.
   *
   * `currentPickDeadline`: wall-clock timestamp when the on-clock
   * pick's deadline expires. Wall-clock (not relative) so it
   * survives bootstrap correctly — at bootstrap the engine reads
   * the deadline from `leagues.pick_deadline` and computes
   * `setTimeout(handleAutopickTimeout, deadline - now())`.
   *
   * `currentPickTimerHandle`: the live `setTimeout` handle. Cleared
   * by `cancelPickTimer` on pick advance, pause, completion,
   * cancellation, and shutdown. `null` when no timer is scheduled.
   *
   * `pauseState`: present iff the draft is paused. Captures the
   * pause moment AND the time-remaining-when-paused for audit /
   * diagnostic. **Not used to reconstruct the resume deadline** —
   * the `draft_resume` RPC gives a fresh full pick clock (per
   * migration line 1136-1141), and the engine mirrors that
   * behavior. Single source of truth principle: engine state
   * derives from RPC behavior, not engine-internal computation.
   *
   * `shutDown`: once true, no further timers may be scheduled and
   * `setPickDeadline` becomes a no-op. Set by `shutdown()` (called
   * by chunk 11g.7's graceful-shutdown path; today only by tests).
   */
  private currentPickDeadline: Date | null = null;
  private currentPickTimerHandle: NodeJS.Timeout | null = null;
  private pauseState: { pausedAt: Date; remainingMs: number } | null = null;
  private shutDown = false;

  /**
   * uWS pub/sub topic name for this lobby. Step-5 broadcasts
   * publish to this topic; addConnection / removeConnection
   * subscribe / unsubscribe each ws.
   *
   * Naming follows the architecture doc convention
   * (PHASE_4_5_ARCHITECTURE.md lines 138, 143): `draft:${lobbyId}`.
   */
  private readonly topicName: string;

  /**
   * Connected uWS WebSockets keyed by ws reference, mapping to the
   * userData captured at upgrade time. Map (not Set) so
   * `removeConnection` can recover the closing user's identity for
   * presence-leave broadcasts without a separate parallel structure.
   *
   * Map.set on the same key is idempotent — addConnection on the
   * same ws twice is a safe no-op for membership.
   */
  private readonly connections = new Map<WebSocket<DraftSocketUserData>, DraftSocketUserData>();

  /**
   * Set of distinct userIds currently present in the lobby. A user
   * with multiple WebSocket connections (co-manager case: same user
   * on phone + laptop) appears once. Presence join is broadcast on
   * the FIRST connection for a userId; presence leave on the LAST
   * disconnect for that userId.
   */
  private readonly presentUserIds = new Set<string>();

  /**
   * Single-writer queue. The `this.queue = this.queue.then(...)` chain
   * pattern from PHASE_4_5_ARCHITECTURE.md Principle 5 serializes all
   * mutations within a lobby — concurrent `enqueueAction` calls
   * resolve in submission order. On a single Node process the event
   * loop already serializes, but the pattern must be present so
   * future multi-process sharding (Stage 2 in the architecture doc)
   * doesn't require finding and fixing concurrent-access bugs.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Idempotency cache: `idempotencyKey -> Promise<DraftActionResult>`.
   * Stores the **in-flight promise**, not the resolved value, so
   * concurrent same-key callers get the same promise (processAction
   * runs once). Once the promise resolves, sequential same-key
   * callers also get the cached resolution.
   *
   * Insertion-ordered (Map preserves insertion order); FIFO eviction
   * at IDEMPOTENCY_CACHE_MAX entries.
   */
  private readonly seenIdempotencyKeys = new Map<
    string,
    Promise<DraftActionResult>
  >();

  /**
   * Recent-events ring buffer backing chunk 11g.5's `last_seen_seq`
   * resume protocol. Sized at `EVENT_BUFFER_CAPACITY` (~200) per
   * the architecture doc. Eviction-aware semantics: clients whose
   * `sinceSeq` references events the buffer no longer holds get a
   * `too_old` reply and fall back to a full snapshot resync from
   * Postgres; clients within the buffer's window get an incremental
   * event stream.
   *
   * Step 3 appends `pick_submitted` here on every successful non-
   * duplicate `submit_pick`. Chunk 11g.6 will append the auction
   * event variants (`auction_bid_placed`, `auction_nomination_started`,
   * plus the system-generated variants like `auction_paused`).
   */
  private readonly events = new RingBuffer<BufferedDraftEvent>(EVENT_BUFFER_CAPACITY);

  // ── Auction state (chunk 11g.6 sub-step 6a) ───────────────────────

  /**
   * Round-robin nomination rotation. Empty for snake/linear.
   * `currentNominator = nominationOrder[nominationsCompleted %
   * nominationOrder.length]`. Auction completes when
   * `nominationsCompleted >= nominationOrder.length × draftRounds`.
   */
  private readonly nominationOrder: ReadonlyArray<string>;
  private readonly draftRounds: number;
  private readonly auctionMinBid: number;
  /**
   * Bid-window duration in ms. 6a uses `pickClockMs` (mirrors
   * `auctionNominationTime + 1`); ADR-002 §3.4 nomination-window/
   * bid-window split lands in 6c alongside auto-nominate.
   */
  private readonly bidWindowMs: number;

  /**
   * Number of nominations that have closed (bid won + roster
   * filled, OR no_sale + nomination expired). Drives the rotation
   * pointer and the auction-complete check.
   */
  private nominationsCompleted = 0;

  /**
   * Active nomination row, or null when no nomination is open.
   * Updated by:
   *   - `processNominate` success (creates)
   *   - `processPlaceBid` success (mutates leadingBid + leadingBidderId)
   *   - `handleNominationTimeout` (clears on close + advances rotation)
   *   - bootstrap auction event handlers (event log replay)
   *
   * The timer handle is held here (parallel to snake/linear's
   * `currentPickTimerHandle`); `cancelPickTimer` clears both.
   */
  private currentNomination: {
    nominationId: string;
    playerId: string;
    playerName: string;
    nominatorTeamId: string;
    leadingBidderId: string;
    leadingBid: number;
    expiresAt: Date;
    timerHandle: NodeJS.Timeout | null;
  } | null = null;

  /** Per-team remaining budget (mirrors `auction_budgets.remaining_budget`). */
  private readonly teamBudgets: Map<string, number>;
  /** Per-team players-won count (mirrors `auction_budgets.players_won`). */
  private readonly teamPlayersWon: Map<string, number>;

  /**
   * Anti-snipe configuration (chunk 11g.6 sub-step 6b per ADR-002
   * §3.3 / §4.4). Threshold = 0 disables anti-snipe entirely.
   * Threaded through to every `place_bid_v2` call so the RPC can
   * apply the threshold check atomically with the bid write.
   */
  private readonly antiSnipeThresholdSeconds: number;
  private readonly antiSnipeExtensionSeconds: number;

  constructor(opts: LobbyManagerOptions) {
    this.lobbyId = opts.lobbyId;
    this.format = opts.format;
    this.leagueId = opts.leagueId;
    this.draftService = opts.draftService;
    this.publish = opts.publish;
    this.verifyTeamAuthorization = opts.verifyTeamAuthorization;
    this.supabase = opts.supabase;
    this.autopickStrategies = opts.autopickStrategies;
    this.pickClockMs = opts.pickClockSeconds * 1000;
    this.initialPickDeadline = opts.initialPickDeadline;
    this.initialDraftState = opts.initialDraftState;
    this.draftOrder = opts.draftOrder;
    this.topicName = `draft:${opts.lobbyId}`;

    // Auction state (chunk 11g.6 sub-step 6a). `bidWindowMs` reuses
    // `pickClockMs` (the auction format-aware `pickClockSeconds`
    // already pulled `auctionNominationTime + 1` from settings in
    // `lookupLobbyConfig`).
    this.nominationOrder = opts.nominationOrder;
    this.draftRounds = opts.draftRounds;
    this.auctionMinBid = opts.auctionMinBid;
    this.bidWindowMs = this.pickClockMs;
    this.teamBudgets = new Map(opts.initialTeamBudgets);
    this.teamPlayersWon = new Map(opts.initialPlayersWon);
    this.antiSnipeThresholdSeconds = opts.auctionAntiSnipeThresholdSeconds;
    this.antiSnipeExtensionSeconds = opts.auctionAntiSnipeExtensionSeconds;

    // `picksMade`, `draftStatus`, `initialized`, timer state are
    // zero-initialized at the field declaration above. `init()`
    // mutates them during event-log replay + sets the deadline
    // timer from `initialPickDeadline` per chunk 11g.4 step 6c.
    logger.info(
      `[lobby] LobbyManager constructed (pre-init) lobbyId=${opts.lobbyId} format=${opts.format} leagueId=${opts.leagueId} topic=${this.topicName} totalPicks=${this.draftOrder.length} pickClockSeconds=${opts.pickClockSeconds} auctionTeams=${opts.nominationOrder.length} auctionRounds=${opts.draftRounds}`,
    );
  }

  /**
   * Bootstrap from the durable `draft_events` log. MUST be called
   * after construction and BEFORE any `processSubmitPick` invocation.
   * `LobbyRegistry.constructLobby` (chunk 11g.4 step 4 / 6b) awaits
   * this before returning the LobbyManager.
   *
   * Idempotent — calling twice is a safe no-op (the `initialized`
   * flag short-circuits). Bootstrap-twice would double-replay the
   * event log and corrupt state, so this guard is load-bearing.
   *
   * Construction failures (DB query rejection, event log integrity
   * error) propagate as thrown errors. The registry's existing
   * Promise-placeholder pattern handles the propagation: the failed
   * placeholder is deleted from the map so the next caller can
   * retry from scratch (chunk 11g.4 step 4 design).
   *
   * Future replacement contract (chunk 11g.7): bootstrap will read
   * from a snapshot table + events-since-snapshot rather than full
   * replay. The init() interface stays the same; only the internal
   * `bootstrap()` implementation changes.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      logger.debug(
        `[lobby] init() called more than once — no-op lobbyId=${this.lobbyId}`,
      );
      return;
    }
    await this.bootstrap();
    this.initialized = true;

    // Step 6c: reconstruct timer state from `leagues.pick_deadline`.
    // The RPC has authoritatively maintained this column since
    // Phase 2; reading it directly is cleaner than reconstructing
    // from event timestamps + pickTimeLimit (no clock-drift concerns).
    //
    // - `paused` / `completed` / `cancelled`: no timer.
    // - `active` + deadline in the future: schedule normally.
    // - `active` + deadline already passed (engine started after
    //   the on-clock team's clock expired): fire autopick
    //   immediately. This is the "process restarted mid-deadline"
    //   recovery path.
    if (this.format === 'auction') {
      // Auction timer post-replay (chunk 11g.6 sub-step 6a): if a
      // nomination is open after event replay AND the draft is
      // active, schedule the bid-window timer from
      // `currentNomination.expiresAt`. Process-restart-mid-bid
      // recovery; mirrors the snake/linear `initialPickDeadline`
      // path conceptually.
      if (
        this.draftStatus === 'in_progress' &&
        this.pauseState === null &&
        this.currentNomination !== null
      ) {
        this.setPickDeadline(this.currentNomination.expiresAt);
      }
    } else if (
      this.draftStatus === 'in_progress' &&
      this.pauseState === null &&
      this.initialPickDeadline !== null
    ) {
      this.setPickDeadline(this.initialPickDeadline);
    }

    logger.info(
      `[lobby] init complete lobbyId=${this.lobbyId} format=${this.format} picksMade=${this.picksMade} status=${this.draftStatus} bufferSize=${this.events.size()} timerScheduled=${this.currentPickTimerHandle !== null} activeNomination=${this.currentNomination !== null}`,
    );
  }

  /**
   * Register a newly-upgraded WebSocket as a connected client.
   * Step 5 wiring:
   *   1. Record `ws → userData` mapping
   *   2. Subscribe ws to the lobby's broadcast topic
   *   3. Send the joining client a `snapshot` message so they have
   *      current state immediately (no separate HTTP round-trip)
   *   4. If this is the first ws for this `userId`, broadcast a
   *      `presence` join (deduplicated for co-manager / multi-device)
   *
   * Idempotent for the same ws: the Map.set + Set.add no-op on
   * duplicate keys, and the snapshot send is harmless (the client
   * already has state but treats snapshots as authoritative).
   *
   * Race tolerance: if the user disconnects during the open-handler
   * race window from step 4 (getOrCreate resolves AFTER the user
   * disconnected), `ws.send` for the snapshot may throw. Caught and
   * logged at debug — the orphan registration self-cleans on the
   * next removeConnection or lobby teardown.
   */
  addConnection(ws: WebSocket<DraftSocketUserData>, userData: DraftSocketUserData): void {
    const alreadyRegistered = this.connections.has(ws);
    this.connections.set(ws, userData);

    if (!alreadyRegistered) {
      try {
        ws.subscribe(this.topicName);
      } catch (err) {
        logger.debug(
          `[lobby] ws.subscribe threw during addConnection lobbyId=${this.lobbyId} userId=${userData.userId}`,
          err,
        );
      }
    }

    // Snapshot send — point-to-point, not via the broadcast topic.
    try {
      const snapshot: DraftServerMessage = {
        v: WIRE_PROTOCOL_VERSION,
        type: 'snapshot',
        timestamp: new Date().toISOString(),
        payload: this.getSnapshot(),
      };
      ws.send(serializeServerMessage(snapshot));
    } catch (err) {
      logger.debug(
        `[lobby] snapshot ws.send threw during addConnection lobbyId=${this.lobbyId} userId=${userData.userId}`,
        err,
      );
    }

    logger.info(
      `[lobby] connection added lobbyId=${this.lobbyId} userId=${userData.userId} size=${this.connections.size}`,
    );

    // Presence join — only on the FIRST connection for this userId.
    // Subsequent connections (co-manager multi-device) don't re-emit.
    if (!this.presentUserIds.has(userData.userId)) {
      this.presentUserIds.add(userData.userId);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'presence',
        timestamp: new Date().toISOString(),
        payload: {
          kind: 'joined',
          userId: userData.userId,
          presentUserIds: [...this.presentUserIds],
        },
      });
    }
  }

  /**
   * Deregister a closed/dropped WebSocket. Step 5 wiring:
   *   1. Recover userData from the connection map
   *   2. Drop the entry
   *   3. Unsubscribe ws from the topic (best-effort — the ws may
   *      already be closed, in which case unsubscribe throws and we
   *      swallow at debug)
   *   4. If no other connection for this userId remains, remove from
   *      presentUserIds and broadcast a `presence` left event
   *
   * Idempotent — calling for a ws not in the map is a no-op (early
   * return on map lookup miss). No presence churn for ws not
   * recognized.
   *
   * Lobby eviction on last-disconnect is intentionally NOT done here
   * — chunk 11g.7's snapshot-and-bootstrap flow owns lobby retirement
   * (drafts that complete get snapshotted and dropped from the
   * registry; pre-completion the lobby stays alive for late
   * reconnects to pick up the ring buffer).
   */
  removeConnection(ws: WebSocket<DraftSocketUserData>): void {
    const userData = this.connections.get(ws);
    if (!userData) {
      // ws was never registered (or already removed); idempotent no-op.
      return;
    }
    this.connections.delete(ws);

    try {
      ws.unsubscribe(this.topicName);
    } catch (err) {
      logger.debug(
        `[lobby] ws.unsubscribe threw during removeConnection lobbyId=${this.lobbyId} userId=${userData.userId}`,
        err,
      );
    }

    logger.info(
      `[lobby] connection removed lobbyId=${this.lobbyId} userId=${userData.userId} size=${this.connections.size}`,
    );

    // Presence leave — only when this was the LAST connection for
    // the userId (co-manager / multi-device case keeps presence
    // alive while at least one ws remains).
    const stillPresent = this.hasOtherConnectionForUser(userData.userId);
    if (!stillPresent) {
      this.presentUserIds.delete(userData.userId);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'presence',
        timestamp: new Date().toISOString(),
        payload: {
          kind: 'left',
          userId: userData.userId,
          presentUserIds: [...this.presentUserIds],
        },
      });
    }
  }

  /**
   * Number of currently-connected WebSockets. Used by the LobbyRegistry
   * (and chunk 11g.7's snapshot logic, eventually) for diagnostic
   * logging. Read-only — connection mutations go through
   * `addConnection`/`removeConnection`.
   */
  connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Enqueue a state-mutating action through the single-writer queue.
   * All bid/pick/nominate flows route through here so concurrent
   * actions serialize cleanly (per ADR-002 §3.5 race-condition fix
   * and PHASE_4_5_ARCHITECTURE.md Principle 5).
   *
   * Idempotency: each action carries an `idempotencyKey` (UUID). If
   * the same key has already been submitted (in-flight or resolved),
   * the cached promise is returned without re-running `processAction`.
   * Mobile retries on flaky networks collapse to one durable event.
   *
   * Step 2 dispatches `submit_pick` to the snake/linear handler;
   * `place_bid` and `nominate` return `'not_yet_implemented_chunk_11g6'`
   * stubs until the auction state machine lands.
   */
  async enqueueAction(action: DraftAction): Promise<DraftActionResult> {
    // Step 6b init guard. The LobbyManager state machine MUST be
    // bootstrapped before any action can be processed — running an
    // action with picksMade=0 / draftStatus='not_started' when the
    // durable log says otherwise would silently corrupt state. This
    // is a programmer error (caller forgot to await `init()`), not a
    // runtime condition. Logged at error level + thrown synchronously
    // BEFORE the queue chain — so it propagates as a rejected Promise
    // (visible to `await enqueueAction`) rather than getting masked
    // by the queue's catch-and-convert-to-internal_error pattern.
    if (!this.initialized) {
      const msg = `[lobby] enqueueAction called before init() — caller MUST await LobbyManager.init() lobbyId=${this.lobbyId} actionKind=${action.kind}`;
      logger.error(msg);
      throw new Error(msg);
    }

    // Idempotency check: if we've seen this key (either in-flight or
    // resolved), return the same promise. Concurrent same-key callers
    // get a shared promise; processAction runs at most once.
    const cached = this.seenIdempotencyKeys.get(action.idempotencyKey);
    if (cached) {
      return cached;
    }

    // Chain the action onto the queue. The .catch ensures a failed
    // action doesn't poison the chain — handleQueueError converts
    // the rejection to a resolved DraftActionResult (`internal_error`)
    // so the next enqueueAction call still runs.
    const next: Promise<DraftActionResult> = this.queue
      .then(() => this.processAction(action))
      .catch((err: unknown) => this.handleQueueError(err, action));

    this.queue = next;

    // Cache the in-flight promise immediately so a concurrent
    // same-key call returns this same promise (not a new one).
    this.cacheIdempotencyResult(action.idempotencyKey, next);

    return next;
  }

  /**
   * Return a wire-envelope snapshot of the current lobby state.
   * This is what new connections receive on join (step 5 wired the
   * send via uws-server.ts open handler; step 6a populates the
   * state-machine fields via `stateSnapshot`).
   *
   * Steps 1-3 returned identity + ring buffer; step 6a adds the
   * state-machine view. Future steps add pick deadlines (6c) and
   * format-specific state (chunk 11g.6 / ADR-002 for auction).
   *
   * For internal callers that only need the bare state-machine
   * values, use `getCurrentState()` — it skips the ring-buffer
   * snapshot and identity shaping.
   */
  getSnapshot(): DraftSnapshot {
    const auctionState = this.getAuctionState();
    return {
      lobbyId: this.lobbyId,
      format: this.format,
      recentEvents: this.events.snapshot(),
      stateSnapshot: this.getCurrentState(),
      ...(auctionState !== undefined ? { auctionState } : {}),
    };
  }

  /**
   * Return the bare state-machine view of the lobby. Distinct from
   * `getSnapshot()` (which builds the full wire envelope including
   * recent events) so internal callers — diagnostics, observability,
   * direct test access — don't pay the wire-shaping cost.
   *
   * `onClockTeamId` is `null` when the draft is `not_started` or
   * `completed`. During `in_progress`, it's
   * `draftOrder[picksMade].teamId`.
   *
   * `currentPickNumber` and `currentRoundNumber` follow the same
   * `null`-when-not-active convention.
   */
  getCurrentState(): DraftStateSnapshot {
    if (this.format === 'auction') {
      // Auction lobbies derive `onClockTeamId` from the round-robin
      // rotation rather than `draftOrder`; `currentPickNumber` and
      // `currentRoundNumber` map to the rotation pointer +
      // round-within-rotation. `totalPicks` is `nominationOrder.length
      // × draftRounds` (one nomination per roster slot per team).
      const teamCount = this.nominationOrder.length;
      const totalPicks = teamCount * this.draftRounds;
      const onClockTeamId =
        this.draftStatus === 'in_progress' && teamCount > 0
          ? this.nominationOrder[this.nominationsCompleted % teamCount] ?? null
          : null;
      const currentRoundNumber =
        this.draftStatus === 'in_progress' && teamCount > 0
          ? Math.floor(this.nominationsCompleted / teamCount) + 1
          : null;
      const currentPickNumber =
        this.draftStatus === 'in_progress'
          ? this.nominationsCompleted + 1
          : null;
      return {
        currentPickNumber,
        currentRoundNumber,
        onClockTeamId,
        totalPicks,
        picksMade: this.nominationsCompleted,
        draftStatus: this.draftStatus,
        currentPickDeadline:
          this.currentNomination !== null
            ? this.currentNomination.expiresAt.toISOString()
            : null,
      };
    }

    const slot =
      this.draftStatus === 'in_progress' ? this.draftOrder[this.picksMade] : null;
    return {
      currentPickNumber: slot ? slot.pickNumber : null,
      currentRoundNumber: slot ? slot.round : null,
      onClockTeamId: slot ? slot.teamId : null,
      totalPicks: this.draftOrder.length,
      picksMade: this.picksMade,
      draftStatus: this.draftStatus,
      currentPickDeadline:
        this.currentPickDeadline !== null
          ? this.currentPickDeadline.toISOString()
          : null,
    };
  }

  /**
   * Auction-only state for the wire snapshot. Returns `undefined`
   * for snake/linear lobbies (callers spread conditionally on
   * `DraftSnapshot.auctionState`). Per chunk 11g.6 sub-step 6a +
   * the `AuctionStateSnapshot` shape in `packages/shared/src/types/
   * draftWire.ts`.
   *
   * `teamRosterSlotsRemaining` = `draftRounds - players_won` per
   * team (the auction-side equivalent of how many roster slots a
   * team still needs to fill).
   */
  getAuctionState(): AuctionStateSnapshot | undefined {
    if (this.format !== 'auction') {
      return undefined;
    }
    const teamRosterSlotsRemaining: Record<string, number> = {};
    for (const teamId of this.nominationOrder) {
      const playersWon = this.teamPlayersWon.get(teamId) ?? 0;
      teamRosterSlotsRemaining[teamId] = this.draftRounds - playersWon;
    }
    return {
      currentNomination:
        this.currentNomination !== null
          ? {
              nominationId: this.currentNomination.nominationId,
              playerId: this.currentNomination.playerId,
              nominatorTeamId: this.currentNomination.nominatorTeamId,
              leadingBidderId: this.currentNomination.leadingBidderId,
              leadingBid: this.currentNomination.leadingBid,
              clockDeadline: this.currentNomination.expiresAt.toISOString(),
            }
          : null,
      teamBudgets: Object.fromEntries(this.teamBudgets),
      teamRosterSlotsRemaining,
      nominationsCompleted: this.nominationsCompleted,
    };
  }

  /**
   * Return events buffered since `sinceSeq`, or a `too_old` signal
   * telling the caller to fall back to a full snapshot resync from
   * Postgres. Used by chunk 11g.5's reconnect handler when a client
   * resumes with a `last_seen_seq` cursor.
   *
   * See `RingBuffer.getEventsSinceSeq` for the eviction-aware rule:
   * empty buffer or no eviction yet always returns `ok` (with the
   * filtered events, possibly empty); `too_old` only fires when the
   * buffer has actually evicted events the client wanted.
   */
  getEventsSinceSeq(sinceSeq: number): GetEventsSinceSeqResult {
    return this.events.getEventsSinceSeq(sinceSeq);
  }

  /**
   * Server-side primitive for chunk 11g.5's reconnect protocol.
   * Wraps `getEventsSinceSeq` in a `resync_response` server message
   * envelope. The caller (uws-helpers.ts `handleClientMessage`) is
   * responsible for `ws.send`-ing the serialized result back to the
   * requesting WebSocket.
   *
   * Point-to-point reply, NOT broadcast — only the requesting client
   * needs the response. The userData parameter is currently used for
   * diagnostic logging; chunk 11g.5 may also use it for per-user
   * rate-limit decisions.
   */
  handleResyncRequest(
    userData: DraftSocketUserData,
    sinceSeq: number,
  ): DraftServerMessage {
    const result = this.events.getEventsSinceSeq(sinceSeq);
    logger.debug(
      `[lobby] resync request lobbyId=${this.lobbyId} userId=${userData.userId} sinceSeq=${sinceSeq} ok=${result.ok}`,
    );

    // Narrow via property-existence (`'events' in result`) rather
    // than via the `ok` discriminator — narrowing on `result.ok` is
    // unreliable under server/tsconfig.json's `strict: false`
    // setting; `in`-based narrowing works in either mode (same
    // pattern as uws-server.ts verifyDraftToken handling).
    const payload =
      'events' in result
        ? { ok: true as const, events: result.events }
        : {
            ok: false as const,
            reason: result.reason,
            oldestAvailableSeq: result.oldestAvailableSeq,
          };

    return {
      v: WIRE_PROTOCOL_VERSION,
      type: 'resync_response',
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  // ── Private: queue + dispatch ─────────────────────────────────────

  /**
   * Per-action dispatch. Snake/linear `submit_pick` flows through
   * `processSubmitPick`; auction `nominate` / `place_bid` flow
   * through `processNominate` / `processPlaceBid` (chunk 11g.6 6a).
   */
  private async processAction(action: DraftAction): Promise<DraftActionResult> {
    switch (action.kind) {
      case 'submit_pick':
        return this.processSubmitPick(action);
      case 'nominate':
        return this.processNominate(action);
      case 'place_bid':
        return this.processPlaceBid(action);
    }
  }

  /**
   * Snake/linear pick handler. Step 6a sequence:
   *
   *   1. **Format gate** — auction returns `wrong_format_for_action`
   *      (chunk 11g.6 introduces auction-specific handlers).
   *   2. **Authorization (ADR-004 §5.3)** — engine MUST verify
   *      `userId` is authorized to act on behalf of `teamId` BEFORE
   *      calling the RPC. Auth failure logs the granular reason at
   *      info level for observability but returns coarse-grained
   *      `'unauthorized'` to the client (no information disclosure
   *      on the wire).
   *   3. **On-clock check** — engine-side fail-fast: if the action's
   *      `teamId` doesn't match the slot at `draftOrder[picksMade]`,
   *      return `'not_on_clock'` without round-tripping to the RPC.
   *      Auth runs FIRST so a non-manager probing the WS doesn't get
   *      on-clock information leaked through differentiated error
   *      reasons.
   *   4. **Status check** — already-completed drafts reject with
   *      `'invalid_state'`; the RPC's `illegal_state` would also
   *      catch this but the engine fails fast.
   *   5. **Compute round + pickNumber** from `draftOrder[picksMade]`
   *      (replaces the step-2 hardcoded 1/1).
   *   6. **Call RPC** — `submit_pick_v2` does its own atomic
   *      validation; idempotency replays are still handled there.
   *   7. **Advance state** — on success + `was_duplicate=false`,
   *      increment `picksMade`, transition `draftStatus`, append to
   *      ring buffer, broadcast the event message.
   *
   * Auction format never reaches step 5 — the format gate at step 1
   * short-circuits before consulting `draftOrder` (which is empty
   * for auction lobbies).
   */
  private async processSubmitPick(
    action: Extract<DraftAction, { kind: 'submit_pick' }>,
  ): Promise<DraftActionResult> {
    // Step 1: format gate.
    if (this.format === 'auction') {
      return { ok: false, reason: 'wrong_format_for_action' };
    }

    const isAutopick = action.actorKind === 'autopick';

    // Step 2: ADR-004 §5.3 engine-side authorization. **Skipped for
    // engine-authored autopick actions** — per ADR-004 §5's
    // trusted-executor extension, the engine is the trusted author
    // of these actions and there is no human user whose
    // authorization to verify. The on-clock check at step 4 still
    // fires as a defensive guard against bugs constructing autopick
    // actions for the wrong team.
    if (!isAutopick) {
      let authResult: TeamAuthorizationResult;
      try {
        authResult = await this.verifyTeamAuthorization(action.userId, action.teamId);
      } catch (err) {
        logger.error(
          `[lobby] verifyTeamAuthorization threw lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId}`,
          err,
        );
        return { ok: false, reason: 'internal_error' };
      }
      if ('reason' in authResult) {
        // Narrow via property-existence (`'reason' in result`) rather
        // than via the `authorized` discriminator — narrowing on the
        // discriminator is unreliable under server/tsconfig.json's
        // `strict: false` setting; `in`-based narrowing works in either
        // mode (same pattern as uws-server.ts verifyDraftToken handling).
        //
        // Granular reason for ops; coarse-grained for the wire (no
        // information disclosure beyond "you can't do that").
        logger.info(
          `[lobby] unauthorized pick attempt lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId} reason=${authResult.reason}`,
        );
        return { ok: false, reason: 'unauthorized' };
      }
    }

    // Step 3: status check. Already-completed/cancelled drafts cannot
    // accept more picks — return `invalid_state` for an informative
    // client signal. Runs BEFORE on-clock so the response
    // distinguishes "draft is over" from "your team isn't on the
    // clock" (which would be the misleading reading of a completed-
    // draft slot lookup, since `draftOrder[picksMade]` is undefined
    // past the last pick). Step 6b adds `cancelled` as a terminal
    // state alongside `completed`.
    if (this.draftStatus === 'completed' || this.draftStatus === 'cancelled') {
      return { ok: false, reason: 'invalid_state' };
    }

    // Step 4: on-clock check.
    const expectedSlot = this.draftOrder[this.picksMade];
    if (!expectedSlot || expectedSlot.teamId !== action.teamId) {
      return { ok: false, reason: 'not_on_clock' };
    }

    // Step 5: compute round + pickNumber from the loaded draft order.
    const roundNumber = expectedSlot.round;
    const pickNumber = expectedSlot.pickNumber;

    const actor: DraftV2Actor = {
      kind: isAutopick ? 'autopick' : 'user',
      id: action.userId,
      session_id: action.sessionId,
    };

    // Step 6: call the RPC. submit_pick_v2 runs its own atomic
    // validation (idempotency, on-clock, player-taken, etc.) so the
    // engine's fail-fast checks above are an optimization, not a
    // replacement for RPC-side guards.
    let result: SubmitPickResult;
    try {
      result = await this.draftService.submitPick({
        leagueId: this.leagueId,
        teamId: action.teamId,
        // Wire-format playerId is string (matches DraftAction). The
        // submit_pick_v2 RPC expects int (NHL player ID from staging
        // files). Coerce at the boundary.
        playerId: parseInt(action.playerId, 10),
        round: roundNumber,
        pickNumber,
        sessionId: action.sessionId,
        idempotencyKey: action.idempotencyKey,
        actor,
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return { ok: false, reason: this.mapAppErrorToReason(err) };
      }
      logger.error(
        `[lobby] processSubmitPick: unexpected throw lobbyId=${this.lobbyId}`,
        err,
      );
      return { ok: false, reason: 'internal_error' };
    }

    // Step 7: advance state on the non-duplicate success path.
    // Skip on `was_duplicate=true` — the original event is already
    // in the buffer + durable log; the state machine already
    // advanced when the original first landed.
    if (!result.was_duplicate) {
      this.picksMade++;
      // Status transition: not_started → in_progress on first pick;
      // in_progress → completed on the final pick.
      if (this.draftStatus === 'not_started') {
        this.draftStatus = 'in_progress';
      }
      if (this.picksMade >= this.draftOrder.length) {
        this.draftStatus = 'completed';
      }

      const timestamp = new Date().toISOString();
      const event: BufferedDraftEvent = {
        kind: 'pick_submitted',
        seq: result.seq,
        timestamp,
        teamId: action.teamId,
        playerId: parseInt(action.playerId, 10),
        roundNumber,
        pickNumber,
        // Mirror the action's idempotencyKey under the client-facing
        // `correlationId` name. Lets the submitter's optimistic UI
        // settle when the broadcast comes back.
        correlationId: action.idempotencyKey,
        ...(isAutopick ? { isAutopick: true } : {}),
      };
      this.events.append(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: action.idempotencyKey,
        payload: event,
      });

      // Step 6c: set / cancel the deadline timer based on new state.
      if (this.draftStatus === 'in_progress') {
        // Prefer the RPC's authoritative `pick_deadline` (it carries
        // the +1s pad already); fall back to engine-side computation
        // if the RPC didn't return one (defensive — shouldn't happen
        // for snake/linear picks).
        const nextDeadline = result.pick_deadline
          ? new Date(result.pick_deadline)
          : new Date(Date.now() + this.pickClockMs);
        this.setPickDeadline(nextDeadline);
      } else {
        // Draft completed. Clear timer + deadline; no team is on
        // the clock anymore, so getCurrentState should reflect
        // that with currentPickDeadline=null.
        this.cancelPickTimer();
        this.currentPickDeadline = null;
      }
    }

    return { ok: true, eventSeq: result.seq };
  }

  /**
   * Auction `nominate` handler (chunk 11g.6 sub-step 6a per
   * ADR-002 §3.2 + §3.3).
   *
   * Sequence:
   *   1. Format gate — snake/linear → `wrong_format_for_action`.
   *   2. ADR-004 §5.3 engine-side authorization (skipped for engine-
   *      authored autopick / auto-nominate; auto-nominate proper
   *      lands in 6c).
   *   3. Status check — completed/cancelled → `invalid_state`.
   *   4. **Active nomination check** — engine-side fail-fast: if
   *      `currentNomination !== null`, return
   *      `nomination_already_active`. Mirrors the RPC's
   *      `auction_nominations` constraint at migration line 119
   *      (UNIQUE (`league_id`) WHERE `status = 'active'`); engine
   *      check eliminates the round-trip on the contended path.
   *   5. **Nominator-on-clock check** —
   *      `nominationOrder[nominationsCompleted % nominationOrder.length]`
   *      must equal `action.teamId`, else `not_on_clock`. Auth
   *      runs FIRST so a non-manager probing the WS doesn't see
   *      on-clock leak through differentiated error reasons.
   *   6. **Bid validation** — opening bid must be ≥ `auctionMinBid`
   *      (`bid_too_low`) AND must satisfy the budget reserve check
   *      (`insufficient_budget`). Reserve = `(slotsRemaining - 1) ×
   *      auctionMinBid` mirrors v1 `AuctionService.placeBid`.
   *   7. **Call `nominate_player_v2` RPC** — atomic 5-write block
   *      (INSERT auction_nominations + INSERT auction_bids +
   *      INSERT draft_events; the engine consumes the resulting
   *      nomination_id from the RPC response).
   *   8. **Advance state** on `was_duplicate=false`: set
   *      `currentNomination`, append to ring buffer, broadcast
   *      `auction_nomination_started`, schedule the bid-window
   *      timer.
   */
  private async processNominate(
    action: Extract<DraftAction, { kind: 'nominate' }>,
  ): Promise<DraftActionResult> {
    // Step 1: format gate.
    if (this.format !== 'auction') {
      return { ok: false, reason: 'wrong_format_for_action' };
    }

    const isAutopick = action.actorKind === 'autopick';

    // Step 2: ADR-004 §5.3 engine-side authorization (skip for
    // engine-authored actions). Auto-nominate proper lands in 6c
    // alongside the nomination-window timer; today the only
    // engine-authored auction action is the `closeNomination` call
    // from `handleNominationTimeout`, which goes through the RPC
    // directly rather than through `enqueueAction`.
    if (!isAutopick) {
      let authResult: TeamAuthorizationResult;
      try {
        authResult = await this.verifyTeamAuthorization(action.userId, action.teamId);
      } catch (err) {
        logger.error(
          `[lobby] processNominate verifyTeamAuthorization threw lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId}`,
          err,
        );
        return { ok: false, reason: 'internal_error' };
      }
      if ('reason' in authResult) {
        logger.info(
          `[lobby] unauthorized nominate attempt lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId} reason=${authResult.reason}`,
        );
        return { ok: false, reason: 'unauthorized' };
      }
    }

    // Step 3: status check.
    if (this.draftStatus === 'completed' || this.draftStatus === 'cancelled') {
      return { ok: false, reason: 'invalid_state' };
    }

    // Step 4: active nomination check.
    if (this.currentNomination !== null) {
      return { ok: false, reason: 'nomination_already_active' };
    }

    // Step 5: nominator-on-clock check.
    if (this.nominationOrder.length === 0) {
      return { ok: false, reason: 'invalid_state' };
    }
    const expectedNominator =
      this.nominationOrder[this.nominationsCompleted % this.nominationOrder.length];
    if (action.teamId !== expectedNominator) {
      return { ok: false, reason: 'not_on_clock' };
    }

    // Step 6: bid validation.
    if (action.openingBid < this.auctionMinBid) {
      return { ok: false, reason: 'bid_too_low' };
    }
    const budget = this.teamBudgets.get(action.teamId) ?? 0;
    const playersWon = this.teamPlayersWon.get(action.teamId) ?? 0;
    const slotsRemaining = this.draftRounds - playersWon;
    if (slotsRemaining <= 0) {
      // Roster full. Should be unreachable when the on-clock check
      // passes (a team with no slots can't be in rotation), but
      // guard anyway.
      return { ok: false, reason: 'invalid_state' };
    }
    // Reserve $auctionMinBid for each remaining slot AFTER this one
    // (matches v1 AuctionService.placeBid semantics; ADR-002 §3.3).
    const reserve = (slotsRemaining - 1) * this.auctionMinBid;
    const maxAffordable = budget - reserve;
    if (action.openingBid > maxAffordable) {
      return { ok: false, reason: 'insufficient_budget' };
    }

    const actor: DraftV2Actor = {
      kind: isAutopick ? 'autopick' : 'user',
      id: action.userId,
      session_id: action.sessionId,
    };

    // Step 7: call the RPC. Atomic 5-write block per the migration
    // at supabase/migrations/20260506000000_auction_engine_foundation.sql.
    let result: Awaited<ReturnType<DraftServiceV2['nominatePlayer']>>;
    try {
      result = await this.draftService.nominatePlayer({
        leagueId: this.leagueId,
        teamId: action.teamId,
        playerId: action.playerId,
        playerName: action.playerName,
        openingBid: action.openingBid,
        sessionId: action.sessionId,
        idempotencyKey: action.idempotencyKey,
        actor,
        clockSeconds: Math.floor(this.bidWindowMs / 1000),
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return { ok: false, reason: this.mapAppErrorToReason(err) };
      }
      logger.error(
        `[lobby] processNominate: unexpected throw lobbyId=${this.lobbyId}`,
        err,
      );
      return { ok: false, reason: 'internal_error' };
    }

    // Step 8: advance state on the non-duplicate success path.
    if (!result.was_duplicate) {
      const expiresAt = new Date(result.clock_deadline);
      this.currentNomination = {
        nominationId: result.nomination_id,
        playerId: action.playerId,
        playerName: action.playerName,
        nominatorTeamId: action.teamId,
        leadingBidderId: action.teamId,
        leadingBid: action.openingBid,
        expiresAt,
        timerHandle: null,
      };
      if (this.draftStatus === 'not_started') {
        this.draftStatus = 'in_progress';
      }

      const timestamp = new Date().toISOString();
      const event: BufferedDraftEvent = {
        kind: 'auction_nomination_started',
        seq: result.seq,
        timestamp,
        nominationId: result.nomination_id,
        playerId: action.playerId,
        playerName: action.playerName,
        nominatorTeamId: action.teamId,
        openingBid: action.openingBid,
        clockDeadline: expiresAt.toISOString(),
        correlationId: action.idempotencyKey,
      };
      this.events.append(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: action.idempotencyKey,
        payload: event,
      });

      this.setPickDeadline(expiresAt);
    }

    return { ok: true, eventSeq: result.seq };
  }

  /**
   * Auction `place_bid` handler (chunk 11g.6 sub-step 6a per
   * ADR-002 §3.3).
   *
   * Sequence:
   *   1. Format gate.
   *   2. ADR-004 §5.3 engine-side authorization.
   *   3. **Active nomination check** — `currentNomination` must be
   *      non-null AND its `nominationId` must match
   *      `action.nominationId`; else `no_active_nomination`.
   *      Mismatched nomination IDs happen on a stale client whose
   *      bid arrives after the nomination it targeted has closed.
   *   4. **Bid validation** — strictly greater than current
   *      leading bid (`bid_too_low`); meets minimum increment
   *      (`bid_increment_violation`; flat $1 in 6a, tiered in 6c);
   *      satisfies budget reserve (`insufficient_budget`).
   *   5. **Call `place_bid_v2` RPC** — atomic 4-write block.
   *   6. **Advance state** on `was_duplicate=false`: mutate
   *      `currentNomination.leadingBid` + `leadingBidderId`,
   *      append to ring buffer, broadcast `auction_bid_placed`.
   *      Anti-snipe extension semantics (ADR-002 §3.3) are
   *      deferred to 6b.
   */
  private async processPlaceBid(
    action: Extract<DraftAction, { kind: 'place_bid' }>,
  ): Promise<DraftActionResult> {
    // Step 1: format gate.
    if (this.format !== 'auction') {
      return { ok: false, reason: 'wrong_format_for_action' };
    }

    const isAutopick = action.actorKind === 'autopick';

    // Step 2: auth.
    if (!isAutopick) {
      let authResult: TeamAuthorizationResult;
      try {
        authResult = await this.verifyTeamAuthorization(action.userId, action.teamId);
      } catch (err) {
        logger.error(
          `[lobby] processPlaceBid verifyTeamAuthorization threw lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId}`,
          err,
        );
        return { ok: false, reason: 'internal_error' };
      }
      if ('reason' in authResult) {
        logger.info(
          `[lobby] unauthorized place_bid attempt lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId} reason=${authResult.reason}`,
        );
        return { ok: false, reason: 'unauthorized' };
      }
    }

    // Step 3: active-nomination check.
    if (this.draftStatus === 'completed' || this.draftStatus === 'cancelled') {
      return { ok: false, reason: 'invalid_state' };
    }
    if (
      this.currentNomination === null ||
      this.currentNomination.nominationId !== action.nominationId
    ) {
      return { ok: false, reason: 'no_active_nomination' };
    }

    // Step 4: bid validation.
    if (action.bidAmount <= this.currentNomination.leadingBid) {
      return { ok: false, reason: 'bid_too_low' };
    }
    // Min increment in 6a is flat `auctionMinBid` ($1 default).
    // ADR-002 §4.3 tiered increments land in 6c.
    if (action.bidAmount - this.currentNomination.leadingBid < this.auctionMinBid) {
      return { ok: false, reason: 'bid_increment_violation' };
    }
    const budget = this.teamBudgets.get(action.teamId) ?? 0;
    const playersWon = this.teamPlayersWon.get(action.teamId) ?? 0;
    const slotsRemaining = this.draftRounds - playersWon;
    if (slotsRemaining <= 0) {
      return { ok: false, reason: 'invalid_state' };
    }
    const reserve = (slotsRemaining - 1) * this.auctionMinBid;
    const maxAffordable = budget - reserve;
    if (action.bidAmount > maxAffordable) {
      return { ok: false, reason: 'insufficient_budget' };
    }

    const actor: DraftV2Actor = {
      kind: isAutopick ? 'autopick' : 'user',
      id: action.userId,
      session_id: action.sessionId,
    };

    // Step 5: call the RPC. Anti-snipe configuration is threaded
    // through per ADR-002 §3.3 / §4.4 — the RPC applies the
    // threshold check atomically with the bid write.
    let result: Awaited<ReturnType<DraftServiceV2['placeBid']>>;
    try {
      result = await this.draftService.placeBid({
        leagueId: this.leagueId,
        teamId: action.teamId,
        nominationId: action.nominationId,
        bidAmount: action.bidAmount,
        sessionId: action.sessionId,
        idempotencyKey: action.idempotencyKey,
        actor,
        antiSnipeThresholdSeconds: this.antiSnipeThresholdSeconds,
        antiSnipeExtensionSeconds: this.antiSnipeExtensionSeconds,
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return { ok: false, reason: this.mapAppErrorToReason(err) };
      }
      logger.error(
        `[lobby] processPlaceBid: unexpected throw lobbyId=${this.lobbyId}`,
        err,
      );
      return { ok: false, reason: 'internal_error' };
    }

    // Step 6: advance state. The bid event's `clockDeadline`
    // carries the POST-extension deadline (or unchanged original
    // when no extension fired) — RPC has already evaluated the
    // anti-snipe threshold and updated `auction_nominations.expires_at`
    // atomically. Engine mirrors the DB state here.
    if (!result.was_duplicate) {
      const priorExpiresAt = this.currentNomination.expiresAt;
      const newExpiresAt = new Date(result.clock_deadline);

      this.currentNomination.leadingBid = action.bidAmount;
      this.currentNomination.leadingBidderId = action.teamId;
      this.currentNomination.expiresAt = newExpiresAt;

      const timestamp = new Date().toISOString();
      const bidEvent: BufferedDraftEvent = {
        kind: 'auction_bid_placed',
        seq: result.seq,
        timestamp,
        nominationId: action.nominationId,
        bidderTeamId: action.teamId,
        bidAmount: action.bidAmount,
        clockDeadline: newExpiresAt.toISOString(),
        correlationId: action.idempotencyKey,
      };
      this.events.append(bidEvent);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: action.idempotencyKey,
        payload: bidEvent,
      });

      // Anti-snipe extension (ADR-002 §3.3 / §4.4 — chunk 11g.6
      // sub-step 6b). When `was_extended === true`, the RPC has
      // already extended `auction_nominations.expires_at` atomically
      // with the bid write. Engine: cancel current timer, reschedule
      // from new deadline, append `auction_bid_extends_timer` event
      // to ring buffer, broadcast it as a separate event so resync
      // semantics work (the ring buffer entry's seq matches the
      // durable `draft_events.seq` from the same transaction).
      if (result.was_extended && result.extends_event_seq !== undefined) {
        this.setPickDeadline(newExpiresAt);

        const extendsEvent: BufferedDraftEvent = {
          kind: 'auction_bid_extends_timer',
          seq: result.extends_event_seq,
          timestamp,
          nominationId: action.nominationId,
          priorClockDeadline: priorExpiresAt.toISOString(),
          newClockDeadline: newExpiresAt.toISOString(),
          // `event_id` is `bigint` in Postgres; PostgREST returns
          // it as `number` in JSON. Engine surfaces the durable id
          // so clients can correlate extension to bid without
          // payload-field equality checks.
          triggeringBidId: result.event_id,
          triggeringBidderTeamId: action.teamId,
          triggeringBidAmount: action.bidAmount,
          correlationId: action.idempotencyKey,
        };
        this.events.append(extendsEvent);
        this.broadcast({
          v: WIRE_PROTOCOL_VERSION,
          type: 'event',
          seq: result.extends_event_seq,
          timestamp,
          correlationId: action.idempotencyKey,
          payload: extendsEvent,
        });
      }
    }

    return { ok: true, eventSeq: result.seq };
  }

  /**
   * Serialize and publish a server message to the lobby's topic,
   * then sweep connections for backpressure overflow. Centralized so
   * every broadcast path goes through the same backpressure check —
   * a slow consumer cannot block the rest of the lobby.
   */
  private broadcast(message: DraftServerMessage): void {
    const serialized = serializeServerMessage(message);
    this.publish(this.topicName, serialized);
    this.sweepBackpressure();
  }

  /**
   * Iterate connections and forcibly disconnect any whose buffered
   * amount exceeds `BACKPRESSURE_THRESHOLD_BYTES`. Called after every
   * broadcast.
   *
   * Cost: O(connections) per broadcast. Trivial for 12-team drafts
   * (~12 connections); revisit at chunk 11g.11 load test if 1000+
   * concurrent connections per lobby become real (then: lazy check
   * only on WS that received recent broadcasts, or async sweep
   * timer). Tracked in PHASE_4_5_PROJECT_PLAN.md Decision Log
   * (2026-05-05).
   */
  private sweepBackpressure(): void {
    for (const [ws, userData] of this.connections) {
      let buffered: number;
      try {
        buffered = ws.getBufferedAmount();
      } catch (err) {
        // ws may have closed mid-iteration. Skip — close handler
        // will purge it from the map shortly.
        logger.debug(
          `[lobby] getBufferedAmount threw during sweep lobbyId=${this.lobbyId} userId=${userData.userId}`,
          err,
        );
        continue;
      }
      if (buffered > BACKPRESSURE_THRESHOLD_BYTES) {
        logger.warn(
          `[lobby] backpressure threshold exceeded — disconnecting slow consumer lobbyId=${this.lobbyId} userId=${userData.userId} bufferedAmount=${buffered} threshold=${BACKPRESSURE_THRESHOLD_BYTES}`,
        );
        try {
          // Code 1013 = "Try Again Later" — signals transient server
          // congestion to the client retry path (vs 1011 server_error
          // for failures, or 1000 normal close for intentional logout).
          ws.end(1013, 'backpressure');
        } catch (err) {
          logger.debug(
            `[lobby] ws.end after backpressure threw lobbyId=${this.lobbyId} userId=${userData.userId}`,
            err,
          );
        }
      }
    }
  }

  /**
   * True iff at least one connection (other than the one that just
   * left) is still registered for the given userId. Used to decide
   * whether removeConnection should emit a presence-leave event.
   */
  private hasOtherConnectionForUser(userId: string): boolean {
    for (const data of this.connections.values()) {
      if (data.userId === userId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Map `AppError.message` (set by `DraftServiceV2.mapRpcError` from
   * the `submit_pick_v2` RAISE EXCEPTION prefix) to a DraftActionResult
   * reason. Order matters — more specific prefixes first, mirroring
   * the order in `DraftServiceV2.mapRpcError`.
   */
  private mapAppErrorToReason(err: AppError): Extract<DraftActionResult, { ok: false }>['reason'] {
    const msg = err.message;
    if (msg.startsWith('idempotency_conflict')) return 'idempotency_conflict';
    if (msg.startsWith('pick_out_of_order')) return 'pick_out_of_order';
    if (msg.startsWith('not_on_clock')) return 'not_on_clock';
    if (msg.startsWith('player_taken')) return 'player_taken';
    if (msg.startsWith('unauthorized')) return 'unauthorized';
    if (msg.startsWith('illegal_state')) return 'invalid_state';
    if (msg.startsWith('invalid_event_payload')) return 'invalid_payload';
    return 'internal_error';
  }

  /**
   * Queue-error handler: a thrown rejection inside `processAction`
   * (typically a non-AppError, since AppErrors are caught and mapped
   * inside `processSubmitPick`) becomes a resolved
   * `{ ok: false, reason: 'internal_error' }` so the queue chain
   * keeps running. The next enqueueAction call still gets to execute.
   */
  private handleQueueError(err: unknown, action: DraftAction): DraftActionResult {
    logger.error(
      `[lobby] queue error lobbyId=${this.lobbyId} actionKind=${action.kind}`,
      err,
    );
    return { ok: false, reason: 'internal_error' };
  }

  /**
   * Insert into the idempotency cache with FIFO eviction at
   * IDEMPOTENCY_CACHE_MAX. Map preserves insertion order, so
   * `keys().next().value` is the oldest entry.
   */
  private cacheIdempotencyResult(
    key: string,
    result: Promise<DraftActionResult>,
  ): void {
    if (this.seenIdempotencyKeys.size >= IDEMPOTENCY_CACHE_MAX) {
      const oldestKey = this.seenIdempotencyKeys.keys().next().value;
      if (oldestKey !== undefined) {
        this.seenIdempotencyKeys.delete(oldestKey);
      }
    }
    this.seenIdempotencyKeys.set(key, result);
  }

  // ── Step 6b: bootstrap from event log ──────────────────────────────

  /**
   * Read the durable event log for this lobby's `leagueId` and
   * replay each row into the in-memory state machine. Validates
   * seq contiguity, payload-vs-draftOrder consistency for pick
   * events, and emits typed errors on any inconsistency.
   *
   * Performance: typical 12-team × 21-round draft (252 events) is a
   * single index scan on `(league_id, seq)` plus an in-memory walk;
   * end-to-end latency is dominated by the round-trip to Postgres
   * (~10-50ms in production, <1ms in unit tests with mocked service).
   */
  private async bootstrap(): Promise<void> {
    const startTime = Date.now();

    let events: DraftEventRow[];
    try {
      events = await this.draftService.listDraftEvents(this.leagueId);
    } catch (err) {
      logger.error(
        `[lobby] bootstrap listDraftEvents failed lobbyId=${this.lobbyId} leagueId=${this.leagueId}`,
        err,
      );
      throw err;
    }

    let prevSeq: number | null = null;
    let pickEventCount = 0;
    let undoneEventCount = 0;
    let overrideEventCount = 0;
    let skippedCount = 0;

    for (const event of events) {
      // Seq contiguity: every event's seq is exactly prevSeq + 1.
      // Gaps mean either silent log corruption or a missing event
      // that the snapshot path should fix (chunk 11g.7); fail loudly.
      if (prevSeq !== null && event.seq !== prevSeq + 1) {
        throw new Error(
          `[lobby] bootstrap seq gap detected lobbyId=${this.lobbyId} ` +
            `prevSeq=${prevSeq} got=${event.seq}`,
        );
      }
      prevSeq = event.seq;

      switch (event.event_type) {
        case 'pick':
          // **Wire-format note:** durable `event_type === 'pick'` per
          // the migration's CHECK enum
          // (`20260425130000_draft_engine_v2_foundation.sql:36-48`).
          // Application-layer `BufferedDraftEvent.kind ===
          // 'pick_submitted'` is the client-facing rename per the
          // action-vs-event naming convention from chunk 11g.4 step 3
          // / ADR-002 §4.1. Translation happens inside
          // `applyPickEvent` below.
          this.applyPickEvent(event);
          pickEventCount++;
          break;
        case 'pick_undone':
          this.applyPickUndoneEvent(event);
          undoneEventCount++;
          break;
        case 'commissioner_override':
          this.applyCommissionerOverrideEvent(event);
          overrideEventCount++;
          break;
        case 'draft_completed':
          // Belt-and-suspenders alongside the natural picksMade ===
          // draftOrder.length derivation in applyPickEvent. A draft
          // can be marked complete by the commissioner before all
          // slots are filled (early termination); in that case the
          // explicit event is the source of truth.
          this.draftStatus = 'completed';
          skippedCount++;
          break;
        case 'draft_cancelled':
          this.draftStatus = 'cancelled';
          skippedCount++;
          break;
        case 'draft_paused':
          // Step 6c: capture pause state for the in-memory timer.
          // No picksMade impact. The `pauseState.remainingMs` is
          // captured for diagnostic / audit only — the engine does
          // NOT use it to reconstruct the resume deadline because
          // the `draft_resume` RPC gives a fresh full pick clock
          // (per migration line 1136-1141). Single source of truth:
          // engine state mirrors RPC behavior.
          this.pauseState = {
            pausedAt: new Date(
              ((event.payload as Record<string, unknown>).paused_at as string) ?? event.created_at,
            ),
            remainingMs:
              ((((event.payload as Record<string, unknown>).remaining_seconds as number) ?? 0) * 1000),
          };
          skippedCount++;
          break;
        case 'draft_resumed':
          // Step 6c: clear pause state. Bootstrap doesn't need to
          // schedule the timer here — `init()`'s post-replay step
          // reads `leagues.pick_deadline` (which the resume RPC
          // updated) and schedules from there. This keeps bootstrap
          // single-pass and idempotent.
          this.pauseState = null;
          skippedCount++;
          break;
        case 'draft_extended':
          // Deadline-extension event (commissioner adds time to the
          // current pick's clock). No picksMade impact; timer
          // reconstruction at `init()` end picks up the updated
          // `leagues.pick_deadline`.
          logger.debug(
            `[lobby] bootstrap skipping draft_extended event ` +
              `seq=${event.seq} lobbyId=${this.lobbyId}`,
          );
          skippedCount++;
          break;
        case 'autopick_failed':
        case 'generation_bumped':
          // Diagnostic / internal versioning. No state-machine impact.
          logger.debug(
            `[lobby] bootstrap skipping diagnostic event_type=${event.event_type} ` +
              `seq=${event.seq} lobbyId=${this.lobbyId}`,
          );
          skippedCount++;
          break;
        // ── Auction events (chunk 11g.6 sub-step 6a) ──────────────────
        case 'auction_nomination_started':
          this.applyAuctionNominationStartedEvent(event);
          break;
        case 'auction_bid_placed':
          this.applyAuctionBidPlacedEvent(event);
          break;
        case 'auction_bid_extends_timer':
          this.applyAuctionBidExtendsTimerEvent(event);
          break;
        case 'auction_nomination_closed':
          this.applyAuctionNominationClosedEvent(event);
          break;
        case 'auction_nomination_expired':
          this.applyAuctionNominationExpiredEvent(event);
          break;
        case 'auction_paused':
        case 'auction_resumed':
          // Auction pause/resume mirror the snake/linear flow. Engine-
          // side pause state lives in `pauseState`; the chunks that
          // drive these (commissioner override + cross-process
          // notification) land in 6c. Replay them as state-only events
          // for now — no in-memory mutation beyond the existing
          // `pauseState` field.
          logger.debug(
            `[lobby] bootstrap auction pause/resume placeholder event_type=${event.event_type} ` +
              `seq=${event.seq} lobbyId=${this.lobbyId} (chunk 11g.6 6c handles fully)`,
          );
          skippedCount++;
          break;
        default:
          // Forward-compat for any future additions. Today the
          // migration's CHECK enum admits the 9 event types listed
          // in the cases above; encountering an unknown type means
          // a newer chunk added one that this engine doesn't handle.
          logger.warn(
            `[lobby] bootstrap unknown event_type=${event.event_type} ` +
              `seq=${event.seq} lobbyId=${this.lobbyId} ` +
              `(forward-compat skip)`,
          );
          skippedCount++;
          break;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      `[lobby] bootstrap replay complete lobbyId=${this.lobbyId} ` +
        `totalEvents=${events.length} pickEvents=${pickEventCount} ` +
        `undoneEvents=${undoneEventCount} overrideEvents=${overrideEventCount} ` +
        `skipped=${skippedCount} picksMade=${this.picksMade} ` +
        `status=${this.draftStatus} duration=${duration}ms`,
    );
  }

  /**
   * Bootstrap handler for `event_type === 'pick'`. Validates the
   * payload against the expected slot at `draftOrder[picksMade]`,
   * appends a translated `pick_submitted` entry to the ring buffer,
   * advances `picksMade` and `draftStatus`.
   */
  private applyPickEvent(event: DraftEventRow): void {
    if (this.picksMade >= this.draftOrder.length) {
      throw new Error(
        `[lobby] bootstrap pick event past draft order ` +
          `lobbyId=${this.lobbyId} seq=${event.seq} ` +
          `picksMade=${this.picksMade} totalPicks=${this.draftOrder.length}`,
      );
    }
    const slot = this.draftOrder[this.picksMade];
    const payload = event.payload as Record<string, unknown>;
    const teamId = payload.team_id;
    const pickNumber = payload.pick_number;
    const round = payload.round;
    const playerId = payload.player_id;

    if (teamId !== slot.teamId) {
      throw new Error(
        `[lobby] bootstrap pick team mismatch lobbyId=${this.lobbyId} ` +
          `seq=${event.seq} slot=${this.picksMade} expected=${slot.teamId} ` +
          `got=${String(teamId)}`,
      );
    }
    if (pickNumber !== slot.pickNumber) {
      throw new Error(
        `[lobby] bootstrap pick number mismatch lobbyId=${this.lobbyId} ` +
          `seq=${event.seq} expected=${slot.pickNumber} got=${String(pickNumber)}`,
      );
    }
    if (round !== slot.round) {
      throw new Error(
        `[lobby] bootstrap pick round mismatch lobbyId=${this.lobbyId} ` +
          `seq=${event.seq} expected=${slot.round} got=${String(round)}`,
      );
    }

    // Translate from durable wire form ('pick') to application-layer
    // form ('pick_submitted') per the action-vs-event naming
    // convention (chunk 11g.4 step 3 / ADR-002 §4.1).
    //
    // `is_autopick` from the durable payload surfaces as the
    // step-6c `isAutopick` flag on the buffered event, so resync'd
    // clients see the autopick badge for picks made while they
    // were disconnected.
    const isAutopick =
      ((event.payload as Record<string, unknown>).is_autopick as boolean) === true;
    const buffered: BufferedDraftEvent = {
      kind: 'pick_submitted',
      seq: event.seq,
      timestamp: event.created_at,
      teamId: slot.teamId,
      playerId: typeof playerId === 'number' ? playerId : 0,
      roundNumber: slot.round,
      pickNumber: slot.pickNumber,
      correlationId: event.idempotency_key ?? '',
      ...(isAutopick ? { isAutopick: true } : {}),
    };
    this.events.append(buffered);

    this.picksMade++;
    if (this.draftStatus === 'not_started') {
      this.draftStatus = 'in_progress';
    }
    if (this.picksMade >= this.draftOrder.length) {
      this.draftStatus = 'completed';
    }
  }

  /**
   * Bootstrap handler for `event_type === 'pick_undone'`. Validates
   * the payload against the slot at `draftOrder[picksMade - 1]`
   * (the most-recent completed pick), appends a `pick_undone`
   * entry to the ring buffer, decrements `picksMade`, and may
   * transition `draftStatus` backwards (`completed → in_progress`,
   * or `in_progress → not_started` if the undo was the only pick).
   */
  private applyPickUndoneEvent(event: DraftEventRow): void {
    if (this.picksMade === 0) {
      throw new Error(
        `[lobby] bootstrap pick_undone with no prior picks ` +
          `lobbyId=${this.lobbyId} seq=${event.seq}`,
      );
    }
    const slotIndex = this.picksMade - 1;
    const slot = this.draftOrder[slotIndex];
    const payload = event.payload as Record<string, unknown>;
    const teamId = payload.team_id;
    const pickNumber = payload.pick_number;
    const round = payload.round;
    const playerId = payload.player_id;
    const undoneSeq = payload.undone_seq;

    if (
      teamId !== slot.teamId ||
      pickNumber !== slot.pickNumber ||
      round !== slot.round
    ) {
      throw new Error(
        `[lobby] bootstrap pick_undone payload mismatch ` +
          `lobbyId=${this.lobbyId} seq=${event.seq} slot=${slotIndex} ` +
          `expected={team:${slot.teamId},pick:${slot.pickNumber},round:${slot.round}} ` +
          `got={team:${String(teamId)},pick:${String(pickNumber)},round:${String(round)}}`,
      );
    }

    const buffered: BufferedDraftEvent = {
      kind: 'pick_undone',
      seq: event.seq,
      timestamp: event.created_at,
      teamId: slot.teamId,
      playerId: typeof playerId === 'number' ? playerId : 0,
      roundNumber: slot.round,
      pickNumber: slot.pickNumber,
      correlationId: event.idempotency_key ?? '',
      undoneSeq: typeof undoneSeq === 'number' ? undoneSeq : 0,
    };
    this.events.append(buffered);

    this.picksMade--;
    if (this.draftStatus === 'completed') {
      this.draftStatus = 'in_progress';
    }
    if (this.picksMade === 0) {
      this.draftStatus = 'not_started';
    }
  }

  /**
   * Bootstrap handler for `event_type === 'commissioner_override'`.
   * Advances `picksMade` and `draftStatus` like a regular pick BUT
   * without validating against `draftOrder[picksMade]` — the
   * commissioner has authoritatively decided the pick. The
   * commissioner's payload values (team_id, pick_number, round,
   * player_id) are taken at face value and stored on the buffered
   * event for client rendering.
   */
  private applyCommissionerOverrideEvent(event: DraftEventRow): void {
    if (this.picksMade >= this.draftOrder.length) {
      throw new Error(
        `[lobby] bootstrap commissioner_override past draft order ` +
          `lobbyId=${this.lobbyId} seq=${event.seq} ` +
          `picksMade=${this.picksMade} totalPicks=${this.draftOrder.length}`,
      );
    }
    const payload = event.payload as Record<string, unknown>;
    const teamId = payload.team_id;
    const pickNumber = payload.pick_number;
    const round = payload.round;
    const playerId = payload.player_id;
    const reason = payload.reason;

    const buffered: BufferedDraftEvent = {
      kind: 'commissioner_override',
      seq: event.seq,
      timestamp: event.created_at,
      teamId: typeof teamId === 'string' ? teamId : '',
      playerId: typeof playerId === 'number' ? playerId : 0,
      roundNumber: typeof round === 'number' ? round : 0,
      pickNumber: typeof pickNumber === 'number' ? pickNumber : 0,
      correlationId: event.idempotency_key ?? '',
      ...(typeof reason === 'string' ? { reason } : {}),
    };
    this.events.append(buffered);

    this.picksMade++;
    if (this.draftStatus === 'not_started') {
      this.draftStatus = 'in_progress';
    }
    if (this.picksMade >= this.draftOrder.length) {
      this.draftStatus = 'completed';
    }
  }

  // ── Auction event-replay handlers (chunk 11g.6 sub-step 6a) ────────

  /**
   * Bootstrap handler for `event_type === 'auction_nomination_started'`.
   * Sets `currentNomination` from the payload, appends a translated
   * application-layer event to the ring buffer. Does NOT schedule a
   * timer (init() handles that post-replay so paused / completed
   * states correctly suppress).
   */
  private applyAuctionNominationStartedEvent(event: DraftEventRow): void {
    const payload = event.payload as Record<string, unknown>;
    const nominationId = String(payload.nomination_id);
    const playerId = String(payload.player_id);
    const playerName = String(payload.player_name ?? '');
    const nominatorTeamId = String(payload.nominator_team_id);
    const openingBid = Number(payload.opening_bid);
    const expiresAt = new Date(String(payload.expires_at));

    this.currentNomination = {
      nominationId,
      playerId,
      playerName,
      nominatorTeamId,
      leadingBidderId: nominatorTeamId,
      leadingBid: openingBid,
      expiresAt,
      timerHandle: null,
    };
    if (this.draftStatus === 'not_started') {
      this.draftStatus = 'in_progress';
    }

    this.events.append({
      kind: 'auction_nomination_started',
      seq: event.seq,
      timestamp: event.created_at,
      nominationId,
      playerId,
      playerName,
      nominatorTeamId,
      openingBid,
      clockDeadline: expiresAt.toISOString(),
      correlationId: event.idempotency_key ?? '',
    });
  }

  /**
   * Bootstrap handler for `event_type === 'auction_bid_placed'`.
   * Mutates `currentNomination.leadingBid` + `leadingBidderId`.
   * Throws if no active nomination — events arriving in this state
   * indicate an event-log corruption.
   */
  private applyAuctionBidPlacedEvent(event: DraftEventRow): void {
    if (this.currentNomination === null) {
      throw new Error(
        `[lobby] bootstrap auction_bid_placed with no active nomination ` +
          `lobbyId=${this.lobbyId} seq=${event.seq}`,
      );
    }
    const payload = event.payload as Record<string, unknown>;
    const nominationId = String(payload.nomination_id);
    if (nominationId !== this.currentNomination.nominationId) {
      throw new Error(
        `[lobby] bootstrap auction_bid_placed nomination mismatch ` +
          `lobbyId=${this.lobbyId} seq=${event.seq} ` +
          `expected=${this.currentNomination.nominationId} got=${nominationId}`,
      );
    }
    const bidderTeamId = String(payload.team_id);
    const bidAmount = Number(payload.bid_amount);
    this.currentNomination.leadingBid = bidAmount;
    this.currentNomination.leadingBidderId = bidderTeamId;

    this.events.append({
      kind: 'auction_bid_placed',
      seq: event.seq,
      timestamp: event.created_at,
      nominationId,
      bidderTeamId,
      bidAmount,
      clockDeadline: this.currentNomination.expiresAt.toISOString(),
      correlationId: event.idempotency_key ?? '',
    });
  }

  /**
   * Bootstrap handler for `event_type === 'auction_bid_extends_timer'`
   * (chunk 11g.6 sub-step 6b per ADR-002 §3.3 / §4.4).
   *
   * **Apply during replay (NOT log-and-skip).** The 6b recon surfaced
   * a load-bearing principle: bootstrap event-replay is canonical for
   * in-memory state; `lookupLobbyConfig`'s row reads are
   * informational/diagnostic only. `applyAuctionNominationStartedEvent`
   * sets `currentNomination.expiresAt` from the START event's payload
   * (the original pre-extension deadline). If we log-and-skipped
   * extends_timer events, the in-memory deadline would be stale by
   * every extension count, and `init()`'s post-replay timer schedule
   * would fire too early. APPLYing during replay preserves
   * event-sourcing-as-canonical (Principle 3) and matches every other
   * 6a auction handler. See PHASE_4_5_PROJECT_PLAN.md Decision Log
   * (2026-05-07) for the canonical-replay-principle entry.
   *
   * Throws if no active nomination or nomination-id mismatch — the
   * event log integrity is broken in that case.
   */
  private applyAuctionBidExtendsTimerEvent(event: DraftEventRow): void {
    if (this.currentNomination === null) {
      throw new Error(
        `[lobby] bootstrap auction_bid_extends_timer with no active nomination ` +
          `lobbyId=${this.lobbyId} seq=${event.seq}`,
      );
    }
    const payload = event.payload as Record<string, unknown>;
    const nominationId = String(payload.nomination_id);
    if (nominationId !== this.currentNomination.nominationId) {
      throw new Error(
        `[lobby] bootstrap auction_bid_extends_timer nomination mismatch ` +
          `lobbyId=${this.lobbyId} seq=${event.seq} ` +
          `expected=${this.currentNomination.nominationId} got=${nominationId}`,
      );
    }
    const priorExpiresAt = new Date(String(payload.prior_expires_at));
    const newExpiresAt = new Date(String(payload.new_expires_at));
    const triggeringBidId = Number(payload.triggering_bid_id);
    const triggeringTeamId = String(payload.triggering_team_id);
    const triggeringBidAmount = Number(payload.triggering_bid_amount);

    // Mutate the in-memory deadline to the post-extension value.
    // This is what makes apply-during-replay correct — without it,
    // currentNomination.expiresAt would stay at the original START
    // event's deadline regardless of extensions.
    this.currentNomination.expiresAt = newExpiresAt;

    this.events.append({
      kind: 'auction_bid_extends_timer',
      seq: event.seq,
      timestamp: event.created_at,
      nominationId,
      priorClockDeadline: priorExpiresAt.toISOString(),
      newClockDeadline: newExpiresAt.toISOString(),
      triggeringBidId,
      triggeringBidderTeamId: triggeringTeamId,
      triggeringBidAmount,
      correlationId: event.idempotency_key ?? '',
    });
  }

  /**
   * Bootstrap handler for `event_type === 'auction_nomination_closed'`.
   * Deducts winner's budget, increments `players_won`, increments
   * `nominationsCompleted`, clears `currentNomination`, advances to
   * `completed` if the auction is full.
   */
  private applyAuctionNominationClosedEvent(event: DraftEventRow): void {
    const payload = event.payload as Record<string, unknown>;
    const nominationId = String(payload.nomination_id);
    const winnerTeamId = String(payload.winning_team_id);
    const finalAmount = Number(payload.final_amount);
    const totalBids = Number(payload.total_bids ?? 1);
    const playerId = String(payload.player_id);

    const prevBudget = this.teamBudgets.get(winnerTeamId) ?? 0;
    const prevWon = this.teamPlayersWon.get(winnerTeamId) ?? 0;
    this.teamBudgets.set(winnerTeamId, prevBudget - finalAmount);
    this.teamPlayersWon.set(winnerTeamId, prevWon + 1);

    this.currentNomination = null;
    this.nominationsCompleted++;

    this.events.append({
      kind: 'auction_nomination_closed',
      seq: event.seq,
      timestamp: event.created_at,
      nominationId,
      winnerTeamId,
      finalAmount,
      totalBids,
      playerId,
    });

    const totalNominations = this.nominationOrder.length * this.draftRounds;
    if (
      this.nominationOrder.length > 0 &&
      this.nominationsCompleted >= totalNominations
    ) {
      this.draftStatus = 'completed';
    }
  }

  /**
   * Bootstrap handler for `event_type === 'auction_nomination_expired'`.
   * No-sale: nominator forfeited the turn. No budget / players_won
   * change. Increments `nominationsCompleted` and clears
   * `currentNomination`.
   */
  private applyAuctionNominationExpiredEvent(event: DraftEventRow): void {
    const payload = event.payload as Record<string, unknown>;
    const nominationId = String(payload.nomination_id);

    this.currentNomination = null;
    this.nominationsCompleted++;

    this.events.append({
      kind: 'auction_nomination_expired',
      seq: event.seq,
      timestamp: event.created_at,
      nominationId,
      reason: 'no_bids',
    });

    const totalNominations = this.nominationOrder.length * this.draftRounds;
    if (
      this.nominationOrder.length > 0 &&
      this.nominationsCompleted >= totalNominations
    ) {
      this.draftStatus = 'completed';
    }
  }

  // ── Step 6c: pick deadline timer + autopick on timeout ─────────────

  /**
   * Schedule (or reschedule) the autopick timer for the on-clock
   * pick. Cancels any existing timer first so concurrent calls
   * don't double-schedule.
   *
   * If `deadline <= now()`, the timer fires on the next event-loop
   * tick (via `setTimeout(..., 0)`). This handles the bootstrap-
   * recovery path where the engine starts after the on-clock team's
   * deadline already passed — autopick fires immediately rather
   * than leaving the draft stuck.
   *
   * No-op if `shutDown` is true (graceful-shutdown protection
   * against late-firing timers post-shutdown).
   */
  private setPickDeadline(deadline: Date): void {
    this.cancelPickTimer();
    if (this.shutDown) {
      return;
    }
    this.currentPickDeadline = deadline;
    const delayMs = Math.max(0, deadline.getTime() - Date.now());
    this.currentPickTimerHandle = setTimeout(() => {
      this.currentPickTimerHandle = null;
      void this.handleClockExpired();
    }, delayMs);
    logger.debug(
      `[lobby] pick deadline scheduled lobbyId=${this.lobbyId} deadline=${deadline.toISOString()} delayMs=${delayMs}`,
    );
  }

  /**
   * Format-aware clock-expiry dispatch (chunk 11g.6 sub-step 6a).
   * Snake/linear → autopick; auction → close-nomination. Common
   * defensive guards (shut down / not in_progress / paused) live
   * here so each branch's body is single-purpose.
   */
  private async handleClockExpired(): Promise<void> {
    if (this.shutDown) {
      logger.debug(`[lobby] clock fired post-shutdown — ignored lobbyId=${this.lobbyId}`);
      return;
    }
    if (this.draftStatus !== 'in_progress') {
      logger.warn(
        `[lobby] clock fired but draftStatus=${this.draftStatus} — ignored (timer should have been cancelled) lobbyId=${this.lobbyId}`,
      );
      return;
    }
    if (this.pauseState !== null) {
      logger.warn(
        `[lobby] clock fired while paused — ignored (pauseDraft should have cancelled) lobbyId=${this.lobbyId}`,
      );
      return;
    }
    if (this.format === 'auction') {
      await this.handleNominationTimeout();
    } else {
      await this.handleAutopickTimeout();
    }
  }

  /**
   * Cancel the pending autopick timer (if any). Idempotent — safe
   * to call when no timer is set. Does NOT clear
   * `currentPickDeadline` because callers may want to inspect it
   * (e.g., for observability after shutdown). Set to null
   * explicitly when the deadline truly no longer applies.
   */
  private cancelPickTimer(): void {
    if (this.currentPickTimerHandle !== null) {
      clearTimeout(this.currentPickTimerHandle);
      this.currentPickTimerHandle = null;
    }
  }

  /**
   * Timer-fired entry point. Constructs an autopick action and
   * feeds it through `enqueueAction` so it serializes through the
   * single-writer queue alongside any concurrent user submits
   * (first-one-wins by queue order; the loser sees
   * `not_on_clock` from the RPC's idempotency / state checks).
   *
   * Defensive guards: drop if shut down, not in_progress, or
   * paused (timer should have been cancelled by the relevant
   * transition; if it fires anyway, treat as stale and ignore).
   */
  private async handleAutopickTimeout(): Promise<void> {
    // Guards (shut down / not in_progress / paused) live in
    // handleClockExpired — this method is only called from that
    // dispatcher AND from legacy direct callers (none today, but
    // keep the method signature stable for forward-compat).

    const slot = this.draftOrder[this.picksMade];
    if (!slot) {
      logger.error(
        `[lobby] autopick fired with no slot at picksMade=${this.picksMade} lobbyId=${this.lobbyId}`,
      );
      return;
    }

    let result;
    try {
      result = await selectAutopickPlayer(
        {
          leagueId: this.leagueId,
          teamId: slot.teamId,
          supabase: this.supabase,
        },
        this.autopickStrategies,
      );
    } catch (err) {
      logger.error(
        `[lobby] autopick strategy threw lobbyId=${this.lobbyId} teamId=${slot.teamId}`,
        err,
      );
      // Treat as stuck-draft — clear deadline, surface for ops.
      this.currentPickDeadline = null;
      return;
    }

    if (!result.ok) {
      // Stuck-draft condition: every strategy returned no_eligible_players.
      // Real production issue requiring commissioner intervention. Chunk
      // 11g.7's alert policy fires on this log line.
      logger.error(
        `[lobby] autopick STUCK — no eligible players lobbyId=${this.lobbyId} teamId=${slot.teamId} picksMade=${this.picksMade}`,
      );
      this.currentPickDeadline = null;
      return;
    }

    logger.info(
      `[lobby] autopick fired lobbyId=${this.lobbyId} teamId=${slot.teamId} playerId=${result.playerId} source=${result.source}`,
    );

    // Construct the engine-authored action. Synthetic userId
    // (`'autopick-engine'`) and a per-call sessionId (UUID) so the
    // audit trail records the engine as the actor and ties the
    // resulting `draft_events` row back to this fire.
    const autopickAction: DraftAction = {
      kind: 'submit_pick',
      teamId: slot.teamId,
      playerId: String(result.playerId),
      userId: 'autopick-engine',
      sessionId: randomUUID(),
      idempotencyKey: randomUUID(),
      actorKind: 'autopick',
    };

    // Route through enqueueAction so it serializes through the
    // single-writer queue. processSubmitPick will skip the auth
    // check (per `actorKind === 'autopick'`) and submit with
    // `actor.kind = 'autopick'` to the RPC.
    try {
      await this.enqueueAction(autopickAction);
    } catch (err) {
      logger.error(
        `[lobby] autopick enqueueAction threw lobbyId=${this.lobbyId}`,
        err,
      );
    }
  }

  /**
   * Auction nomination-timer entry point (chunk 11g.6 sub-step 6a).
   * Called from `handleClockExpired` when the bid window closes.
   * Common defensive guards already ran in the dispatcher.
   *
   * Sequence:
   *   1. **Active-nomination guard** — if `currentNomination` is
   *      already null, the timer fired against a closed nomination
   *      (race with a manual close path; shouldn't happen in 6a).
   *      Log warn and return.
   *   2. **Call `close_nomination_v2` RPC** — atomic 5-write block
   *      (UPDATE auction_nominations + UPDATE auction_budgets +
   *      INSERT draft_picks + INSERT draft_events; no_sale branch
   *      omits the budget/picks writes when the nominator's
   *      opening bid is the only bid).
   *   3. **Advance state** — deduct budget, increment players_won,
   *      append closed/expired event to ring buffer, broadcast,
   *      increment `nominationsCompleted`, clear
   *      `currentNomination`. Auction-completion check fires when
   *      `nominationsCompleted >= teams × draftRounds`.
   *
   * Unlike snake/linear's `handleAutopickTimeout` (which routes a
   * synthetic `submit_pick` action through the queue),
   * `handleNominationTimeout` calls `closeNomination` directly. The
   * close is engine-authored and engine-only; there's no
   * client-facing `close_nomination` action that needs to be
   * idempotency-cached or auth-checked.
   */
  private async handleNominationTimeout(): Promise<void> {
    if (this.currentNomination === null) {
      logger.warn(
        `[lobby] nomination timeout fired with no active nomination — ignored lobbyId=${this.lobbyId}`,
      );
      return;
    }
    const nomination = this.currentNomination;

    let result: Awaited<ReturnType<DraftServiceV2['closeNomination']>>;
    try {
      result = await this.draftService.closeNomination({
        leagueId: this.leagueId,
        nominationId: nomination.nominationId,
        idempotencyKey: `close-${nomination.nominationId}`,
        actor: {
          kind: 'autopick',
          id: 'auction-engine',
          session_id: randomUUID(),
        },
      });
    } catch (err) {
      logger.error(
        `[lobby] closeNomination RPC threw lobbyId=${this.lobbyId} nominationId=${nomination.nominationId}`,
        err,
      );
      // Stuck-auction condition. Surface for ops; clear timer and
      // currentNomination so the lobby doesn't deadlock. Chunk 11g.7
      // alerting fires on this log line.
      this.currentNomination = null;
      this.currentPickDeadline = null;
      return;
    }

    const timestamp = new Date().toISOString();
    const correlationId = `close-${nomination.nominationId}`;

    if (!result.no_sale) {
      // Winning bid: deduct budget, increment players_won. Mirror
      // the RPC's atomic UPDATE auction_budgets writes so engine
      // state matches the DB without a re-read. Winner / final
      // amount come from the in-memory `currentNomination` (which
      // tracked the leading bid live); RPC doesn't redundantly
      // return them.
      const winnerId = nomination.leadingBidderId;
      const finalAmount = nomination.leadingBid;
      const prevBudget = this.teamBudgets.get(winnerId) ?? 0;
      const prevWon = this.teamPlayersWon.get(winnerId) ?? 0;
      this.teamBudgets.set(winnerId, prevBudget - finalAmount);
      this.teamPlayersWon.set(winnerId, prevWon + 1);

      const event: BufferedDraftEvent = {
        kind: 'auction_nomination_closed',
        seq: result.seq,
        timestamp,
        nominationId: nomination.nominationId,
        winnerTeamId: winnerId,
        finalAmount,
        // Engine doesn't track per-nomination bid counts in 6a;
        // placeholder of 1 (= the opening bid) is the floor.
        // Chunk 11g.6 6b/6c may add a counter on `currentNomination`.
        totalBids: 1,
        playerId: nomination.playerId,
      };
      this.events.append(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId,
        payload: event,
      });
    } else {
      // No-sale: nomination expired with only the opening bid (no
      // follow-up bids). Nominator forfeits the turn, no budget
      // change. ADR-002 §3.3.
      const event: BufferedDraftEvent = {
        kind: 'auction_nomination_expired',
        seq: result.seq,
        timestamp,
        nominationId: nomination.nominationId,
        reason: 'no_bids',
      };
      this.events.append(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId,
        payload: event,
      });
    }

    this.currentNomination = null;
    this.currentPickDeadline = null;
    this.nominationsCompleted++;

    // Auction completion check.
    const totalNominations = this.nominationOrder.length * this.draftRounds;
    if (this.nominationsCompleted >= totalNominations) {
      this.draftStatus = 'completed';
      logger.info(
        `[lobby] auction completed lobbyId=${this.lobbyId} totalNominations=${totalNominations}`,
      );
    }
  }

  /**
   * Pause the draft (in-memory bookkeeping). Mirror of the
   * `draft_pause` RPC behavior; called by the engine when it
   * observes a `draft_paused` event (cross-process notification
   * lands in chunk 11g.7) or by tests.
   *
   * Cancels the pending pick timer and captures `pauseState` for
   * audit. The `remainingMs` is informational only — the engine
   * does NOT use it to reconstruct the resume deadline because
   * the `draft_resume` RPC gives a fresh full pick clock (single
   * source of truth: engine state mirrors RPC behavior).
   *
   * Idempotent — calling on an already-paused draft is a no-op.
   * Throws if the draft isn't `in_progress` (illegal state).
   */
  pauseDraft(): void {
    if (this.pauseState !== null) {
      logger.debug(`[lobby] pauseDraft on already-paused draft — no-op lobbyId=${this.lobbyId}`);
      return;
    }
    if (this.draftStatus !== 'in_progress') {
      throw new Error(
        `[lobby] pauseDraft called from invalid status=${this.draftStatus} lobbyId=${this.lobbyId}`,
      );
    }
    const now = new Date();
    const remainingMs = this.currentPickDeadline
      ? Math.max(0, this.currentPickDeadline.getTime() - now.getTime())
      : 0;
    this.pauseState = { pausedAt: now, remainingMs };
    this.cancelPickTimer();
    this.currentPickDeadline = null;
    logger.info(
      `[lobby] paused lobbyId=${this.lobbyId} remainingMs=${remainingMs}`,
    );
  }

  /**
   * Resume a paused draft (in-memory bookkeeping). Sets a fresh
   * full pick-clock deadline (matching the `draft_resume` RPC
   * behavior at migration line 1136-1141).
   *
   * Throws if the draft isn't paused (illegal state).
   */
  resumeDraft(): void {
    if (this.pauseState === null) {
      throw new Error(
        `[lobby] resumeDraft called on non-paused draft lobbyId=${this.lobbyId}`,
      );
    }
    this.pauseState = null;
    const newDeadline = new Date(Date.now() + this.pickClockMs);
    this.setPickDeadline(newDeadline);
    logger.info(
      `[lobby] resumed lobbyId=${this.lobbyId} newDeadline=${newDeadline.toISOString()}`,
    );
  }

  /**
   * Graceful shutdown (chunk 11g.4 step 6c — partial; chunk 11g.7
   * extends with connection-teardown + final-state persistence).
   *
   * Today: cancel pending timers and mark the lobby as shut down
   * so any late-firing callbacks become no-ops. Subsequent
   * `setPickDeadline` calls are no-ops; `handleAutopickTimeout`
   * early-returns. Idempotent.
   *
   * Future expansion (chunk 11g.7): close all WebSocket
   * connections, await in-flight queue actions, persist a final
   * snapshot to `draft_state` for fast subsequent bootstrap.
   */
  async shutdown(): Promise<void> {
    if (this.shutDown) {
      return;
    }
    this.shutDown = true;
    this.cancelPickTimer();
    this.currentPickDeadline = null;
    logger.info(`[lobby] shutdown lobbyId=${this.lobbyId}`);
  }
}
