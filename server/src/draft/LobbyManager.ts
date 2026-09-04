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
import { structuredLogger } from '@citrus/shared';
import { AppError } from '../lib/errors';
import {
  DraftServiceV2,
  type DraftEventRow,
  type DraftV2Actor,
  type SubmitPickResult,
} from '../services/DraftServiceV2';
import { createHash, randomUUID } from 'node:crypto';
import { getPushService } from '../services/PushService';

/**
 * Derive a deterministic UUID-formatted string from a seed via MD5
 * hashing. Used by chunk 11g.6 sub-step 6c3 for engine-fired
 * auto-nominate / skip idempotency keys. Same pattern as the SQL
 * migration's `md5('extends:'||...)::uuid` derivation in 6b.
 *
 * Output format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (32 hex
 * chars + 4 hyphens; the column type is uuid so the format must
 * match Postgres' uuid parser).
 */
/**
 * ENGINE-EAR v3 Slice 1 item 6 (E106, 2026-08-11) — INSTANT-AUTOPICK
 * arm window for on-clock teams with `owner_id IS NULL`. 2 seconds
 * gives just enough headroom for the pick_submitted broadcast +
 * client re-arm to land before the autopick fires (metronome
 * measured at 74-75ms notify→broadcast in LOAD-1-NIGHT; ~2s covers
 * the p99 with margin) while feeling "instant" to observers.
 */
const INSTANT_AUTOPICK_ARM_MS = 2_000;

function md5UuidFromSeed(seed: string): string {
  const hex = createHash('md5').update(seed).digest('hex');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20, 32)
  );
}
import { RingBuffer } from './RingBuffer';
import {
  selectAutopickPlayer,
  type AutopickStrategy,
} from './autopickStrategy';
import { computeMinimumNextBid } from './auctionBidIncrement';
import {
  ENGINE_SNAPSHOT_VERSION,
  deserializeEngineState,
  findMaxEventSeq,
  findMinEventSeq,
  readMostRecentSnapshot,
  serializeEngineState,
  validateSnapshotForBootstrap,
  writeSnapshot,
  type SnapshotRecord,
} from './snapshotPersistence';
import { buildSnapshot } from '../services/snapshotService';
import {
  selectAuctionAutoNominate,
  type AuctionAutoNominateStrategy,
} from './auctionAutoNominateStrategy';
import {
  serializeServerMessage,
  WIRE_PROTOCOL_VERSION,
  type AuctionStateSnapshot,
  type BufferedDraftEvent,
  type CommissionerAuthorizationResult,
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
import type { CommissionerOverrideAction } from '../services/DraftServiceV2';

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
   * Engine-side commissioner-authorization callback per ADR-004 §5
   * + ADR-002 §4.4 (chunk 11g.6 sub-step 6c4). Verifies that
   * `userId` is the league's commissioner BEFORE the engine calls
   * `auction_commissioner_override_v2` with `actor.kind='commissioner'`.
   * Required for the trusted-executor contract — RPC's relaxed
   * permission check (service_role + actor.kind='commissioner')
   * trusts the engine to have done this verification.
   *
   * Today's `index.ts` implementation queries `leagues.commissioner_id`
   * directly; parallel structure to `verifyTeamAuthorization`. The
   * callback returns a discriminated union; engine logs granular
   * reason at info level but returns coarse-grained
   * `'unauthorized'` to the client.
   */
  verifyCommissionerAuthorization: (
    userId: string,
    leagueId: string,
  ) => Promise<CommissionerAuthorizationResult>;

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
  /**
   * Tiered minimum-bid-increment table (chunk 11g.6 sub-step 6c2
   * per ADR-002 §4.3). Engine threads through to every
   * `place_bid_v2` call AND uses for fail-fast rejection in
   * `processPlaceBid`. Default = flat $1 preserves v1 behavior.
   * Snake/linear lobbies pass the default (unused).
   */
  auctionMinBidIncrementTiers: ReadonlyArray<{ below: number; increment: number }>;
  /**
   * Auction bid-window duration in seconds (chunk 11g.6 sub-step
   * 6c3 per ADR-002 §3.4 default 30). Pre-launch rename of legacy
   * `auctionNominationTime` setting. Snake/linear lobbies pass 0
   * (unused).
   */
  auctionBidWindowSeconds: number;
  /**
   * Auction nomination-window duration in seconds (chunk 11g.6
   * sub-step 6c3 per ADR-002 §3.4 default 60). Net-new in 6c3.
   * Drives the auto-nominate timer for on-clock nominators who
   * don't choose a player. Snake/linear lobbies pass 0 (unused).
   */
  auctionNominationWindowSeconds: number;
  /**
   * Optional auction auto-nominate strategy chain override.
   * Defaults to `[projectionsAuctionStrategy]` per
   * `auctionAutoNominateStrategy.ts`. Tests pass custom strategies.
   */
  auctionAutoNominateStrategies?: ReadonlyArray<AuctionAutoNominateStrategy>;
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
 *
 * **Chunk 11g.10 checkpoint-2 LEDGER (no action):** 200 events holds a
 * full 12-team × 15-round snake/linear draft (180 pick events + slack
 * for presence + snapshot events). A 20-team × 20-round league (400
 * events) exceeds this — a long mid-draft absence in a big league
 * takes the client's `too_old` → HTTP snapshot fallback path (server
 * route `GET /api/drafts/:draftId/snapshot`, tested end-to-end in
 * `apps/web/src/lib/draftClient/__tests__/reduce.test.ts`). This is
 * correct behavior, not a bug. Noted here so nobody rediscovers it
 * as one.
 */
/**
 * RECONNECT (2026-08-12) — the ring buffer now sizes itself to the draft.
 *
 * It was a flat 200. The commissioner picks the round count on the night,
 * and the default roster size is 21 (`LeagueService.ts:87`), so a 12-team
 * league emits 12 x 21 + 1 = **253 events**. Eviction therefore began
 * around pick 200 — round 17 of 21.
 *
 * What that cost, end to end: `getSnapshot()` sends `recentEvents` only,
 * and the route attaches the authoritative `picks` array ONLY for terminal
 * drafts (`routes/drafts.ts`, gated on `isTerminal`). So a mid-draft
 * reconnect always takes the fold path — and `deriveDraftState` correctly
 * refuses to fold a sequence with a hole, halting at the first gap. The
 * manager's room then renders `picksMade = 0`, `draftStatus =
 * 'not_started'`, empty rosters: **a blank board, mid-draft, in the last
 * five rounds.** Three fallbacks that should have caught it all miss —
 * the `too_old` resync reply, the HTTP snapshot (same cap, see
 * `snapshotService.ts`), and the gap-resync escalation, which loops.
 *
 * Sizing from `draftOrder.length` rather than raising the constant is
 * deliberate: Garrett sets rounds at draft time, so any fixed number is a
 * guess that a future league silently outgrows. This way the buffer is
 * correct for a 3-round test rig and a 25-round keeper league alike, and
 * the failure mode cannot come back by configuration change.
 *
 * The floor keeps small/empty-order lobbies (auction pre-nomination,
 * rigs mid-construction) at the previous behaviour. The headroom covers
 * the non-pick lifecycle events — draft_started, paused/resumed,
 * extended, completed — which are appended to the same buffer.
 */
const EVENT_BUFFER_MIN_CAPACITY = 200;
const EVENT_BUFFER_HEADROOM = 64;

export function eventBufferCapacityFor(totalPicks: number): number {
  // Only non-finite input needs an explicit guard. Zero and negative
  // draft orders are already handled by the floor below — Math.max
  // returns EVENT_BUFFER_MIN_CAPACITY for anything under it — and a
  // NaN/Infinity capacity would make the RingBuffer constructor throw.
  //
  // An earlier version also tested `totalPicks <= 0` here. Mutation
  // testing showed that branch was unreachable in effect: flipping it to
  // `< 0` changed no output for any input, because max() rescues both
  // cases identically. Removed rather than papered over with a test that
  // could not tell the two apart.
  if (!Number.isFinite(totalPicks)) {
    return EVENT_BUFFER_MIN_CAPACITY;
  }
  return Math.max(
    EVENT_BUFFER_MIN_CAPACITY,
    Math.ceil(totalPicks) + EVENT_BUFFER_HEADROOM,
  );
}

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
  private readonly verifyCommissionerAuthorization: (
    userId: string,
    leagueId: string,
  ) => Promise<CommissionerAuthorizationResult>;
  private readonly supabase: SupabaseClient;
  private readonly autopickStrategies: ReadonlyArray<AutopickStrategy> | undefined;
  private readonly pickClockMs: number;
  // R1 stash (F27b-1, 2026-08-07): dropped `readonly` so
  // applyDraftStartedEventState can populate this when the
  // construction-time leagues.pick_deadline read pre-dated ignition
  // (dead-lobby razor race close). Only mutated in that one call
  // site under a null-check guard.
  private initialPickDeadline: Date | null;
  private readonly initialDraftState: string | null;

  /**
   * ENGINE-EAR v3 Slice 1 item 6 (E106, 2026-08-11) —
   * INSTANT-AUTOPICK-FOR-UNOWNED-SEATS.
   *
   * Per-league team-owner cache, populated at init() from the
   * `teams` table. Keyed by teamId; value is the owner's user UUID
   * or null when the seat is unowned (fixture-drafted rig seats or
   * post-league-creation seats not yet claimed by a real user).
   *
   * Consumed by `computeArmDeadlineForOnClockTeam`: when the on-clock
   * team's owner is null, override the pick deadline to
   * `now + INSTANT_AUTOPICK_ARM_MS` (~2s) so the autopick fires
   * within a live-draft-feel window instead of the full pick clock.
   *
   * Discriminator (per R98 spec ratified in E106 without amendment):
   * only truly-null owners fire instant. An owner who exists but is
   * disconnected respects the full pick clock (their team is
   * eligible to pick manually if they reconnect in time).
   *
   * Populated at init(). Empty until then — `computeArmDeadlineFor
   * OnClockTeam` treats the missing-key case as "unknown, do not
   * override" (fail-open toward the full pick clock).
   */
  private readonly teamOwners = new Map<string, string | null>();

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
   * `currentTimerDeadline`: wall-clock timestamp when the on-clock
   * pick's deadline expires. Wall-clock (not relative) so it
   * survives bootstrap correctly — at bootstrap the engine reads
   * the deadline from `leagues.pick_deadline` and computes
   * `setTimeout(handleAutopickTimeout, deadline - now())`.
   *
   * `currentTimerHandle`: the live `setTimeout` handle. Cleared
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
  private currentTimerDeadline: Date | null = null;
  private currentTimerHandle: NodeJS.Timeout | null = null;
  /**
   * Chunk 10c-2 batch 3 (2026-07-27): activity timestamp used by
   * LobbyRegistry's idle-eviction scanner. Updated on every
   * connection open, every runtime engine event emission (via
   * `appendEventAndCount`), and every external-event apply (via
   * `processExternalEvent`). A lobby with `connectionCount() === 0`
   * AND `draftStatus ∈ {not_started, completed, cancelled}` AND
   * `now - lastActivityAt > LOBBY_IDLE_EVICTION_MS` is a candidate
   * for eviction. See `LobbyRegistry.startIdleEvictionTimer` for the
   * scanner + the Monday 2026-07-28 amendment's active/paused
   * exemption rationale.
   */
  private lastActivityAt: number = Date.now();
  /**
   * Chunk 10c-2 batch 2 (2026-07-27): timer arm sequence counter.
   * Incremented on every `setPickDeadline` AND every `cancelPickTimer`
   * call. The setTimeout callback captures the current value in its
   * closure and passes it to `handleClockExpired`; if the captured
   * value doesn't match `timerArmSeq` at fire time, the timer is
   * stale (superseded by a later arm or cancelled), and the fire is
   * skipped with a `autopick.stale_timer_skipped` log line.
   *
   * Why not just compare `currentTimerDeadline` reference identity?
   * `cancelPickTimer` intentionally does NOT clear
   * `currentTimerDeadline` (see comment at cancelPickTimer for the
   * observability rationale). A stale fire after cancel would still
   * see `armedDeadline === currentTimerDeadline` if the timer was
   * cancelled without a replacement arm. The counter distinguishes
   * "same arm" from "stale arm cancelled without replacement."
   */
  private timerArmSeq = 0;
  /**
   * Single-timer-handle architecture (chunk 11g.6 sub-step 6c3).
   * At most one timer is active at runtime; this discriminates
   * the format-and-state-specific behavior on
   * `handleClockExpired`. Snake/linear uses `'pick'`; auction uses
   * `'bid_window'` (active nomination open for bidding) or
   * `'nomination_window'` (between nominations — current nominator
   * has the clock to pick a player). Mutually exclusive by
   * construction; tests verify never-both.
   */
  private currentTimerKind:
    | 'pick'
    | 'bid_window'
    | 'nomination_window'
    | null = null;
  /**
   * Pause state. `pausedTimerKind` (chunk 11g.6 sub-step 6c3)
   * discriminates which timer was running so resume restores
   * correctly. Backward-compat: 6c1-emitted events without this
   * field default to `'bid_window'`. Snake/linear paused state
   * also carries `'bid_window'` as a harmless placeholder
   * (engine consults `format` to decide the restore path).
   */
  private pauseState: {
    pausedAt: Date;
    remainingMs: number;
    pausedTimerKind: 'bid_window' | 'nomination_window';
  } | null = null;
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

  // F20 Piece 3 (2026-08-02 architect ruling): in-flight action counter
  // consulted by attemptClockRecovery() before re-arming a stalled
  // clock. The queue serializes actions, so any nonzero value means an
  // action is currently in the queue — re-arming while a submit is
  // about to bump timerArmSeq would create a timer for state that's
  // about to be superseded. Not strictly necessary given the
  // observedSeq guard, but defence in depth against a race window
  // where the submit is queued but hasn't yet advanced the seq.
  //
  // Incremented in enqueueAction before the .then; decremented in a
  // .finally so BOTH success and failure paths clear it.
  private pendingActionCount = 0;

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
   * resume protocol. Sized per-lobby by `eventBufferCapacityFor(
   * draftOrder.length)` so the whole draft always fits — see that
   * function for why a flat 200 blanked the board in late rounds.
   * Assigned in the constructor (not as a field initializer) because
   * it depends on `opts.draftOrder`; first use is in `init()`.
   * Eviction-aware semantics: clients whose
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
  private readonly events: RingBuffer<BufferedDraftEvent>;

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
   * `currentTimerHandle`); `cancelPickTimer` clears both.
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

  /**
   * Tiered minimum-bid-increment table (chunk 11g.6 sub-step 6c2
   * per ADR-002 §4.3). The tier whose `below` (strictly) exceeds
   * the leading bid determines the next-bid increment. Engine
   * fail-fast in `processPlaceBid` mirrors the SQL
   * `compute_min_next_bid()` for cheap rejection; RPC enforces
   * the same rule durably (defense-in-depth).
   */
  private readonly auctionMinBidIncrementTiers: ReadonlyArray<{
    below: number;
    increment: number;
  }>;

  /**
   * Auction nomination-window duration in ms (chunk 11g.6 sub-step
   * 6c3 per ADR-002 §3.4 default 60s). Engine schedules the
   * nomination-window timer with this duration when no nomination
   * is open. On expiry → auto-nominate via the strategy chain.
   */
  private readonly nominationWindowMs: number;

  /**
   * Strategy chain for engine-fired auto-nominate (chunk 11g.6
   * sub-step 6c3). Today: `[projectionsAuctionStrategy]`. Future
   * chains can prepend queue-priority / append commissioner-preset
   * without engine refactor (chain-of-strategies pattern).
   */
  private readonly auctionAutoNominateStrategies:
    | ReadonlyArray<AuctionAutoNominateStrategy>
    | undefined;

  // ── Snapshot persistence (chunk 11g.7 sub-step 7c) ────────────────

  /**
   * Periodic snapshot timer handle. Fires every
   * `SNAPSHOT_INTERVAL_MS` (env, default 30000ms). Gated on
   * `draftStatus !== 'not_started'` AND `pauseState === null` —
   * snapshot generation skipped during pause (nothing new to
   * capture; previous snapshot remains current).
   */
  private snapshotIntervalHandle: NodeJS.Timeout | null = null;

  /**
   * Counter for the milestone trigger. Incremented by
   * `appendEventAndCount` on every runtime event emission; reset to
   * 0 after each successful snapshot write. Replay-time
   * `events.append` calls do NOT increment this — replay should
   * reflect only post-bootstrap activity in the milestone counter.
   * Persisted in the `engine_state` JSONB so milestone continuity
   * survives bootstrap.
   */
  private eventsSinceLastSnapshot = 0;

  /**
   * Highest `draft_events.seq` value the engine has applied to its
   * in-memory state (chunk 11g.7 sub-step 7e). Initialized to 0 at
   * construction; updated by:
   *   - `applySnapshot` to `snapshotRecord.lastAppliedSeq`
   *   - `applyEventDuringBootstrap` to `event.seq` (each event,
   *     monotonically increasing)
   *   - `bootstrapFullEventReplay` to the seq of each replayed event
   *   - Runtime emission paths (`processSubmitPick`, `processNominate`,
   *     `processPlaceBid`, `processPauseAuction`, `processResumeAuction`,
   *     `processCommissionerOverride`, `fireAutoSkipEvent`,
   *     `handleNominationTimeout`'s close, `fireAutoNominateAction`,
   *     and the snake/linear `pauseDraft`/`resumeDraft`/`extendDraft`)
   *     update this cursor to the seq returned by their RPC.
   *   - `processExternalEvent` (the cross-process NOTIFY apply path)
   *     updates this cursor to the seq of the event it just applied.
   *
   * **Used by `processExternalEvent` for dedup**: NOTIFY notifications
   * for seq `<= lastAppliedSeq` short-circuit without re-applying.
   * This dedups the engine's own emitted events (which fire NOTIFY
   * via the `draft_events_notify_after_insert` trigger from migration
   * `20260511000000_draft_events_notify.sql`) that bounce back to its
   * own LISTEN subscription.
   */
  private lastAppliedSeq = 0;

  /**
   * Cadence configuration (env-overridable for tests + tuning).
   * Tests typically pass `0` for `intervalMs` to disable the
   * periodic timer and trigger snapshots manually via
   * `lobby.scheduleSnapshot()` (test-only). Production defaults
   * land at 30s + 50 events.
   */
  private readonly snapshotIntervalMs: number;
  private readonly snapshotEventMilestone: number;

  constructor(opts: LobbyManagerOptions) {
    this.lobbyId = opts.lobbyId;
    this.format = opts.format;
    this.leagueId = opts.leagueId;
    this.draftService = opts.draftService;
    this.publish = opts.publish;
    this.verifyTeamAuthorization = opts.verifyTeamAuthorization;
    this.verifyCommissionerAuthorization = opts.verifyCommissionerAuthorization;
    this.supabase = opts.supabase;
    this.autopickStrategies = opts.autopickStrategies;
    this.pickClockMs = opts.pickClockSeconds * 1000;
    this.initialPickDeadline = opts.initialPickDeadline;
    this.initialDraftState = opts.initialDraftState;
    this.draftOrder = opts.draftOrder;

    // RECONNECT (2026-08-12) — size the resume buffer to THIS draft.
    // Must come after `this.draftOrder` is set and before `init()`,
    // which is the first reader (`bufferSize=` in the init log line).
    this.events = new RingBuffer<BufferedDraftEvent>(
      eventBufferCapacityFor(opts.draftOrder.length),
    );

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
    this.auctionMinBidIncrementTiers = opts.auctionMinBidIncrementTiers;
    // Chunk 11g.6 sub-step 6c3: nomination window timer +
    // auto-nominate strategy chain. `bidWindowMs` (set above) is
    // the legacy `pickClockMs` reuse; 6c3 introduces the explicit
    // pair via `auctionBidWindowSeconds` + `auctionNominationWindowSeconds`.
    if (opts.format === 'auction') {
      this.bidWindowMs = opts.auctionBidWindowSeconds * 1000;
    }
    this.nominationWindowMs = opts.auctionNominationWindowSeconds * 1000;
    this.auctionAutoNominateStrategies = opts.auctionAutoNominateStrategies;

    // Chunk 11g.7 sub-step 7c: snapshot cadence configuration.
    // Tests pass `0` to disable the periodic timer and trigger
    // snapshots manually via `lobby.scheduleSnapshot()`.
    const intervalMsEnv = process.env.SNAPSHOT_INTERVAL_MS;
    this.snapshotIntervalMs =
      intervalMsEnv !== undefined ? Number(intervalMsEnv) : 30_000;
    const milestoneEnv = process.env.SNAPSHOT_EVENT_MILESTONE;
    this.snapshotEventMilestone =
      milestoneEnv !== undefined ? Number(milestoneEnv) : 50;

    // `picksMade`, `draftStatus`, `initialized`, timer state are
    // zero-initialized at the field declaration above. `init()`
    // mutates them during event-log replay + sets the deadline
    // timer from `initialPickDeadline` per chunk 11g.4 step 6c.
    structuredLogger.info(
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
      structuredLogger.debug(
        `[lobby] init() called more than once — no-op lobbyId=${this.lobbyId}`,
      );
      return;
    }
    await this.bootstrap();

    // ENGINE-EAR v3 Slice 1 item 6 (E106, 2026-08-11): populate the
    // team-owner cache for INSTANT-AUTOPICK. One-shot query at init;
    // the cache is not invalidated during the draft (mid-draft owner
    // changes are rare and would go through a separate flow). Query
    // failures are non-fatal — the cache stays empty and
    // `computeArmDeadlineForOnClockTeam` fail-opens to the full pick
    // clock (silent-degrade to pre-Slice-1 behavior).
    if (this.format === 'snake' || this.format === 'linear') {
      try {
        const { data: teamRows, error: teamErr } = await this.supabase
          .from('teams')
          .select('id, owner_id')
          .eq('league_id', this.leagueId);
        if (teamErr) {
          structuredLogger.warn(
            `[lobby] team_owner_cache_query_failed lobbyId=${this.lobbyId} error=${teamErr.message}`,
          );
        } else if (Array.isArray(teamRows)) {
          for (const row of teamRows as Array<{ id: string; owner_id: string | null }>) {
            this.teamOwners.set(row.id, row.owner_id ?? null);
          }
          const nullCount = Array.from(this.teamOwners.values()).filter(
            (v) => v === null,
          ).length;
          structuredLogger.info(
            `[lobby] team_owner_cache_populated lobbyId=${this.lobbyId} totalTeams=${this.teamOwners.size} unownedTeams=${nullCount}`,
          );
        }
      } catch (err) {
        structuredLogger.warn(
          `[lobby] team_owner_cache_threw lobbyId=${this.lobbyId} error=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

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
      // Auction timer post-replay (chunk 11g.6 sub-step 6a + 6c3):
      //   - Active nomination → bid-window timer from
      //     `currentNomination.expiresAt`. Process-restart-mid-bid
      //     recovery.
      //   - In-progress, no active nomination, draft not complete →
      //     nomination-window timer for the current nominator
      //     (chunk 11g.6 sub-step 6c3 — NEW). Process-restart-
      //     mid-nomination-window recovery; the deadline is
      //     reconstructed locally as `now() + nominationWindowMs`
      //     since there's no DB row tracking nomination-window
      //     deadlines (they're transient state).
      //   - Not started → no timer scheduled here. The first
      //     manual nomination transitions `draftStatus` from
      //     `'not_started'` to `'in_progress'` AND starts the bid-
      //     window timer (in `processNominate`). Auction draft
      //     lifecycle initiation (transitioning the DB to
      //     `'active'`) is owned by the commissioner-start-draft
      //     flow which lands separately. Once `initialDraftState`
      //     is `'active'` AND the durable log is fresh, init()
      //     starts the very first nomination-window timer.
      if (this.draftStatus === 'in_progress' && this.pauseState === null) {
        if (this.currentNomination !== null) {
          this.setPickDeadline(this.currentNomination.expiresAt, 'bid_window');
        } else if (
          this.nominationOrder.length > 0 &&
          this.nominationsCompleted <
            this.nominationOrder.length * this.draftRounds
        ) {
          // Schedule nomination-window timer for the current nominator.
          const newDeadline = new Date(Date.now() + this.nominationWindowMs);
          this.setPickDeadline(newDeadline, 'nomination_window');
        }
      } else if (
        this.draftStatus === 'not_started' &&
        this.initialDraftState === 'active' &&
        this.pauseState === null &&
        this.nominationOrder.length > 0 &&
        this.draftRounds > 0
      ) {
        // Fresh-start auction with `leagues.draft_state='active'`:
        // kick the very first nominator's window. Transition
        // status to in_progress so the timer's expiry passes
        // `handleClockExpired`'s status guard.
        this.draftStatus = 'in_progress';
        const newDeadline = new Date(Date.now() + this.nominationWindowMs);
        this.setPickDeadline(newDeadline, 'nomination_window');
      }
    } else if (
      this.draftStatus === 'in_progress' &&
      this.pauseState === null &&
      this.initialPickDeadline !== null
    ) {
      // ENGINE-EAR v3 Slice 1 item 6 (E106 + E113): route through
      // armPickDeadline so ownerless seats fire fast on engine boot
      // too (not just after normal pick advance). E113 introduced
      // the wrapper as a single entry point after 3 unrouted sites
      // were found in the field.
      this.armPickDeadline(this.initialPickDeadline);
    }

    // Chunk 11g.7 sub-step 7c: start the periodic snapshot timer
    // after bootstrap completes. Tests pass SNAPSHOT_INTERVAL_MS=0
    // to disable the periodic timer; manual triggers via
    // `scheduleSnapshot()` still work.
    this.startSnapshotTimer();

    structuredLogger.info(
      `[lobby] init complete lobbyId=${this.lobbyId} format=${this.format} picksMade=${this.picksMade} status=${this.draftStatus} bufferSize=${this.events.size()} bufferCapacity=${eventBufferCapacityFor(this.draftOrder.length)} timerScheduled=${this.currentTimerHandle !== null} activeNomination=${this.currentNomination !== null}`,
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
    // Chunk 10c-2 batch 3 (2026-07-27): touch activity clock. A new
    // WS connection is the strongest liveness signal a lobby can get;
    // resetting the idle-eviction window from here means a reconnect
    // after a long disconnect immediately protects the lobby from
    // the next scan.
    this.lastActivityAt = Date.now();
    const alreadyRegistered = this.connections.has(ws);
    this.connections.set(ws, userData);

    if (!alreadyRegistered) {
      try {
        ws.subscribe(this.topicName);
      } catch (err) {
        structuredLogger.debug(
          `[lobby] ws.subscribe threw during addConnection lobbyId=${this.lobbyId} userId=${userData.userId}`,
        );
      }
    }

    // DR-4 (2026-07-30) — add the connecting user to presentUserIds
    // BEFORE building the snapshot, so the snapshot carries the user's
    // OWN presence. This is the server half of the DR-4 F-fix for the
    // presence-count-anomaly (first client sees 0 because their own
    // join broadcast races the snapshot they just received). Post-DR-4
    // the client's setSnapshot seeds presentUserIds directly from the
    // snapshot, so the count is correct from render-1. See
    // packages/shared/src/types/draftWire.ts:DraftSnapshot.presentUserIds
    // for the wire contract.
    //
    // `isFirstConnection` captures the pre-add state so the subsequent
    // presence broadcast (still needed for OTHER already-connected
    // clients) only fires on the true first connection for this user
    // (not subsequent co-manager multi-device attaches).
    const isFirstConnection = !this.presentUserIds.has(userData.userId);
    if (isFirstConnection) {
      this.presentUserIds.add(userData.userId);
    }

    // Snapshot send — point-to-point, not via the broadcast topic.
    //
    // Chunk 11g.10 sub-step 10c-1b: lobby.snapshot_sent_on_connect
    // instrumentation. INFO-level, once per connection (low rate —
    // one per WS open, ~12 per active draft in the baseline scenario).
    // `buildMs` isolates `getSnapshot()` cost from `ws.send()` I/O.
    // Both contribute to the Mandate's "draft state load p95 ≤ 1500ms"
    // metric — this is the server-side portion.
    let snapshotBuildMs = 0;
    let snapshotSendMs = 0;
    try {
      const buildStart = Date.now();
      const snapshot: DraftServerMessage = {
        v: WIRE_PROTOCOL_VERSION,
        type: 'snapshot',
        timestamp: new Date().toISOString(),
        payload: this.getSnapshot(),
      };
      const serialized = serializeServerMessage(snapshot);
      snapshotBuildMs = Date.now() - buildStart;
      const sendStart = Date.now();
      ws.send(serialized);
      snapshotSendMs = Date.now() - sendStart;
    } catch (err) {
      structuredLogger.debug(
        `[lobby] snapshot ws.send threw during addConnection lobbyId=${this.lobbyId} userId=${userData.userId}`,
      );
    }
    structuredLogger.info('lobby.snapshot_sent_on_connect', {
      lobbyId: this.lobbyId,
      userId: userData.userId,
      buildMs: snapshotBuildMs,
      sendMs: snapshotSendMs,
    });

    structuredLogger.info(
      `[lobby] connection added lobbyId=${this.lobbyId} userId=${userData.userId} size=${this.connections.size}`,
    );

    // Presence join broadcast — only on the FIRST connection for this
    // userId. Subsequent connections (co-manager multi-device) don't
    // re-emit. Broadcast still goes to the topic so OTHER connected
    // clients update their presence set; the JOINING client itself
    // now learns of its own presence via the snapshot seed above.
    if (isFirstConnection) {
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
    this.cleanupConnection(ws, 'close_handler');
  }

  /**
   * Chunk 11g.10 F5 — unconditional map removal for a stale connection
   * that the uWS `close:` handler failed to fire on.
   *
   * Called by the heartbeat scanner's rung 3 after ws.end() (rung 1)
   * and ws.close() (rung 2) both failed to induce a close-handler
   * invocation across multiple scan passes. The mechanism is
   * fundamentally the same as `removeConnection` — same cleanup, same
   * presence.left broadcast — but the CALL SITE is the scanner, not
   * uWS itself. This guarantees the LobbyManager's `connections` map
   * (which drives broadcast fanout and presence counts) is not lying
   * about a dead socket regardless of what uWS or Caddy do downstream.
   *
   * Idempotent — same idempotence guarantee as `removeConnection`;
   * if the uWS `close:` handler eventually DOES fire later (e.g., after
   * Caddy's dead-client TCP finally times out an hour later), the
   * subsequent `removeConnection` no-ops on the empty-map lookup.
   */
  forceRemoveConnection(ws: WebSocket<DraftSocketUserData>): void {
    this.cleanupConnection(ws, 'force_purge');
  }

  /**
   * Shared cleanup for `removeConnection` (uWS close handler path) and
   * `forceRemoveConnection` (heartbeat scanner rung-3 force-purge path).
   *
   * The `origin` discriminator lets the two paths emit distinguishable
   * INFO logs so ops can see which path is responsible for a given
   * disconnect — critical for F5 field diagnosis, where the whole
   * point of the escalation ladder is to learn which rung actually
   * stops the leak.
   *
   * Idempotent by construction: if `ws` is not in the map, we early-
   * return without emitting logs or presence.left. This covers the
   * race where `forceRemoveConnection` purges first and then the
   * uWS `close:` handler fires later.
   */
  private cleanupConnection(
    ws: WebSocket<DraftSocketUserData>,
    origin: 'close_handler' | 'force_purge',
  ): void {
    const userData = this.connections.get(ws);
    if (!userData) {
      // ws was never registered (or already removed); idempotent no-op.
      return;
    }
    this.connections.delete(ws);

    try {
      ws.unsubscribe(this.topicName);
    } catch (err) {
      structuredLogger.debug(
        `[lobby] ws.unsubscribe threw during ${origin} lobbyId=${this.lobbyId} userId=${userData.userId}`,
      );
      void err;
    }

    if (origin === 'force_purge') {
      structuredLogger.warn(
        `[lobby] connection FORCE-purged (uWS close never fired) lobbyId=${this.lobbyId} userId=${userData.userId} size=${this.connections.size}`,
      );
    } else {
      structuredLogger.info(
        `[lobby] connection removed lobbyId=${this.lobbyId} userId=${userData.userId} size=${this.connections.size}`,
      );
    }

    // Presence leave — only when this was the LAST connection for
    // the userId (co-manager / multi-device case keeps presence
    // alive while at least one ws remains). Applies identically for
    // close-handler and force-purge origins per the F5 ruling:
    // silently-purging a connection that still shows as "connected"
    // to other clients would trade one lie for another.
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
   * Chunk 10c-2 batch 3 (2026-07-27): activity-clock accessor for the
   * LobbyRegistry idle-eviction scanner. Returns the epoch-ms
   * timestamp of the most-recent activity signal (WS open, runtime
   * event emission, or external-event apply). Never null — initialized
   * to constructor time.
   */
  getLastActivityAt(): number {
    return this.lastActivityAt;
  }

  /**
   * Chunk 10c-2 batch 3 (2026-07-27): draft-status accessor for the
   * LobbyRegistry idle-eviction scanner's active-status exemption.
   * A lobby with `draftStatus === 'in_progress'` is NEVER evicted
   * even if `connectionCount === 0` and `lastActivityAt` is old —
   * the engine's autopick timer may still need to fire, and
   * evicting mid-draft would disrupt the pending state machine.
   */
  getDraftStatus(): DraftStatus {
    return this.draftStatus;
  }

  /**
   * F20 Piece 3 (2026-08-02): read-only accessor for the current
   * pick-timer deadline. Null when no timer is armed (pre-first-arm
   * window in an in_progress lobby, or immediately after
   * cancelPickTimer). Consumed by the LobbyRegistry clock-liveness
   * scanner to detect stalled clocks.
   */
  getCurrentTimerDeadline(): Date | null {
    return this.currentTimerDeadline;
  }

  /**
   * F20 Piece 3 (2026-08-02): read-only accessor for the current
   * timer-arm sequence. Scanner captures this at scan time and passes
   * it to attemptClockRecovery so the recovery path can detect
   * "someone else advanced the state between the scan and now" and
   * abort idempotently.
   */
  getTimerArmSeq(): number {
    return this.timerArmSeq;
  }

  /**
   * Phase 4.5 chunk 11g.10 sub-step 10b — engine-admin diagnostic.
   *
   * Returns a read-only snapshot of the lobby's identity + replay
   * cursor + connection count, intended for the engine-admin
   * `GET /api/admin/engine/registry` endpoint. Cheap (no IO);
   * called on demand for the operational diagnostic view.
   *
   * `format` is the locked snake/linear/auction discriminator. The
   * registry surfaces this for at-a-glance "what kind of draft is
   * this lobby."
   *
   * `lastAppliedSeq` exposes the engine's replay cursor — useful for
   * post-incident verification that the engine is caught up with
   * durable state.
   */
  getDiagnosticInfo(): {
    lobbyId: string;
    leagueId: string;
    format: 'snake' | 'linear' | 'auction';
    connectionCount: number;
    lastAppliedSeq: number;
  } {
    return {
      lobbyId: this.lobbyId,
      leagueId: this.leagueId,
      format: this.format,
      connectionCount: this.connections.size,
      lastAppliedSeq: this.lastAppliedSeq,
    };
  }

  /**
   * Iterate this lobby's active WebSocket connections (chunk 11g.7
   * sub-step 7d). Snapshots the `connections` map at call-start, then
   * walks the snapshot — safe against mid-iteration mutation (a
   * connection closing inside the callback removes itself from the
   * live map but does not affect the snapshot we're walking).
   *
   * Used by `LobbyRegistry.forEachConnection` to drive the
   * heartbeat soft-check scan across every lobby in a single pass.
   * Callbacks that throw propagate up; callers should `try/catch`
   * around the per-connection work so one bad connection doesn't
   * abort the rest of the scan.
   */
  forEachConnection(
    fn: (ws: WebSocket<DraftSocketUserData>, userData: DraftSocketUserData) => void,
  ): void {
    const snapshot: Array<[WebSocket<DraftSocketUserData>, DraftSocketUserData]> = [];
    for (const entry of this.connections) {
      snapshot.push(entry);
    }
    for (const [ws, userData] of snapshot) {
      fn(ws, userData);
    }
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
   * Step 2 dispatches `submit_pick` to the snake/linear handler and
   * `nominate` / `place_bid` to the auction handlers (processNominate,
   * processPlaceBid). The `'not_yet_implemented_chunk_11g6'` reason string
   * survives in types.ts / toasts.ts for old clients only.
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
      structuredLogger.error(msg);
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
    this.pendingActionCount += 1;
    const next: Promise<DraftActionResult> = this.queue
      .then(() => this.processAction(action))
      .catch((err: unknown) => this.handleQueueError(err, action))
      .finally(() => {
        this.pendingActionCount -= 1;
      });

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
      // DR-4 (2026-07-30) — carry current presence in the snapshot so
      // newly-connecting clients see themselves + all other present
      // users on render-1. See addConnection() for the ordering
      // guarantee (join added to Set BEFORE this snapshot is built).
      presentUserIds: [...this.presentUserIds],
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
        // Wire field name unchanged (`currentPickDeadline`) for
        // backward-compat — clients consume this key. Internal
        // engine field was renamed to `currentTimerDeadline` in
        // chunk 11g.6 sub-step 6c3 alongside the timer-kind
        // discriminator addition.
        currentPickDeadline:
          this.currentNomination !== null
            ? this.currentNomination.expiresAt.toISOString()
            : this.currentTimerDeadline !== null
              ? this.currentTimerDeadline.toISOString()
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
        this.currentTimerDeadline !== null
          ? this.currentTimerDeadline.toISOString()
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
    // Chunk 11g.10 sub-step 10c-1b: resync.responded instrumentation.
    // `buildMs` bounds the ring-buffer filter cost (typically <1ms
    // for a 200-event buffer). `deltaCount` is the number of events
    // returned to the client; useful for reconnect-storm capacity
    // planning in 10c-2 (larger deltas mean longer resync recovery).
    const buildStart = Date.now();
    const result = this.events.getEventsSinceSeq(sinceSeq);
    structuredLogger.debug(
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

    const message: DraftServerMessage = {
      v: WIRE_PROTOCOL_VERSION,
      type: 'resync_response',
      timestamp: new Date().toISOString(),
      payload,
    };

    structuredLogger.info('resync.responded', {
      lobbyId: this.lobbyId,
      sinceSeq,
      deltaCount: 'events' in result ? result.events.length : 0,
      tooOld: !('events' in result),
      buildMs: Date.now() - buildStart,
    });

    return message;
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
    // Chunk 11g.10 sub-step 10c-1b: instrumentation entry timestamp.
    // `totalMs` bounds the full engine-side pick processing latency
    // (authorization + on-clock check + RPC + broadcast). `rpcMs` and
    // `broadcastMs` decompose it for the Mandate manual-pick metric.
    const processStart = Date.now();

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
        structuredLogger.error(
          `[lobby] verifyTeamAuthorization threw lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId}`,
          {}, err,
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
        structuredLogger.info(
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
    const rpcStart = Date.now();
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
      structuredLogger.error(
        `[lobby] processSubmitPick: unexpected throw lobbyId=${this.lobbyId}`,
        {}, err,
      );
      return { ok: false, reason: 'internal_error' };
    }

    // Step 7: advance state on the non-duplicate success path.
    // Skip on `was_duplicate=true` — the original event is already
    // in the buffer + durable log; the state machine already
    // advanced when the original first landed.
    const rpcMs = Date.now() - rpcStart;
    let broadcastMs = 0;
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
      // Chunk 10c-2 batch 3 C2 (2026-07-28): mirror the RPC's
      // pick_deadline into the wire event so clients can re-arm
      // their countdown UI. Symmetric with applyPickEvent's
      // pickDeadline mirroring for external-apply events. Both
      // paths converge on the same wire field.
      const pickDeadlineForWire =
        typeof result.pick_deadline === 'string' && result.pick_deadline.length > 0
          ? result.pick_deadline
          : undefined;
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
        ...(pickDeadlineForWire !== undefined ? { pickDeadline: pickDeadlineForWire } : {}),
      };
      this.appendEventAndCount(event);
      const broadcastStart = Date.now();
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: action.idempotencyKey,
        payload: event,
      });
      broadcastMs = Date.now() - broadcastStart;

      // Step 6c: set / cancel the deadline timer based on new state.
      if (this.draftStatus === 'in_progress') {
        // Prefer the RPC's authoritative `pick_deadline` (it carries
        // the +1s pad already); fall back to engine-side computation
        // if the RPC didn't return one (defensive — shouldn't happen
        // for snake/linear picks).
        const nextDeadline = result.pick_deadline
          ? new Date(result.pick_deadline)
          : new Date(Date.now() + this.pickClockMs);
        // E113 primary miss: this self-drive re-arm bypassed the
        // instant-autopick helper on tag dcaeeeb9-draft (Item 6
        // fired at init only, then reverted to the full 30s
        // courtesy clock for picks 2..N). Routed through
        // armPickDeadline as of E113.
        this.armPickDeadline(nextDeadline);
      } else {
        // Draft completed. Clear timer + deadline; no team is on
        // the clock anymore, so getCurrentState should reflect
        // that with currentTimerDeadline=null.
        this.cancelPickTimer();
        this.currentTimerDeadline = null;
      }
    }

    // Chunk 11g.10 sub-step 10c-1b: pick.processed emission.
    // INFO-level, one per submit (autopick + manual through engine
    // paths — currently just autopick until 10c-2's WS-direct-submit
    // optional optimization, if triggered by measurement data).
    // `totalMs` includes authorization + on-clock check + RPC round
    // trip + broadcast. `wasDuplicate=true` skips broadcast so
    // `broadcastMs=0` there is expected, not a bug.
    structuredLogger.info('pick.processed', {
      lobbyId: this.lobbyId,
      seq: result.seq,
      teamId: action.teamId,
      rpcMs,
      broadcastMs,
      totalMs: Date.now() - processStart,
      wasAutopick: isAutopick,
      wasDuplicate: result.was_duplicate,
    });

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

    // Step 1b: pause gate (chunk 11g.6 sub-step 6c1 per ADR-002 §4.4).
    // Engine fail-fast — RPC also gates via `leagues.draft_state` as
    // defense-in-depth.
    if (this.pauseState !== null) {
      return { ok: false, reason: 'auction_paused' };
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
        structuredLogger.error(
          `[lobby] processNominate verifyTeamAuthorization threw lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId}`,
          {}, err,
        );
        return { ok: false, reason: 'internal_error' };
      }
      if ('reason' in authResult) {
        structuredLogger.info(
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
      structuredLogger.error(
        `[lobby] processNominate: unexpected throw lobbyId=${this.lobbyId}`,
        {}, err,
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
      this.appendEventAndCount(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: action.idempotencyKey,
        payload: event,
      });

      // Chunk 11g.6 sub-step 6c3: explicit bid-window kind for the
      // post-nomination timer (previously implicit since auction
      // had only one timer kind).
      this.setPickDeadline(expiresAt, 'bid_window');
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

    // Step 1b: pause gate (chunk 11g.6 sub-step 6c1 per ADR-002 §4.4).
    // Engine fail-fast; RPC also gates via `leagues.draft_state` as
    // defense-in-depth.
    if (this.pauseState !== null) {
      return { ok: false, reason: 'auction_paused' };
    }

    const isAutopick = action.actorKind === 'autopick';

    // Step 2: auth.
    if (!isAutopick) {
      let authResult: TeamAuthorizationResult;
      try {
        authResult = await this.verifyTeamAuthorization(action.userId, action.teamId);
      } catch (err) {
        structuredLogger.error(
          `[lobby] processPlaceBid verifyTeamAuthorization threw lobbyId=${this.lobbyId} userId=${action.userId} teamId=${action.teamId}`,
          {}, err,
        );
        return { ok: false, reason: 'internal_error' };
      }
      if ('reason' in authResult) {
        structuredLogger.info(
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
    // Tiered minimum-bid increment per ADR-002 §4.3 (chunk 11g.6
    // sub-step 6c2). Default tier is flat $1 — preserves the 6a
    // behavior for leagues that haven't configured custom tiers.
    // The tier of the LEADING bid determines the increment for
    // the next bid. RPC also enforces this (defense-in-depth);
    // engine populates `minimumNextBid` on rejection so clients
    // can render "Minimum next bid: $X" instead of generic error.
    const minimumNextBid = computeMinimumNextBid(
      this.currentNomination.leadingBid,
      this.auctionMinBidIncrementTiers,
    );
    if (action.bidAmount < minimumNextBid) {
      return { ok: false, reason: 'bid_increment_violation', minimumNextBid };
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
        minBidIncrementTiers: this.auctionMinBidIncrementTiers,
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return { ok: false, reason: this.mapAppErrorToReason(err) };
      }
      structuredLogger.error(
        `[lobby] processPlaceBid: unexpected throw lobbyId=${this.lobbyId}`,
        {}, err,
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
      this.appendEventAndCount(bidEvent);
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
        // Chunk 11g.6 sub-step 6c3: explicit bid-window kind on
        // anti-snipe extension reschedule.
        this.setPickDeadline(newExpiresAt, 'bid_window');

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
        this.appendEventAndCount(extendsEvent);
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
    // KI-010 Tier 1: byte-limited delta (not full state) — each
    // broadcast carries a single event payload (`BufferedDraftEvent`),
    // never a full lobby snapshot. Snapshots are point-to-point on
    // connect + explicit resync only. Keeps per-broadcast wire size
    // bounded to O(1 event) regardless of draft depth. Verified
    // structural per chunk 11g.10 sub-step 10c-1b audit.
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
    // KI-010 Tier 1: per-socket fanout protection via getBufferedAmount()
    // — a single slow consumer's per-connection outbound queue cannot
    // block the rest of the lobby. Any WS whose buffered outbound
    // exceeds BACKPRESSURE_THRESHOLD_BYTES is forcibly disconnected
    // with WS close code 1013 (Try Again Later). Verified structural
    // per chunk 11g.10 sub-step 10c-1b audit.
    for (const [ws, userData] of this.connections) {
      let buffered: number;
      try {
        buffered = ws.getBufferedAmount();
      } catch (err) {
        // ws may have closed mid-iteration. Skip — close handler
        // will purge it from the map shortly.
        structuredLogger.debug(
          `[lobby] getBufferedAmount threw during sweep lobbyId=${this.lobbyId} userId=${userData.userId}`,
        );
        continue;
      }
      if (buffered > BACKPRESSURE_THRESHOLD_BYTES) {
        structuredLogger.warn(
          `[lobby] backpressure threshold exceeded — disconnecting slow consumer lobbyId=${this.lobbyId} userId=${userData.userId} bufferedAmount=${buffered} threshold=${BACKPRESSURE_THRESHOLD_BYTES}`,
        );
        try {
          // Code 1013 = "Try Again Later" — signals transient server
          // congestion to the client retry path (vs 1011 server_error
          // for failures, or 1000 normal close for intentional logout).
          ws.end(1013, 'backpressure');
        } catch (err) {
          structuredLogger.debug(
            `[lobby] ws.end after backpressure threw lobbyId=${this.lobbyId} userId=${userData.userId}`,
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
    structuredLogger.error(
      `[lobby] queue error lobbyId=${this.lobbyId} actionKind=${action.kind}`,
      {}, err,
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

  // ── Chunk 11g.7 sub-step 7c — snapshot persistence ────────────────

  /**
   * Append an event to the ring buffer AND increment the snapshot
   * milestone counter. **Use this method for runtime event emissions
   * (action processing).** DO NOT use during bootstrap event-replay
   * — replay should call `this.events.append` directly so
   * `eventsSinceLastSnapshot` reflects only post-bootstrap activity.
   *
   * Schedules a snapshot if the milestone threshold is reached;
   * snapshot generation is queue-routed so it serializes against
   * any in-flight actions.
   */
  private appendEventAndCount(event: BufferedDraftEvent): void {
    this.events.append(event);
    this.eventsSinceLastSnapshot++;
    // Chunk 10c-2 batch 3 (2026-07-27): touch activity clock so the
    // idle-eviction scanner sees this lobby is live. Every engine-
    // authored event flows through here (see the enumeration comment
    // below); no per-callsite touch required.
    this.lastActivityAt = Date.now();
    // Chunk 11g.7 sub-step 7e: every runtime emission path that
    // appends to the ring buffer is one that just successfully wrote
    // a `draft_events` row. Advance the dedup cursor here so external
    // NOTIFY bounces for the same seq short-circuit in
    // `processExternalEvent`. Single source of truth — runtime paths
    // (`processSubmitPick`, `processNominate`, `processPlaceBid` with
    // its possible double-event extend-timer case, `processPauseAuction`,
    // `processResumeAuction`, `processCommissionerOverride`,
    // `fireAutoSkipEvent`, `handleNominationTimeout` close,
    // `fireAutoNominateAction`) all funnel through here without
    // needing per-callsite updates.
    if (event.seq > this.lastAppliedSeq) {
      this.lastAppliedSeq = event.seq;
    }
    if (
      this.snapshotEventMilestone > 0 &&
      this.eventsSinceLastSnapshot >= this.snapshotEventMilestone
    ) {
      this.scheduleSnapshot();
    }
  }

  /**
   * Schedule a snapshot generation through the single-writer queue.
   * Public for tests; production triggers are the periodic timer
   * (`startSnapshotTimer`), the milestone threshold (via
   * `appendEventAndCount`), and lifecycle hooks (draft completion /
   * cancellation). Also called by the engine-admin
   * `POST /api/admin/engine/lobby/:id/snapshot` endpoint via
   * `LobbyRegistry.forceSnapshot` (chunk 11g.10 sub-step 10b).
   *
   * Routed through the queue (not a `DraftAction` variant — direct
   * promise chain like `pauseAuction`) so snapshot generation
   * serializes against in-flight actions. Snapshot generation
   * latency (~100ms DB write) contributes to action processing
   * latency for actions queued during snapshot. At 30s cadence,
   * this is ~0.3% of wall-clock time (acceptable per Decision Log
   * 2026-05-07).
   *
   * Returns a `{ persisted, reason? }` envelope per chunk 11g.10
   * sub-step 10b Q3 follow-up (Decision Log 2026-05-19). Internal
   * callers (periodic timer + milestone trigger) ignore the return
   * value via `void`. The admin endpoint consumes it to distinguish
   * "new snapshot written" from "scheduling succeeded but skipped."
   *
   * Reason discriminator values:
   *   - `state_not_in_progress` — draftStatus is `not_started` OR
   *     pauseState is non-null. Most common skip cause.
   *   - `shutting_down` — engine is mid-shutdown.
   *   - `max_seq_lookup_failed` — findMaxEventSeq threw (DB error).
   *   - `build_failed` — buildSnapshot threw.
   *   - `no_snapshot_available` — buildSnapshot returned null.
   *   - `write_failed` — writeSnapshot threw.
   *   - `queue_error` — single-writer queue chain rejected.
   */
  scheduleSnapshot(): Promise<{ persisted: boolean; reason?: string }> {
    const next: Promise<{ persisted: boolean; reason?: string }> = this.queue
      .then(() => this.processSnapshot())
      .catch((err: unknown) => {
        structuredLogger.error(
          'snapshot.persistence.queue_error',
          { lobbyId: this.lobbyId, leagueId: this.leagueId },
          err,
        );
        return { persisted: false as const, reason: 'queue_error' };
      });
    this.queue = next.then(() => undefined);
    return next;
  }

  /**
   * Snapshot generation logic (queue-routed). Reads the current
   * max event seq, builds the wire `DraftSnapshot` via 7b's
   * `buildSnapshot()` helper, captures engine-internal orchestration
   * fields, validates basic shape, and writes the row + retention
   * pruning. Skipped during pause (nothing new to capture; previous
   * snapshot remains current). Returns `{ persisted, reason? }` so
   * the admin endpoint can distinguish written vs. skipped.
   */
  private async processSnapshot(): Promise<{ persisted: boolean; reason?: string }> {
    if (this.shutDown) {
      return { persisted: false, reason: 'shutting_down' };
    }
    if (this.draftStatus === 'not_started') {
      structuredLogger.debug('snapshot.persistence.skipped_not_started', {
        lobbyId: this.lobbyId,
        leagueId: this.leagueId,
      });
      return { persisted: false, reason: 'state_not_in_progress' };
    }
    if (this.pauseState !== null) {
      structuredLogger.debug('snapshot.persistence.skipped_paused', {
        lobbyId: this.lobbyId,
        leagueId: this.leagueId,
      });
      return { persisted: false, reason: 'state_not_in_progress' };
    }

    structuredLogger.debug('snapshot.persistence.scheduled', {
      lobbyId: this.lobbyId,
      leagueId: this.leagueId,
      eventsSinceLastSnapshot: this.eventsSinceLastSnapshot,
    });

    let lastAppliedSeq: number;
    try {
      lastAppliedSeq = await findMaxEventSeq(this.supabase, this.leagueId);
    } catch (err) {
      structuredLogger.error(
        'snapshot.persistence.max_seq_lookup_failed',
        { lobbyId: this.lobbyId, leagueId: this.leagueId },
        err,
      );
      return { persisted: false, reason: 'max_seq_lookup_failed' };
    }

    let snapshot;
    try {
      snapshot = await buildSnapshot(this.leagueId, this.supabase);
    } catch (err) {
      structuredLogger.error(
        'snapshot.persistence.build_failed',
        { lobbyId: this.lobbyId, leagueId: this.leagueId },
        err,
      );
      return { persisted: false, reason: 'build_failed' };
    }
    if (snapshot === null) {
      structuredLogger.warn('snapshot.persistence.skipped_no_snapshot', {
        lobbyId: this.lobbyId,
        leagueId: this.leagueId,
      });
      return { persisted: false, reason: 'no_snapshot_available' };
    }

    const engineState = serializeEngineState({
      currentTimerKind: this.currentTimerKind,
      pauseState: this.pauseState,
      eventsSinceLastSnapshot: this.eventsSinceLastSnapshot,
    });

    try {
      await writeSnapshot(this.supabase, {
        leagueId: this.leagueId,
        lastAppliedSeq,
        snapshot,
        engineState,
        draftStatus: this.draftStatus,
      });
    } catch (err) {
      // Already logged in writeSnapshot; just swallow + return.
      void err;
      return { persisted: false, reason: 'write_failed' };
    }

    // Reset the milestone counter on successful write.
    this.eventsSinceLastSnapshot = 0;
    return { persisted: true };
  }

  /**
   * Start the periodic snapshot timer. Called by `init()` after
   * bootstrap completes. Tests pass `SNAPSHOT_INTERVAL_MS=0` to
   * disable the periodic timer and trigger snapshots manually via
   * `lobby.scheduleSnapshot()`.
   */
  private startSnapshotTimer(): void {
    if (this.snapshotIntervalMs <= 0) {
      return;
    }
    if (this.snapshotIntervalHandle !== null) {
      return; // already started
    }
    this.snapshotIntervalHandle = setInterval(() => {
      void this.scheduleSnapshot();
    }, this.snapshotIntervalMs);
    // Don't keep the process alive for snapshot timer alone.
    if (typeof this.snapshotIntervalHandle.unref === 'function') {
      this.snapshotIntervalHandle.unref();
    }
  }

  /**
   * Stop the periodic snapshot timer. Called from `shutdown()`.
   */
  private stopSnapshotTimer(): void {
    if (this.snapshotIntervalHandle !== null) {
      clearInterval(this.snapshotIntervalHandle);
      this.snapshotIntervalHandle = null;
    }
  }

  // ── Step 6b + 7c: bootstrap from snapshot + event log ─────────────

  /**
   * Bootstrap entry point. Chunk 11g.7 sub-step 7c adds a snapshot+
   * delta optimization in front of the existing full event-log
   * replay (chunk 11g.4 step 6b):
   *
   *   1. Try `readMostRecentSnapshot` for this league.
   *   2. If a snapshot exists AND validates against
   *      `validateSnapshotForBootstrap` (engine version match, seq
   *      sanity, payload + engine_state shape):
   *      - `applySnapshot` to restore the base state.
   *      - `listDraftEvents(sinceSeq=snapshot.lastAppliedSeq)` to
   *        read the delta.
   *      - Apply each delta event via existing apply-during-replay
   *        handlers (canonical-replay principle preserved).
   *   3. If no snapshot OR validation fails → WARN log with
   *      structured `reason` discriminator + fall back to full
   *      event-log replay.
   *
   * **Belt-and-suspenders preserved**: the full event-replay path
   * (chunk 11g.4 step 6b's original behavior) remains the canonical
   * fallback. Snapshot+delta is purely an optimization on top.
   */
  private async bootstrap(): Promise<void> {
    let snapshotRecord: SnapshotRecord | null = null;
    try {
      snapshotRecord = await readMostRecentSnapshot(
        this.supabase,
        this.leagueId,
      );
    } catch (err) {
      structuredLogger.warn('snapshot.bootstrap.read_failed', {
        lobbyId: this.lobbyId,
        leagueId: this.leagueId,
      });
      void err; // already logged inside readMostRecentSnapshot
    }

    if (snapshotRecord) {
      let maxSeq: number;
      let minSeq: number;
      try {
        maxSeq = await findMaxEventSeq(this.supabase, this.leagueId);
        minSeq = await findMinEventSeq(this.supabase, this.leagueId);
      } catch (err) {
        structuredLogger.warn('snapshot.bootstrap.fallback_full_replay', {
          lobbyId: this.lobbyId,
          leagueId: this.leagueId,
          reason: 'payload_deserialization_failed',
          details: 'failed to read seq bounds from draft_events',
        });
        void err;
        return this.bootstrapFullEventReplay();
      }

      const validation = validateSnapshotForBootstrap(
        snapshotRecord,
        maxSeq,
        minSeq,
      );
      // Narrow via property-existence (`'reason' in validation`)
      // rather than via the `ok` discriminator — narrowing on
      // `validation.ok` is unreliable under server/tsconfig.json's
      // `strict: false` setting; `in`-based narrowing works in
      // either mode (same pattern as uws-server.ts verifyDraftToken
      // handling).
      if ('reason' in validation) {
        structuredLogger.warn('snapshot.bootstrap.fallback_full_replay', {
          lobbyId: this.lobbyId,
          leagueId: this.leagueId,
          reason: validation.reason,
          ...(validation.details !== undefined
            ? { details: validation.details }
            : {}),
        });
        return this.bootstrapFullEventReplay();
      }

      // Apply the snapshot's base state.
      this.applySnapshot(snapshotRecord);

      // Read + replay delta events via existing apply-during-replay
      // handlers. Canonical-replay principle preserved.
      let deltaEvents: DraftEventRow[];
      try {
        deltaEvents = await this.draftService.listDraftEvents(
          this.leagueId,
          snapshotRecord.lastAppliedSeq,
        );
      } catch (err) {
        structuredLogger.error(
          'snapshot.bootstrap.delta_read_failed',
          { lobbyId: this.lobbyId, leagueId: this.leagueId },
          err,
        );
        throw err;
      }

      for (const event of deltaEvents) {
        this.applyEventDuringBootstrap(event);
      }

      structuredLogger.info('snapshot.bootstrap.applied', {
        lobbyId: this.lobbyId,
        leagueId: this.leagueId,
        snapshotSeq: snapshotRecord.lastAppliedSeq,
        deltaEvents: deltaEvents.length,
      });
      return;
    }

    // No snapshot exists — first-deploy scenario. Fall through to
    // full event-replay (existing chunk 11g.4 step 6b behavior).
    return this.bootstrapFullEventReplay();
  }

  /**
   * Apply a `SnapshotRecord` to engine in-memory state. Restores
   * format-specific projection fields from the wire snapshot +
   * orchestration fields from `engineState`. Called by `bootstrap`
   * before delta-event replay.
   *
   * The wire `DraftSnapshot.recentEvents` ring buffer is hydrated
   * directly into the engine's ring buffer (these are already in
   * the wire-shape `BufferedDraftEvent` form).
   */
  private applySnapshot(record: SnapshotRecord): void {
    const { snapshot, engineState } = record;
    const state = snapshot.stateSnapshot;

    // Status — common to both formats.
    this.draftStatus = state.draftStatus as DraftStatus;

    if (snapshot.format === 'auction') {
      // Auction projection state.
      this.nominationsCompleted = state.picksMade;
      const aux = snapshot.auctionState;
      if (aux) {
        // currentNomination — wire shape carries clockDeadline as
        // ISO string; engine wants a Date.
        if (aux.currentNomination) {
          this.currentNomination = {
            nominationId: aux.currentNomination.nominationId,
            playerId: aux.currentNomination.playerId,
            // playerName isn't in AuctionStateSnapshot; recover
            // empty string (the engine derives display only via
            // the broadcast event payloads, not this field).
            playerName: '',
            nominatorTeamId: aux.currentNomination.nominatorTeamId,
            leadingBidderId: aux.currentNomination.leadingBidderId,
            leadingBid: aux.currentNomination.leadingBid,
            expiresAt: new Date(aux.currentNomination.clockDeadline),
            timerHandle: null,
          };
        }
        // teamBudgets / teamPlayersWon (note: aux carries
        // teamRosterSlotsRemaining, which is `draftRounds -
        // players_won` — invert to recover playersWon).
        for (const [teamId, budget] of Object.entries(aux.teamBudgets)) {
          this.teamBudgets.set(teamId, budget);
        }
        for (const [teamId, slotsRemaining] of Object.entries(
          aux.teamRosterSlotsRemaining,
        )) {
          this.teamPlayersWon.set(teamId, this.draftRounds - slotsRemaining);
        }
      }
    } else {
      // Snake/linear projection state.
      this.picksMade = state.picksMade;
    }

    // Engine-internal orchestration fields.
    this.currentTimerKind = engineState.currentTimerKind;
    this.pauseState = engineState.pauseState;
    this.eventsSinceLastSnapshot = engineState.eventsSinceLastSnapshot;

    // Chunk 11g.7 sub-step 7e: seed the dedup cursor from the
    // snapshot. Subsequent delta-event apply via
    // `applyEventDuringBootstrap` will advance it further.
    this.lastAppliedSeq = record.lastAppliedSeq;

    // Hydrate the ring buffer from the snapshot's recentEvents.
    // These are already in the engine's wire-shape; append directly
    // (NOT appendEventAndCount — replay shouldn't increment the
    // milestone counter).
    for (const event of snapshot.recentEvents) {
      this.events.append(event);
    }
  }

  /**
   * Dispatch a single durable `DraftEventRow` to the appropriate
   * apply-during-replay handler. Used by both the snapshot+delta
   * path (delta events post-snapshot) and the full event-replay
   * fallback. Mirrors the dispatch switch in
   * `bootstrapFullEventReplay` but doesn't track aggregate counters
   * (those are full-replay's diagnostic concern).
   */
  private applyEventDuringBootstrap(event: DraftEventRow): void {
    // Chunk 11g.7 sub-step 7e: advance the dedup cursor monotonically
    // so the LISTEN/NOTIFY path can dedup against bootstrap-applied
    // events. Events arrive in seq order from the durable log; this
    // assignment effectively becomes `this.lastAppliedSeq = event.seq`
    // but using max() defends against any future caller that replays
    // out-of-order (e.g., a chunk-7e cross-process apply path
    // re-entering this method through the queue).
    if (event.seq > this.lastAppliedSeq) {
      this.lastAppliedSeq = event.seq;
    }
    switch (event.event_type) {
      case 'pick':
        this.applyPickEvent(event);
        break;
      case 'pick_undone':
        this.applyPickUndoneEvent(event);
        break;
      case 'commissioner_override':
        this.applyCommissionerOverrideEvent(event);
        break;
      case 'draft_started': {
        // F27 (2026-08-06) — draft ignition receiver. Paired with
        // start_draft_v2 (migration 20260807000000).
        //
        // F27b-1 (2026-08-07): case body extracted into shared method
        // `applyDraftStartedEventState` so bootstrapFullEventReplay's
        // switch can invoke it (previously the switch had NO case for
        // draft_started and dropped the event as forward-compat-skip —
        // fresh-lobby bootstrap of ignited leagues left draftStatus
        // 'not_started', timer never armed, scanner-invisible).
        //
        // Live-path semantics preserved: shared method does append +
        // guarded flip; live path additionally arms the timer inline
        // if (and only if) the flip actually fired. Guard-skip due to
        // stale in-memory status must NOT re-arm from a stale seq-1
        // payload deadline (Bar 2 / R2 arm-exactly-once discipline).
        // Bootstrap path calls shared method WITHOUT arming — init's
        // post-replay catch-up at line 974 arms once from
        // initialPickDeadline (matches applyPickEvent's no-per-event-
        // arm-thrash convention).
        const startedPayload = event.payload as Record<string, unknown>;
        const firstPickDeadline =
          typeof startedPayload.first_pick_deadline === 'string'
            ? startedPayload.first_pick_deadline
            : '';
        const didFlip = this.applyDraftStartedEventState(event);
        if (didFlip && firstPickDeadline.length > 0) {
          const parsed = new Date(firstPickDeadline);
          if (!Number.isNaN(parsed.getTime())) {
            // E113 primary miss: draft_started external apply also
            // bypassed the instant-autopick helper on dcaeeeb9-draft.
            // Routed through armPickDeadline as of E113.
            this.armPickDeadline(parsed);
          }
        }
        break;
      }
      case 'draft_completed': {
        // F26 / KI-035 (2026-08-06) — reverse the "no wire representation"
        // default for this event. Prior behavior (pre-F26): mutate
        // draftStatus only; central broadcast path at line 5519 fails
        // its tail check (no append) → observers never receive the
        // completion frame → clients stare at a locked draft-room
        // until they infer state some other way. F24 acceptance
        // (2026-08-05) recorded exactly this — architect adjudicated
        // as KI-035, gated before THE TWELVE.
        //
        // F26 fix — three actions in this case:
        //   1. Append a BufferedDraftEvent of kind='draft_completed'
        //      to this.events so the central broadcast path's
        //      peekLast() tail check passes (line 5519-5531).
        //   2. Mutate draftStatus.
        //   3. Cancel the armed pick timer + null the deadline —
        //      mirrors the internal-path teardown at 1826-1832 (which
        //      runs when processSubmitPick's completion else-branch
        //      returns). Prevents F20 guard from absorbing a stray
        //      "clock fired but draftStatus=completed" WARNING (Rider 4
        //      assert E).
        //
        // TEARDOWN — accepted as SATISFIED-BY-DESIGN via idle-reap
        // (architect ratification 2026-08-06). Post-completion,
        // discovery's status gate stops new joins; connected clients
        // linger to view the final board (celebration UI in F28/
        // P5-slice-1); the lobby reaper collects on its normal
        // schedule. F27 lifecycle-acceptance adds a POST-RUN
        // OBSERVATION (not a gate): the lobby is reaped on schedule
        // post-completion, no zombie. KI-035 "initiate teardown"
        // scope line reads as satisfied — actions (1) + (2) + (3)
        // above + idle-reap-on-schedule = the full teardown pipeline.
        //
        // BufferedDraftEvent carries the TRUE event seq (architect
        // condition 2), not a synthesized value.
        const completionPayload = event.payload as Record<string, unknown>;
        const completedAt =
          typeof completionPayload.completed_at === 'string'
            ? completionPayload.completed_at
            : event.created_at;
        const totalPicks =
          typeof completionPayload.total_picks === 'number'
            ? completionPayload.total_picks
            : 0;
        const bufferedCompleted: BufferedDraftEvent = {
          kind: 'draft_completed',
          seq: event.seq,
          timestamp: event.created_at,
          correlationId: event.idempotency_key ?? '',
          completedAt,
          totalPicks,
        };
        this.events.append(bufferedCompleted);
        this.draftStatus = 'completed';
        this.cancelPickTimer();
        this.currentTimerDeadline = null;
        break;
      }
      case 'draft_cancelled':
        this.draftStatus = 'cancelled';
        break;
      case 'draft_paused':
        this.pauseState = {
          pausedAt: new Date(
            ((event.payload as Record<string, unknown>).paused_at as string) ??
              event.created_at,
          ),
          remainingMs:
            ((((event.payload as Record<string, unknown>).remaining_seconds as number) ??
              0) *
              1000),
          pausedTimerKind: 'bid_window',
        };
        break;
      case 'draft_resumed':
        // Chunk 10c-2 batch 2 (2026-07-27): re-arm the pick timer from
        // the event's new_pick_deadline. Live external-apply path uses
        // THIS dispatcher (`applyEventDuringBootstrap` — see the
        // matching processExternalEvent call at line 4897). Same
        // defect class as applyPickEvent — the LIVE apply must re-arm
        // or the engine's stale timer will fire against an
        // out-of-date deadline. Bootstrap-mode still has init()'s
        // covering fallback (line 920) reading leagues.pick_deadline.
        this.pauseState = null;
        {
          const resumedDeadline = (event.payload as Record<string, unknown>)
            .new_pick_deadline;
          if (typeof resumedDeadline === 'string' && resumedDeadline.length > 0) {
            const parsed = new Date(resumedDeadline);
            if (!Number.isNaN(parsed.getTime()) && this.draftStatus === 'in_progress') {
              // E113: resume is a new on-clock transition — ownerless
              // seats should get the instant-autopick treatment.
              // Routed through armPickDeadline.
              this.armPickDeadline(parsed);
            }
          }
        }
        break;
      case 'draft_extended':
        // Chunk 10c-2 batch 2 (2026-07-27): draft_extended was NOT in
        // this dispatcher's switch previously (fell through to default
        // — the live-apply skip). Adding it with re-arm. new_pick_deadline
        // has been in the event payload since chunk 11g.4 and is
        // guaranteed present per validate_draft_event_payload; presence
        // guard here is defense-in-depth.
        {
          const extendedDeadline = (event.payload as Record<string, unknown>)
            .new_pick_deadline;
          if (typeof extendedDeadline === 'string' && extendedDeadline.length > 0) {
            const parsed = new Date(extendedDeadline);
            if (!Number.isNaN(parsed.getTime()) && this.draftStatus === 'in_progress') {
              // E113 EXEMPT: draft_extended is commissioner-explicit
              // "add time to the current pick's clock". Routing
              // through armPickDeadline would silently shorten the
              // extension back to the instant-autopick window for
              // ownerless seats — defeating the extension. Extend
              // semantics preserve the full RPC deadline for both
              // owned and unowned seats. Direct setPickDeadline call
              // is intentional; the test suite pins this exemption.
              this.setPickDeadline(parsed, 'pick');
            }
          }
        }
        break;
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
        this.applyAuctionPausedEvent(event);
        break;
      case 'auction_resumed':
        this.applyAuctionResumedEvent(event);
        break;
      case 'auction_auto_nominated':
        this.applyAuctionAutoNominatedEvent(event);
        break;
      case 'auction_nomination_skipped':
        this.applyAuctionNominationSkippedEvent(event);
        break;
      case 'auction_commissioner_override':
        this.applyAuctionCommissionerOverrideEvent(event);
        break;
      default:
        // Forward-compat skip; existing bootstrapFullEventReplay
        // covers the diagnostic-vs-unknown distinction.
        break;
    }
  }

  /**
   * Read the durable event log for this lobby's `leagueId` and
   * replay each row into the in-memory state machine. Validates
   * seq contiguity, payload-vs-draftOrder consistency for pick
   * events, and emits typed errors on any inconsistency.
   *
   * **This is the canonical bootstrap fallback (chunk 11g.4 step 6b).**
   * Snapshot+delta replay (chunk 11g.7 sub-step 7c) is an optimization
   * that defers to this path on any snapshot issue.
   *
   * Performance: typical 12-team × 21-round draft (252 events) is a
   * single index scan on `(league_id, seq)` plus an in-memory walk;
   * end-to-end latency is dominated by the round-trip to Postgres
   * (~10-50ms in production, <1ms in unit tests with mocked service).
   */
  private async bootstrapFullEventReplay(): Promise<void> {
    const startTime = Date.now();

    let events: DraftEventRow[];
    try {
      events = await this.draftService.listDraftEvents(this.leagueId);
    } catch (err) {
      structuredLogger.error(
        `[lobby] bootstrap listDraftEvents failed lobbyId=${this.lobbyId} leagueId=${this.leagueId}`,
        {}, err,
      );
      throw err;
    }

    let prevSeq: number | null = null;
    let pickEventCount = 0;
    let undoneEventCount = 0;
    let overrideEventCount = 0;
    let lifecycleEventCount = 0;
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
        case 'draft_started':
          // F27b-1 (2026-08-07): bootstrap replay of ignited leagues
          // must apply draft_started. Previously fell to default:
          // "forward-compat skip" WARN — draftStatus stayed 'not_started',
          // timer never armed, scanClockLiveness skipped via its
          // status guard (LobbyRegistry.ts:942). Fresh-lobby bootstrap
          // of any post-ignition league stalled indefinitely.
          // Observed 2026-08-07 STEP 5' rig failure + engine log
          // verbatim "[lobby] bootstrap unknown event_type=draft_started
          // seq=1 (forward-compat skip)".
          //
          // Bar 2 discipline (arm-exactly-once): shared state-apply
          // method flips status but does NOT arm the timer. The arm
          // happens exactly once at init's post-replay catch-up
          // (line 974 for snake/linear) from initialPickDeadline
          // (which now stashes from event payload in the R1 branch of
          // applyDraftStartedEventState — closes the dead-lobby razor
          // race between construction-time row read and replay-time
          // event availability). Matches applyPickEvent's convention
          // (line 3317+) which also does no per-event timer arm
          // during replay.
          this.applyDraftStartedEventState(event);
          lifecycleEventCount++;
          break;
        case 'draft_completed':
          // Belt-and-suspenders alongside the natural picksMade ===
          // draftOrder.length derivation in applyPickEvent. A draft
          // can be marked complete by the commissioner before all
          // slots are filled (early termination); in that case the
          // explicit event is the source of truth.
          //
          // Pre-existing inconsistency (ledger note L2, 2026-08-07):
          // this case does NOT append to this.events (the live-apply
          // path at case 'draft_completed' :2988 DOES). Ring buffer
          // resync therefore lacks the draft_completed frame for a
          // fresh-lobby bootstrap of a completed league. Not fixed
          // in F27b-1 (out of scope; drafts stay reachable post-
          // completion for celebration UI, so completion frame
          // absence is currently benign). Distinct from F27b-1's
          // draft_started append which IS present in both paths for
          // buffer contiguity behind the pick sequence.
          this.draftStatus = 'completed';
          lifecycleEventCount++;
          break;
        case 'draft_cancelled':
          this.draftStatus = 'cancelled';
          lifecycleEventCount++;
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
            // Snake/linear `draft_paused` doesn't have a meaningful
            // `pausedTimerKind` — populate as 'bid_window' as a
            // harmless backward-compat default. The engine consults
            // `format` to decide the restore path; this field is
            // load-bearing only for auction.
            pausedTimerKind: 'bid_window',
          };
          lifecycleEventCount++;
          break;
        case 'draft_resumed':
          // Step 6c: clear pause state.
          // Chunk 10c-2 batch 2 (2026-07-27): also re-arm the pick timer
          // from the event's new_pick_deadline. Pre-batch-2 relied on
          // init()'s post-replay leagues.pick_deadline read — fine for
          // bootstrap but LEFT LIVE draft_resumed events (via
          // processExternalEvent) without any re-arm. Same defect
          // class as applyPickEvent — re-arm is now inline. Bootstrap
          // still has the covering init() fallback.
          this.pauseState = null;
          {
            const resumedDeadline = (event.payload as Record<string, unknown>)
              .new_pick_deadline;
            if (typeof resumedDeadline === 'string' && resumedDeadline.length > 0) {
              const parsed = new Date(resumedDeadline);
              if (!Number.isNaN(parsed.getTime()) && this.draftStatus === 'in_progress') {
                // E113: same rationale as the sibling dispatcher —
                // resume is a fresh on-clock transition, ownerless
                // seats should get instant-autopick.
                this.armPickDeadline(parsed);
              }
            }
          }
          lifecycleEventCount++;
          break;
        case 'draft_extended':
          // Deadline-extension event (commissioner adds time to the
          // current pick's clock).
          // Chunk 10c-2 batch 2 (2026-07-27): re-arm from
          // new_pick_deadline on live apply. Bootstrap covered by
          // init()'s leagues.pick_deadline read; the inline re-arm here
          // makes the LIVE external-apply path correct without needing
          // a mode flag.
          {
            const extendedDeadline = (event.payload as Record<string, unknown>)
              .new_pick_deadline;
            if (typeof extendedDeadline === 'string' && extendedDeadline.length > 0) {
              const parsed = new Date(extendedDeadline);
              if (!Number.isNaN(parsed.getTime()) && this.draftStatus === 'in_progress') {
                // E113 EXEMPT: same as the sibling dispatcher —
                // draft_extended is commissioner-explicit time
                // addition. Routing through armPickDeadline would
                // undo the extension for ownerless seats. Direct
                // setPickDeadline call is intentional.
                this.setPickDeadline(parsed, 'pick');
              }
            }
          }
          structuredLogger.debug(
            `[lobby] bootstrap applying draft_extended event ` +
              `seq=${event.seq} lobbyId=${this.lobbyId}`,
          );
          lifecycleEventCount++;
          break;
        case 'autopick_failed':
        case 'generation_bumped':
          // Diagnostic / internal versioning. No state-machine impact.
          structuredLogger.debug(
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
          this.applyAuctionPausedEvent(event);
          break;
        case 'auction_resumed':
          this.applyAuctionResumedEvent(event);
          break;
        // ── Auction events (chunk 11g.6 sub-step 6c3) ─────────────────
        case 'auction_auto_nominated':
          this.applyAuctionAutoNominatedEvent(event);
          break;
        case 'auction_nomination_skipped':
          this.applyAuctionNominationSkippedEvent(event);
          break;
        // ── Auction events (chunk 11g.6 sub-step 6c4) ─────────────────
        case 'auction_commissioner_override':
          this.applyAuctionCommissionerOverrideEvent(event);
          break;
        default:
          // Forward-compat for any future additions. Today the
          // migration's CHECK enum admits the 9 event types listed
          // in the cases above; encountering an unknown type means
          // a newer chunk added one that this engine doesn't handle.
          structuredLogger.warn(
            `[lobby] bootstrap unknown event_type=${event.event_type} ` +
              `seq=${event.seq} lobbyId=${this.lobbyId} ` +
              `(forward-compat skip)`,
          );
          skippedCount++;
          break;
      }
    }

    // F27b-2 (2026-08-08 architect ratification): advance lastAppliedSeq
    // to the highest replayed seq (prevSeq at loop exit). Prior omission
    // left the cursor at 0 post-full-replay; any subsequent NOTIFY passed
    // the guard at :5659 (0 < any seq), re-fetched ALL events via
    // listDraftEvents(sinceSeq=0), and iterated through
    // applyEventDuringBootstrap — re-applying seq 1 draft_started (the
    // observed WARN "draft_started_apply.skipped_stale_status" on
    // c3615619 at 2026-08-08T06:38:35.899Z), appending a duplicate seq-1
    // buffered event to the ring buffer (unconditional append inside
    // applyDraftStartedEventState at :3373), and potentially re-broadcasting
    // via the peekLast() tail-check at :5791. Latent scope beyond F27b-2:
    // hypothetical in-progress-league-no-snapshot bootstrap would also
    // re-apply pick events on first post-bootstrap NOTIFY, throwing at
    // applyPickEvent's slot-check (:3416-3422) because picksMade already
    // advanced during bootstrap. Snapshot+delta path is the common route
    // for post-pick drafts, so this latent case rarely surfaces, but the
    // fix closes it as a side effect.
    //
    // The advance mirrors applyEventDuringBootstrap's cursor discipline
    // at :2825-2826 (single source of truth for cursor advancement is
    // "any event applied to state"; bootstrap-full-replay was the one
    // path that violated this).
    if (prevSeq !== null) {
      this.lastAppliedSeq = prevSeq;
    }
    const duration = Date.now() - startTime;
    structuredLogger.info(
      `[lobby] bootstrap replay complete lobbyId=${this.lobbyId} ` +
        `totalEvents=${events.length} pickEvents=${pickEventCount} ` +
        `undoneEvents=${undoneEventCount} overrideEvents=${overrideEventCount} ` +
        `lifecycleEvents=${lifecycleEventCount} skipped=${skippedCount} ` +
        `picksMade=${this.picksMade} status=${this.draftStatus} ` +
        `lastAppliedSeq=${this.lastAppliedSeq} ` +
        `duration=${duration}ms`,
    );
  }

  /**
   * Shared state-apply for `draft_started` events. Called by BOTH
   * dispatchers:
   *   - `applyEventDuringBootstrap` (LIVE NOTIFY, case 'draft_started'
   *     near line 2833)
   *   - `bootstrapFullEventReplay` (REPLAY, case 'draft_started' in
   *     the switch above)
   *
   * Actions:
   *   1. Append a `BufferedDraftEvent` of kind='draft_started' to
   *      `this.events` — keeps the ring buffer contiguous behind the
   *      pick sequence for late-joiner resync. Live path relies on
   *      this append for the central broadcast path's tail check
   *      (peekLast at line 5519-5531).
   *   2. Stash `payload.first_pick_deadline` into
   *      `this.initialPickDeadline` if that field is still null
   *      (R1 dead-lobby razor race close). Construction reads
   *      `leagues.pick_deadline`; if ignition commits BETWEEN row
   *      read and event log read, the row was pre-ignition (null
   *      deadline) while the log has the ignition event — without
   *      this stash, replay flips status but post-replay catch-up at
   *      line 974 skips on null deadline, leaving the lobby dead
   *      with scanner edge (a) invisible-to-null-deadline. Stash is
   *      safe by construction: mid-draft restart has non-null row
   *      (picks maintain leagues.pick_deadline via applyPickEvent's
   *      broadcast path); completed-league replay stashes harmlessly
   *      (post-replay guard requires in_progress); flip-era leagues
   *      have no draft_started event and never reach this method.
   *   3. Guarded flip of `draftStatus` from 'not_started' to
   *      'in_progress'. Skip if in-memory status is stale (already
   *      in_progress from a prior lifecycle apply, or completed) —
   *      Bar 2 discipline: the DIDflip return distinguishes true
   *      transitions from re-plays so the live caller can gate its
   *      inline arm on didFlip and NOT re-arm from a stale seq-1
   *      payload deadline.
   *
   * **DOES NOT arm the pick timer.** The live-apply site (case
   * 'draft_started' at :2833) arms inline AFTER this call when
   * `didFlip === true`. The bootstrap-apply site (case 'draft_started'
   * in the switch above) omits the inline arm; init's post-replay
   * catch-up at line 974 arms exactly once from
   * `this.initialPickDeadline` (potentially just stashed here by R1)
   * on final replayed state. Matches `applyPickEvent`'s convention
   * (line 3317+) which also does no per-event timer arm during
   * replay — arm-exactly-once-from-final-state discipline.
   *
   * Observability (F27b freebie, 2026-08-07 architect approval): if
   * the guard REFUSES because in-memory status is stale, emit a WARN
   * with actual vs expected values so the refusal is visible instead
   * of silent. Pure observability; no behavior change.
   *
   * @returns `true` iff draftStatus flipped from 'not_started' to
   *   'in_progress' during this call. Live caller gates its inline
   *   timer arm on this to avoid re-arming from a stale seq-1 payload
   *   deadline when a legitimate later apply (e.g. a pick that
   *   already advanced the deadline) has since taken over.
   */
  private applyDraftStartedEventState(event: DraftEventRow): boolean {
    const startedPayload = event.payload as Record<string, unknown>;
    const startedAt =
      typeof startedPayload.started_at === 'string'
        ? startedPayload.started_at
        : event.created_at;
    const firstPickDeadline =
      typeof startedPayload.first_pick_deadline === 'string'
        ? startedPayload.first_pick_deadline
        : '';
    const totalRounds =
      typeof startedPayload.total_rounds === 'number'
        ? startedPayload.total_rounds
        : 0;
    const totalTeams =
      typeof startedPayload.total_teams === 'number'
        ? startedPayload.total_teams
        : 0;
    const pickTimeLimitSeconds =
      typeof startedPayload.pick_time_limit_seconds === 'number'
        ? startedPayload.pick_time_limit_seconds
        : 0;
    const draftFormat =
      typeof startedPayload.draft_format === 'string'
        ? (startedPayload.draft_format as DraftFormat)
        : 'snake';

    // Action 1: append to ring buffer (contiguity for resync).
    const bufferedStarted: BufferedDraftEvent = {
      kind: 'draft_started',
      seq: event.seq,
      timestamp: event.created_at,
      correlationId: event.idempotency_key ?? '',
      startedAt,
      firstPickDeadline,
      totalRounds,
      totalTeams,
      pickTimeLimitSeconds,
      draftFormat,
    };
    this.events.append(bufferedStarted);

    // Action 2: R1 stash — close dead-lobby razor race between
    // construction-time leagues.pick_deadline read and event log
    // read. Only fires when the row was pre-ignition at construction;
    // safe in every other lifecycle (see method-header safety note).
    if (this.initialPickDeadline === null && firstPickDeadline.length > 0) {
      const parsed = new Date(firstPickDeadline);
      if (!Number.isNaN(parsed.getTime())) {
        this.initialPickDeadline = parsed;
      }
    }

    // Action 3: guarded status flip. Return didFlip so the live
    // caller can gate its inline arm — Bar 2 discipline.
    if (this.draftStatus === 'not_started' && firstPickDeadline.length > 0) {
      const parsed = new Date(firstPickDeadline);
      if (!Number.isNaN(parsed.getTime())) {
        this.draftStatus = 'in_progress';
        return true;
      }
    }

    structuredLogger.warn('draft_started_apply.skipped_stale_status', {
      lobbyId: this.lobbyId,
      leagueId: this.leagueId,
      seq: event.seq,
      currentDraftStatus: this.draftStatus,
      firstPickDeadlinePresent: firstPickDeadline.length > 0,
      reason: this.draftStatus !== 'not_started'
        ? 'in_memory_status_not_not_started'
        : 'missing_first_pick_deadline',
    });
    return false;
  }

  /**
   * Bootstrap handler for `event_type === 'pick'`. Validates the
   * payload against the expected slot at `draftOrder[picksMade]`,
   * appends a translated `pick_submitted` entry to the ring buffer,
   * advances `picksMade` and `draftStatus`.
   */
  private applyPickEvent(event: DraftEventRow): void {
    // AUCTION FOREIGN-PICK GUARD (2026-09-03). Auction lobbies are
    // constructed with `draftOrder: []` (index.ts:381), so the guard
    // immediately below (`picksMade >= draftOrder.length`, i.e. 0 >= 0
    // on the very first pick row) THROWS for every `pick` event that
    // lands in an auction league's log. Those rows do still arrive in
    // production: the pg_cron `draft-deadline-sweep` +
    // `draft-autopick-keepalive` safety net is format-blind and wrote
    // 53 of them into auction league a1a125c8 on 2026-09-01,
    // taking that auction to `draft_completed` as a snake draft.
    //
    // The throw is far worse than the stray row it reports:
    //   - LIVE rail: `processExternalEvent`'s per-event catch aborts
    //     the whole NOTIFY batch with a bare `return`, so any later
    //     event in the same fetch is dropped for that pass.
    //   - BOOTSTRAP rail: `bootstrapFullEventReplay`'s switch has no
    //     per-event try/catch, so the throw rejects `bootstrap()` and
    //     therefore `init()`. An auction league whose log contains one
    //     stray pick can then never have a lobby constructed again,
    //     which takes the draft room down for good.
    //
    // A `pick` row is foreign to the auction state machine anyway
    // (auction state is `currentNomination` / `teamBudgets` /
    // `nominationsCompleted`, none of which a pick row addresses), so
    // skip it loudly rather than wedging the room. Snake and linear
    // behaviour is untouched.
    if (this.format === 'auction') {
      structuredLogger.warn(
        `[lobby] pick event in auction lobby, skipped as foreign to the auction state machine lobbyId=${this.lobbyId} seq=${event.seq}`,
      );
      return;
    }
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
    // Chunk 10c-2 batch 3 C2 (2026-07-28): mirror the durable payload's
    // pick_deadline into the wire event so clients can re-arm their
    // countdown UI symmetric with the engine's own setPickDeadline
    // re-arm (batch 2 pattern). Present iff the pick event was written
    // by a post-batch-2 RPC; absent for v1 legacy events replayed at
    // bootstrap (client guards on presence).
    const rawPickDeadline = (event.payload as Record<string, unknown>).pick_deadline;
    const pickDeadlineForWire =
      typeof rawPickDeadline === 'string' && rawPickDeadline.length > 0
        ? rawPickDeadline
        : undefined;
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
      ...(pickDeadlineForWire !== undefined ? { pickDeadline: pickDeadlineForWire } : {}),
    };
    this.events.append(buffered);

    this.picksMade++;
    if (this.draftStatus === 'not_started') {
      this.draftStatus = 'in_progress';
    }
    if (this.picksMade >= this.draftOrder.length) {
      this.draftStatus = 'completed';
    }

    // ── Chunk 10c-2 batch 2 (2026-07-27): re-arm the pick timer from
    // the durable payload's pick_deadline field.
    //
    // Pre-batch-2 behavior: applyPickEvent advanced state but never
    // re-armed the timer. Every human pick (which flows through the
    // external NOTIFY path since production picks are submitted via
    // POST /api/draft/v2/league/:leagueId/pick, not through the
    // engine's own processSubmitPick) left the engine's timer pointed
    // at the ORIGINAL bootstrap deadline — leading to stall (if the
    // stale deadline was in the future) or premature-steal (if it was
    // in the past). See PROJECT_PLAN.md Decision Log 2026-07-27
    // "S5 exposed: external-event apply does not re-arm the pick-
    // deadline timer" for the verify report.
    //
    // Backwards compat: v1 events written before the paired migration
    // `20260727010000_pick_event_carries_pick_deadline.sql` have no
    // pick_deadline field in the payload. Presence-guard here: skip
    // the re-arm when the field is missing. During bootstrap replay,
    // the engine's init() post-replay step (line 920) arms from
    // leagues.pick_deadline as a single-pass covering-fallback for
    // pre-migration rows.
    //
    // Draft transitions to `completed` here (line above) skip the re-arm:
    // the final pick has no successor to arm a clock for.
    const rawDeadline = payload.pick_deadline;
    if (
      typeof rawDeadline === 'string' &&
      rawDeadline.length > 0 &&
      this.draftStatus === 'in_progress'
    ) {
      const parsed = new Date(rawDeadline);
      if (!Number.isNaN(parsed.getTime())) {
        // ENGINE-EAR v3 Slice 1 item 6 (E106 + E113): route through
        // the armPickDeadline wrapper. Same effect as the pre-E113
        // inline pattern (setPickDeadline + computeArmDeadlineForOnClockTeam)
        // but funnels through the single entry point so future
        // arm sites cannot bypass the helper silently. The DB's
        // pick_deadline column stays the RPC value; only the
        // engine's local timer fires early. Client renders full
        // countdown briefly then the autopick event lands.
        this.armPickDeadline(parsed);
      } else {
        structuredLogger.warn(
          `[lobby] applyPickEvent pick_deadline unparseable ` +
            `lobbyId=${this.lobbyId} seq=${event.seq} raw=${String(rawDeadline)}`,
        );
      }
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

  /**
   * Bootstrap handler for `event_type === 'auction_auto_nominated'`
   * (chunk 11g.6 sub-step 6c3 per ADR-002 §3.4 + §4.2).
   *
   * Treated symmetrically with `auction_nomination_started` for
   * state-machine purposes — both set `currentNomination`. The
   * `fallbackSource` discriminator is preserved in the ring buffer
   * for client UI to render an "🤖 Auto-nominated" badge.
   *
   * Per the canonical-replay principle from 6b: APPLY during
   * replay, not log-and-skip.
   */
  private applyAuctionAutoNominatedEvent(event: DraftEventRow): void {
    const payload = event.payload as Record<string, unknown>;
    const nominationId = String(payload.nomination_id);
    const playerId = String(payload.player_id);
    const playerName = String(payload.player_name ?? '');
    const nominatorTeamId = String(payload.nominator_team_id);
    const openingBid = Number(payload.opening_bid);
    const expiresAt = new Date(String(payload.expires_at));
    const fallbackSourceRaw = String(payload.fallback_source ?? 'projections');
    const fallbackSource: 'queue' | 'projections' | 'commissioner_preset' =
      fallbackSourceRaw === 'queue'
        ? 'queue'
        : fallbackSourceRaw === 'commissioner_preset'
          ? 'commissioner_preset'
          : 'projections';

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
      kind: 'auction_auto_nominated',
      seq: event.seq,
      timestamp: event.created_at,
      nominationId,
      playerId,
      playerName,
      nominatorTeamId,
      openingBid,
      clockDeadline: expiresAt.toISOString(),
      fallbackSource,
      correlationId: event.idempotency_key ?? '',
    });
  }

  /**
   * Bootstrap handler for `event_type === 'auction_nomination_skipped'`
   * (chunk 11g.6 sub-step 6c3 — Path Y extension of ADR-002).
   *
   * No `currentNomination` mutation (skip means no nomination
   * happened). Just advances `nominationsCompleted` so the rotation
   * pointer moves forward; cascade-completion check fires if the
   * skip was the final pending action.
   */
  private applyAuctionNominationSkippedEvent(event: DraftEventRow): void {
    const payload = event.payload as Record<string, unknown>;
    const skippedTeamId = String(payload.skipped_team_id);
    const reasonRaw = String(payload.reason ?? 'insufficient_budget');
    const reason: 'insufficient_budget' | 'no_eligible_players' =
      reasonRaw === 'no_eligible_players'
        ? 'no_eligible_players'
        : 'insufficient_budget';

    this.nominationsCompleted++;

    this.events.append({
      kind: 'auction_nomination_skipped',
      seq: event.seq,
      timestamp: event.created_at,
      correlationId: event.idempotency_key ?? '',
      skippedTeamId,
      reason,
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
   * Bootstrap handler for `event_type === 'auction_commissioner_override'`
   * (chunk 11g.6 sub-step 6c4 per ADR-002 §4.4 + extensions).
   *
   * Polymorphic dispatch on `payload.override_action`. Each branch
   * mutates engine state to mirror what the corresponding runtime
   * handler did at the moment the event fired. Per the canonical-
   * replay principle from 6b: APPLY during replay, not log-and-skip.
   *
   * Append the polymorphic event to the ring buffer with the
   * full discriminator preserved so client UI can render
   * action-specific audit messages.
   */
  private applyAuctionCommissionerOverrideEvent(event: DraftEventRow): void {
    const payload = event.payload as Record<string, unknown>;
    const overrideActionRaw = String(payload.override_action);
    const commissionerUserId =
      payload.commissioner_user_id == null
        ? ''
        : String(payload.commissioner_user_id);
    const priorState = (payload.prior_state ?? {}) as Record<string, unknown>;
    const newState = (payload.new_state ?? {}) as Record<string, unknown>;
    const rationale =
      payload.rationale == null ? undefined : String(payload.rationale);

    // Apply state mutation per action.
    const overrideAction = overrideActionRaw as
      | 'revert_bid'
      | 'force_close_nomination'
      | 'award_to_team'
      | 'adjust_opening_bid'
      | 'adjust_budget'
      | 'cancel_nomination'
      | 'extend_bid_window';

    switch (overrideAction) {
      case 'revert_bid': {
        if (this.currentNomination !== null) {
          this.currentNomination.leadingBidderId = String(newState.leadingBidderId);
          this.currentNomination.leadingBid = Number(newState.leadingBid);
        }
        break;
      }
      case 'force_close_nomination': {
        const outcome = String(newState.outcome);
        if (outcome === 'sold') {
          const winnerId = String(newState.winnerTeamId);
          const finalAmount = Number(newState.finalAmount);
          const prevBudget = this.teamBudgets.get(winnerId) ?? 0;
          const prevWon = this.teamPlayersWon.get(winnerId) ?? 0;
          this.teamBudgets.set(winnerId, prevBudget - finalAmount);
          this.teamPlayersWon.set(winnerId, prevWon + 1);
        }
        this.currentNomination = null;
        this.nominationsCompleted++;
        const totalNominations = this.nominationOrder.length * this.draftRounds;
        if (
          this.nominationOrder.length > 0 &&
          this.nominationsCompleted >= totalNominations
        ) {
          this.draftStatus = 'completed';
        }
        break;
      }
      case 'award_to_team': {
        const winnerId = String(newState.awardedTeamId);
        const finalAmount = Number(newState.awardedAmount);
        const prevBudget = this.teamBudgets.get(winnerId) ?? 0;
        const prevWon = this.teamPlayersWon.get(winnerId) ?? 0;
        this.teamBudgets.set(winnerId, prevBudget - finalAmount);
        this.teamPlayersWon.set(winnerId, prevWon + 1);
        this.currentNomination = null;
        this.nominationsCompleted++;
        const totalNominations = this.nominationOrder.length * this.draftRounds;
        if (
          this.nominationOrder.length > 0 &&
          this.nominationsCompleted >= totalNominations
        ) {
          this.draftStatus = 'completed';
        }
        break;
      }
      case 'adjust_opening_bid': {
        if (this.currentNomination !== null) {
          this.currentNomination.leadingBid = Number(newState.leadingBid);
        }
        break;
      }
      case 'adjust_budget': {
        const teamId = String(newState.teamId);
        const newBudget = Number(newState.budgetRemaining);
        this.teamBudgets.set(teamId, newBudget);
        break;
      }
      case 'cancel_nomination': {
        // Redo semantics: nominationsCompleted does NOT advance.
        this.currentNomination = null;
        break;
      }
      case 'extend_bid_window': {
        if (this.currentNomination !== null) {
          this.currentNomination.expiresAt = new Date(
            String(newState.newClockDeadline),
          );
        }
        break;
      }
    }

    this.events.append({
      kind: 'auction_commissioner_override',
      seq: event.seq,
      timestamp: event.created_at,
      correlationId: event.idempotency_key ?? '',
      commissionerUserId,
      overrideAction,
      priorState,
      newState,
      ...(rationale !== undefined ? { rationale } : {}),
    });
  }

  /**
   * Bootstrap handler for `event_type === 'auction_paused'` (chunk
   * 11g.6 sub-step 6c1 per ADR-002 §4.4).
   *
   * **Apply during replay** per the canonical-replay principle from
   * 6b — the in-memory `pauseState` is the source of truth for
   * "engine knows the auction is paused", and bootstrap must mutate
   * it from event log replay. Without this, an engine that
   * bootstraps mid-pause would not know to suppress the bid-window
   * timer in `init()`'s post-replay schedule pass.
   *
   * Also cancels any pending pick-deadline timer that the START
   * event's apply may have scheduled (defensive — bootstrap doesn't
   * schedule timers itself, only `init()` post-replay does, and that
   * step gates on `pauseState === null`).
   */
  private applyAuctionPausedEvent(event: DraftEventRow): void {
    const payload = event.payload as Record<string, unknown>;
    const pausedAt = new Date(String(payload.paused_at ?? event.created_at));
    const capturedRemainingSeconds =
      payload.captured_remaining_seconds == null
        ? null
        : Number(payload.captured_remaining_seconds);
    const pausedNominationId =
      payload.paused_nomination_id == null
        ? null
        : String(payload.paused_nomination_id);
    const reason = String(payload.reason ?? 'commissioner');
    const commissionerUserId =
      payload.commissioner_user_id == null
        ? null
        : String(payload.commissioner_user_id);
    // Chunk 11g.6 sub-step 6c3: read `pausedTimerKind` from payload;
    // default to 'bid_window' for backward-compat with 6c1 events
    // that don't have this field.
    const pausedTimerKindRaw = payload.paused_timer_kind;
    const pausedTimerKind: 'bid_window' | 'nomination_window' =
      pausedTimerKindRaw === 'nomination_window'
        ? 'nomination_window'
        : 'bid_window';

    this.pauseState = {
      pausedAt,
      remainingMs:
        capturedRemainingSeconds === null
          ? 0
          : capturedRemainingSeconds * 1000,
      pausedTimerKind,
    };

    this.events.append({
      kind: 'auction_paused',
      seq: event.seq,
      timestamp: event.created_at,
      correlationId: event.idempotency_key ?? '',
      commissionerUserId,
      reason,
      pausedAt: pausedAt.toISOString(),
      ...(pausedNominationId !== null
        ? { pausedNominationId }
        : {}),
      ...(capturedRemainingSeconds !== null
        ? { capturedRemainingSeconds }
        : {}),
      pausedTimerKind,
    });
  }

  /**
   * Bootstrap handler for `event_type === 'auction_resumed'` (chunk
   * 11g.6 sub-step 6c1 per ADR-002 §4.4).
   *
   * Clears `pauseState`. If the event payload carries
   * `new_expires_at`, mutates `currentNomination.expiresAt` to it
   * (the resume RPC computed `now() +
   * captured_remaining_seconds * interval` and persisted it). Per
   * canonical-replay principle: in-memory state mirrors event-log
   * truth.
   */
  private applyAuctionResumedEvent(event: DraftEventRow): void {
    const payload = event.payload as Record<string, unknown>;
    const resumedAt = new Date(String(payload.resumed_at ?? event.created_at));
    const priorPauseEventId = Number(payload.prior_pause_event_id);
    const restoredNominationId =
      payload.restored_nomination_id == null
        ? null
        : String(payload.restored_nomination_id);
    const newExpiresAtRaw = payload.new_expires_at;
    const newExpiresAt =
      newExpiresAtRaw == null ? null : new Date(String(newExpiresAtRaw));
    const commissionerUserId =
      payload.commissioner_user_id == null
        ? null
        : String(payload.commissioner_user_id);

    this.pauseState = null;

    if (
      newExpiresAt !== null &&
      this.currentNomination !== null &&
      restoredNominationId === this.currentNomination.nominationId
    ) {
      this.currentNomination.expiresAt = newExpiresAt;
    }

    this.events.append({
      kind: 'auction_resumed',
      seq: event.seq,
      timestamp: event.created_at,
      correlationId: event.idempotency_key ?? '',
      commissionerUserId,
      resumedAt: resumedAt.toISOString(),
      priorPauseEventId,
      ...(restoredNominationId !== null
        ? { restoredNominationId }
        : {}),
      ...(newExpiresAt !== null
        ? { newClockDeadline: newExpiresAt.toISOString() }
        : {}),
    });
  }

  // ── Step 6c: pick deadline timer + autopick on timeout ─────────────

  /**
   * Schedule (or reschedule) the active timer. Cancels any existing
   * timer first so concurrent calls don't double-schedule.
   *
   * Chunk 11g.6 sub-step 6c3: `kind` parameter discriminates the
   * timer's semantics for `handleClockExpired` dispatch:
   *   - `'pick'`: snake/linear pick deadline → fires
   *     `handleAutopickTimeout` (chunk 11g.4 step 6c).
   *   - `'bid_window'`: auction nomination is open for bidding;
   *     fires `handleNominationTimeout` → close nomination.
   *   - `'nomination_window'`: auction is between nominations;
   *     fires `handleNominationWindowTimeout` → auto-nominate.
   *
   * If `deadline <= now()`, the timer fires on the next event-loop
   * tick. This handles the bootstrap-recovery path where the
   * engine starts after a deadline already passed.
   *
   * No-op if `shutDown` is true (graceful-shutdown protection
   * against late-firing timers post-shutdown).
   */
  /**
   * ENGINE-EAR v3 Slice 1 item 6 (E106, 2026-08-11) — compute the
   * arm deadline for the on-clock team, applying INSTANT-AUTOPICK
   * when the seat's owner is null.
   *
   * Semantics:
   *   - If the on-clock team's owner is null → override to
   *     `now + INSTANT_AUTOPICK_ARM_MS` (2s). Autopick fires
   *     within ~2s of the on-clock transition; ownerless seats
   *     never drag the room.
   *   - If the owner exists (any string value) → return
   *     `rpcDeadline` unchanged. A logged-out owner respects the
   *     full pick clock so they can reconnect and pick manually.
   *   - If the team is not in `teamOwners` cache (unknown owner
   *     state) → return `rpcDeadline` unchanged (fail-open toward
   *     the full pick clock — the discriminator between "unowned"
   *     and "unknown" is load-bearing).
   *
   * ONLY applies to snake/linear `'pick'` timers. Auction bid-window
   * and nomination-window arms bypass this helper (auction has its
   * own budget/nomination-order logic).
   *
   * Called from `applyPickEvent` (post-picksMade++ so the NEW
   * on-clock team is at `draftOrder[picksMade]`) and from `init()`
   * (post-replay, arming the initial deadline).
   */
  private computeArmDeadlineForOnClockTeam(rpcDeadline: Date): Date {
    if (this.format !== 'snake' && this.format !== 'linear') {
      return rpcDeadline;
    }
    if (this.picksMade >= this.draftOrder.length) {
      return rpcDeadline;
    }
    const onClockTeamId = this.draftOrder[this.picksMade].teamId;
    // `has` returns false when the cache doesn't know this team —
    // fail-open to rpcDeadline (do NOT accidentally instant-autopick
    // just because we forgot to populate the cache).
    if (!this.teamOwners.has(onClockTeamId)) {
      return rpcDeadline;
    }
    const owner = this.teamOwners.get(onClockTeamId);
    if (owner !== null) {
      return rpcDeadline;
    }
    // Ownerless seat → instant-autopick.
    const instantDeadline = new Date(Date.now() + INSTANT_AUTOPICK_ARM_MS);
    // If the RPC deadline is ALREADY earlier than the instant window
    // (e.g., the timer fires immediately on a caught-up event), respect
    // the earlier one — never delay a legitimately-due autopick.
    if (rpcDeadline.getTime() < instantDeadline.getTime()) {
      return rpcDeadline;
    }
    structuredLogger.info(
      `[lobby] instant_autopick_arm lobbyId=${this.lobbyId} teamId=${onClockTeamId} armMs=${INSTANT_AUTOPICK_ARM_MS} rpcDeadlineOverridden=${rpcDeadline.toISOString()}`,
    );
    return instantDeadline;
  }

  /**
   * ENGINE-EAR v3 Slice 1 item 6 (E113) — SINGLE ENTRY POINT for
   * arming a snake/linear pick deadline. Every call site that arms
   * the pick timer for a snake or linear draft MUST route through
   * this wrapper so `computeArmDeadlineForOnClockTeam` cannot be
   * silently bypassed by a future arm site. E113 field evidence:
   * only 2 of ~7 pick arm sites carried the helper on `dcaeeeb9-draft`
   * → S1 field pass but S3 partial (instant-autopick fired on pick 1
   * only; picks 2..N reverted to the full 30s courtesy clock).
   *
   * Wraps `setPickDeadline(deadline, 'pick')` with the instant-
   * autopick helper — ownerless seats fire within
   * INSTANT_AUTOPICK_ARM_MS instead of the full pick clock. When
   * the on-clock team has an owner (or the cache is unpopulated,
   * or rpcDeadline is already earlier than the instant window), the
   * RPC value is honored unchanged (fail-open).
   *
   * EXEMPT PATHS (must NOT route through this wrapper — leave a
   * comment at each exempt site + a test pinning the exemption):
   * - `draft_extended` handlers (2 sites, one per dispatcher):
   *   commissioner explicitly added time to the current pick's
   *   clock; shortening it back to an instant-autopick window
   *   would defeat the extension. Extend semantics preserve the
   *   full RPC deadline for both owned and unowned seats.
   * - `setPickDeadline(_, 'bid_window' | 'nomination_window')`:
   *   auction paths use their own state machine and are outside
   *   ENGINE-EAR v3 Slice 1 scope.
   * - `handleStallScanner` recovery re-arm at ~line 4731:
   *   scanner recovery restores the previous kind (which may be
   *   auction). Recovery from a lost timer is not a fresh on-clock
   *   transition — the instant-autopick benefit applies to the
   *   NEXT normal pick, not to a re-arm of a stale deadline.
   *
   * PUSH (2026-08-18): `notifyOnClockDevice` is appended AFTER the
   * helper→setPickDeadline call, never folded into it. That call is
   * a single expression on purpose and engineEar3.test.ts pins both
   * its exact shape and its length ("if a future refactor splits
   * them ... this lock trips", matched within a 300-char window) —
   * so the body stays minimal and the reasoning lives up here.
   * It is handed `rpcDeadline` rather than the computed value: the
   * two differ only for ownerless seats, which have no owner to
   * notify and send nothing anyway.
   */
  private armPickDeadline(rpcDeadline: Date): void {
    // AUCTION INCIDENT (2026-09-01, league a1a125c8 seq 4): the
    // draft_started apply path armed this snake/linear pick clock in
    // an AUCTION lobby (the start RPC stamps first_pick_deadline for
    // every format), and 90s later the snake autopick fired into a
    // live auction. This wrapper is the enforced single entry point
    // for the pick clock (E113), so the format fence lives here:
    // auction lobbies keep time exclusively through the bid-window
    // and nomination-window timers.
    if (this.format === 'auction') {
      structuredLogger.warn(
        `[lobby] armPickDeadline suppressed for auction lobby lobbyId=${this.lobbyId}`,
      );
      return;
    }
    this.setPickDeadline(
      this.computeArmDeadlineForOnClockTeam(rpcDeadline),
      'pick',
    );
    this.notifyOnClockDevice(rpcDeadline);
  }

  /**
   * PUSH (2026-08-18) — "you're on the clock" notification.
   *
   * Hangs off armPickDeadline because that is already the enforced single entry
   * point for a snake/linear pick clock, so it cannot be bypassed by a future
   * arm site the way `computeArmDeadlineForOnClockTeam` once was (E113: only 2
   * of ~7 arm sites carried it).
   *
   * SAFETY POSTURE — this must never be able to affect a draft:
   *   - Fire-and-forget. Not awaited, so it cannot add latency to a pick.
   *   - PushService.notifyOnTheClock is total; it returns a result rather than
   *     throwing. The extra try/catch and .catch() here are belt-and-braces
   *     against a synchronous throw before the promise is created.
   *   - Dormant unless APNs credentials are configured, so local dev, CI and any
   *     deploy without secrets do nothing at all.
   *
   * DOUBLE-SEND — armPickDeadline also fires on init() after event-log replay,
   * i.e. every engine restart re-arms the current pick. PushService claims the
   * (league_id, pick_number) row in public.push_deliveries and only sends if it
   * won, so a mid-draft deploy cannot re-notify a lobby.
   *
   * Ownerless seats resolve to zero device tokens inside the service, so AI
   * teams cost one cheap lookup and send nothing.
   */
  private notifyOnClockDevice(deadline: Date): void {
    try {
      if (this.format !== 'snake' && this.format !== 'linear') {
        return;
      }
      if (this.picksMade >= this.draftOrder.length) {
        return;
      }
      const onClockTeamId = this.draftOrder[this.picksMade].teamId;
      if (!onClockTeamId) {
        return;
      }
      const push = getPushService(this.supabase);
      if (!push.isConfigured()) {
        return;
      }
      void push
        .notifyOnTheClock({
          leagueId: this.leagueId,
          pickNumber: this.picksMade + 1,
          teamId: onClockTeamId,
          deadlineIso: deadline.toISOString(),
        })
        .catch((err: unknown) => {
          structuredLogger.warn(
            `[lobby] push notify failed lobbyId=${this.lobbyId} pick=${this.picksMade + 1}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    } catch (err) {
      structuredLogger.warn(
        `[lobby] push notify threw lobbyId=${this.lobbyId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private setPickDeadline(
    deadline: Date,
    kind: 'pick' | 'bid_window' | 'nomination_window' = 'pick',
  ): void {
    this.cancelPickTimer();
    if (this.shutDown) {
      return;
    }
    this.currentTimerDeadline = deadline;
    this.currentTimerKind = kind;
    // Chunk 10c-2 batch 2 (2026-07-27): increment arm-seq and capture
    // in the setTimeout closure so a stale fire (from a previously-
    // armed timer that raced past cancelPickTimer or from a bug that
    // leaked a handle) can be identified and skipped.
    this.timerArmSeq += 1;
    const armSeq = this.timerArmSeq;
    const armedDeadline = deadline;
    // F20 (2026-08-01 architect ruling — correctness fix): CAPTURE
    // `kind` in the closure. `this.currentTimerKind` is mutable
    // instance state read at FIRE time; if handleClockExpired's
    // opportunistic re-arm reads it instead of the captured value,
    // a fire from a previous ARM could resurrect a different kind
    // of timer than the one that fired (e.g. auction nomination
    // re-armed as pick). Same discipline as F21's single-Date.now()
    // capture: read the value that was true when the decision
    // context was created.
    const armedKind = kind;
    const delayMs = Math.max(0, deadline.getTime() - Date.now());
    this.currentTimerHandle = setTimeout(() => {
      this.currentTimerHandle = null;
      void this.handleClockExpired({ armSeq, armedDeadline, armedKind });
    }, delayMs);
    structuredLogger.debug(
      `[lobby] timer scheduled lobbyId=${this.lobbyId} kind=${kind} deadline=${deadline.toISOString()} delayMs=${delayMs} armSeq=${armSeq}`,
    );
  }

  // F20 (2026-08-01 architect ruling — blocking amendment): consecutive
  // early-fire re-arm counter, keyed on `armedDeadline.getTime()`. After
  // 3 consecutive re-arms for the same armedDeadline, STOP re-arming
  // and PROCEED WITH THE AUTOPICK ANYWAY. Fail open, not closed.
  // Reasoning: an autopick that fires 26ms early is indistinguishable
  // from an on-time one in every way that matters to a user; a draft
  // that never advances is not. When defence-in-depth (the wall-clock
  // gate is redundant with the armSeq identity check) and liveness
  // conflict, liveness wins.
  //
  // Reset to 0 whenever a fire is accepted (drift within tolerance) or
  // when a new setPickDeadline arms a different deadline.
  private earlyFireRearmCount: number = 0;
  private earlyFireRearmForDeadlineMs: number | null = null;

  /**
   * Format-aware AND timer-kind-aware clock-expiry dispatch. Common
   * defensive guards (shut down / not in_progress / paused) live
   * here so each branch's body is single-purpose. Chunk 11g.6
   * sub-step 6c3 extends with `currentTimerKind` dispatch for
   * auction lobbies (bid_window vs nomination_window).
   */
  private async handleClockExpired(
    fire?: {
      armSeq: number;
      armedDeadline: Date;
      armedKind: 'pick' | 'bid_window' | 'nomination_window';
    },
  ): Promise<void> {
    // F20 amendment C (2026-08-02 architect ruling): the three fields
    // are captured together in the setTimeout closure at arm time; the
    // ONLY production caller passes all three. Bundling them into a
    // single optional object param enforces "defined together" at the
    // type system level so the pre-refactor `armedKind ?? 'pick'`
    // fallback (dead but paperable-over-a-mutable-state-read) is now
    // impossible to write. Legacy signature stays optional so
    // direct-test invocations that pass nothing skip all guards.
    const armSeq = fire?.armSeq;
    const armedDeadline = fire?.armedDeadline;
    const armedKind = fire?.armedKind;
    // Chunk 10c-2 batch 2 (2026-07-27): identity guard + wall-clock
    // gate. Kills the premature-steal class structurally.
    //
    // Identity check: if the setTimeout callback captured `armSeq` at
    // arm time and the current `timerArmSeq` doesn't match, THIS timer
    // was superseded — either by a later `setPickDeadline` that armed
    // a fresh one (which cancelled this handle but the callback still
    // fired due to a race — extremely rare, but possible) OR by a
    // `cancelPickTimer` that cleared the handle without a replacement.
    // Skip the fire and log the anomaly.
    //
    // Wall-clock gate: even if identity matches, sanity-check that the
    // deadline actually elapsed. setTimeout can (rarely) fire early
    // under GC pressure, event-loop scheduling, or system-clock
    // adjustments. F20 (2026-08-01) added a 25ms tolerance because a
    // strict `<` on wall-clock ms-boundary rejects legitimate on-time
    // fires; rejections that DO fall outside tolerance re-arm rather
    // than discard the draft's only clock.
    //
    // Backwards compat: `armSeq`, `armedDeadline`, `armedKind` are
    // optional so legacy call sites (there are none today, but the
    // method signature must accommodate direct-test invocation) skip
    // the guard when neither is passed.
    if (armSeq !== undefined && armSeq !== this.timerArmSeq) {
      // F20 (2026-08-01 architect ruling): superseded branch stays
      // BARE RETURN and INFO severity. A superseded armSeq means a
      // newer arm exists (either via setPickDeadline or via a
      // successor already in flight); re-arming here would race the
      // successor. SAFETY OF THIS BEHAVIOUR DEPENDS ON THE F20
      // CLOCK-LIVENESS SCANNER — if the scanner is ever removed,
      // audit every cancelPickTimer / clearTimeout path to prove a
      // superseded fire always implies a live successor. Without
      // that audit, this bare return re-inherits the F20 defect
      // class (rejected timer, no live replacement).
      structuredLogger.info('autopick.stale_timer_skipped', {
        lobbyId: this.lobbyId,
        reason: 'timer_superseded',
        firedArmSeq: armSeq,
        currentArmSeq: this.timerArmSeq,
        expectedDeadline: this.currentTimerDeadline?.toISOString() ?? null,
        armedDeadline: armedDeadline?.toISOString() ?? null,
        firedAt: new Date().toISOString(),
        driftMs: armedDeadline !== undefined ? Date.now() - armedDeadline.getTime() : null,
      });
      return;
    }
    if (armedDeadline !== undefined) {
      // F21 (2026-08-01 architect ruling): capture Date.now() ONCE.
      // The pre-fix code called Date.now() three times (once for the
      // guard check, twice for the log's firedAt/driftMs), so the log
      // measured microseconds after the guard's decision — F20's
      // sub-millisecond-early fire recorded as driftMs=0, invisible.
      const firedAtMs = Date.now();
      const armedMs = armedDeadline.getTime();
      const driftMs = firedAtMs - armedMs;

      // F20 amendment 1 (2026-08-01 architect ruling): tolerance
      // replaces strict `<`. 25ms is generous against setTimeout slop
      // and the ms-floor boundary, tight enough that a backward
      // system-clock step still registers. With the re-arm below and
      // its cap, the exact value is a noise-tuning knob — a wrong
      // tolerance produces noisy WARNs, not dead drafts.
      const EARLY_FIRE_TOLERANCE_MS = 25;
      const MAX_CONSECUTIVE_EARLY_REARMS = 3;

      if (driftMs < -EARLY_FIRE_TOLERANCE_MS) {
        // Track consecutive re-arms per-deadline. Reset when the
        // armedDeadline changes (new setPickDeadline for a different
        // instant clears the strike-set for the previous instant).
        if (this.earlyFireRearmForDeadlineMs !== armedMs) {
          this.earlyFireRearmForDeadlineMs = armedMs;
          this.earlyFireRearmCount = 0;
        }

        if (this.earlyFireRearmCount >= MAX_CONSECUTIVE_EARLY_REARMS) {
          // F20 blocking amendment (2026-08-01): CAP EXHAUSTED, FAIL
          // OPEN. An autopick 26ms early is indistinguishable from
          // an on-time one to a user; a draft that never advances is
          // not. When defence-in-depth and liveness conflict,
          // liveness wins. Proceed with the autopick as if the fire
          // had landed within tolerance.
          structuredLogger.error('autopick.early_fire_tolerance_exhausted', {
            lobbyId: this.lobbyId,
            armedDeadline: armedDeadline.toISOString(),
            firedAt: new Date(firedAtMs).toISOString(),
            firedAtMs,
            armedMs,
            driftMs,
            toleranceMs: EARLY_FIRE_TOLERANCE_MS,
            consecutiveRearms: this.earlyFireRearmCount,
            action: 'proceeding_anyway',
          });
          // Reset so the next legitimate fire starts a fresh count.
          this.earlyFireRearmCount = 0;
          this.earlyFireRearmForDeadlineMs = null;
          // Fall through to the normal accept path below.
        } else {
          // F20 ruling 4 (2026-08-01): MANDATORY OPPORTUNISTIC RE-ARM.
          // A timer that fires early is not garbage — it is "not yet."
          // The guard rejects the bad fire AND schedules an immediate
          // re-arm for the remaining delay. Uses the CAPTURED
          // armedKind (F20 correctness fix), not the mutable
          // this.currentTimerKind — a fire from a previous arm must
          // not resurrect a different kind of timer than the one
          // that fired.
          this.earlyFireRearmCount += 1;
          // armedKind is defined-together with armedDeadline (see the
          // fire?: { … } object param at the top of this function) —
          // no `?? 'pick'` fallback needed.
          this.setPickDeadline(armedDeadline, armedKind!);
          // Log AFTER the re-arm succeeds (F20 minor amendment): the
          // pre-amendment version logged action='re_armed' before
          // setPickDeadline ran, asserting an outcome the code had
          // not yet produced — the same species as F19's stale
          // comment. Severity WARN (ruling 6): self-healed but
          // visible.
          structuredLogger.warn('autopick.stale_timer_skipped', {
            lobbyId: this.lobbyId,
            reason: 'fired_before_deadline',
            armedDeadline: armedDeadline.toISOString(),
            firedAt: new Date(firedAtMs).toISOString(),
            firedAtMs,
            armedMs,
            driftMs,
            toleranceMs: EARLY_FIRE_TOLERANCE_MS,
            armedKind: armedKind ?? null,
            consecutiveRearms: this.earlyFireRearmCount,
            maxConsecutiveRearms: MAX_CONSECUTIVE_EARLY_REARMS,
            action: 're_armed',
          });
          return;
        }
      } else {
        // Accepted fire (within tolerance or late) — reset the
        // consecutive-re-arm counter for whatever deadline it belonged
        // to. Next early-fire against a fresh deadline starts fresh.
        this.earlyFireRearmCount = 0;
        this.earlyFireRearmForDeadlineMs = null;
      }
    }
    if (this.shutDown) {
      structuredLogger.debug(`[lobby] clock fired post-shutdown — ignored lobbyId=${this.lobbyId}`);
      return;
    }
    if (this.draftStatus !== 'in_progress') {
      structuredLogger.warn(
        `[lobby] clock fired but draftStatus=${this.draftStatus} — ignored (timer should have been cancelled) lobbyId=${this.lobbyId}`,
      );
      return;
    }
    if (this.pauseState !== null) {
      structuredLogger.warn(
        `[lobby] clock fired while paused — ignored (pauseDraft should have cancelled) lobbyId=${this.lobbyId}`,
      );
      return;
    }
    if (this.format === 'auction') {
      // Chunk 11g.6 sub-step 6c3: dispatch by timer kind.
      if (this.currentTimerKind === 'nomination_window') {
        await this.handleNominationWindowTimeout();
      } else {
        // 'bid_window' (or null — defensive default to bid_window
        // since 6a/6b/6c1/6c2 didn't track the discriminator).
        await this.handleNominationTimeout();
      }
    } else {
      await this.handleAutopickTimeout();
    }
  }

  /**
   * F20 Piece 3 (2026-08-02 architect ruling 2 + 3): pick-clock
   * liveness recovery entry point, called by the LobbyRegistry's
   * global scanner. Scanner proposes ("this lobby looks stalled at
   * observedSeq X"), lobby disposes ("here's my current view; do
   * I re-arm?"). Idempotent — safe to call repeatedly.
   *
   * The scanner's view is racy — by the time this method executes
   * the state may have advanced under it. Every gate below re-verifies
   * a specific pre-condition rather than trusting the caller:
   *
   *   1. shut_down            — lobby is tearing down.
   *   2. not_in_progress      — draftStatus advanced past in_progress
   *                             (completed/cancelled after the scan).
   *   3. paused               — pause landed after the scan; do not
   *                             fight the pause.
   *   4. seq_advanced         — a submit / re-arm happened between the
   *                             scan and this call; observedSeq is
   *                             stale, someone already moved.
   *   5. no_deadline          — pre-first-arm window (currentTimerDeadline
   *                             is null while the lobby is in_progress
   *                             but no pick has been scheduled yet). NOT
   *                             a stall. Edge (a) per architect ruling.
   *   6. no_stall             — re-verify wall-clock stall under lobby's
   *                             view; the scanner's clock may have drifted
   *                             or the deadline may have been advanced.
   *   7. submit_in_flight     — an action is queued but hasn't yet bumped
   *                             the seq; its imminent setPickDeadline
   *                             would supersede our re-arm anyway.
   *
   * On re-arm: calls setPickDeadline with the CURRENT currentTimerDeadline
   * (the deadline the lobby knows about, not the one the scanner
   * observed). Edge (b) — a deadline already in the past re-arms with
   * delay 0 via setPickDeadline's `Math.max(0, deadline - now)`, and
   * fires on the next event-loop tick. That is CORRECT AND DELIBERATE:
   * an overdue pick firing NOW is the recovery working. Do not "fix"
   * this into a skip.
   */
  public async attemptClockRecovery(observedSeq: number): Promise<{
    recovered: boolean;
    reason:
      | 're_armed'
      | 'shut_down'
      | 'not_in_progress'
      | 'paused'
      | 'seq_advanced'
      | 'no_deadline'
      | 'no_stall'
      | 'submit_in_flight';
    currentSeq: number;
    deadlineOverdueMs: number | null;
  }> {
    const CLOCK_LIVENESS_STALL_MS = 10_000;  // architect ruling 3
    const currentSeq = this.timerArmSeq;
    const deadline = this.currentTimerDeadline;
    const overdueMs = deadline !== null ? Date.now() - deadline.getTime() : null;

    if (this.shutDown) {
      return { recovered: false, reason: 'shut_down', currentSeq, deadlineOverdueMs: overdueMs };
    }
    if (this.draftStatus !== 'in_progress') {
      return { recovered: false, reason: 'not_in_progress', currentSeq, deadlineOverdueMs: overdueMs };
    }
    if (this.pauseState !== null) {
      return { recovered: false, reason: 'paused', currentSeq, deadlineOverdueMs: overdueMs };
    }
    if (observedSeq !== currentSeq) {
      return { recovered: false, reason: 'seq_advanced', currentSeq, deadlineOverdueMs: overdueMs };
    }
    if (deadline === null) {
      // Edge (a) per architect ruling: pre-first-arm window is NOT a
      // stall. Lobby is in_progress but no pick has been armed yet.
      return { recovered: false, reason: 'no_deadline', currentSeq, deadlineOverdueMs: overdueMs };
    }
    if (overdueMs === null || overdueMs <= CLOCK_LIVENESS_STALL_MS) {
      // Re-verify stall under lobby's own view — scanner may have been
      // stale by the time we got here.
      return { recovered: false, reason: 'no_stall', currentSeq, deadlineOverdueMs: overdueMs };
    }
    if (this.pendingActionCount > 0) {
      // A submit is queued but hasn't yet bumped the seq. Its
      // imminent setPickDeadline will supersede any re-arm we do
      // here; step back and let the submit land.
      return { recovered: false, reason: 'submit_in_flight', currentSeq, deadlineOverdueMs: overdueMs };
    }
    // All gates passed. Re-arm using the lobby's OWN view of the
    // deadline (not the scanner's cached copy). currentTimerKind
    // is the kind of the last arm — preserved through the recovery.
    // Fallback to 'pick' only if the discriminator is null (which
    // happens after cancelPickTimer — but we already gated on
    // deadline !== null AND draftStatus === 'in_progress', so a
    // null kind here implies an internal inconsistency; 'pick' is
    // the safe default for snake/linear formats).
    const kind = this.currentTimerKind ?? 'pick';
    this.setPickDeadline(deadline, kind);
    return {
      recovered: true,
      reason: 're_armed',
      currentSeq: this.timerArmSeq,
      deadlineOverdueMs: overdueMs,
    };
  }

  /**
   * Cancel the pending autopick timer (if any). Idempotent — safe
   * to call when no timer is set. Does NOT clear
   * `currentTimerDeadline` because callers may want to inspect it
   * (e.g., for observability after shutdown). Set to null
   * explicitly when the deadline truly no longer applies.
   */
  private cancelPickTimer(): void {
    if (this.currentTimerHandle !== null) {
      clearTimeout(this.currentTimerHandle);
      this.currentTimerHandle = null;
    }
    // Chunk 11g.6 sub-step 6c3: clear the discriminator so a
    // subsequent `handleClockExpired` (e.g., a stale timer racing
    // a manual cancel) sees a null kind and bails defensively.
    this.currentTimerKind = null;
    // Chunk 10c-2 batch 2 (2026-07-27): advance the arm-seq. If a
    // stale timer callback fires after this cancel (either because
    // clearTimeout raced with the fire OR because a bug leaked a
    // handle that survived cancellation), its captured `armSeq` will
    // be < this.timerArmSeq → handleClockExpired's identity guard
    // logs and skips. Without this bump, a stale fire after
    // cancel-without-replacement would still see the same
    // `timerArmSeq` its closure captured and would pass the identity
    // guard.
    this.timerArmSeq += 1;
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

    // Chunk 11g.10 sub-step 10c-1b: autopick.fired instrumentation.
    // Captured on entry (before slot lookup) so drift is measured
    // against the scheduled deadline regardless of what the timer
    // dispatch did with the fire. If `currentTimerDeadline` is null
    // (e.g., timer fired for a lobby whose deadline was already
    // cleared), drift is emitted as null to make the anomaly
    // visible without discarding the log.
    const autopickStart = Date.now();
    const scheduledDeadlineMs = this.currentTimerDeadline?.getTime() ?? null;
    const driftFromDeadlineMs =
      scheduledDeadlineMs !== null ? autopickStart - scheduledDeadlineMs : null;

    const slot = this.draftOrder[this.picksMade];
    if (!slot) {
      structuredLogger.error(
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
      structuredLogger.error(
        `[lobby] autopick strategy threw lobbyId=${this.lobbyId} teamId=${slot.teamId}`,
        {}, err,
      );
      // Treat as stuck-draft — clear deadline, surface for ops.
      this.currentTimerDeadline = null;
      return;
    }

    if (!result.ok) {
      // Stuck-draft condition: every strategy returned no_eligible_players.
      // Real production issue requiring commissioner intervention. Chunk
      // 11g.7's alert policy fires on this log line.
      structuredLogger.error(
        `[lobby] autopick STUCK — no eligible players lobbyId=${this.lobbyId} teamId=${slot.teamId} picksMade=${this.picksMade}`,
      );
      this.currentTimerDeadline = null;
      return;
    }

    structuredLogger.info(
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
      structuredLogger.error(
        `[lobby] autopick enqueueAction threw lobbyId=${this.lobbyId}`,
        {}, err,
      );
    }

    // Chunk 11g.10 sub-step 10c-1b: autopick.fired emission.
    // Emitted AFTER enqueueAction returns so `submitElapsedMs`
    // captures the full pick-submission cost (RPC + broadcast via
    // processSubmitPick, which also emits its own `pick.processed`).
    // `deadlineMs` and `scheduledFireMs` are the same value today
    // (setTimeout is scheduled directly against the deadline);
    // separating them keeps the wire schema forward-compatible with
    // any future "fire early by N ms" logic.
    structuredLogger.info('autopick.fired', {
      lobbyId: this.lobbyId,
      teamId: slot.teamId,
      deadlineMs: scheduledDeadlineMs,
      scheduledFireMs: scheduledDeadlineMs,
      actualFireMs: autopickStart,
      driftFromDeadlineMs,
      submitElapsedMs: Date.now() - autopickStart,
    });
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
  /**
   * WEDGE-PROOFING (2026-09-01): one transient RPC failure at lot
   * close used to clear the engine's nomination silently — no durable
   * event, so every connected client kept rendering the lot frozen at
   * 0s (the a1a125c8 incident's visible symptom). One short retry
   * absorbs the transient class; the idempotency key makes the retry
   * safe if the first attempt actually committed.
   */
  private async closeNominationWithRetry(
    nominationId: string,
  ): Promise<Awaited<ReturnType<DraftServiceV2['closeNomination']>>> {
    const call = () =>
      this.draftService.closeNomination({
        leagueId: this.leagueId,
        nominationId,
        // ROOT CAUSE (2026-09-01, league a1a125c8). `close-<uuid>` is
        // not a UUID, and `close_nomination_v2`'s `p_idempotency_key`
        // parameter is typed `uuid`. Postgres rejected every call with
        // 22P02 (invalid input syntax for type uuid:
        // close-a207306d-a2d5-4ad8-8c7d-60e0de8648a2) in postgres_logs at
        // 2026-09-01T17:16:23.027Z, exactly the bid-window deadline.
        // The RPC threw, `handleNominationTimeout`'s catch cleared
        // `currentNomination` + `currentTimerDeadline`, armed no
        // successor timer and wrote no durable event: the auction was
        // wedged at the first lot close, forever. The failure is
        // DETERMINISTIC, so the one-shot retry above could never
        // absorb it.
        //
        // Same seed, same value on every retry (the RPC's idempotency
        // replay still collapses a re-close onto the first result),
        // but now in a shape the `uuid` cast accepts. Same derivation
        // the auto-nominate and skip keys already use.
        idempotencyKey: md5UuidFromSeed(`close:${nominationId}`),
        actor: {
          kind: 'autopick',
          id: 'auction-engine',
          session_id: randomUUID(),
        },
      });
    try {
      return await call();
    } catch (firstErr) {
      structuredLogger.warn(
        `[lobby] closeNomination first attempt threw — retrying once lobbyId=${this.lobbyId} nominationId=${nominationId} error=${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
      );
      await new Promise((r) => setTimeout(r, 400));
      return await call();
    }
  }

  private async handleNominationTimeout(): Promise<void> {
    if (this.currentNomination === null) {
      structuredLogger.warn(
        `[lobby] nomination timeout fired with no active nomination — ignored lobbyId=${this.lobbyId}`,
      );
      return;
    }
    const nomination = this.currentNomination;

    let result: Awaited<ReturnType<DraftServiceV2['closeNomination']>>;
    try {
      result = await this.closeNominationWithRetry(nomination.nominationId);
    } catch (err) {
      structuredLogger.error(
        `[lobby] closeNomination RPC threw lobbyId=${this.lobbyId} nominationId=${nomination.nominationId}`,
        {}, err,
      );
      // Stuck-auction condition. Surface for ops; clear timer and
      // currentNomination so the lobby doesn't deadlock. Chunk 11g.7
      // alerting fires on this log line.
      this.currentNomination = null;
      this.currentTimerDeadline = null;
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
      this.appendEventAndCount(event);
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
      this.appendEventAndCount(event);
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
    this.currentTimerDeadline = null;
    this.nominationsCompleted++;

    // Auction completion check.
    const totalNominations = this.nominationOrder.length * this.draftRounds;
    if (this.nominationsCompleted >= totalNominations) {
      this.draftStatus = 'completed';
      structuredLogger.info(
        `[lobby] auction completed lobbyId=${this.lobbyId} totalNominations=${totalNominations}`,
      );
    } else {
      // Chunk 11g.6 sub-step 6c3: schedule the next nominator's
      // nomination-window timer. Engine drives the auction forward
      // even without user action — auto-nominate fires if the next
      // nominator doesn't manually pick a player within the window.
      const newDeadline = new Date(Date.now() + this.nominationWindowMs);
      this.setPickDeadline(newDeadline, 'nomination_window');
    }
  }

  /**
   * Auction nomination-window timer entry point (chunk 11g.6
   * sub-step 6c3 per ADR-002 §3.4 + §4.2). Called from
   * `handleClockExpired` when a nomination window closes without
   * the on-clock nominator submitting a player.
   *
   * Sequence:
   *   1. **Cascade-completion guard**: if the auction is already
   *      complete (`nominationsCompleted >= teams × draftRounds`),
   *      transition status and exit. Defensive — should be unreachable
   *      because `handleNominationTimeout`'s post-close logic would
   *      have transitioned status already.
   *   2. **Active-nomination guard**: if `currentNomination !== null`,
   *      a user nomination raced ahead of the timer fire. No-op
   *      defensively — the user won the race. Single-writer queue
   *      ensures we observe the user's nomination before the timer's
   *      callback because the timer chains through `enqueueAction`'s
   *      queue as well (via the `setPickDeadline` indirection).
   *   3. **Determine current nominator** from the rotation pointer.
   *   4. **Run strategy chain** to pick a player.
   *      - Strategy returns no_eligible_players → emit
   *        `auction_nomination_skipped` with `reason='no_eligible_players'`,
   *        advance `nominationsCompleted`, schedule next nominator's
   *        timer (cascade); the spec's pause-and-alert path (ADR-002
   *        §4.4) is wired in chunk 11g.7 alongside ops alerting.
   *      - Strategy returns ok → check budget reserve.
   *   5. **Budget check**: if `auctionMinBid > maxAffordable`, emit
   *      `auction_nomination_skipped` with
   *      `reason='insufficient_budget'`, advance `nominationsCompleted`,
   *      schedule next nominator's timer (cascade — Path Y extension
   *      of ADR-002).
   *   6. **Call `nominate_player_v2` RPC** with `actor.kind='autopick'`
   *      and the strategy-chosen player + `openingBid=auctionMinBid`.
   *      Same atomic 5-write block as the user-initiated path.
   *   7. **Advance state** on success: set `currentNomination`,
   *      append `auction_auto_nominated` event (instead of the
   *      user-path's `auction_nomination_started`), broadcast,
   *      schedule bid-window timer.
   *
   * Engine-fired idempotency keys are derived deterministically:
   *   - `md5('auto-nominate:' || leagueId || ':' || nominationsCompleted)::uuid`
   *     for the nominate path.
   *   - `md5('skip:' || leagueId || ':' || nominationsCompleted)::uuid`
   *     for the skip path.
   * Same retry-safety pattern as 6b's `extends-` derivation.
   */
  private async handleNominationWindowTimeout(): Promise<void> {
    // Step 1: cascade-completion guard.
    const totalNominations = this.nominationOrder.length * this.draftRounds;
    if (this.nominationsCompleted >= totalNominations) {
      this.draftStatus = 'completed';
      this.currentTimerDeadline = null;
      structuredLogger.info(
        `[lobby] auction completed via cascade exhaustion lobbyId=${this.lobbyId}`,
      );
      return;
    }

    // Step 2: active-nomination guard (race resolution).
    if (this.currentNomination !== null) {
      structuredLogger.debug(
        `[lobby] nomination-window timer fired with active nomination — race lost, no-op lobbyId=${this.lobbyId}`,
      );
      return;
    }

    // Step 3: determine current nominator.
    const teamCount = this.nominationOrder.length;
    if (teamCount === 0) {
      structuredLogger.error(
        `[lobby] handleNominationWindowTimeout: empty nominationOrder lobbyId=${this.lobbyId}`,
      );
      this.currentTimerDeadline = null;
      return;
    }
    const nominatorTeamId =
      this.nominationOrder[this.nominationsCompleted % teamCount];

    // Step 4: run strategy chain.
    let strategyResult: Awaited<ReturnType<typeof selectAuctionAutoNominate>>;
    try {
      strategyResult = await selectAuctionAutoNominate(
        {
          leagueId: this.leagueId,
          teamId: nominatorTeamId,
          auctionMinBid: this.auctionMinBid,
          supabase: this.supabase,
        },
        this.auctionAutoNominateStrategies,
      );
    } catch (err) {
      structuredLogger.error(
        `[lobby] auto-nominate strategy threw lobbyId=${this.lobbyId} teamId=${nominatorTeamId}`,
        {}, err,
      );
      // Treat as stuck — clear timer + surface for ops. Chunk 11g.7
      // alerting consumes this log line.
      this.currentTimerDeadline = null;
      return;
    }

    if (!strategyResult.ok) {
      // No eligible players — per ADR-002 §4.4 this should pause
      // the draft + alert commissioner. For 6c3 we emit the
      // `auction_nomination_skipped` event with `reason='no_eligible_players'`
      // for audit, advance state, AND cascade to the next nominator.
      // The pause-and-alert wiring is chunk 11g.7 ops territory.
      await this.fireAutoSkipEvent(nominatorTeamId, 'no_eligible_players');
      return;
    }

    // Step 5: budget check. Reserve = (slotsRemaining - 1) * auctionMinBid;
    // maxAffordable = budget - reserve.
    const budget = this.teamBudgets.get(nominatorTeamId) ?? 0;
    const playersWon = this.teamPlayersWon.get(nominatorTeamId) ?? 0;
    const slotsRemaining = this.draftRounds - playersWon;
    if (slotsRemaining <= 0) {
      // Roster full. Should be unreachable when the rotation
      // pointer correctly skips full teams; defensive emit.
      await this.fireAutoSkipEvent(nominatorTeamId, 'insufficient_budget');
      return;
    }
    const reserve = (slotsRemaining - 1) * this.auctionMinBid;
    const maxAffordable = budget - reserve;
    if (strategyResult.openingBid > maxAffordable) {
      // Path Y extension of ADR-002 — engine cascades to next
      // nominator rather than pausing. Better UX than disrupting
      // 11 other teams for one nominator's budget exhaustion.
      await this.fireAutoSkipEvent(nominatorTeamId, 'insufficient_budget');
      return;
    }

    // Step 6: call nominate_player_v2 RPC with actor.kind='autopick'.
    const idemKey = this.deriveAutoNominateIdempotencyKey();
    let result: Awaited<ReturnType<DraftServiceV2['nominatePlayer']>>;
    try {
      result = await this.draftService.nominatePlayer({
        leagueId: this.leagueId,
        teamId: nominatorTeamId,
        playerId: strategyResult.playerId,
        // Player name not known here — strategy returns playerId only.
        // Pass empty string; the audit trail's player name comes from
        // a downstream join (`auction_nominations.player_name` is
        // written by the RPC; UIs render from that).
        playerName: '',
        openingBid: strategyResult.openingBid,
        sessionId: randomUUID(),
        idempotencyKey: idemKey,
        actor: {
          kind: 'autopick',
          id: 'auction-engine',
          session_id: randomUUID(),
        },
        clockSeconds: Math.floor(this.bidWindowMs / 1000),
      });
    } catch (err: unknown) {
      structuredLogger.error(
        `[lobby] auto-nominate RPC threw lobbyId=${this.lobbyId} teamId=${nominatorTeamId}`,
        {}, err,
      );
      this.currentTimerDeadline = null;
      return;
    }

    if (!result.was_duplicate) {
      // Step 7: advance state. Mirror of `processNominate`'s success
      // path but emit `auction_auto_nominated` instead of
      // `auction_nomination_started`.
      const expiresAt = new Date(result.clock_deadline);
      this.currentNomination = {
        nominationId: result.nomination_id,
        playerId: strategyResult.playerId,
        playerName: '',
        nominatorTeamId,
        leadingBidderId: nominatorTeamId,
        leadingBid: strategyResult.openingBid,
        expiresAt,
        timerHandle: null,
      };
      if (this.draftStatus === 'not_started') {
        this.draftStatus = 'in_progress';
      }

      const timestamp = new Date().toISOString();
      const event: BufferedDraftEvent = {
        kind: 'auction_auto_nominated',
        seq: result.seq,
        timestamp,
        nominationId: result.nomination_id,
        playerId: strategyResult.playerId,
        playerName: '',
        nominatorTeamId,
        openingBid: strategyResult.openingBid,
        clockDeadline: expiresAt.toISOString(),
        fallbackSource: strategyResult.source,
        correlationId: idemKey,
      };
      this.appendEventAndCount(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: idemKey,
        payload: event,
      });

      this.setPickDeadline(expiresAt, 'bid_window');
    }
  }

  /**
   * Helper: emit an `auction_nomination_skipped` event for the
   * given nominator + reason, advance `nominationsCompleted`, AND
   * either cascade to the next nominator (if auction not complete)
   * or transition to `'completed'` (cascade-exhaustion).
   */
  private async fireAutoSkipEvent(
    skippedTeamId: string,
    reason: 'insufficient_budget' | 'no_eligible_players',
  ): Promise<void> {
    const idemKey = this.deriveSkipIdempotencyKey();
    let result: Awaited<ReturnType<DraftServiceV2['skipNomination']>>;
    try {
      result = await this.draftService.skipNomination({
        leagueId: this.leagueId,
        teamId: skippedTeamId,
        reason,
        idempotencyKey: idemKey,
        actor: {
          kind: 'autopick',
          id: 'auction-engine',
          session_id: randomUUID(),
        },
      });
    } catch (err) {
      structuredLogger.error(
        `[lobby] skipNomination RPC threw lobbyId=${this.lobbyId} teamId=${skippedTeamId} reason=${reason}`,
        {}, err,
      );
      this.currentTimerDeadline = null;
      return;
    }

    if (!result.was_duplicate) {
      this.nominationsCompleted++;

      const timestamp = new Date().toISOString();
      const event: BufferedDraftEvent = {
        kind: 'auction_nomination_skipped',
        seq: result.seq,
        timestamp,
        correlationId: idemKey,
        skippedTeamId,
        reason,
      };
      this.appendEventAndCount(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: idemKey,
        payload: event,
      });

      structuredLogger.info(
        `[lobby] auction nomination skipped lobbyId=${this.lobbyId} teamId=${skippedTeamId} reason=${reason}`,
      );

      // Cascade or complete.
      const totalNominations =
        this.nominationOrder.length * this.draftRounds;
      if (this.nominationsCompleted >= totalNominations) {
        this.draftStatus = 'completed';
        this.currentTimerDeadline = null;
        structuredLogger.info(
          `[lobby] auction completed via skip-cascade exhaustion lobbyId=${this.lobbyId}`,
        );
      } else {
        const newDeadline = new Date(Date.now() + this.nominationWindowMs);
        this.setPickDeadline(newDeadline, 'nomination_window');
      }
    }
  }

  /**
   * Deterministic idempotency key for engine-fired auto-nominate.
   * Same pattern as 6b's `md5('extends:'||...)::uuid`. Retries of
   * the same auto-nominate (engine restart mid-fire) produce the
   * same key; RPC's idempotency check returns the cached result.
   */
  private deriveAutoNominateIdempotencyKey(): string {
    const seed = `auto-nominate:${this.leagueId}:${this.nominationsCompleted}`;
    return md5UuidFromSeed(seed);
  }

  private deriveSkipIdempotencyKey(): string {
    const seed = `skip:${this.leagueId}:${this.nominationsCompleted}`;
    return md5UuidFromSeed(seed);
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
      structuredLogger.debug(`[lobby] pauseDraft on already-paused draft — no-op lobbyId=${this.lobbyId}`);
      return;
    }
    if (this.draftStatus !== 'in_progress') {
      throw new Error(
        `[lobby] pauseDraft called from invalid status=${this.draftStatus} lobbyId=${this.lobbyId}`,
      );
    }
    const now = new Date();
    const remainingMs = this.currentTimerDeadline
      ? Math.max(0, this.currentTimerDeadline.getTime() - now.getTime())
      : 0;
    // Snake/linear `pausedTimerKind` is a harmless backward-compat
    // default; engine consults `format` to decide the restore path.
    this.pauseState = { pausedAt: now, remainingMs, pausedTimerKind: 'bid_window' };
    this.cancelPickTimer();
    this.currentTimerDeadline = null;
    structuredLogger.info(
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
    // E113: resume is a fresh on-clock transition — ownerless
    // seats should get instant-autopick. armPickDeadline's format
    // guard makes it safe if this ever runs against an auction
    // (the resume path here is snake/linear-only).
    this.armPickDeadline(newDeadline);
    structuredLogger.info(
      `[lobby] resumed lobbyId=${this.lobbyId} newDeadline=${newDeadline.toISOString()}`,
    );
  }

  /**
   * Pause the auction (chunk 11g.6 sub-step 6c1 per ADR-002 §4.4).
   * Routed through the single-writer queue so it serializes against
   * any in-flight bid / nomination — the audit trail in event-seq
   * order matches wall-clock action order, and the in-flight-bid
   * race that snake/linear's sync `pauseDraft` accepts is
   * eliminated. **Divergent from snake/linear's sync `pauseDraft`**;
   * the queue routing is the right shape for runtime commissioner
   * actions even though it's overkill for snake/linear's existing
   * bootstrap-replay use case.
   *
   * Format gate, auth (RPC enforces commissioner identity), and
   * state-machine guard ('active' → 'paused') happen at the RPC
   * layer. Engine: cancel timer, capture `pauseState`, append the
   * `auction_paused` event to the ring buffer, broadcast.
   *
   * Idempotency: caller-supplied `idempotencyKey`. Same-key retries
   * exit early at the RPC's idempotency check (returns
   * `was_duplicate=true`); engine surfaces the cached resolved
   * promise.
   */
  async pauseAuction(params: {
    commissionerUserId: string;
    reason: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (!this.initialized) {
      const msg = `[lobby] pauseAuction called before init() lobbyId=${this.lobbyId}`;
      structuredLogger.error(msg);
      throw new Error(msg);
    }
    if (this.format !== 'auction') {
      return { ok: false, reason: 'wrong_format_for_action' };
    }
    const cached = this.seenIdempotencyKeys.get(params.idempotencyKey);
    if (cached) {
      return cached;
    }

    const next: Promise<DraftActionResult> = this.queue
      .then(() => this.processPauseAuction(params))
      .catch((err: unknown) => {
        structuredLogger.error(
          `[lobby] pauseAuction queue error lobbyId=${this.lobbyId}`,
          {}, err,
        );
        return { ok: false, reason: 'internal_error' as const };
      });

    this.queue = next;
    this.cacheIdempotencyResult(params.idempotencyKey, next);
    return next;
  }

  /**
   * Resume a paused auction (chunk 11g.6 sub-step 6c1 per ADR-002
   * §4.4). Same queue-routed shape as `pauseAuction`. **Restores
   * the captured remaining bid window** from the paired
   * `auction_paused` event payload — NOT a fresh full window.
   * Divergent from snake/linear's `resumeDraft`.
   */
  async resumeAuction(params: {
    commissionerUserId: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (!this.initialized) {
      const msg = `[lobby] resumeAuction called before init() lobbyId=${this.lobbyId}`;
      structuredLogger.error(msg);
      throw new Error(msg);
    }
    if (this.format !== 'auction') {
      return { ok: false, reason: 'wrong_format_for_action' };
    }
    const cached = this.seenIdempotencyKeys.get(params.idempotencyKey);
    if (cached) {
      return cached;
    }

    const next: Promise<DraftActionResult> = this.queue
      .then(() => this.processResumeAuction(params))
      .catch((err: unknown) => {
        structuredLogger.error(
          `[lobby] resumeAuction queue error lobbyId=${this.lobbyId}`,
          {}, err,
        );
        return { ok: false, reason: 'internal_error' as const };
      });

    this.queue = next;
    this.cacheIdempotencyResult(params.idempotencyKey, next);
    return next;
  }

  private async processPauseAuction(params: {
    commissionerUserId: string;
    reason: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (this.pauseState !== null) {
      // Already paused — return invalid_state. RPC would also reject.
      return { ok: false, reason: 'invalid_state' };
    }

    let result: Awaited<ReturnType<DraftServiceV2['pauseAuction']>>;
    try {
      result = await this.draftService.pauseAuction({
        leagueId: this.leagueId,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
        actor: {
          kind: 'commissioner',
          id: params.commissionerUserId,
          session_id: params.sessionId ?? randomUUID(),
        },
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return { ok: false, reason: this.mapAppErrorToReason(err) };
      }
      structuredLogger.error(
        `[lobby] processPauseAuction: unexpected throw lobbyId=${this.lobbyId}`,
        {}, err,
      );
      return { ok: false, reason: 'internal_error' };
    }

    if (!result.was_duplicate) {
      // Mutate engine state. The RPC has already updated
      // `leagues.draft_state='paused'` + recorded the event.
      const pausedAt = new Date(result.paused_at);
      const remainingMs =
        result.captured_remaining_seconds === null
          ? 0
          : result.captured_remaining_seconds * 1000;
      // Chunk 11g.6 sub-step 6c3: capture which timer was running
      // so resume restores the correct one. The timer was cancelled
      // by `cancelPickTimer()` below; before that, `currentTimerKind`
      // tells us what was active. Defaults to 'bid_window' for
      // the snake/linear path (harmless — auction-only code reads
      // this field).
      const pausedTimerKind: 'bid_window' | 'nomination_window' =
        this.currentTimerKind === 'nomination_window'
          ? 'nomination_window'
          : 'bid_window';
      this.pauseState = { pausedAt, remainingMs, pausedTimerKind };
      this.cancelPickTimer();

      const timestamp = new Date().toISOString();
      const event: BufferedDraftEvent = {
        kind: 'auction_paused',
        seq: result.seq,
        timestamp,
        correlationId: params.idempotencyKey,
        commissionerUserId: params.commissionerUserId,
        reason: params.reason,
        pausedAt: pausedAt.toISOString(),
        ...(result.paused_nomination_id !== null
          ? { pausedNominationId: result.paused_nomination_id }
          : {}),
        ...(result.captured_remaining_seconds !== null
          ? { capturedRemainingSeconds: result.captured_remaining_seconds }
          : {}),
        pausedTimerKind,
      };
      this.appendEventAndCount(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: params.idempotencyKey,
        payload: event,
      });

      structuredLogger.info(
        `[lobby] auction paused lobbyId=${this.lobbyId} remainingMs=${remainingMs}`,
      );
    }

    return { ok: true, eventSeq: result.seq };
  }

  private async processResumeAuction(params: {
    commissionerUserId: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (this.pauseState === null) {
      // Not paused — RPC would also reject.
      return { ok: false, reason: 'invalid_state' };
    }

    let result: Awaited<ReturnType<DraftServiceV2['resumeAuction']>>;
    try {
      result = await this.draftService.resumeAuction({
        leagueId: this.leagueId,
        idempotencyKey: params.idempotencyKey,
        actor: {
          kind: 'commissioner',
          id: params.commissionerUserId,
          session_id: params.sessionId ?? randomUUID(),
        },
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return { ok: false, reason: this.mapAppErrorToReason(err) };
      }
      structuredLogger.error(
        `[lobby] processResumeAuction: unexpected throw lobbyId=${this.lobbyId}`,
        {}, err,
      );
      return { ok: false, reason: 'internal_error' };
    }

    if (!result.was_duplicate) {
      // Capture the kind that was paused BEFORE clearing pauseState
      // so we restore the correct timer (chunk 11g.6 sub-step 6c3).
      const wasPausedTimerKind = this.pauseState?.pausedTimerKind ?? 'bid_window';
      const pausedRemainingMs = this.pauseState?.remainingMs ?? 0;
      this.pauseState = null;
      const resumedAt = new Date(result.resumed_at);

      // ADR-002 §4.4: restore captured remaining time. Two paths:
      //   - bid_window: RPC has already updated
      //     `auction_nominations.expires_at`; engine reschedules from
      //     `result.new_expires_at`.
      //   - nomination_window: no DB row tracks this deadline; engine
      //     reschedules locally from `now() + pausedRemainingMs`.
      if (
        wasPausedTimerKind === 'bid_window' &&
        result.new_expires_at !== null &&
        this.currentNomination !== null &&
        result.restored_nomination_id === this.currentNomination.nominationId
      ) {
        const newDeadline = new Date(result.new_expires_at);
        this.currentNomination.expiresAt = newDeadline;
        this.setPickDeadline(newDeadline, 'bid_window');
      } else if (
        wasPausedTimerKind === 'nomination_window' &&
        this.currentNomination === null &&
        this.draftStatus === 'in_progress'
      ) {
        const newDeadline = new Date(Date.now() + pausedRemainingMs);
        this.setPickDeadline(newDeadline, 'nomination_window');
      }

      const timestamp = new Date().toISOString();
      const event: BufferedDraftEvent = {
        kind: 'auction_resumed',
        seq: result.seq,
        timestamp,
        correlationId: params.idempotencyKey,
        commissionerUserId: params.commissionerUserId,
        resumedAt: resumedAt.toISOString(),
        priorPauseEventId: result.prior_pause_event_id,
        ...(result.restored_nomination_id !== null
          ? { restoredNominationId: result.restored_nomination_id }
          : {}),
        ...(result.new_expires_at !== null
          ? { newClockDeadline: result.new_expires_at }
          : {}),
      };
      this.appendEventAndCount(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: params.idempotencyKey,
        payload: event,
      });

      structuredLogger.info(
        `[lobby] auction resumed lobbyId=${this.lobbyId} newExpiresAt=${result.new_expires_at ?? 'null'}`,
      );
    }

    return { ok: true, eventSeq: result.seq };
  }

  // ── Chunk 11g.6 sub-step 6c4 — auction commissioner override ────────

  /**
   * Execute a commissioner override on the auction. **All seven
   * actions** (`revert_bid`, `force_close_nomination`,
   * `award_to_team`, `adjust_opening_bid`, `adjust_budget`,
   * `cancel_nomination`, `extend_bid_window`) flow through this
   * single public entry point. Per ADR-002 §4.4 + extensions
   * documented in PHASE_4_5_PROJECT_PLAN.md Decision Log
   * (2026-05-07).
   *
   * Routed through the single-writer queue (consistent with
   * 6c1's `pauseAuction`/`resumeAuction` queue routing) so
   * commissioner overrides serialize against in-flight bids /
   * nominations deterministically. The audit trail in event-seq
   * order matches wall-clock action order; the in-flight-action
   * race that would otherwise let a bid land between the engine's
   * pre-check and the RPC call is eliminated.
   *
   * Auth (per ADR-004 §5): engine-side
   * `verifyCommissionerAuthorization` fail-fasts BEFORE the RPC
   * call; RPC additionally enforces `actor.kind='commissioner'` +
   * service_role. Two layers, defense-in-depth.
   *
   * Idempotency: caller-provided `idempotencyKey`. Same-key
   * retries return the cached resolved promise without re-firing
   * the RPC.
   */
  async commissionerOverride(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (!this.initialized) {
      const msg = `[lobby] commissionerOverride called before init() lobbyId=${this.lobbyId}`;
      structuredLogger.error(msg);
      throw new Error(msg);
    }
    if (this.format !== 'auction') {
      return { ok: false, reason: 'wrong_format_for_action' };
    }
    const cached = this.seenIdempotencyKeys.get(params.idempotencyKey);
    if (cached) {
      return cached;
    }

    const next: Promise<DraftActionResult> = this.queue
      .then(() => this.processCommissionerOverride(params))
      .catch((err: unknown) => {
        structuredLogger.error(
          `[lobby] commissionerOverride queue error lobbyId=${this.lobbyId}`,
          {}, err,
        );
        return { ok: false, reason: 'internal_error' as const };
      });

    this.queue = next;
    this.cacheIdempotencyResult(params.idempotencyKey, next);
    return next;
  }

  /**
   * Apply an externally-authored draft event (chunk 11g.7 sub-step 7e).
   *
   * Entry point for the LISTEN/NOTIFY subscription dispatch — when a
   * `draft_events` row is committed by ANOTHER process (e.g.,
   * commissioner UI → main API server → `draft_pause` RPC), Postgres
   * fires `pg_notify('draft_events', {league_id, seq})` via the
   * `draft_events_notify_after_insert` trigger from migration
   * `20260511000000_draft_events_notify.sql`. The engine's
   * `eventSubscription.ts` LISTEN client receives the notification,
   * looks up this lobby via `LobbyRegistry.get(leagueId)`, and calls
   * this method.
   *
   * Routes through the single-writer queue so the apply serializes
   * with any in-flight engine-authored actions (preserves the chunk
   * 11g.4 step 2 / ADR-002 §3.5 race-free invariant). Dedup against
   * own-engine emissions is handled inside `processExternalEvent`
   * via the `lastAppliedSeq` cursor — when the engine itself fires
   * an RPC, the resulting NOTIFY bounces back to its own subscription
   * and `seq <= this.lastAppliedSeq` short-circuits the apply.
   *
   * Returns a Promise that resolves when the apply has been processed
   * (or dedup-skipped). Subscription dispatcher does NOT await beyond
   * enqueue — `void` is acceptable at the call site.
   */
  enqueueExternalEvent(seq: number, notificationReceivedAtMs?: number): Promise<void> {
    if (!this.initialized) {
      // External events arriving before init() complete are rare but
      // possible (engine startup race: subscription connects before
      // lobbies bootstrap). Skip — bootstrap will read the same event
      // via snapshot+delta or full-replay paths anyway. Debug-only;
      // not alert-worthy.
      structuredLogger.debug(
        `[lobby] enqueueExternalEvent before init — skipped lobbyId=${this.lobbyId} seq=${seq}`,
      );
      return Promise.resolve();
    }

    // Chunk 11g.10 sub-step 10c-1b: capture the notification-received
    // timestamp at enqueue time so `external_event.applied` can report
    // `notifyToBroadcastMs` (NOTIFY receipt → broadcast dispatched).
    // Caller may pass an explicit value from `eventSubscription.ts`'s
    // notification handler; if omitted, we use enqueue-time as a
    // near-equivalent (adds one microtask hop of overhead).
    const notifyTs = notificationReceivedAtMs ?? Date.now();

    const next = this.queue
      .then(() => this.processExternalEvent(seq, notifyTs))
      .catch((err: unknown) => {
        structuredLogger.error(
          'event_subscription.process_external_event_failed',
          { lobbyId: this.lobbyId, seq },
          err,
        );
      });
    this.queue = next;
    return next;
  }

  /**
   * Queue-routed body for external event apply. Dedups against
   * already-applied events via `lastAppliedSeq`, fetches the event
   * from `draft_events` by seq, dispatches to the canonical
   * `applyEventDuringBootstrap` handler (chunk 11g.6 sub-step 6b
   * canonical-replay principle).
   *
   * Fetches via `listDraftEvents(leagueId, sinceSeq=this.lastAppliedSeq)`
   * which returns ALL events with seq > lastAppliedSeq, not just the
   * single seq we received. This handles the rare "engine missed a
   * notification" case (e.g., LISTEN reconnect window) where the
   * NOTIFY arrives for seq N but the engine hasn't seen seq N-1 yet —
   * we apply both in order. Each applied event advances
   * `lastAppliedSeq` via the per-apply cursor update in
   * `applyEventDuringBootstrap`.
   */
  private async processExternalEvent(
    seq: number,
    notificationReceivedAtMs?: number,
  ): Promise<void> {
    // Dedup gate: own-engine NOTIFY bounces or duplicate notifications.
    // Chunk 11g.10 sub-step 10c-2 batch 1 (item C2): promoted from
    // DEBUG-level `event_subscription.event_skipped_duplicate` to
    // INFO-level `external_event.duplicate_skipped` with a `reason`
    // discriminator. Rationale: the DEBUG line was invisible under
    // production LOG_LEVEL=INFO, so seq-dedup activity was only
    // INFERABLE (from downstream shape) rather than observable
    // (visible in logs). The overnight 2026-07-27 snapshot-retention
    // window is the first case where the invisibility was operationally
    // costly — nine hours of dedup activity on the S4 lobby left no
    // trace. Naming follows the `external_event.applied` /
    // `external_event.duplicate_skipped` broadcast-rail symmetry.
    if (seq <= this.lastAppliedSeq) {
      structuredLogger.info('external_event.duplicate_skipped', {
        lobbyId: this.lobbyId,
        seq,
        lastAppliedSeq: this.lastAppliedSeq,
        reason: 'seq_at_or_below_cursor',
      });
      return;
    }

    let events: DraftEventRow[];
    try {
      events = await this.draftService.listDraftEvents(
        this.leagueId,
        this.lastAppliedSeq,
      );
    } catch (err) {
      structuredLogger.error(
        'event_subscription.fetch_failed',
        { lobbyId: this.lobbyId, seq, sinceSeq: this.lastAppliedSeq },
        err,
      );
      return;
    }

    if (events.length === 0) {
      // Race: NOTIFY arrived but the event isn't yet visible to our
      // read. Postgres NOTIFY delivery + read visibility are both
      // post-commit, but on rare occasions the snapshot read may
      // pre-date the commit. The next NOTIFY for a higher seq will
      // re-trigger and fetch this event as part of its delta.
      structuredLogger.debug('event_subscription.event_not_yet_visible', {
        lobbyId: this.lobbyId,
        seq,
        lastAppliedSeq: this.lastAppliedSeq,
      });
      return;
    }

    for (const event of events) {
      // Defensive: re-check the dedup gate per-event in case multiple
      // notifications interleaved and a prior iteration advanced
      // lastAppliedSeq past this event's seq.
      if (event.seq <= this.lastAppliedSeq) {
        continue;
      }
      try {
        // Chunk 11g.10 sub-step 10c-1b: per-event timing capture.
        // applyMs = state-machine mutation cost (usually <1ms).
        // broadcastMs = uWS publish call cost (0 if no broadcast).
        // notifyToBroadcastMs = server-side commit→broadcast decomposition
        //   for the Mandate fanout metric (measured from NOTIFY receipt
        //   to broadcast dispatched). Combined with `draft_events.created_at`
        //   this gives the full server-side commit→broadcast latency
        //   without any client-side network noise.
        const applyStart = Date.now();
        this.applyEventDuringBootstrap(event);
        // ── AUCTION LIVE-APPLY TIMER ARMING (2026-08-24, launch build) ──
        //
        // The defect class this closes is the same one E113/10c-2 fixed
        // for picks: the per-type appliers deliberately do NOT arm timers
        // (bootstrap's init() owns post-replay arming), so an auction
        // action arriving over the HTTP-RPC-NOTIFY rail (a USER nomination
        // or bid from the new /api/draft/v2 auction routes) mutated state
        // but left no timer armed — a user nomination would sit open
        // forever, and after a close no next nomination window ever
        // started. Engine-authored actions are unaffected (their handlers
        // arm inline and their NOTIFY echo is deduped by lastAppliedSeq
        // before reaching this loop). Live-mode only by construction —
        // bootstrap replay never runs through processExternalEvent.
        this.armAuctionTimersAfterLiveApply(event.event_type);
        const applyMs = Date.now() - applyStart;
        // Chunk 10c-2 batch 3 (2026-07-27): touch activity clock. Any
        // external event applied is proof this lobby is being written
        // to by a live producer (API server → RPC → NOTIFY). Prevents
        // the idle-eviction scanner from evicting a lobby that has no
        // connected WS clients but is actively receiving external
        // picks (e.g., a background autopick worker or a scripted
        // driver in a headless test).
        this.lastActivityAt = Date.now();
        structuredLogger.debug('event_subscription.event_applied', {
          lobbyId: this.lobbyId,
          seq: event.seq,
          eventType: event.event_type,
        });
        // ── Chunk 11g.10 sub-step 10c-1a: live external-apply broadcast ──
        //
        // The defect this closes (see PROJECT_PLAN Decision Log 2026-07-21):
        // pre-10c-1a, this method applied state changes for cross-process
        // events (a pick submitted via the main API server, a pause fired
        // by a commissioner-side RPC, etc.) but did NOT broadcast them to
        // connected WS clients. Only engine-authored actions
        // (`processSubmitPick`, `processNominate`, `processPlaceBid`,
        // auction close/timeout handlers, `processCommissionerOverride`)
        // broadcast, because those handlers had their own inline
        // `this.broadcast(...)` calls after the RPC returned. External
        // events skipped that step entirely, silently violating the
        // Performance Mandate's "manual pick submission → all participants
        // see the pick" wire contract.
        //
        // **Live-mode-only.** Bootstrap event replay (called via
        // `bootstrap()` + `bootstrapFullEventReplay()`) uses the same
        // `applyEventDuringBootstrap` dispatcher and MUST NOT broadcast —
        // replay reconstructs in-memory state from durable history; the
        // events are already old and any connected client already saw them
        // (or gets them from `snapshot` on reconnect + `recentEvents`
        // ring-buffer replay). Broadcasting on replay would flood the wire
        // with duplicate events on every engine restart.
        //
        // **State apply is byte-identical between live and replay modes.**
        // `applyEventDuringBootstrap` mutates the state machine + appends
        // to the ring buffer. Broadcast is a strictly-additive side
        // effect appended AFTER successful state apply — no mutation of
        // the applier's semantics, no mode branching inside the per-type
        // apply functions. Canonical-replay principle (ADR-002 §3.5,
        // chunk 11g.6 sub-step 6b Decision Log) intact.
        //
        // **Detection**: if the applier appended a `BufferedDraftEvent`
        // for this event, the ring buffer's tail's `seq` will equal
        // `event.seq`. Applier variants without a wire representation
        // (`draft_paused`, `draft_resumed`, `draft_cancelled`,
        // `draft_extended`, `autopick_failed`, `generation_bumped`)
        // mutate state without appending to the ring buffer; tail check
        // evaluates false and no broadcast fires. Wire representations
        // for those internal-only variants are tracked as a separate
        // design question (see Decision Log 2026-07-21).
        //
        // **F26 + F27 (2026-08-06) — decision reversed for two variants.**
        // `draft_completed` (F26 / KI-035) and `draft_started` (F27) NOW
        // append and broadcast, because clients need to see draft
        // ignition + completion frames (Rider 4 assert C, KI-035 evidence).
        // The remaining lifecycle events above still stand on the
        // 2026-07-21 default; their client-visibility can be raised in
        // future F-family chunks if room UI expresses them.
        //
        // **Echo protection**: engine-authored actions (autopicks via
        // `processSubmitPick`, all `processNominate`/`processPlaceBid`/
        // etc. paths) advance `this.lastAppliedSeq` inside
        // `appendEventAndCount` at the moment of their local
        // `this.broadcast(...)`. The trigger-fired NOTIFY bounces back to
        // this method with the same seq; the `seq <= lastAppliedSeq`
        // gate at the top of `processExternalEvent` short-circuits before
        // the loop, so echo cannot double-broadcast. Serialization is
        // via the single-writer queue: an engine-authored action's
        // `appendEventAndCount` completes before any external-event
        // apply for the same seq is dequeued.
        const buffered = this.events.peekLast();
        let broadcastMs = 0;
        if (buffered !== undefined && buffered.seq === event.seq) {
          const broadcastStart = Date.now();
          this.broadcast({
            v: WIRE_PROTOCOL_VERSION,
            type: 'event',
            seq: event.seq,
            timestamp: event.created_at,
            correlationId: event.idempotency_key ?? '',
            payload: buffered,
          });
          broadcastMs = Date.now() - broadcastStart;
        }
        // external_event.applied — INFO, live-mode only. Bootstrap
        // replay does not reach this log site (it uses the switch in
        // `bootstrapFullEventReplay` / the `applyEventDuringBootstrap`
        // dispatcher via `bootstrap()`; neither goes through
        // `processExternalEvent`). Fanout-metric decomposition input
        // for 10c-2: pairs with `draft_events.created_at` to compute
        // server-side commit→broadcast latency.
        structuredLogger.info('external_event.applied', {
          lobbyId: this.lobbyId,
          seq: event.seq,
          eventType: event.event_type,
          applyMs,
          broadcastMs,
          notifyToBroadcastMs:
            notificationReceivedAtMs !== undefined
              ? Date.now() - notificationReceivedAtMs
              : undefined,
          broadcasted: buffered !== undefined && buffered.seq === event.seq,
        });
      } catch (err) {
        structuredLogger.error(
          'event_subscription.apply_failed',
          {
            lobbyId: this.lobbyId,
            seq: event.seq,
            eventType: event.event_type,
          },
          err,
        );
        // Abort the loop on apply failure — subsequent events depend
        // on the failed one's state mutations and would propagate
        // corruption.
        return;
      }
    }
  }

  /**
   * Arm/re-arm auction timers after a LIVE externally-applied event
   * (2026-08-24 launch build — see the call site in
   * `processExternalEvent` for the defect history). No-op for
   * snake/linear lobbies and for auction lobbies that are paused,
   * completed, or not in progress. `setPickDeadline` supersedes any
   * previously-armed timer, so arming here after the generic
   * `draft_started` case armed a 'pick' timer corrects the kind for
   * auction lobbies (last arm wins).
   */
  private armAuctionTimersAfterLiveApply(eventType: string): void {
    if (this.format !== 'auction') return;
    if (this.pauseState !== null) return;
    if (this.draftStatus !== 'in_progress') return;

    switch (eventType) {
      case 'draft_started': {
        // Auction ignition over the live rail: the generic
        // 'draft_started' case armed a 'pick' timer from
        // first_pick_deadline — wrong kind for auction. Arm the first
        // nomination window instead.
        const deadline = new Date(Date.now() + this.nominationWindowMs);
        this.setPickDeadline(deadline, 'nomination_window');
        break;
      }
      case 'auction_nomination_started':
      case 'auction_auto_nominated':
      case 'auction_bid_extends_timer': {
        // Applier set/extended currentNomination.expiresAt from the
        // event payload — arm the bid window to that deadline.
        if (this.currentNomination !== null) {
          this.setPickDeadline(this.currentNomination.expiresAt, 'bid_window');
        }
        break;
      }
      case 'auction_nomination_closed':
      case 'auction_nomination_expired':
      case 'auction_nomination_skipped': {
        // Applier cleared currentNomination and advanced the rotation.
        // If the auction is still going, open the next nominator's
        // window. (When the applier detected completion it flipped
        // draftStatus to 'completed' and the guard above already
        // returned.)
        const deadline = new Date(Date.now() + this.nominationWindowMs);
        this.setPickDeadline(deadline, 'nomination_window');
        break;
      }
      case 'auction_resumed': {
        // Applier restored currentNomination/expiresAt state. Re-arm
        // whichever window applies.
        if (this.currentNomination !== null) {
          this.setPickDeadline(this.currentNomination.expiresAt, 'bid_window');
        } else {
          const deadline = new Date(Date.now() + this.nominationWindowMs);
          this.setPickDeadline(deadline, 'nomination_window');
        }
        break;
      }
      default:
        // auction_bid_placed (no deadline change — extensions arrive
        // as their own event), auction_paused (timer teardown is the
        // applier's job), pick/lifecycle events: nothing to arm.
        break;
    }
  }

  private async processCommissionerOverride(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    // Engine-side commissioner-auth fail-fast (ADR-004 §5.3 mirror
    // for commissioner actions). RPC also enforces.
    let authResult: CommissionerAuthorizationResult;
    try {
      authResult = await this.verifyCommissionerAuthorization(
        params.commissionerUserId,
        this.leagueId,
      );
    } catch (err) {
      structuredLogger.error(
        `[lobby] verifyCommissionerAuthorization threw lobbyId=${this.lobbyId} userId=${params.commissionerUserId}`,
        {}, err,
      );
      return { ok: false, reason: 'internal_error' };
    }
    if ('reason' in authResult) {
      structuredLogger.info(
        `[lobby] unauthorized commissioner override attempt lobbyId=${this.lobbyId} userId=${params.commissionerUserId} reason=${authResult.reason}`,
      );
      return { ok: false, reason: 'unauthorized' };
    }

    // Engine-side preconditions per action. Each handler returns
    // either a typed rejection (no RPC call) or proceeds to RPC.
    switch (params.action.kind) {
      case 'revert_bid':
        return this.processOverrideRevertBid(params);
      case 'force_close_nomination':
        return this.processOverrideForceClose(params);
      case 'award_to_team':
        return this.processOverrideAwardToTeam(params);
      case 'adjust_opening_bid':
        return this.processOverrideAdjustOpeningBid(params);
      case 'adjust_budget':
        return this.processOverrideAdjustBudget(params);
      case 'cancel_nomination':
        return this.processOverrideCancelNomination(params);
      case 'extend_bid_window':
        return this.processOverrideExtendBidWindow(params);
    }
  }

  /**
   * Helper: call the commissioner-override RPC, broadcast the
   * resulting `auction_commissioner_override` event, append to the
   * ring buffer. Common-suffix code factored from each per-action
   * handler.
   */
  private async fireCommissionerOverrideRpc(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<
    | { ok: true; eventSeq: number; result: Awaited<ReturnType<DraftServiceV2['commissionerOverride']>> }
    | { ok: false; reason: Extract<DraftActionResult, { ok: false }>['reason']; minimumNextBid?: number }
  > {
    let result: Awaited<ReturnType<DraftServiceV2['commissionerOverride']>>;
    try {
      result = await this.draftService.commissionerOverride({
        leagueId: this.leagueId,
        action: params.action,
        rationale: params.rationale,
        idempotencyKey: params.idempotencyKey,
        actor: {
          kind: 'commissioner',
          id: params.commissionerUserId,
          session_id: params.sessionId ?? randomUUID(),
        },
      });
    } catch (err: unknown) {
      if (err instanceof AppError) {
        return { ok: false, reason: this.mapAppErrorToReason(err) };
      }
      structuredLogger.error(
        `[lobby] commissionerOverride RPC threw lobbyId=${this.lobbyId} action=${params.action.kind}`,
        {}, err,
      );
      return { ok: false, reason: 'internal_error' };
    }

    if (!result.was_duplicate) {
      const timestamp = new Date().toISOString();
      const event: BufferedDraftEvent = {
        kind: 'auction_commissioner_override',
        seq: result.seq,
        timestamp,
        correlationId: params.idempotencyKey,
        commissionerUserId: params.commissionerUserId,
        overrideAction: params.action.kind,
        priorState: result.prior_state,
        newState: result.new_state,
        ...(params.rationale !== undefined ? { rationale: params.rationale } : {}),
      };
      this.appendEventAndCount(event);
      this.broadcast({
        v: WIRE_PROTOCOL_VERSION,
        type: 'event',
        seq: result.seq,
        timestamp,
        correlationId: params.idempotencyKey,
        payload: event,
      });
    }

    return { ok: true, eventSeq: result.seq, result };
  }

  // ── Per-action override handlers ─────────────────────────────────────

  private async processOverrideRevertBid(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (this.currentNomination === null) {
      return { ok: false, reason: 'no_active_nomination' };
    }
    // The engine doesn't track per-nomination bid count in memory
    // (the auction_bids table is canonical); RPC enforces
    // bid_count > 1. Engine pre-check would require a DB read; skip
    // and let the RPC layer handle the rejection.

    const r = await this.fireCommissionerOverrideRpc(params);
    if (!r.ok) return r;

    // Apply state mutation to mirror the RPC's projection-table
    // writes. Reads new leader from result.new_state.
    const newState = r.result.new_state as Record<string, unknown>;
    const newLeaderId = String(newState.leadingBidderId);
    const newLeadingBid = Number(newState.leadingBid);
    if (this.currentNomination !== null) {
      this.currentNomination.leadingBidderId = newLeaderId;
      this.currentNomination.leadingBid = newLeadingBid;
    }
    return { ok: true, eventSeq: r.eventSeq };
  }

  private async processOverrideForceClose(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (this.currentNomination === null) {
      return { ok: false, reason: 'no_active_nomination' };
    }

    const nomination = this.currentNomination;
    const r = await this.fireCommissionerOverrideRpc(params);
    if (!r.ok) return r;

    // Apply state mutation per the close outcome.
    const newState = r.result.new_state as Record<string, unknown>;
    const outcome = String(newState.outcome);
    if (outcome === 'sold') {
      const winnerId = String(newState.winnerTeamId);
      const finalAmount = Number(newState.finalAmount);
      const prevBudget = this.teamBudgets.get(winnerId) ?? 0;
      const prevWon = this.teamPlayersWon.get(winnerId) ?? 0;
      this.teamBudgets.set(winnerId, prevBudget - finalAmount);
      this.teamPlayersWon.set(winnerId, prevWon + 1);
    }
    // Both outcomes (sold + no_sale) advance state the same way:
    // currentNomination cleared, nominationsCompleted++, cascade
    // or complete. Cancel any active bid-window timer first.
    this.cancelPickTimer();
    this.currentNomination = null;
    this.currentTimerDeadline = null;
    this.nominationsCompleted++;

    const totalNominations = this.nominationOrder.length * this.draftRounds;
    if (this.nominationsCompleted >= totalNominations) {
      this.draftStatus = 'completed';
    } else if (this.pauseState === null) {
      // Schedule next nominator's nomination-window timer.
      const newDeadline = new Date(Date.now() + this.nominationWindowMs);
      this.setPickDeadline(newDeadline, 'nomination_window');
    }
    // Suppress unused variable warning — `nomination` captured for
    // scope but unused after currentNomination clear.
    void nomination;
    return { ok: true, eventSeq: r.eventSeq };
  }

  private async processOverrideAwardToTeam(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (this.currentNomination === null) {
      return { ok: false, reason: 'no_active_nomination' };
    }
    if (params.action.kind !== 'award_to_team') {
      return { ok: false, reason: 'invalid_payload' };
    }
    const target = params.action;

    // Engine-side fail-fast budget check (RPC also enforces).
    const targetBudget = this.teamBudgets.get(target.teamId) ?? 0;
    const targetWon = this.teamPlayersWon.get(target.teamId) ?? 0;
    const slotsRemaining = this.draftRounds - targetWon;
    if (slotsRemaining <= 0) {
      return { ok: false, reason: 'insufficient_budget_for_award' };
    }
    const reserve = (slotsRemaining - 1) * this.auctionMinBid;
    if (target.amount + reserve > targetBudget) {
      return { ok: false, reason: 'insufficient_budget_for_award' };
    }

    const r = await this.fireCommissionerOverrideRpc(params);
    if (!r.ok) return r;

    // Apply: deduct budget, increment players_won, advance state.
    this.teamBudgets.set(target.teamId, targetBudget - target.amount);
    this.teamPlayersWon.set(target.teamId, targetWon + 1);
    this.cancelPickTimer();
    this.currentNomination = null;
    this.currentTimerDeadline = null;
    this.nominationsCompleted++;

    const totalNominations = this.nominationOrder.length * this.draftRounds;
    if (this.nominationsCompleted >= totalNominations) {
      this.draftStatus = 'completed';
    } else if (this.pauseState === null) {
      const newDeadline = new Date(Date.now() + this.nominationWindowMs);
      this.setPickDeadline(newDeadline, 'nomination_window');
    }
    return { ok: true, eventSeq: r.eventSeq };
  }

  private async processOverrideAdjustOpeningBid(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (this.currentNomination === null) {
      return { ok: false, reason: 'no_active_nomination' };
    }
    if (params.action.kind !== 'adjust_opening_bid') {
      return { ok: false, reason: 'invalid_payload' };
    }
    const newFloor = params.action.newOpeningBid;

    // Reject floor below current leading bid (nonsensical).
    if (newFloor < this.currentNomination.leadingBid) {
      return { ok: false, reason: 'opening_bid_below_current_leading' };
    }

    // If floor > current leading bid, validate leader's budget.
    if (newFloor > this.currentNomination.leadingBid) {
      const leaderId = this.currentNomination.leadingBidderId;
      const leaderBudget = this.teamBudgets.get(leaderId) ?? 0;
      const leaderWon = this.teamPlayersWon.get(leaderId) ?? 0;
      const leaderSlotsRemaining = this.draftRounds - leaderWon;
      if (leaderSlotsRemaining <= 0) {
        return { ok: false, reason: 'insufficient_budget_for_floor_increase' };
      }
      const leaderReserve = (leaderSlotsRemaining - 1) * this.auctionMinBid;
      if (newFloor + leaderReserve > leaderBudget) {
        return { ok: false, reason: 'insufficient_budget_for_floor_increase' };
      }
    }

    const r = await this.fireCommissionerOverrideRpc(params);
    if (!r.ok) return r;

    // Apply: bump leading bid up if it was below new floor.
    if (newFloor > this.currentNomination.leadingBid) {
      this.currentNomination.leadingBid = newFloor;
    }
    return { ok: true, eventSeq: r.eventSeq };
  }

  private async processOverrideAdjustBudget(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (params.action.kind !== 'adjust_budget') {
      return { ok: false, reason: 'invalid_payload' };
    }
    const target = params.action;
    const currentBudget = this.teamBudgets.get(target.teamId) ?? 0;
    const newBudget = currentBudget + target.delta;
    if (newBudget < 0) {
      return { ok: false, reason: 'insufficient_budget' };
    }

    const r = await this.fireCommissionerOverrideRpc(params);
    if (!r.ok) return r;

    this.teamBudgets.set(target.teamId, newBudget);
    return { ok: true, eventSeq: r.eventSeq };
  }

  private async processOverrideCancelNomination(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (this.currentNomination === null) {
      return { ok: false, reason: 'no_active_nomination' };
    }

    const r = await this.fireCommissionerOverrideRpc(params);
    if (!r.ok) return r;

    // Cancel-nomination = REDO (NOT skip). nominationsCompleted does
    // NOT advance; the same nominator gets another chance.
    this.cancelPickTimer();
    this.currentNomination = null;
    this.currentTimerDeadline = null;

    if (this.pauseState !== null) {
      // During-pause cancel: flip pausedTimerKind from 'bid_window'
      // to 'nomination_window' AND reset the captured remainingMs
      // to the full nomination window — the prior captured time
      // was for the now-nonexistent bid_window timer.
      this.pauseState = {
        pausedAt: this.pauseState.pausedAt,
        remainingMs: this.nominationWindowMs,
        pausedTimerKind: 'nomination_window',
      };
    } else {
      // Schedule fresh nomination-window timer for the same nominator
      // (redo semantics).
      const newDeadline = new Date(Date.now() + this.nominationWindowMs);
      this.setPickDeadline(newDeadline, 'nomination_window');
    }
    return { ok: true, eventSeq: r.eventSeq };
  }

  private async processOverrideExtendBidWindow(params: {
    commissionerUserId: string;
    action: CommissionerOverrideAction;
    rationale?: string;
    idempotencyKey: string;
    sessionId?: string;
  }): Promise<DraftActionResult> {
    if (this.currentNomination === null) {
      return { ok: false, reason: 'no_active_nomination' };
    }
    if (params.action.kind !== 'extend_bid_window') {
      return { ok: false, reason: 'invalid_payload' };
    }
    if (params.action.extensionSeconds <= 0) {
      return { ok: false, reason: 'extension_below_current_deadline' };
    }

    const r = await this.fireCommissionerOverrideRpc(params);
    if (!r.ok) return r;

    // Apply: read newClockDeadline from result.new_state, update
    // currentNomination.expiresAt, reschedule timer.
    const newState = r.result.new_state as Record<string, unknown>;
    const newDeadline = new Date(String(newState.newClockDeadline));
    this.currentNomination.expiresAt = newDeadline;
    if (this.pauseState === null) {
      this.setPickDeadline(newDeadline, 'bid_window');
    }
    return { ok: true, eventSeq: r.eventSeq };
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
    this.stopSnapshotTimer();
    this.currentTimerDeadline = null;
    structuredLogger.info(`[lobby] shutdown lobbyId=${this.lobbyId}`);
  }
}
