// Phase 4.5 chunk 11g.4 step 1 — LobbyManager class skeleton.
//
// One LobbyManager instance per active draft. Holds in-memory state
// (current pick, on-clock team, timer, recent events ring buffer,
// connected sockets) and serializes mutations through a single-writer
// queue. Format-aware: handles snake, linear, and auction drafts via
// state-machine dispatch (per ADR-002 §3.2).
//
// Step 1 of chunk 11g.4: scaffold only. No queue, no buffer, no
// broadcast, no DB writes. Every method is either a stub throwing
// "not yet implemented" or a no-op. Future steps:
//   - Step 2: single-writer queue + first action handlers
//   - Step 3: ring buffer for resync
//   - Step 4: connection management + broadcast via uWS topics
//   - Step 5: durable event log (draft_events RPC integration)
//   - Step 6: timer + autopick (chunk 11g.6 in the original plan)
//   - Step 7: snapshot persistence + bootstrap (chunk 11g.7)
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; LobbyManager
// principles — single-writer queue, ring buffer ~200, broadcast via
// uWS topics), docs/adr/ADR-002-auction-state-machine.md §3.2
// (format-aware single class with state-machine dispatch), and
// docs/adr/ADR-001-persistent-node-draft-engine.md.

import type { WebSocket } from 'uWebSockets.js';
import { logger } from '@citrus/shared';
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
}

export class LobbyManager {
  readonly lobbyId: string;
  readonly format: DraftFormat;
  readonly leagueId: string;

  /**
   * Connected uWS WebSocket references for this lobby. Step 4
   * wires add/remove + broadcast. Day 1 keeps a Set; chunk 11g.5's
   * reconnect protocol may add per-socket bookkeeping (last seen
   * seq, connection state).
   */
  private readonly connections: Set<WebSocket<DraftSocketUserData>> = new Set();

  /**
   * Single-writer queue placeholder. Step 2 implements the
   * `this.queue = this.queue.then(() => doMutation())` promise-chain
   * pattern from PHASE_4_5_ARCHITECTURE.md Principle 5. On a single
   * Node process the event loop already serializes mutations, but
   * the pattern must be present so future multi-process sharding
   * doesn't require finding and fixing concurrent-access bugs.
   * Today: unused.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Recent-events ring buffer placeholder. Step 3 implements the
   * ~200-event rolling buffer for chunk 11g.5's `last_seen_seq`
   * resume protocol — clients reconnecting with a small gap replay
   * from the buffer; bigger gaps fall through to a full snapshot
   * from `draft_state` + replay of `draft_events` since the
   * snapshot's seq. Today: empty array stub.
   */
  private readonly recentEvents: unknown[] = [];

  constructor(opts: LobbyManagerOptions) {
    this.lobbyId = opts.lobbyId;
    this.format = opts.format;
    this.leagueId = opts.leagueId;
    logger.info(
      `[lobby] LobbyManager constructed lobbyId=${opts.lobbyId} format=${opts.format} leagueId=${opts.leagueId}`,
    );
  }

  /**
   * Register a newly-upgraded WebSocket as a connected client.
   *
   * **Implementation status (chunk 11g.4 step 1):** stub (no-op).
   * Step 4 wires connection management — adds to `this.connections`,
   * records the user's last-seen seq for chunk 11g.5's resync
   * protocol, optionally sends a snapshot, and emits a presence
   * event to other connected clients.
   */
  addConnection(ws: WebSocket<DraftSocketUserData>, userData: DraftSocketUserData): void {
    // Step 4 implements. No-op today.
    void ws;
    void userData;
  }

  /**
   * Deregister a closed/dropped WebSocket. Counterpart to
   * `addConnection`.
   *
   * **Implementation status (chunk 11g.4 step 1):** stub (no-op).
   * Step 4 wires connection management — removes from
   * `this.connections` and emits a presence-disconnect event so
   * other clients see the drop.
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
   * **Implementation status (chunk 11g.4 step 1):** rejects with
   * `'not yet implemented'`. Step 2 wires the queue (the
   * `this.queue = this.queue.then(...)` chain) plus per-format
   * dispatch into snake/linear pick handlers and auction
   * bid/nominate handlers. Step 5 wires durability into
   * `draft_events` via the existing `DraftServiceV2` RPC surface.
   */
  async enqueueAction(action: DraftAction): Promise<DraftActionResult> {
    void action;
    throw new Error(
      'LobbyManager.enqueueAction: not yet implemented (chunk 11g.4 step 2)',
    );
  }

  /**
   * Return a snapshot of the current lobby state for a newly-
   * connecting client (or a client whose ring-buffer gap exceeded
   * the buffer size and needs a full resync per chunk 11g.5).
   *
   * **Implementation status (chunk 11g.4 step 1):** placeholder.
   * Step 1 returns identity fields plus an empty `recentEvents`
   * list. Steps 3-6 fill in:
   *   - current pick number + on-clock team
   *   - pick deadline + time remaining
   *   - recent events from the ring buffer (step 3)
   *   - candidate pool / available players (step 5)
   *   - format-specific state: current nomination + budgets (auction)
   */
  getSnapshot(): DraftSnapshot {
    return {
      lobbyId: this.lobbyId,
      format: this.format,
      recentEvents: this.recentEvents,
    };
  }

  /**
   * Gracefully shut down the lobby — close all connected sockets,
   * flush in-flight mutations, persist a final snapshot.
   *
   * **Implementation status (chunk 11g.4 step 1):** stub (no-op).
   * Step 7 wires this alongside chunk 11g.7's snapshot-persistence
   * + process-bootstrap pair so SIGTERM and process-restart cleanly
   * land state in `draft_state` and the next instance picks it up
   * via event replay.
   */
  async shutdown(): Promise<void> {
    // Step 7 implements. No-op today.
  }
}
