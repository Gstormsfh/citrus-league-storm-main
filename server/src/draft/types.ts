// Phase 4.5 chunk 11g.4 — LobbyManager type definitions.
//
// Co-located here so the LobbyManager class file stays focused on
// behavior. uws-server.ts imports DraftSocketUserData from this
// module rather than declaring its own copy.
//
// Step 3 added the BufferedDraftEvent + GetEventsSinceSeqResult
// types backing the recent-events ring buffer and chunk 11g.5's
// resume protocol.
//
// Step 5 added the wire-protocol layer: DraftServerMessage (the
// envelope every server-to-client message uses) + DraftClientMessage
// (incoming client requests, resync only for now), plus the
// serializeServerMessage / parseClientMessage helpers. The wire
// envelope is forward-compatible: a top-level `v: 1` lets future
// protocol revisions coexist; new variants extend the discriminated
// union without breaking existing clients.
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; LobbyManager
// principles), docs/adr/ADR-002-auction-state-machine.md (auction
// state machine — auction-specific DraftAction variants), and
// server/src/lib/draftToken.ts (the JWT contract that produces
// DraftSocketUserData).

import type { GetSinceSeqResult } from './RingBuffer';

/**
 * Per-connection metadata attached during JWT validation in the
 * uws-server.ts upgrade handler. Read off the uWS WebSocket via
 * `ws.getUserData()` in chunk 11g.4 step 4+ message handlers.
 *
 * Field origin: every field except `expiresAt` comes from the
 * verified JWT claims (sub/draftId/leagueId per
 * `server/src/lib/draftToken.ts` `DraftTokenClaims`). `lobbyId`
 * is the URL path parameter, which `verifyDraftToken` confirms
 * matches the token's `draftId` claim. `expiresAt` is the JWT's
 * `exp` claim — useful for connection-renewal logic later.
 */
export interface DraftSocketUserData {
  lobbyId: string;
  userId: string;
  leagueId: string;
  draftId: string;
  expiresAt: number;
}

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
 * Discriminated union of mutating actions a connected client can
 * submit through the LobbyManager. Every action carries an
 * idempotency key (UUID) so retries (mobile network blips,
 * duplicate-clicks) collapse to one durable event in chunk 11g.4
 * step 2+ and do not produce duplicate `draft_events` rows.
 *
 * Actions route through the single-writer queue (step 2) and
 * produce events in the ring buffer (step 3) + `draft_events`
 * Postgres table (step 5).
 *
 * `playerId` is wire-format string. Snake/linear actions get
 * parsed to int at the `submit_pick_v2` RPC boundary in step 2;
 * auction actions keep them as strings (matches v1's
 * `auction_nominations.player_id` TEXT column).
 *
 * See ADR-002 §4.1 for the full event-types catalog.
 */
export type DraftAction =
  | {
      kind: 'submit_pick';
      teamId: string;
      playerId: string;
      /**
       * The user submitting the pick. Sourced from the connected
       * client's `DraftSocketUserData.userId` (which is sourced
       * from the JWT's `sub` claim — see `lib/draftToken.ts`).
       * Used by `LobbyManager.processSubmitPick` to construct the
       * actor envelope for `submit_pick_v2` RPC calls.
       *
       * For engine-authored autopick actions
       * (`actorKind === 'autopick'`), the engine populates this
       * with a synthetic identifier (e.g. `'autopick-engine'`) so
       * the durable audit trail records the engine as the actor.
       */
      userId: string;
      /**
       * Per-connection session identifier. Sourced from the WS
       * upgrade flow. Used for the actor's `session_id` field
       * and the RPC's `p_session_id` parameter — ties pick events
       * to their originating WS session for tracing.
       *
       * For autopick actions: a per-call generated UUID; ties the
       * autopick fire to its trigger event in the audit trail.
       */
      sessionId: string;
      idempotencyKey: string;
      /**
       * Discriminator: `'user'` (default — submitted by a connected
       * client through the WS message handler) or `'autopick'`
       * (engine-authored, fires on pick-deadline expiry). Defaults
       * to `'user'` if absent for backwards compatibility.
       *
       * **Auth-skip when `'autopick'`:** `processSubmitPick`
       * bypasses the engine-side `verifyTeamAuthorization` callback
       * for autopick actions per ADR-004 §5's trusted-executor
       * extension — the engine is the trusted author of these
       * actions. The on-clock check still runs as a defensive
       * guard against bugs constructing autopick actions for the
       * wrong team.
       *
       * **Wire-format note:** the durable `draft_events.actor.kind`
       * matches this value (`'user'` or `'autopick'`); the persisted
       * `payload.is_autopick` boolean mirrors `actorKind === 'autopick'`.
       */
      actorKind?: 'user' | 'autopick';
    }
  | {
      kind: 'place_bid';
      teamId: string;
      nominationId: string;
      bidAmount: number;
      idempotencyKey: string;
    }
  | {
      kind: 'nominate';
      teamId: string;
      playerId: string;
      openingBid: number;
      idempotencyKey: string;
    };

/**
 * Result of `LobbyManager.enqueueAction`. Success carries the
 * per-league monotonic seq (the `seq` returned by `submit_pick_v2`
 * / equivalent RPC) so clients can use it as a `since_seq`
 * resume cursor for chunk 11g.5's reconnect protocol. Failure
 * carries a typed reason code so client UI can display
 * structured error messages.
 *
 * Reason enum mirrors the `submit_pick_v2` RPC error surface
 * (mapped from `RAISE EXCEPTION` prefixes via
 * `DraftServiceV2.mapRpcError` → `AppError.message` →
 * `LobbyManager.mapAppErrorToReason`). Three reasons are
 * LobbyManager-specific (not from the RPC):
 *   - `'not_yet_implemented_chunk_11g6'`: auction action
 *     variants (`place_bid`, `nominate`) are stubs until the
 *     auction state machine lands in chunk 11g.6.
 *   - `'wrong_format_for_action'`: caller submitted a snake/
 *     linear `submit_pick` against an auction-format lobby
 *     (or vice versa once auction handlers exist).
 *   - `'internal_error'`: `processAction` threw or the queue
 *     hit an unexpected runtime error. Logged at error level.
 */
export type DraftActionResult =
  | { ok: true; eventSeq: number }
  | {
      ok: false;
      reason:
        | 'not_yet_implemented_chunk_11g6'
        | 'wrong_format_for_action'
        | 'internal_error'
        | 'not_on_clock'
        | 'player_taken'
        | 'pick_out_of_order'
        | 'idempotency_conflict'
        | 'unauthorized'
        | 'invalid_state'
        | 'invalid_payload';
    };

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
 *
 * `idempotencyKey` is intentionally excluded — server-internal
 * concern for the durable event log, not relevant to client UI.
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
       *
       * Step 3 deliberately excluded the idempotency key as a
       * "server-internal concern"; step 5 reverses that decision
       * because the resync path needs to deliver the correlation
       * context the same way the live broadcast does (otherwise
       * resync events can't settle optimistic state on the client
       * that submitted them).
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
       *
       * On the in-memory state machine: bootstrap decrements
       * `picksMade` by 1 and may transition `draftStatus` from
       * `completed` back to `in_progress` (or from `in_progress`
       * back to `not_started` if it was the only pick).
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
       * (commissioner has authoritatively decided). Step 6b's
       * bootstrap appends this when it encounters a
       * `commissioner_override` event; mirrors the `pick_submitted`
       * shape for client-rendering symmetry plus an optional
       * `reason` field for justification text.
       *
       * On the in-memory state machine: advances `picksMade` like
       * a regular pick. The on-clock check is skipped during
       * bootstrap (and would be skipped at the action layer too if
       * the engine ever exposed a commissioner-override action,
       * which it currently does not — picks come only from
       * `submit_pick_v2`).
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
      kind: 'auction_bid_placed';
      seq: number;
      timestamp: string;
      nominationId: string;
      teamId: string;
      bidAmount: number;
    }
  | {
      kind: 'auction_nomination_started';
      seq: number;
      timestamp: string;
      nominationId: string;
      playerId: string;
      openingBid: number;
      nominatorTeamId: string;
    };

/**
 * Result of `LobbyManager.getEventsSinceSeq` (and the underlying
 * `RingBuffer.getEventsSinceSeq`). Used by chunk 11g.5's reconnect
 * protocol: client sends `last_seen_seq`, server replies with either
 * the events strictly after that seq, or a `too_old` signal telling
 * the client to fall back to a full snapshot resync from Postgres.
 *
 * Eviction-aware semantic: an empty buffer returns `ok: true` with
 * `events: []` (fresh lobby — client is up to date by definition).
 * `too_old` only fires when the buffer has actually evicted events
 * the client wanted, i.e. the buffer has reached capacity AND the
 * client's `sinceSeq` is below the current oldest seq.
 */
export type GetEventsSinceSeqResult = GetSinceSeqResult<BufferedDraftEvent>;

// ── State machine (step 6a) ────────────────────────────────────────

/**
 * One pick slot in the pre-computed draft order. Snake/linear are
 * pre-flattened into a list of slots — the slot's `round` and
 * `pickNumber` already account for snake reversal (even rounds have
 * teams listed in reverse order). The state machine consumes the
 * list directly without computing reversal at pick time.
 *
 * Source of truth: the existing v1 `public.draft_order` Postgres
 * table (one row per round, `team_order` JSONB array per row).
 * `lobbyConfigLookup` in `index.ts` flattens the rows into this
 * shape at LobbyManager construction time. The same data feeds
 * `submit_pick_v2`'s on-clock check (per migration line 783-799),
 * so the engine and the RPC validate against an identical view.
 *
 * `format` is intentionally NOT carried per-slot — the format
 * discriminator lives on the LobbyManager itself; the snake-vs-linear
 * difference is already baked into the round-by-round teamId
 * ordering.
 */
export interface DraftOrderSlot {
  round: number;
  pickNumber: number;
  teamId: string;
}

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
export type DraftStatus = 'not_started' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Bare state-machine view of a lobby's current draft state. Returned
 * by `LobbyManager.getCurrentState()` for diagnostics, observability,
 * and direct test access. Distinct from `DraftSnapshot` (the wire-
 * envelope shape) so internal callers don't pay the wire-format
 * shaping cost when they only need the state values.
 *
 * `onClockTeamId` is `null` when the draft is `not_started` or
 * `completed`. During `in_progress`, it's always the team whose pick
 * is at index `picksMade` of the draft order.
 */
export interface DraftStateSnapshot {
  currentPickNumber: number | null;
  currentRoundNumber: number | null;
  onClockTeamId: string | null;
  totalPicks: number;
  picksMade: number;
  draftStatus: DraftStatus;
  /**
   * Wall-clock ISO timestamp when the on-clock pick's deadline
   * expires. `null` when no team is on the clock (`not_started`,
   * `completed`, `cancelled`) or when the draft is `paused`.
   * Chunk 11g.4 step 6c populates this from the LobbyManager's
   * timer state; clients use it to render countdown UI without
   * relying on the local clock as authoritative (server time is
   * the source of truth — local clock smooths between server
   * ticks per `PHASE_4_5_ARCHITECTURE.md` line 176).
   */
  currentPickDeadline: string | null;
}

/**
 * Discriminated union returned by the engine-side
 * `verifyTeamAuthorization` callback (per ADR-004 §5.3 — engine MUST
 * verify team authorization before calling `submit_pick_v2` with
 * `actor.kind = 'user'`).
 *
 * Today's `index.ts` implementation only emits `'not_owner'` and
 * `'team_not_found'` (queries `teams.owner_id` directly). The richer
 * `'team_archived'` and `'co_manager_disabled'` reasons are forward-
 * compat for ADR-003 Phase 2's `team_authorized()` SQL helper —
 * which can distinguish "user is a co-manager but co-managers are
 * disabled for this league" from "user has no relationship to this
 * team at all." Adding the shape now keeps that integration a
 * drop-in rather than a callback-signature refactor.
 *
 * **Wire-side handling:** the engine logs the granular `reason` at
 * info level for observability, but returns the coarse-grained
 * `'unauthorized'` to the client to avoid information disclosure
 * (clients should not differentiate on the auth-failure mode).
 */
export type TeamAuthorizationResult =
  | { authorized: true }
  | {
      authorized: false;
      reason: 'not_owner' | 'team_not_found' | 'team_archived' | 'co_manager_disabled';
    };

/**
 * Minimal client-facing snapshot of a lobby's current state.
 *
 * Steps 1-3 returned identity fields plus the recent-events ring
 * buffer; step 6a adds the state-machine view (`stateSnapshot`)
 * carrying current pick / round / on-clock team. Future steps:
 *   - 6c: pick deadline + remaining seconds
 *   - 11g.6 / ADR-002: format-specific auction state (current
 *     nomination + budgets) layered on top
 */
export interface DraftSnapshot {
  lobbyId: string;
  format: DraftFormat;
  recentEvents: ReadonlyArray<BufferedDraftEvent>;
  stateSnapshot: DraftStateSnapshot;
}

// ── Wire protocol (step 5) ─────────────────────────────────────────

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
 * Wire format: serialized as JSON via `serializeServerMessage`.
 * Clients parse via `JSON.parse` then narrow on `type`.
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
    };

/**
 * Discriminated union of client-to-server messages.
 *
 * Today: only `resync` (chunk 11g.5's reconnect protocol primitive
 * is the server-side `handleResyncRequest`; the client lives in
 * chunk 11g.5). Pick submissions, bids, nominations route through
 * `LobbyManager.enqueueAction` directly via `DraftAction`, NOT
 * through this wire union — they require server-issued correlation
 * IDs and structured validation that the action API provides.
 */
export type DraftClientMessage = {
  type: 'resync';
  payload: { sinceSeq: number };
};

/**
 * Serialize a server-to-client message to its wire form. Pure JSON
 * encoding today; centralized so future encoding changes (e.g.,
 * MessagePack for bandwidth) live in one place.
 */
export function serializeServerMessage(msg: DraftServerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Parse and validate a raw client message. Returns the typed
 * message on success, `null` on any failure (JSON parse error,
 * missing/invalid fields, unknown `type`). Callers should log at
 * debug level and ignore — never raise to the user, since malformed
 * input from the wire is not actionable client-side.
 *
 * Validation is intentionally minimal — only enough to safely
 * dispatch. Deep field validation belongs in the action handlers
 * (which already validate via Zod / typed payload checks).
 */
export function parseClientMessage(raw: string): DraftClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    typeof (parsed as { type?: unknown }).type !== 'string'
  ) {
    return null;
  }

  const obj = parsed as { type: string; payload?: unknown };

  if (obj.type === 'resync') {
    const payload = obj.payload;
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('sinceSeq' in payload) ||
      typeof (payload as { sinceSeq?: unknown }).sinceSeq !== 'number' ||
      !Number.isFinite((payload as { sinceSeq: number }).sinceSeq)
    ) {
      return null;
    }
    return {
      type: 'resync',
      payload: { sinceSeq: (payload as { sinceSeq: number }).sinceSeq },
    };
  }

  return null;
}
