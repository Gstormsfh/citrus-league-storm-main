// Phase 4.5 chunk 11g.4 — LobbyManager: in-memory state machine + single-
// writer queue per active draft.
//
// Step 2 of chunk 11g.4: implement the single-writer queue, idempotency
// cache, and the first action handler (`submit_pick` for snake/linear).
// Auction action variants (`place_bid`, `nominate`) remain stubbed —
// they land in chunk 11g.6 when the auction state machine arrives.
// Connection management (addConnection/removeConnection) stays as no-op
// stubs from step 1; that's step 4's work. Broadcast is step 5.
//
// Future steps:
//   - Step 3: ring buffer for resync
//   - Step 4: connection management (real addConnection/removeConnection)
//             + LobbyRegistry singleton
//   - Step 5: broadcast via uWS topics post-commit
//   - Step 6: auction state machine (place_bid + nominate handlers, real
//             round/pickNumber computation from in-memory state)
//   - Step 7: snapshot persistence + bootstrap (chunk 11g.7)
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; LobbyManager
// principles — Principle 5 single-writer per lobby), docs/adr/
// ADR-002-auction-state-machine.md §3.2 (format-aware single class),
// and docs/adr/ADR-001-persistent-node-draft-engine.md.

import type { WebSocket } from 'uWebSockets.js';
import { logger } from '@citrus/shared';
import { AppError } from '../lib/errors';
import {
  DraftServiceV2,
  type DraftV2Actor,
  type SubmitPickResult,
} from '../services/DraftServiceV2';
import type {
  DraftAction,
  DraftActionResult,
  DraftFormat,
  DraftSnapshot,
  DraftSocketUserData,
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

export class LobbyManager {
  readonly lobbyId: string;
  readonly format: DraftFormat;
  readonly leagueId: string;

  private readonly draftService: DraftServiceV2;

  /**
   * Connected uWS WebSocket references for this lobby. Step 4
   * wires add/remove + broadcast.
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
   * Recent-events ring buffer placeholder. Step 3 implements the
   * ~200-event rolling buffer for chunk 11g.5's `last_seen_seq`
   * resume protocol. Today: empty array stub.
   */
  private readonly recentEvents: unknown[] = [];

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
   *
   * **Implementation status (chunk 11g.4 step 1, unchanged in step 2):**
   * stub (no-op). Step 4 wires connection management — adds to
   * `this.connections`, records the user's last-seen seq for chunk
   * 11g.5's resync protocol, optionally sends a snapshot, and emits
   * a presence event to other connected clients.
   */
  addConnection(ws: WebSocket<DraftSocketUserData>, userData: DraftSocketUserData): void {
    // Step 4 implements. No-op today.
    void ws;
    void userData;
  }

  /**
   * Deregister a closed/dropped WebSocket.
   *
   * **Implementation status (chunk 11g.4 step 1, unchanged in step 2):**
   * stub (no-op). Step 4 wires connection management.
   */
  removeConnection(ws: WebSocket<DraftSocketUserData>): void {
    // Step 4 implements. No-op today.
    void ws;
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
   * Return a snapshot of the current lobby state. Step 1 returns
   * identity fields only; steps 3-6 fill in pick/timer/buffer state.
   */
  getSnapshot(): DraftSnapshot {
    return {
      lobbyId: this.lobbyId,
      format: this.format,
      recentEvents: this.recentEvents,
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
