// Phase 4.5 chunk 11g.4 — LobbyManager: in-memory state machine + single-
// writer queue per active draft.
//
// Step 4 of chunk 11g.4: real `addConnection`/`removeConnection`
// (set-membership only — no broadcast yet) plus the public
// `connectionCount()` getter the LobbyRegistry uses for diagnostic
// logging. The registry (server/src/draft/LobbyRegistry.ts, new in
// step 4) handles lazy LobbyManager construction with a Promise-
// placeholder map that collapses concurrent same-lobby callers onto
// one constructed instance.
//
// Future steps:
//   - Step 5: broadcast via uWS topics post-commit
//   - Step 6: auction state machine (place_bid + nominate handlers, real
//             round/pickNumber computation from in-memory state)
//   - Step 7: snapshot persistence + bootstrap (chunk 11g.7) — owns
//             lobby eviction once the draft completes; step 4 does
//             NOT evict on last-disconnect.
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
import type {
  BufferedDraftEvent,
  DraftAction,
  DraftActionResult,
  DraftFormat,
  DraftSnapshot,
  DraftSocketUserData,
  GetEventsSinceSeqResult,
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

export class LobbyManager {
  readonly lobbyId: string;
  readonly format: DraftFormat;
  readonly leagueId: string;

  private readonly draftService: DraftServiceV2;

  /**
   * Connected uWS WebSocket references for this lobby. Populated by
   * `addConnection` from the uws-server.ts open handler; cleared by
   * `removeConnection` from the close handler. Set semantics dedupe
   * — addConnection is naturally idempotent for the same ws.
   *
   * Step 5 will additionally subscribe each ws to the lobby's uWS
   * pub/sub topic for fan-out. Today the set is just a roll call
   * for diagnostic logging via `connectionCount()`.
   */
  private readonly connections: Set<WebSocket<DraftSocketUserData>> = new Set();

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
    logger.info(
      `[lobby] LobbyManager constructed lobbyId=${opts.lobbyId} format=${opts.format} leagueId=${opts.leagueId}`,
    );
  }

  /**
   * Register a newly-upgraded WebSocket as a connected client.
   * Set semantics: idempotent — adding the same ws twice is a no-op
   * for set membership.
   *
   * Step 5 will additionally subscribe ws to the lobby's broadcast
   * topic; chunk 11g.5 will record the user's last-seen seq for the
   * resync protocol. Today: set membership + diagnostic log only.
   */
  addConnection(ws: WebSocket<DraftSocketUserData>, userData: DraftSocketUserData): void {
    this.connections.add(ws);
    logger.info(
      `[lobby] connection added lobbyId=${this.lobbyId} userId=${userData.userId} size=${this.connections.size}`,
    );
  }

  /**
   * Deregister a closed/dropped WebSocket. Idempotent — calling for
   * a ws not in the set is a safe no-op (no log emitted).
   *
   * Step 5 will additionally unsubscribe ws from the broadcast topic.
   * Lobby eviction on last-disconnect is intentionally NOT done here
   * — chunk 11g.7's snapshot-and-bootstrap flow owns lobby retirement
   * (drafts that complete get snapshotted and dropped from the
   * registry; pre-completion the lobby stays alive for late
   * reconnects to pick up the ring buffer).
   */
  removeConnection(ws: WebSocket<DraftSocketUserData>): void {
    const removed = this.connections.delete(ws);
    if (removed) {
      logger.info(
        `[lobby] connection removed lobbyId=${this.lobbyId} size=${this.connections.size}`,
      );
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
   * Return a snapshot of the current lobby state. Steps 1-3 return
   * identity fields plus the recent-events ring buffer contents;
   * steps 4-6 fill in pick/timer/candidate-pool/auction state.
   */
  getSnapshot(): DraftSnapshot {
    return {
      lobbyId: this.lobbyId,
      format: this.format,
      recentEvents: this.events.snapshot(),
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
   * Snake/linear pick handler. Calls `DraftServiceV2.submitPick`
   * which writes to `draft_events` via the `submit_pick_v2` RPC
   * (atomic envelope: payload validation, idempotency-key check,
   * payload-hash conflict detection, projection-trigger fire).
   *
   * **Auction format:** returns `'wrong_format_for_action'` —
   * auction picks happen via `place_bid` + `nominate` + automatic
   * close, not direct `submit_pick`. Chunk 11g.6 wires those.
   *
   * **TODO(chunk 11g.4 step 6):** replace the hardcoded round=1 /
   * pickNumber=1 with computation from the in-memory state machine.
   * The submit_pick_v2 RPC validates pick ordering (`pick_out_of_order`
   * is one of its rejection reasons), so the values must be the
   * actual current pick — not 1/1 — once the state machine exists.
   * For step 2's queue/idempotency tests, fixed values are sufficient
   * because the tests mock `DraftServiceV2.submitPick`.
   */
  private async processSubmitPick(
    action: Extract<DraftAction, { kind: 'submit_pick' }>,
  ): Promise<DraftActionResult> {
    if (this.format === 'auction') {
      return { ok: false, reason: 'wrong_format_for_action' };
    }

    // TODO(chunk 11g.4 step 6): compute from in-memory state machine.
    const HARDCODED_ROUND = 1;
    const HARDCODED_PICK_NUMBER = 1;

    const actor: DraftV2Actor = {
      kind: 'user',
      id: action.userId,
      session_id: action.sessionId,
    };

    let result: SubmitPickResult;
    try {
      result = await this.draftService.submitPick({
        leagueId: this.leagueId,
        teamId: action.teamId,
        // Wire-format playerId is string (matches DraftAction). The
        // submit_pick_v2 RPC expects int (NHL player ID from staging
        // files). Coerce at the boundary.
        playerId: parseInt(action.playerId, 10),
        round: HARDCODED_ROUND,
        pickNumber: HARDCODED_PICK_NUMBER,
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

    // Buffer the recorded event for chunk 11g.5's resume protocol.
    // Skip when the RPC reports `was_duplicate=true` — the original
    // event is already in the buffer (and the durable log) from the
    // first non-retried submission; double-appending would let
    // clients see the same event twice during resync.
    if (!result.was_duplicate) {
      this.events.append({
        kind: 'pick_submitted',
        seq: result.seq,
        timestamp: new Date().toISOString(),
        teamId: action.teamId,
        playerId: parseInt(action.playerId, 10),
        roundNumber: HARDCODED_ROUND,
        pickNumber: HARDCODED_PICK_NUMBER,
      });
    }

    return { ok: true, eventSeq: result.seq };
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
