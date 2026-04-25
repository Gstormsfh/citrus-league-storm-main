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
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, type ErrorCode } from '../lib/errors';
import { logger } from '@citrus/shared';

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

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Canonical JSON for hashing: keys sorted recursively, no whitespace,
 * no trailing newline. Two payloads with identical logical content
 * always serialize to identical strings.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
      .join(',') +
    '}'
  );
}

function sha256Hex(input: string): string {
  return 'sha256:' + createHash('sha256').update(input).digest('hex');
}

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
   * Submit a pick via `submit_pick_v2`. Returns the RPC result.
   * Does NOT broadcast — call `broadcastEvent` from the route handler
   * with an admin client AFTER this resolves successfully.
   */
  async submitPick(params: SubmitPickParams): Promise<SubmitPickResult> {
    // Build the payload-hash input in the SAME shape the RPC builds
    // server-side (spec §4.1: server computes payload_hash from
    // canonical JSON; this lets idempotent retries with identical
    // inputs hit the same hash).
    //
    // We deliberately exclude server-assigned fields (picked_at,
    // is_autopick) from the hash input — the RPC does the same.
    const hashInput = canonicalJson({
      league_id:   params.leagueId,
      team_id:     params.teamId,
      player_id:   params.playerId,
      round:       params.round,
      pick_number: params.pickNumber,
      actor_kind:  params.actor.kind,
    });
    const payloadHash = sha256Hex(hashInput);

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
      await new Promise<void>((resolve) => {
        channel.subscribe(async (status) => {
          if (status !== 'SUBSCRIBED') return;
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
          } finally {
            await opts.admin.removeChannel(channel);
            resolve();
          }
        });
      });
    } catch (err) {
      logger.warn('draft_v2.broadcast_channel_failed', {
        event_id: opts.eventId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
