// Phase 4.5 chunk 11g.4 — LobbyManager: in-memory state machine + single-
// writer queue per active draft.
//
// Step 6a of chunk 11g.4: the state machine. Replaces the hardcoded
// round=1/pickNumber=1 from step 2 with values computed from a
// pre-loaded draft-order slot list (Path B per chunk-6a recon: load
// from `public.draft_order` rather than regenerate in-engine, so the
// engine and `submit_pick_v2`'s on-clock check validate against the
// identical view — eliminates the commissioner-customTeamOrder
// divergence risk). Adds engine-side team-authorization verification
// per ADR-004 §5.3 (engine MUST verify before calling submit_pick_v2
// with actor.kind='user'); auth runs BEFORE on-clock check so a
// non-manager probing the WS doesn't get on-clock information leaked
// via differentiated error reasons.
//
// **Step 6a is fresh-start-only.** A LobbyManager constructed in 6a
// assumes the draft starts at picksMade=0. Production server restart
// mid-draft is incorrect until step 6b ships event-log bootstrap. The
// `existingPicksMade` constructor option is the forward-compat hook
// that 6b populates after replaying the durable event log; in 6a it
// defaults to 0 and zero callers exercise it.
//
// Future sub-steps:
//   - 6b: bootstrap from event log on construction (process restart
//          recovery for already-in-progress drafts)
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
import { logger } from '@citrus/shared';
import { AppError } from '../lib/errors';
import {
  DraftServiceV2,
  type DraftV2Actor,
  type SubmitPickResult,
} from '../services/DraftServiceV2';
import { RingBuffer } from './RingBuffer';
import {
  serializeServerMessage,
  WIRE_PROTOCOL_VERSION,
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
   * **Forward-compat hook for chunk 11g.4 step 6b** (event-log
   * bootstrap on process restart). When step 6b replays the durable
   * event log, it sets this to the count of `pick_submitted` events
   * already recorded for the league; the LobbyManager resumes from
   * that index in the draft order.
   *
   * Step 6a always passes 0 (or omits — defaults to 0). 6a is
   * fresh-start-only by design; production server restart mid-draft
   * remains incorrect until 6b ships.
   */
  existingPicksMade?: number;
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
   * gets a `was_duplicate=false` from the RPC.
   *
   * **Step 6a starts at `existingPicksMade ?? 0`** — production
   * restart mid-draft is incorrect until step 6b's event-log
   * bootstrap sets this from the durable record.
   */
  private picksMade: number;

  /**
   * Lifecycle phase per `DraftStatus`. Transitions:
   *   - constructor: `not_started` (or `in_progress` / `completed`
   *     if `existingPicksMade > 0` per the 6b forward-compat hook)
   *   - first successful pick: `not_started → in_progress`
   *   - final pick (`picksMade === draftOrder.length`):
   *     `in_progress → completed`
   *
   * Auction lobbies stay at `not_started` until chunk 11g.6
   * introduces auction-specific lifecycle wiring.
   */
  private draftStatus: DraftStatus;

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

  constructor(opts: LobbyManagerOptions) {
    this.lobbyId = opts.lobbyId;
    this.format = opts.format;
    this.leagueId = opts.leagueId;
    this.draftService = opts.draftService;
    this.publish = opts.publish;
    this.verifyTeamAuthorization = opts.verifyTeamAuthorization;
    this.draftOrder = opts.draftOrder;
    this.topicName = `draft:${opts.lobbyId}`;

    // Step 6b forward-compat: start at `existingPicksMade` if the
    // bootstrap path supplies it; otherwise zero. Step 6a always
    // takes the zero path.
    this.picksMade = opts.existingPicksMade ?? 0;
    this.draftStatus = this.computeInitialStatus();

    logger.info(
      `[lobby] LobbyManager constructed lobbyId=${opts.lobbyId} format=${opts.format} leagueId=${opts.leagueId} topic=${this.topicName} totalPicks=${this.draftOrder.length} picksMade=${this.picksMade} status=${this.draftStatus}`,
    );
  }

  /**
   * Determine the initial `draftStatus` based on `picksMade` vs the
   * draft order length. For step 6a this is always `not_started`
   * (picksMade=0). Step 6b's bootstrap path may construct a lobby
   * with picksMade > 0, in which case the status is `in_progress`
   * (or `completed` if all picks have been recorded). Auction lobbies
   * with empty draftOrder stay `not_started` — chunk 11g.6 owns
   * auction-status lifecycle.
   */
  private computeInitialStatus(): DraftStatus {
    if (this.draftOrder.length === 0) {
      return 'not_started';
    }
    if (this.picksMade === 0) {
      return 'not_started';
    }
    if (this.picksMade >= this.draftOrder.length) {
      return 'completed';
    }
    return 'in_progress';
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
    return {
      lobbyId: this.lobbyId,
      format: this.format,
      recentEvents: this.events.snapshot(),
      stateSnapshot: this.getCurrentState(),
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
    const slot =
      this.draftStatus === 'in_progress' ? this.draftOrder[this.picksMade] : null;
    return {
      currentPickNumber: slot ? slot.pickNumber : null,
      currentRoundNumber: slot ? slot.round : null,
      onClockTeamId: slot ? slot.teamId : null,
      totalPicks: this.draftOrder.length,
      picksMade: this.picksMade,
      draftStatus: this.draftStatus,
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

  /**
   * Gracefully shut down the lobby.
   *
   * **Implementation status (chunk 11g.4 step 1, unchanged in step 2):**
   * stub (no-op). Step 7 wires this alongside chunk 11g.7's snapshot-
   * persistence + process-bootstrap pair.
   */
  async shutdown(): Promise<void> {
    // Step 7 implements. No-op today.
  }

  // ── Private: queue + dispatch ─────────────────────────────────────

  /**
   * Per-action dispatch. Snake/linear `submit_pick` flows through
   * `processSubmitPick`; auction action variants are stubbed until
   * chunk 11g.6.
   */
  private async processAction(action: DraftAction): Promise<DraftActionResult> {
    switch (action.kind) {
      case 'submit_pick':
        return this.processSubmitPick(action);
      case 'place_bid':
      case 'nominate':
        return { ok: false, reason: 'not_yet_implemented_chunk_11g6' };
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

    // Step 2: ADR-004 §5.3 engine-side authorization.
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

    // Step 3: status check. Already-completed drafts cannot accept
    // more picks — return `invalid_state` for an informative client
    // signal. Runs BEFORE on-clock so the response distinguishes
    // "draft is over" from "your team isn't on the clock" (which
    // would be the misleading reading of a completed-draft slot
    // lookup, since `draftOrder[picksMade]` is undefined past the
    // last pick).
    if (this.draftStatus === 'completed') {
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
      kind: 'user',
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
}
