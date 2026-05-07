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
 * `DraftFormat` lives in `@citrus/shared` (chunk 11g.5a moved
 * cross-boundary types out of server-only space). Re-exported here
 * so existing server imports keep working without churn.
 */
export type { DraftFormat } from '@citrus/shared';

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
      /**
       * Auction nomination — chunk 11g.6 sub-step 6a. The nominator
       * proposes a player at an opening bid; the engine starts the
       * bid window on success.
       *
       * `playerId` is wire-format string (matches auction's TEXT
       * `auction_nominations.player_id` column, distinct from
       * snake/linear's int `draft_picks_v2.player_id`).
       *
       * `playerName` is captured at the action layer so the engine
       * can write the canonical player name to
       * `auction_nominations.player_name` without an extra DB
       * lookup. Client provides this from its player-pool view.
       */
      kind: 'nominate';
      teamId: string;
      playerId: string;
      playerName: string;
      openingBid: number;
      userId: string;
      sessionId: string;
      idempotencyKey: string;
      actorKind?: 'user' | 'autopick';
    }
  | {
      /**
       * Auction bid placement — chunk 11g.6 sub-step 6a. Bid must
       * be strictly greater than the current leading bid and meet
       * the minimum-increment rule (flat $1 in 6a; tiered increments
       * 6c). Engine validates budget reserve before calling RPC.
       */
      kind: 'place_bid';
      teamId: string;
      nominationId: string;
      bidAmount: number;
      userId: string;
      sessionId: string;
      idempotencyKey: string;
      actorKind?: 'user' | 'autopick';
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
        | 'invalid_payload'
        // Auction-specific rejection reasons (chunk 11g.6 sub-step 6a).
        | 'nomination_already_active'
        | 'no_active_nomination'
        | 'bid_too_low'
        | 'bid_increment_violation'
        | 'insufficient_budget'
        // Chunk 11g.6 sub-step 6c1 (auction pause/resume): explicit
        // typed rejection so clients can render "Auction paused —
        // bids reopen on resume" toast instead of generic
        // 'invalid_state'. Engine fail-fast in processPlaceBid /
        // processNominate during pauseState !== null.
        | 'auction_paused'
        // Chunk 11g.6 sub-step 6c4 (auction commissioner override):
        // typed rejection reasons for the seven override actions.
        // Each reason maps to a specific failure mode of one or
        // more override actions; clients can render actionable
        // errors per the action attempted.
        | 'no_bids_to_revert'
        | 'insufficient_budget_for_award'
        | 'opening_bid_below_current_leading'
        | 'extension_below_current_deadline'
        | 'insufficient_budget_for_floor_increase';
      /**
       * Chunk 11g.6 sub-step 6c2: when `reason ===
       * 'bid_increment_violation'`, engine populates the computed
       * minimum-next-bid so clients can render the actionable error
       * "Minimum next bid: $X" instead of a generic increment
       * violation. Optional because the field is only meaningful
       * for that one reason value (and RPC-side admin rejections
       * don't go through the engine path that knows the value).
       */
      minimumNextBid?: number;
    };

/**
 * `BufferedDraftEvent` lives in `@citrus/shared` (chunk 11g.5a
 * moved cross-boundary types). Re-exported here so existing server
 * imports keep working without churn.
 */
export type { BufferedDraftEvent } from '@citrus/shared';

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
import type { BufferedDraftEvent as _BufferedDraftEvent } from '@citrus/shared';
export type GetEventsSinceSeqResult = GetSinceSeqResult<_BufferedDraftEvent>;

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
 * `LobbyStatus` and `DraftStateSnapshot` live in `@citrus/shared`
 * (chunk 11g.5a moved cross-boundary types). Re-exported here as
 * `DraftStatus` to preserve the existing engine-facing name —
 * `LobbyStatus` is the canonical name in the wire types because
 * `DraftStatus` already meant a different (product-level) enum in
 * `league.ts`. The engine's lifecycle alias stays `DraftStatus`
 * server-side; the cross-boundary export is `LobbyStatus`.
 */
export type { LobbyStatus as DraftStatus, DraftStateSnapshot } from '@citrus/shared';

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
 * Discriminated union returned by the engine-side
 * `verifyCommissionerAuthorization` callback (chunk 11g.6 sub-step
 * 6c4 per ADR-002 §4.4 + ADR-004 §5). Engine MUST verify
 * commissioner authority before calling
 * `auction_commissioner_override_v2` with `actor.kind='commissioner'`.
 *
 * Today's `index.ts` implementation queries `leagues.commissioner_id`
 * directly; same `service_role` bypass pattern as
 * `verifyTeamAuthorization`. Engine logs the granular `reason` at
 * info level for observability but returns coarse-grained
 * `'unauthorized'` to the client (no information disclosure).
 */
export type CommissionerAuthorizationResult =
  | { authorized: true }
  | {
      authorized: false;
      reason: 'not_commissioner' | 'league_not_found';
    };

/**
 * `DraftSnapshot` and `AuctionStateSnapshot` live in
 * `@citrus/shared` (chunk 11g.5a moved cross-boundary types;
 * chunk 11g.6 sub-step 6a added `AuctionStateSnapshot`).
 * Re-exported here so existing server imports keep working
 * without churn.
 */
export type { DraftSnapshot, AuctionStateSnapshot } from '@citrus/shared';

// ── Wire protocol (chunk 11g.5a moved to @citrus/shared) ───────────
//
// `WIRE_PROTOCOL_VERSION`, `DraftServerMessage`, and
// `DraftClientMessage` live in `packages/shared/src/types/draftWire.ts`
// so the client can import them too. Re-exported here so existing
// server imports keep working without churn.

export { WIRE_PROTOCOL_VERSION } from '@citrus/shared';
export type { DraftServerMessage, DraftClientMessage } from '@citrus/shared';
import type {
  DraftServerMessage as _DraftServerMessage,
  DraftClientMessage as _DraftClientMessage,
} from '@citrus/shared';

/**
 * Serialize a server-to-client message to its wire form. Pure JSON
 * encoding today; centralized so future encoding changes (e.g.,
 * MessagePack for bandwidth) live in one place.
 */
export function serializeServerMessage(msg: _DraftServerMessage): string {
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
export function parseClientMessage(raw: string): _DraftClientMessage | null {
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
