// Phase 4.5 chunk 11g.5a — wire-protocol types shared between server
// and client. Moved from `server/src/draft/types.ts` so the contract
// lives in one place; the server re-exports for backwards-compat.
//
// **What lives here:** types that flow over the WebSocket wire
// (DraftServerMessage / DraftClientMessage), the payloads they
// carry (BufferedDraftEvent, DraftSnapshot, DraftStateSnapshot),
// and the lifecycle enums those payloads reference (DraftStatus,
// DraftFormat).
//
// **What stays server-internal:** DraftAction, DraftActionResult,
// DraftSocketUserData, DraftOrderSlot, GetEventsSinceSeqResult,
// TeamAuthorizationResult, the (de)serializer helpers. Those are
// implementation details of the LobbyManager / RPC layer that the
// client doesn't consume.

// ── Format / status enums ──────────────────────────────────────────

/**
 * Live-draftable formats. Subset of `@citrus/shared`'s `DraftType`,
 * excluding `'autopick'` and `'offline'` (operational modes — drafts
 * in those modes don't get a LobbyManager).
 *
 * Defined as a literal alias rather than `Extract<DraftType, ...>`
 * so future `DraftType` additions in `@citrus/shared` (e.g. a
 * hypothetical `'best-ball'` or `'turbo'`) don't silently expand
 * LobbyManager's supported set. Opt-in by design — when a new
 * format is added, this alias must be updated explicitly, which
 * forces the dispatch logic in LobbyManager to be reviewed.
 *
 * See ADR-002 §3.2 for the format-aware single-class decision.
 */
export type DraftFormat = 'snake' | 'linear' | 'auction';

/**
 * Lifecycle phase of the in-memory draft state machine. Step 6a
 * implements the linear progression `not_started → in_progress →
 * completed`; step 6b adds `cancelled` as a terminal state set
 * explicitly by the durable `draft_cancelled` event during bootstrap.
 *
 * Step 6c (deadline + autopick) and ADR-002 §6 (auction pause/resume)
 * will introduce additional transient states (e.g. `paused`).
 *
 * Both `completed` and `cancelled` are terminal — `processSubmitPick`
 * rejects with `invalid_state` once either is reached.
 */
export type LobbyStatus = 'not_started' | 'in_progress' | 'completed' | 'cancelled';

// ── Buffered event union ───────────────────────────────────────────

/**
 * Discriminated union of events stored in the LobbyManager's
 * recent-events ring buffer (chunk 11g.4 step 3, ~200 events).
 *
 * Variants mirror the past-tense event-type names cataloged in
 * ADR-002 §4.1, NOT the present-tense action verbs in `DraftAction`.
 * Actions are what clients submit; events are what got recorded.
 *
 * Only `pick_submitted` is appended in step 3. The auction variants
 * are placeholders for chunk 11g.6's auction state machine, which
 * appends them when the matching `place_bid` / `nominate` actions
 * succeed. System-generated auction events (`auction_paused`,
 * `auction_nomination_expired`, `auction_nomination_closed`,
 * `auction_auto_nominated`, `auction_resumed`,
 * `auction_bid_extends_timer`, `auction_commissioner_override`)
 * extend this union when chunk 11g.6's state machine generates them.
 *
 * `seq` is the per-league monotonic from the `submit_pick_v2` RPC
 * (or chunk 11g.6's auction RPC equivalent). `timestamp` is ISO 8601
 * captured at append time on the server.
 */
export type BufferedDraftEvent =
  | {
      kind: 'pick_submitted';
      seq: number;
      timestamp: string;
      teamId: string;
      playerId: number;
      roundNumber: number;
      pickNumber: number;
      /**
       * Same value as the originating action's `idempotencyKey`,
       * exposed under a client-facing name. Lets the originator's
       * client match the server's broadcast against their optimistic
       * action — they submit a pick with `idempotencyKey=K`, then
       * see an `event` message arrive with `correlationId=K` and
       * settle their optimistic state.
       */
      correlationId: string;
      /**
       * `true` when the pick was server-authored on deadline expiry
       * (chunk 11g.4 step 6c). Mirrors `draft_events.payload.is_autopick`
       * and `actor.kind === 'autopick'`. Surfaces in the ring buffer
       * so client UI can render the "AP" / "Autopick" badge during
       * resync (matches Sleeper / ESPN / Yahoo conventions). Optional
       * for backwards compatibility with pre-6c-buffered events.
       */
      isAutopick?: boolean;
      /**
       * Chunk 10c-2 batch 2 (2026-07-27) — the next pick's deadline,
       * as ISO 8601. Paired with the durable `pick_deadline` field
       * in `draft_events.payload` (migration
       * `20260727010000_pick_event_carries_pick_deadline.sql`). The
       * engine re-arms its own `setPickDeadline` from this value on
       * external-event apply; clients use it symmetrically to re-arm
       * their countdown UI without having to re-fetch a snapshot.
       *
       * Optional: pre-batch-2 buffered events (bootstrap replay of
       * historical v1 rows) don't carry the field. Clients guard on
       * presence and fall back to the snapshot's
       * `stateSnapshot.currentPickDeadline` if missing.
       */
      pickDeadline?: string;
    }
  | {
      /**
       * A previously-recorded pick was rolled back (commissioner
       * action). Step 6b's bootstrap appends this when it encounters
       * a `pick_undone` event in the durable log.
       *
       * `undoneSeq` is the seq of the original `pick_submitted`
       * event being rolled back — clients can correlate the undo
       * to the displayed pick for animation / history rendering.
       */
      kind: 'pick_undone';
      seq: number;
      timestamp: string;
      teamId: string;
      playerId: number;
      roundNumber: number;
      pickNumber: number;
      correlationId: string;
      undoneSeq: number;
    }
  | {
      /**
       * Commissioner-issued pick that bypasses the on-clock check
       * (commissioner has authoritatively decided). Mirrors the
       * `pick_submitted` shape for client-rendering symmetry plus
       * an optional `reason` field for justification text.
       */
      kind: 'commissioner_override';
      seq: number;
      timestamp: string;
      teamId: string;
      playerId: number;
      roundNumber: number;
      pickNumber: number;
      correlationId: string;
      reason?: string;
    }
  | {
      /**
       * Auction nomination begins. Chunk 11g.6 sub-step 6a writes
       * this when a nominator submits via `nominate_player_v2`.
       * `clockDeadline` is the wall-clock ISO timestamp when the
       * bid window expires; engine clears the timer on
       * `auction_nomination_closed`.
       *
       * `playerId` is wire-format string (auction uses TEXT
       * `auction_nominations.player_id`, distinct from snake/linear's
       * int `draft_picks_v2.player_id`).
       */
      kind: 'auction_nomination_started';
      seq: number;
      timestamp: string;
      correlationId: string;
      nominationId: string;
      playerId: string;
      playerName: string;
      nominatorTeamId: string;
      openingBid: number;
      clockDeadline: string;
    }
  | {
      /**
       * Bid placed on the active nomination. `bidAmount` strictly
       * greater than the prior leading bid (RPC + engine both
       * enforce). `clockDeadline` is forward-compat for chunk
       * 11g.6 sub-step 6b's anti-snipe extension; in 6a the
       * deadline doesn't change on bids, so this carries the
       * nomination's original deadline.
       */
      kind: 'auction_bid_placed';
      seq: number;
      timestamp: string;
      correlationId: string;
      nominationId: string;
      bidderTeamId: string;
      bidAmount: number;
      clockDeadline: string;
    }
  | {
      /**
       * Anti-snipe extension fired (chunk 11g.6 sub-step 6b per
       * ADR-002 §3.3 / §4.4). System-derived consequence of a bid
       * that arrived within the final `anti_snipe_threshold_seconds`
       * of the bid window — the window is extended by
       * `anti_snipe_extension_seconds` and a separate event is
       * appended so reconnecting clients can replay the extension
       * during resync.
       *
       * `correlationId` matches the parent bid's idempotency key
       * so the audit trail reads "user X placed bid Y; system
       * extended timer Z" with shared correlation. Same `actor`
       * as the parent bid (the user); the engine treats the
       * extension as a consequence of their action, not a separate
       * engine action — mirrors chunk 11g.4 step 6c's autopick-
       * actor-flow-to-event pattern.
       *
       * `priorClockDeadline` and `newClockDeadline` are wall-clock
       * ISO timestamps. `triggeringBidId` is the durable
       * `draft_events.id` of the parent `auction_bid_placed`
       * event, so clients can correlate extension to bid without
       * relying on payload field equality.
       */
      kind: 'auction_bid_extends_timer';
      seq: number;
      timestamp: string;
      correlationId: string;
      nominationId: string;
      priorClockDeadline: string;
      newClockDeadline: string;
      triggeringBidId: number;
      triggeringBidderTeamId: string;
      triggeringBidAmount: number;
    }
  | {
      /**
       * Bid window expired with NO bids. Engine emits this when a
       * nomination opens, the engine's clock fires, and the
       * leading bid equals the opening bid (no follow-up bids).
       * Chunk 11g.6 sub-step 6a treats this as a no-sale: nominator
       * forfeits their nomination turn but loses no budget.
       */
      kind: 'auction_nomination_expired';
      seq: number;
      timestamp: string;
      nominationId: string;
      reason: 'no_bids';
    }
  | {
      /**
       * Bid window expired WITH a winning bid. RPC awards the
       * player to `winnerTeamId`, decrements their budget by
       * `finalAmount`, increments their `players_won`, INSERTs the
       * `draft_picks` row.
       */
      kind: 'auction_nomination_closed';
      seq: number;
      timestamp: string;
      nominationId: string;
      winnerTeamId: string;
      finalAmount: number;
      totalBids: number;
      playerId: string;
    }
  | {
      /**
       * Commissioner paused the auction (chunk 11g.6 sub-step 6c1
       * per ADR-002 §4.4). The active timer is suspended; new
       * bids and nominations are rejected until `auction_resumed`.
       *
       * `pausedNominationId` and `capturedRemainingSeconds` are
       * present only when there was an active timer at pause
       * time. The captured remaining-seconds value is the
       * source-of-truth for resume math — auction `auction_resumed`
       * restores the timer based on this value. **This diverges
       * from snake/linear's `draft_resumed` which gives a fresh
       * full pick clock**; auction's timers represent all teams'
       * opportunity to react, so restoring remaining-time is
       * fairness-correct.
       *
       * Chunk 11g.6 sub-step 6c3: `pausedTimerKind` discriminates
       * which timer was running so resume restores the correct
       * one. Backward-compat: 6c1-emitted events without this
       * field default to `'bid_window'` (the only timer that
       * existed pre-6c3).
       */
      kind: 'auction_paused';
      seq: number;
      timestamp: string;
      correlationId: string;
      commissionerUserId: string | null;
      reason: string;
      pausedAt: string;
      pausedNominationId?: string;
      capturedRemainingSeconds?: number;
      pausedTimerKind?: 'bid_window' | 'nomination_window';
    }
  | {
      /**
       * Commissioner resumed the auction (chunk 11g.6 sub-step 6c1
       * per ADR-002 §4.4). The bid window resumes from where it
       * stopped (NOT a fresh full window). `restoredNominationId`
       * and `newClockDeadline` are present only when a paused
       * nomination is being unfrozen — `newClockDeadline = now() +
       * captured_remaining_seconds` from the paired pause event.
       *
       * `priorPauseEventId` is the durable `draft_events.id` of
       * the matching `auction_paused` row, so clients can
       * correlate pause/resume pairs without payload-equality
       * checks.
       */
      kind: 'auction_resumed';
      seq: number;
      timestamp: string;
      correlationId: string;
      commissionerUserId: string | null;
      resumedAt: string;
      priorPauseEventId: number;
      restoredNominationId?: string;
      newClockDeadline?: string;
    }
  | {
      /**
       * Engine-fired auto-nominate (chunk 11g.6 sub-step 6c3 per
       * ADR-002 §3.4 + §4.2). Emitted INSTEAD of
       * `auction_nomination_started` when the nomination-window
       * timer expires without the on-clock nominator submitting a
       * choice. Engine selects the player via the chain-of-
       * strategies in `auctionAutoNominateStrategy.ts`, then
       * writes this event with `actor.kind='autopick'`.
       *
       * Carries the full `auction_nomination_started` shape (so
       * bootstrap treats both events symmetrically for state-
       * machine purposes — both set `currentNomination`) PLUS the
       * `fallbackSource` discriminator that records which strategy
       * succeeded for audit trail rendering ("🤖 Auto-nominated
       * by projections").
       */
      kind: 'auction_auto_nominated';
      seq: number;
      timestamp: string;
      correlationId: string;
      nominationId: string;
      playerId: string;
      playerName: string;
      nominatorTeamId: string;
      openingBid: number;
      clockDeadline: string;
      fallbackSource: 'queue' | 'projections' | 'commissioner_preset';
    }
  | {
      /**
       * Nomination skipped (chunk 11g.6 sub-step 6c3). **Path Y
       * extension of ADR-002** — the spec is silent on this case.
       * Two trigger reasons:
       *
       *   - `'insufficient_budget'`: auto-nominator can't afford
       *     even `auctionMinBid + reserve` — engine cascades to
       *     the next nominator without writing a nomination.
       *     Auction continues; nominator forfeits this turn.
       *
       *   - `'no_eligible_players'`: strategy chain exhausted (no
       *     undrafted player available). Per ADR-002 §4.4 this
       *     should pause the draft + alert the commissioner; the
       *     skip event is emitted alongside the pause for audit
       *     clarity.
       *
       * `nominationsCompleted` advances by one in either case so
       * the rotation pointer moves forward.
       */
      kind: 'auction_nomination_skipped';
      seq: number;
      timestamp: string;
      correlationId: string;
      skippedTeamId: string;
      reason: 'insufficient_budget' | 'no_eligible_players';
    }
  | {
      /**
       * Commissioner override (chunk 11g.6 sub-step 6c4 per ADR-002
       * §4.4 + extensions). **Polymorphic discriminator-based event**
       * — a single event variant covers all seven supported override
       * actions; the `overrideAction` field discriminates. Engine
       * bootstrap dispatches on `overrideAction` to per-action APPLY
       * handlers; runtime dispatch in `LobbyManager.processCommissionerOverride`
       * mirrors the apply-handler pattern.
       *
       * **No additional side-effect events are emitted.** A
       * `force_close_nomination` does NOT also emit
       * `auction_nomination_closed`; a `cancel_nomination` does NOT
       * emit a separate cancel event. Engine state mutations match
       * what natural events would have produced (e.g.,
       * `force_close_nomination` mutates `teamBudgets` /
       * `teamPlayersWon` like `auction_nomination_closed` would),
       * but the canonical event in the durable log is this single
       * polymorphic row. Avoids redundant event pairs.
       *
       * **Seven actions ship in 6c4 — extending ADR-002 §4.1's
       * three illustrative actions** (forced nomination, forced
       * close, undo) with a full operational toolbox commissioners
       * need on day 1. Decision Log 2026-05-07 captures the
       * extension rationale.
       *
       * `priorState` and `newState` are action-specific JSONB
       * snapshots for audit reconstruction. Their shapes vary by
       * `overrideAction`; the engine reads them with action-aware
       * field extraction during bootstrap APPLY.
       */
      kind: 'auction_commissioner_override';
      seq: number;
      timestamp: string;
      correlationId: string;
      commissionerUserId: string;
      overrideAction:
        | 'revert_bid'
        | 'force_close_nomination'
        | 'award_to_team'
        | 'adjust_opening_bid'
        | 'adjust_budget'
        | 'cancel_nomination'
        | 'extend_bid_window';
      priorState: Record<string, unknown>;
      newState: Record<string, unknown>;
      rationale?: string;
    }
  | {
      /**
       * F27 (2026-08-07) — draft ignition. Emitted by `start_draft_v2`
       * as `seq=1` of every draft (docs/DESIGN_F27_start_draft_v2.md,
       * commit c8aabe32). Payload mirrors the durable event's §6.4
       * required fields, exposed on the wire so late-connecting clients
       * can arm their countdown UI from `firstPickDeadline` without
       * waiting for a snapshot fetch.
       *
       * REVERSAL of the 2026-07-21 Decision Log's "no wire
       * representation for lifecycle events" default. F27's Rider 4
       * requires an observing client to receive this frame (assert C /
       * assert F for mid-draft-join contiguity). Frame is appended to
       * the ring buffer by `applyEventDuringBootstrap`'s `draft_started`
       * case (F27 engine PR); central broadcast path at
       * LobbyManager.ts:5519-5531's tail check then fires.
       *
       * SCOPE NOTE (v1). Seq-1 draft_started via buffer is UNREACHABLE
       * for the observing client in v1 — discovery refuses pre-start
       * joins, so no lobby predates ignition and no client can be
       * listening when seq 1 lands. The frame's utility is for late-
       * joiners whose resync window includes the seq-1 range (rare in
       * practice; snapshot covers started state directly) AND for the
       * F27 lifecycle-acceptance rig's observing harness client which
       * connects before ignition specifically to prove the broadcast
       * fires (Rider 4 assert C).
       */
      kind: 'draft_started';
      seq: number;
      timestamp: string;
      correlationId: string;
      startedAt: string;
      firstPickDeadline: string;
      totalRounds: number;
      totalTeams: number;
      pickTimeLimitSeconds: number;
      draftFormat: DraftFormat;
    }
  | {
      /**
       * F26 / KI-035 (2026-08-07) — draft completion. Emitted by
       * `submit_pick_v2`'s completion branch (F24 emitter). Signals
       * clients to render "draft complete" UI + stop rendering the
       * timer. Payload mirrors §6.8.
       *
       * F24 acceptance (2026-08-05) surfaced KI-035: this frame was
       * invisible to observers because the external-apply case at
       * LobbyManager.ts:2833-2835 mutated state (`this.draftStatus =
       * 'completed'`) but did NOT append to `this.events` ring
       * buffer. The central broadcast path at LobbyManager.ts:5519-5531
       * conditions on `peekLast().seq === event.seq` — with no append,
       * tail check fails silently, no frame lands on the wire. F26
       * reverses this: the case now appends a BufferedDraftEvent of
       * `kind: 'draft_completed'` shape (this variant), triggers the
       * broadcast, AND cancels the armed pick timer (mirroring the
       * internal-path teardown at LobbyManager.ts:1826-1832).
       *
       * Client-side handling: today's client dispatchers (deriveDraftState
       * at line 198; store applyEvent at line 260; optimistic at line
       * 108) are tolerant — no default clause, no assertNever, unknown
       * kinds no-op silently. Adding this variant is safe for the
       * currently-deployed web build (Phase 5 UI wires actual completion
       * rendering).
       */
      kind: 'draft_completed';
      seq: number;
      timestamp: string;
      correlationId: string;
      completedAt: string;
      totalPicks: number;
    };

// ── Snapshot payloads ──────────────────────────────────────────────

/**
 * Bare state-machine view of a lobby's current draft state. Returned
 * by `LobbyManager.getCurrentState()` on the server; nested in
 * `DraftSnapshot` when delivered over the wire.
 *
 * `onClockTeamId` is `null` when the draft is `not_started` or
 * `completed`. During `in_progress`, it's always the team whose pick
 * is at index `picksMade` of the draft order.
 *
 * `currentPickDeadline` is a wall-clock ISO timestamp; `null` when
 * no team is on the clock or the draft is `paused`. Clients use it
 * to render countdown UI without relying on the local clock as
 * authoritative (server time is the source of truth — local clock
 * smooths between server ticks per `PHASE_4_5_ARCHITECTURE.md`
 * line 176).
 */
export interface DraftStateSnapshot {
  currentPickNumber: number | null;
  currentRoundNumber: number | null;
  onClockTeamId: string | null;
  totalPicks: number;
  picksMade: number;
  draftStatus: LobbyStatus;
  currentPickDeadline: string | null;
}

/**
 * Auction-specific state carried in the wire snapshot for auction-
 * format lobbies. `undefined` for snake/linear (chunk 11g.5b's v2
 * UI ignores). Populated by `LobbyManager.getCurrentState()` for
 * `format === 'auction'` per chunk 11g.6 sub-step 6a.
 *
 * `currentNomination` is `null` between nominations and after the
 * auction completes; non-null while a nomination is active.
 *
 * `teamBudgets` and `teamRosterSlotsRemaining` are keyed by team
 * UUID. Match `auction_budgets.remaining_budget` (cents-as-int /
 * NUMERIC) and `(rosterSize - players_won)` respectively.
 */
export interface AuctionStateSnapshot {
  currentNomination: {
    nominationId: string;
    playerId: string;
    nominatorTeamId: string;
    leadingBidderId: string;
    leadingBid: number;
    clockDeadline: string;
  } | null;
  teamBudgets: Record<string, number>;
  teamRosterSlotsRemaining: Record<string, number>;
  nominationsCompleted: number;
}

/**
 * Minimal client-facing snapshot of a lobby's current state.
 * Carried in the `snapshot` server message (sent on first connect)
 * and the chunk-11g.5 fallback HTTP snapshot endpoint (when the
 * resync ring buffer is too_old).
 *
 * Chunk 11g.6 sub-step 6a adds `auctionState` for auction-format
 * lobbies; snake/linear leave it `undefined`.
 */
export interface DraftSnapshot {
  lobbyId: string;
  format: DraftFormat;
  recentEvents: ReadonlyArray<BufferedDraftEvent>;
  stateSnapshot: DraftStateSnapshot;
  auctionState?: AuctionStateSnapshot;
  /**
   * DR-4 (2026-07-30) — the userIds present in the lobby at snapshot
   * build time, including the connecting client itself. Fixes the
   * DR-1 presence-count-anomaly: without this, a newly-connecting
   * client's presentUserIds Set stays empty until an EXTERNAL join
   * event fires, so the first client sees 0 (their own presence not
   * counted). The client's `setSnapshot` seeds `presentUserIds` from
   * this array. Optional for backwards compatibility with servers on
   * older wire versions — clients treat `undefined` as an empty
   * seed and rely on subsequent presence events to populate.
   *
   * Server contract (LobbyManager.addConnection): the connecting
   * user's id is added to the internal `presentUserIds` Set BEFORE
   * the snapshot is built, so the snapshot always includes self.
   */
  presentUserIds?: ReadonlyArray<string>;
}

// ── Wire envelope ──────────────────────────────────────────────────

/**
 * Current wire-protocol version. Bump when the envelope shape or
 * required fields change. Clients gate on this — older clients
 * receiving a higher `v` should reconnect with a forced upgrade
 * prompt rather than silently mishandling unknown fields.
 *
 * Adding new variants to `DraftServerMessage` does NOT require a
 * version bump (forward-compatible: clients ignore unknown variants).
 * Renaming or removing fields, or changing semantic meaning, does.
 */
export const WIRE_PROTOCOL_VERSION = 1 as const;

/**
 * Discriminated union of server-to-client messages.
 *
 * Every variant shares the wire envelope:
 *   - `v`: protocol version (always `1` today)
 *   - `type`: discriminant
 *   - `seq?`: per-league monotonic, present for `event`; absent
 *     elsewhere (presence/snapshot/resync_response/error are not
 *     sequenced — they're either snapshots or transient signals)
 *   - `timestamp`: ISO 8601 server-side capture
 *   - `correlationId?`: present on `event` variants that originated
 *     from a client action (mirrors `payload.correlationId`); absent
 *     for system-generated events, snapshots, presence, error
 *   - `payload`: variant-specific
 *
 * Wire format: JSON. Clients parse via `JSON.parse` then narrow
 * on `type`.
 */
export type DraftServerMessage =
  | {
      v: typeof WIRE_PROTOCOL_VERSION;
      type: 'event';
      seq: number;
      timestamp: string;
      correlationId: string;
      payload: BufferedDraftEvent;
    }
  | {
      v: typeof WIRE_PROTOCOL_VERSION;
      type: 'snapshot';
      timestamp: string;
      payload: DraftSnapshot;
    }
  | {
      v: typeof WIRE_PROTOCOL_VERSION;
      type: 'presence';
      timestamp: string;
      payload: {
        kind: 'joined' | 'left';
        userId: string;
        presentUserIds: string[];
      };
    }
  | {
      v: typeof WIRE_PROTOCOL_VERSION;
      type: 'resync_response';
      timestamp: string;
      payload:
        | { ok: true; events: ReadonlyArray<BufferedDraftEvent> }
        | { ok: false; reason: 'too_old'; oldestAvailableSeq: number };
    }
  | {
      v: typeof WIRE_PROTOCOL_VERSION;
      type: 'error';
      timestamp: string;
      payload: { code: string; message: string };
    }
  | {
      /**
       * Chunk 11g.10 — application-level pong. Echoes the client-supplied
       * `t` (client wall-clock at ping-send) so the client can compute
       * round-trip latency AND detect missed responses (its own watchdog
       * counts consecutive missed pongs).
       *
       * Distinct from uWS's protocol-level ping/pong (which browsers
       * respond to internally per RFC 6455 §5.5.2 — a JS runtime cannot
       * observe those). This is an APPLICATION message parsed by the
       * client's onmessage handler; the browser doesn't invent it.
       *
       * Server-side handler in `uws-helpers.handleClientMessage` responds
       * immediately without touching lobby state.
       */
      v: typeof WIRE_PROTOCOL_VERSION;
      type: 'pong';
      timestamp: string;
      payload: { t: number };
    };

/**
 * Discriminated union of client-to-server messages.
 *
 * Variants:
 *   - `resync` (chunk 11g.5): reconnect resume protocol primitive.
 *     Server-side handler: `LobbyManager.handleResyncRequest`.
 *   - `ping` (chunk 11g.10): client-driven liveness watchdog. Server
 *     responds with a `pong` server message echoing `t`. See the
 *     `pong` DraftServerMessage variant for the round-trip semantics.
 *     Pick submissions, bids, nominations do NOT route through this
 *     union — they use `LobbyManager.enqueueAction` directly via
 *     `DraftAction` because they need server-issued correlation IDs
 *     and structured validation the action API provides.
 */
export type DraftClientMessage =
  | {
      type: 'resync';
      payload: { sinceSeq: number };
    }
  | {
      type: 'ping';
      payload: { t: number };
    };
