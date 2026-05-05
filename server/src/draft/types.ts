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
 * durable event id (assigned by the `submit_pick_v2` / equivalent
 * RPC); failure carries a typed reason code so client UI can
 * display structured error messages.
 *
 * Reason codes are placeholders today — the full set is finalized
 * in step 2 alongside the queue + dispatch implementation.
 * `'not_yet_implemented'` is the step-1 stub's reason.
 */
export type DraftActionResult =
  | { ok: true; eventId: string }
  | {
      ok: false;
      reason:
        | 'not_on_clock'
        | 'duplicate_idempotency_key'
        | 'invalid_state'
        | 'wrong_team'
        | 'not_yet_implemented';
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
