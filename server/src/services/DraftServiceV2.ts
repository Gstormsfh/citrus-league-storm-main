/**
 * Draft Engine v2 — pick service.
 *
 * Wraps the `submit_pick_v2` RPC (spec §4.1) and provides a thin
 * post-commit broadcast helper (spec §6.14).
 *
 * Design rules:
 *   - The service computes `payload_hash` server-side from canonical
 *     JSON. Clients never compute it.
 *   - The RPC enforces auth via `auth.uid()` inside SECURITY DEFINER —
 *     callers must pass a user-scoped Supabase client (from
 *     `createUserClient(userToken)`) to preserve the JWT.
 *   - Broadcast happens AFTER the RPC commits, using the row returned
 *     by a follow-up SELECT against `draft_events`. The RPC's
 *     `was_duplicate=true` path skips the broadcast (the original
 *     commit's broadcast already fired).
 *   - Broadcast errors are logged + counted, NEVER thrown back to the
 *     caller. The steady-state poll (`/sync`) + reconnect replay
 *     (`/events?since_seq=N`) catch any broadcast that drops on the
 *     floor (spec principle P4).
 *   - RPC errors are mapped to AppError with HTTP statuses per spec §11.1.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, type ErrorCode } from '../lib/errors';
import { logger, computePickPayloadHash } from '@citrus/shared';

// ── Types ───────────────────────────────────────────────────────────

export type ActorKind = 'user' | 'autopick' | 'commissioner' | 'shadow' | 'system';

export interface DraftV2Actor {
  kind: ActorKind;
  id?: string;
  session_id?: string;
}

export interface SubmitPickParams {
  leagueId: string;
  teamId: string;
  playerId: number;
  round: number;
  pickNumber: number;
  sessionId: string;
  idempotencyKey: string;
  actor: DraftV2Actor;
  /** Optional; RPC generates one server-side if absent. */
  correlationId?: string | null;
}

export interface SubmitPickResult {
  event_id: number;
  seq: number;
  pick_deadline: string | null;
  was_duplicate: boolean;
}

export interface DraftEventRow {
  id: number;
  league_id: string;
  seq: number;
  event_type: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  idempotency_key: string | null;
  actor: DraftV2Actor;
  correlation_id: string;
  created_at: string;
}

// ── Auction RPC params + results (chunk 11g.6 sub-step 6a) ────────

export interface NominatePlayerParams {
  leagueId: string;
  teamId: string;
  /** Wire-format string; auction's `auction_nominations.player_id` is TEXT. */
  playerId: string;
  playerName: string;
  openingBid: number;
  sessionId: string;
  idempotencyKey: string;
  actor: DraftV2Actor;
  correlationId?: string | null;
  /** Bid window duration in seconds; RPC adds +1s pad and computes deadline. */
  clockSeconds: number;
}

export interface NominatePlayerResult {
  event_id: number;
  seq: number;
  nomination_id: string;
  clock_deadline: string;
  was_duplicate: boolean;
}

export interface PlaceBidParams {
  leagueId: string;
  teamId: string;
  nominationId: string;
  bidAmount: number;
  sessionId: string;
  idempotencyKey: string;
  actor: DraftV2Actor;
  correlationId?: string | null;
  /**
   * Chunk 11g.6 sub-step 6b — anti-snipe configuration passed per-RPC
   * (rather than read from `leagues.settings` inside the function).
   * Mirrors the chunk 11g.6 6a pattern of `nominate_player_v2.p_clock_seconds`
   * — engine reads the per-league config once and threads it through.
   * Threshold = 0 disables anti-snipe.
   */
  antiSnipeThresholdSeconds: number;
  antiSnipeExtensionSeconds: number;
  /**
   * Chunk 11g.6 sub-step 6c2 — tiered minimum-bid increments per
   * ADR-002 §4.3. Each tier `{below: number, increment: number}`;
   * RPC's `compute_min_next_bid()` walks the tiers to compute the
   * minimum next bid based on the leading bid. Engine threads
   * through; RPC enforces durably.
   */
  minBidIncrementTiers: ReadonlyArray<{ below: number; increment: number }>;
}

export interface PlaceBidResult {
  event_id: number;
  seq: number;
  /**
   * Post-extension `auction_nominations.expires_at` if anti-snipe
   * fired (`was_extended === true`); otherwise the original
   * unchanged deadline. Either way: this is the wall-clock
   * deadline the engine should use to (re)schedule its bid-window
   * timer. Chunk 11g.6 sub-step 6b.
   */
  clock_deadline: string;
  was_duplicate: boolean;
  /**
   * `true` when the bid arrived in the final
   * `anti_snipe_threshold_seconds` of the bid window and the RPC
   * extended `expires_at` atomically with the bid write. Engine
   * cancels the existing timer + reschedules from the new
   * deadline + broadcasts the `auction_bid_extends_timer` event.
   */
  was_extended: boolean;
  /**
   * `draft_events.seq` of the `auction_bid_extends_timer` event
   * row written in the same transaction (only when
   * `was_extended === true`). Engine uses this seq when appending
   * the extension event to the ring buffer + broadcasting; saves
   * a downstream lookup on the durable log.
   */
  extends_event_seq?: number;
}

export interface CloseNominationParams {
  leagueId: string;
  nominationId: string;
  idempotencyKey: string;
  actor: DraftV2Actor;
  correlationId?: string | null;
}

// ── Chunk 11g.6 sub-step 6c1 — auction pause/resume ──────────────────

export interface PauseAuctionParams {
  leagueId: string;
  reason: string;
  idempotencyKey: string;
  /**
   * Per ADR-002 §4.4 + ADR-004 §5: actor.kind must be
   * 'commissioner'. RPC enforces both this and
   * `auth.uid() = leagues.commissioner_id`.
   */
  actor: DraftV2Actor;
}

export interface PauseAuctionResult {
  event_id: number;
  seq: number;
  paused_at: string;
  /**
   * UUID of the active nomination at pause time, or `null` when
   * the auction was paused between nominations.
   */
  paused_nomination_id: string | null;
  /**
   * `ceil(remaining_seconds)` of the paused bid window. `null`
   * when paused between nominations. Source-of-truth for resume
   * math — `auction_resume_v2` reads this back from the
   * durable event payload to compute the new `expires_at`.
   */
  captured_remaining_seconds: number | null;
  was_duplicate: boolean;
}

export interface ResumeAuctionParams {
  leagueId: string;
  idempotencyKey: string;
  actor: DraftV2Actor;
}

export interface ResumeAuctionResult {
  event_id: number;
  seq: number;
  resumed_at: string;
  /** `draft_events.id` of the paired `auction_paused` event row. */
  prior_pause_event_id: number;
  restored_nomination_id: string | null;
  /**
   * Post-restore `auction_nominations.expires_at` (= `resumed_at +
   * captured_remaining_seconds * interval`). `null` when no
   * nomination was active at pause time. Engine uses this to
   * reschedule the bid-window timer.
   */
  new_expires_at: string | null;
  was_duplicate: boolean;
}

export interface CloseNominationResult {
  event_id: number;
  seq: number;
  /** `auction_nomination_closed` (winning bid) or `auction_nomination_expired` (no_sale). */
  event_type: 'auction_nomination_closed' | 'auction_nomination_expired';
  no_sale: boolean;
  was_duplicate: boolean;
}

// ── Internal helpers ────────────────────────────────────────────────
// Hash computation lives in @citrus/shared (canonicalJson, sha256Hex,
// computePickPayloadHash) so the Phase 4 autopick worker can use the
// SAME canonicalization. Mismatched canonicalization → spurious
// idempotency_conflict at runtime.

/**
 * Maximum time `broadcastEvent` will wait for `channel.subscribe` to
 * reach a terminal status before logging a failure and moving on. See
 * docs/RUNBOOKS/draft-engine-v2-known-issues.md#KI-001 for the
 * resolved hang scenario this guards against.
 */
const BROADCAST_TIMEOUT_MS = 5_000;

/**
 * Map a Postgres RPC error (raised by submit_pick_v2 via RAISE
 * EXCEPTION) to the appropriate AppError. The RPC's message prefix
 * carries the spec §11.1 error code.
 */
function mapRpcError(err: { message?: string; code?: string }): AppError {
  const msg = err.message ?? 'unknown RPC error';

  // Order matters: more specific prefixes first.
  const prefixToError: Array<[string, ErrorCode, number]> = [
    ['idempotency_conflict', 'CONFLICT', 409],
    ['pick_out_of_order',    'CONFLICT', 409],
    ['not_on_clock',         'CONFLICT', 409],
    ['player_taken',         'CONFLICT', 409],
    // Auction-specific prefixes (chunk 11g.6 sub-step 6a).
    ['bid_too_low',          'CONFLICT', 409],
    ['unauthorized',         'FORBIDDEN', 403],
    ['shadow_guard_violated', 'INTERNAL_ERROR', 500],
    ['illegal_state_transition', 'INTERNAL_ERROR', 500],
    ['illegal_state',        'VALIDATION_ERROR', 422],
    ['invalid_event_payload', 'VALIDATION_ERROR', 400],
  ];

  for (const [prefix, code, status] of prefixToError) {
    if (msg.startsWith(prefix)) {
      return new AppError(msg, status, code, err.code);
    }
  }

  return new AppError(`RPC error: ${msg}`, 500, 'INTERNAL_ERROR', err.code);
}

// ── Service ─────────────────────────────────────────────────────────

export class DraftServiceV2 {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Read all `draft_events` rows for a league in seq order.
   *
   * **Wire-format note:** the durable `event_type` for picks is
   * `'pick'` per the migration's CHECK constraint
   * (`20260425130000_draft_engine_v2_foundation.sql:36-48`), NOT
   * `'pick_submitted'`. Application-layer naming
   * (`BufferedDraftEvent.kind === 'pick_submitted'`) is a separate
   * convention — bootstrap performs the rename when consuming these
   * rows. Callers operating on the wire form should match
   * `event.event_type === 'pick'` not `'pick_submitted'`.
   *
   * Used by `LobbyManager.bootstrap()` (chunk 11g.4 step 6b) to
   * reconstruct in-memory state from the durable event log.
   * Single indexed query on `(league_id, seq)` per the
   * `draft_events_league_seq_uniq` UNIQUE INDEX.
   *
   * @param leagueId — the league to read for.
   * @param sinceSeq — optional. If provided, returns only events
   *   with `seq > sinceSeq`. Used by chunk 11g.7's snapshot path
   *   (read events emitted after the last snapshot); 6b's bootstrap
   *   always passes `undefined` for full replay.
   */
  async listDraftEvents(
    leagueId: string,
    sinceSeq?: number,
  ): Promise<DraftEventRow[]> {
    let query = this.supabase
      .from('draft_events')
      .select(
        'id, league_id, seq, event_type, payload, payload_hash, ' +
          'idempotency_key, actor, correlation_id, created_at',
      )
      .eq('league_id', leagueId)
      .order('seq', { ascending: true });

    if (sinceSeq !== undefined) {
      query = query.gt('seq', sinceSeq);
    }

    const { data, error } = await query;
    if (error) {
      throw new AppError(
        `Failed to read draft_events: ${error.message}`,
        500,
        'INTERNAL_ERROR',
        error.code,
      );
    }
    return (data ?? []) as unknown as DraftEventRow[];
  }

  /**
   * Submit a pick via `submit_pick_v2`. Returns the RPC result.
   * Does NOT broadcast — call `broadcastEvent` from the route handler
   * with an admin client AFTER this resolves successfully.
   */
  async submitPick(params: SubmitPickParams): Promise<SubmitPickResult> {
    // payload_hash is a CLIENT-INTENT signature (NOT a hash of what
    // the RPC will store). The RPC accepts it as a parameter and
    // uses it ONLY to detect "same idempotency_key, different
    // intent" → idempotency_conflict. The RPC itself never computes
    // a hash.
    //
    // Spec §7.3 fixes the input shape exactly: pick_number, round,
    // team_id, player_id. No league_id (redundant with the global
    // unique idempotency_key index). No actor_kind (would cause a
    // spurious conflict if a user retry escalates to autopick after
    // the original landed). No server-assigned fields (picked_at,
    // is_autopick).
    //
    // computePickPayloadHash lives in @citrus/shared so the Phase 4
    // autopick worker uses the SAME canonicalization. Any drift
    // would break idempotency for autopicks vs user picks at the
    // same key.
    const payloadHash = await computePickPayloadHash({
      pick_number: params.pickNumber,
      round:       params.round,
      team_id:     params.teamId,
      player_id:   params.playerId,
    });

    const { data, error } = await this.supabase.rpc('submit_pick_v2', {
      p_league_id:        params.leagueId,
      p_team_id:          params.teamId,
      p_player_id:        params.playerId,
      p_round:            params.round,
      p_pick_number:      params.pickNumber,
      p_session_id:       params.sessionId,
      p_idempotency_key:  params.idempotencyKey,
      p_payload_hash:     payloadHash,
      p_actor:            params.actor,
      p_correlation_id:   params.correlationId ?? null,
    });

    if (error) {
      throw mapRpcError(error);
    }

    return data as SubmitPickResult;
  }

  // ── Auction RPCs (chunk 11g.6 sub-step 6a) ──────────────────────

  /**
   * Submit an auction nomination via `nominate_player_v2`. Mirrors
   * `submitPick`'s structural pattern: typed params/result,
   * `mapRpcError` for error translation, idempotency via the RPC's
   * advisory lock + `draft_events_idempotency_key_uniq` index.
   *
   * Engine validates nominator-on-clock + budget reserve BEFORE
   * calling (per ADR-002 §3 + ADR-004 §5 trusted-executor). RPC
   * does its own preflight as defense-in-depth (player-not-taken,
   * no active nomination, opening_bid >= league min).
   */
  async nominatePlayer(params: NominatePlayerParams): Promise<NominatePlayerResult> {
    const payloadHash = await computePickPayloadHash({
      pick_number: 0, // unused for nominations; payload-hash uses
      round:       0, // a different shape but the same canonical
      team_id:     params.teamId, // hash function for idempotency-key
      player_id:   0, // collision detection.
    } as never);

    const { data, error } = await this.supabase.rpc('nominate_player_v2', {
      p_league_id:       params.leagueId,
      p_team_id:         params.teamId,
      p_player_id:       params.playerId,
      p_player_name:     params.playerName,
      p_opening_bid:     params.openingBid,
      p_session_id:      params.sessionId,
      p_idempotency_key: params.idempotencyKey,
      p_payload_hash:    payloadHash,
      p_actor:           params.actor,
      p_correlation_id:  params.correlationId ?? null,
      p_clock_seconds:   params.clockSeconds,
    });

    if (error) throw mapRpcError(error);
    return data as NominatePlayerResult;
  }

  /**
   * Submit an auction bid via `place_bid_v2`. Mirrors `submitPick`'s
   * pattern. Engine validates budget reserve + bid-too-low BEFORE
   * calling; RPC enforces strict-greater-than-current-bid as
   * defense-in-depth.
   */
  async placeBid(params: PlaceBidParams): Promise<PlaceBidResult> {
    const payloadHash = await computePickPayloadHash({
      pick_number: 0,
      round:       0,
      team_id:     params.teamId,
      player_id:   0,
    } as never);

    const { data, error } = await this.supabase.rpc('place_bid_v2', {
      p_league_id:                    params.leagueId,
      p_team_id:                      params.teamId,
      p_nomination_id:                params.nominationId,
      p_bid_amount:                   params.bidAmount,
      p_session_id:                   params.sessionId,
      p_idempotency_key:              params.idempotencyKey,
      p_payload_hash:                 payloadHash,
      p_actor:                        params.actor,
      p_correlation_id:               params.correlationId ?? null,
      p_anti_snipe_threshold_seconds: params.antiSnipeThresholdSeconds,
      p_anti_snipe_extension_seconds: params.antiSnipeExtensionSeconds,
      p_min_bid_increment_tiers:      params.minBidIncrementTiers,
    });

    if (error) throw mapRpcError(error);
    return data as PlaceBidResult;
  }

  /**
   * Close the active auction nomination via `close_nomination_v2`.
   * Engine-only (timer fire); actor.kind must be 'autopick' (engine)
   * or 'commissioner' (override). The RPC awards the player to the
   * leading bidder, decrements their budget, INSERTs the
   * `draft_picks` row, and writes the `auction_nomination_closed`
   * event — all atomically.
   *
   * "No sale" branch: when only one bid exists (the nominator's
   * opening bid) and no follow-up bids landed, the RPC marks status
   * 'no_sale', skips the budget decrement + draft_picks insert, and
   * emits `auction_nomination_expired` instead. Caller advances
   * state via the returned `event_type`.
   */
  async closeNomination(params: CloseNominationParams): Promise<CloseNominationResult> {
    const payloadHash = await computePickPayloadHash({
      pick_number: 0,
      round:       0,
      team_id:     params.nominationId,
      player_id:   0,
    } as never);

    const { data, error } = await this.supabase.rpc('close_nomination_v2', {
      p_league_id:       params.leagueId,
      p_nomination_id:   params.nominationId,
      p_idempotency_key: params.idempotencyKey,
      p_payload_hash:    payloadHash,
      p_actor:           params.actor,
      p_correlation_id:  params.correlationId ?? null,
    });

    if (error) throw mapRpcError(error);
    return data as CloseNominationResult;
  }

  /**
   * Pause the auction via `auction_pause_v2` (chunk 11g.6 sub-step 6c1
   * per ADR-002 §4.4). Atomic 4-write block: row-locks the active
   * nomination (if any), flips `leagues.draft_state` to `'paused'`,
   * advances the event counter, and INSERTs an `auction_paused`
   * event whose payload carries `captured_remaining_seconds` for the
   * paired `auction_resume_v2` to read back.
   *
   * Auth (per ADR-004 §5): actor.kind must be 'commissioner'; RPC
   * additionally verifies `auth.uid() = leagues.commissioner_id`
   * unless caller is service_role.
   */
  async pauseAuction(params: PauseAuctionParams): Promise<PauseAuctionResult> {
    const { data, error } = await this.supabase.rpc('auction_pause_v2', {
      p_league_id:       params.leagueId,
      p_actor:           params.actor,
      p_reason:          params.reason,
      p_idempotency_key: params.idempotencyKey,
    });

    if (error) throw mapRpcError(error);
    return data as PauseAuctionResult;
  }

  /**
   * Resume a paused auction via `auction_resume_v2` (chunk 11g.6
   * sub-step 6c1 per ADR-002 §4.4).
   *
   * Atomic 4-or-5-write block. The RPC `SELECT ... FOR UPDATE`s the
   * most recent `auction_paused` event for this league to recover
   * the captured remaining-seconds — the row lock is the
   * world-class race-protection that prevents two simultaneous
   * commissioner clicks from both succeeding.
   *
   * Per ADR-002 §4.4: resume restores the captured remaining time,
   * NOT a fresh full window. **Divergent from snake/linear
   * `draft_resume`** (which gives a fresh full pick clock); auction
   * resume restores `auction_nominations.expires_at = now() +
   * captured_remaining_seconds * interval`.
   */
  async resumeAuction(params: ResumeAuctionParams): Promise<ResumeAuctionResult> {
    const { data, error } = await this.supabase.rpc('auction_resume_v2', {
      p_league_id:       params.leagueId,
      p_actor:           params.actor,
      p_idempotency_key: params.idempotencyKey,
    });

    if (error) throw mapRpcError(error);
    return data as ResumeAuctionResult;
  }

  /**
   * Broadcast a single draft event row over the v2 realtime channel.
   * Uses an ADMIN client (passed in) — broadcast write must not depend
   * on user-scoped auth, and the channel itself is not access-
   * controlled (spec §6.14).
   *
   * Errors are logged + swallowed. The polling safety net catches any
   * broadcast that drops.
   *
   * Skips the fetch + broadcast entirely when `wasDuplicate` is true:
   * the original commit's broadcast already fired, and re-broadcasting
   * the same seq creates noise without adding value.
   */
  async broadcastEvent(opts: {
    admin:        SupabaseClient;
    leagueId:     string;
    eventId:      number;
    wasDuplicate: boolean;
  }): Promise<void> {
    if (opts.wasDuplicate) return;

    let row: DraftEventRow | null = null;
    try {
      const { data, error } = await opts.admin
        .from('draft_events')
        .select(
          'id, league_id, seq, event_type, payload, payload_hash, ' +
            'idempotency_key, actor, correlation_id, created_at',
        )
        .eq('id', opts.eventId)
        .single();
      if (error) {
        logger.warn('draft_v2.broadcast_fetch_failed', {
          event_id: opts.eventId,
          error: error.message,
        });
        return;
      }
      row = data as unknown as DraftEventRow;
    } catch (err) {
      logger.warn('draft_v2.broadcast_fetch_threw', {
        event_id: opts.eventId,
        err: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    try {
      const channelName = `draft_events_v2:${opts.leagueId}`;
      const channel = opts.admin.channel(channelName, {
        config: { broadcast: { self: false } },
      });

      // KI-001 fix: race the channel.subscribe callback against a 5s
      // timeout. The callback resolves on any terminal status
      // (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED). The timeout
      // resolves with 'TIMEOUT' if no terminal status fires within
      // BROADCAST_TIMEOUT_MS. Either way, we don't await indefinitely
      // for SUBSCRIBED-that-never-comes.
      const subscribeResult: string = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('TIMEOUT'), BROADCAST_TIMEOUT_MS);
        channel.subscribe((status: string) => {
          if (
            status === 'SUBSCRIBED'    ||
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT'     ||
            status === 'CLOSED'
          ) {
            clearTimeout(timer);
            resolve(status);
          }
        });
      });

      if (subscribeResult === 'SUBSCRIBED') {
        try {
          await channel.send({
            type: 'broadcast',
            event: 'event',
            payload: row,
          });
        } catch (err) {
          logger.warn('draft_v2.broadcast_send_failed', {
            event_id: opts.eventId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        logger.warn('draft_v2.broadcast_channel_failed', {
          event_id: opts.eventId,
          status:   subscribeResult,
        });
      }

      // Always clean up the channel. removeChannel itself can throw
      // (e.g., on a CLOSED channel). Swallow — broadcast errors are
      // never user-facing.
      try {
        await opts.admin.removeChannel(channel);
      } catch (err) {
        logger.warn('draft_v2.broadcast_remove_channel_failed', {
          event_id: opts.eventId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      logger.warn('draft_v2.broadcast_channel_failed', {
        event_id: opts.eventId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
