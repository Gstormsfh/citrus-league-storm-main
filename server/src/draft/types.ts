// Phase 4.5 chunk 11g.4 step 1 — LobbyManager type definitions.
//
// Co-located here so the LobbyManager class file stays focused on
// behavior. uws-server.ts imports DraftSocketUserData from this
// module rather than declaring its own copy.
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; LobbyManager
// principles), docs/adr/ADR-002-auction-state-machine.md (auction
// state machine — auction-specific DraftAction variants), and
// server/src/lib/draftToken.ts (the JWT contract that produces
// DraftSocketUserData).

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
       */
      userId: string;
      /**
       * Per-connection session identifier. Sourced from the WS
       * upgrade flow. Used for the actor's `session_id` field
       * and the RPC's `p_session_id` parameter — ties pick events
       * to their originating WS session for tracing.
       */
      sessionId: string;
      idempotencyKey: string;
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
 * Minimal client-facing snapshot of a lobby's current state.
 *
 * Step 1 returns identity fields only (`lobbyId`, `format`) plus
 * an empty `recentEvents` list. Steps 3-6 expand this to include:
 *   - `currentPick`: pick number + on-clock team
 *   - `timer`: pick deadline + remaining seconds
 *   - `recentEvents`: ring-buffer contents (step 3, ~200 events)
 *   - `candidatePool`: cached available players (step 5)
 *   - format-specific state: current nomination + budgets (auction)
 */
export interface DraftSnapshot {
  lobbyId: string;
  format: DraftFormat;
  recentEvents: ReadonlyArray<unknown>;
}
