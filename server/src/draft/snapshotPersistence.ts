// Phase 4.5 chunk 11g.7 sub-step 7c — snapshot persistence helpers.
//
// **Path C architecture**: each row in `draft_snapshots` carries
// TWO JSONB payloads — the wire `DraftSnapshot` (built by 7b's
// `buildSnapshot()`) AND a small engine-internal `engine_state`
// JSONB for orchestration fields that aren't in the wire snapshot
// (`currentTimerKind`, `pauseState`, `eventsSinceLastSnapshot`).
//
// **Canonical-replay principle preserved**: snapshot+delta replay
// is an OPTIMIZATION on top of full event-log replay (chunk 11g.4
// step 6b). Bootstrap falls back to full event-replay on ANY
// snapshot issue. Every state-affecting event still has an
// apply-during-replay handler.
//
// See `docs/PHASE_4_5_PROJECT_PLAN.md` Decision Log (2026-05-07)
// for the full architectural rationale.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftSnapshot } from '@citrus/shared';
import { structuredLogger } from '@citrus/shared';

/**
 * **Bump this constant when the `engine_state` JSONB shape changes
 * in a way that prior-version deserialization would silently
 * corrupt state.**
 *
 * - Adding a new OPTIONAL field is OK without bumping
 *   (deserialization handles missing fields gracefully via
 *   nullish defaults).
 * - Removing or renaming a field, OR changing a discriminator's
 *   value space (e.g., adding a new `currentTimerKind` enum value),
 *   requires a bump.
 *
 * Mismatch on bootstrap → WARN log with structured `reason:
 * 'version_mismatch'` + fall back to full event-replay.
 *
 * Initial value: 1 (chunk 11g.7 sub-step 7c).
 */
export const ENGINE_SNAPSHOT_VERSION = 1;

/** Maximum snapshots retained per in-progress draft. Older rows
 *  pruned after each successful write. Completed/cancelled drafts
 *  keep ALL snapshots for audit. */
const RETENTION_IN_PROGRESS = 5;

/**
 * Engine-internal orchestration fields not in the wire `DraftSnapshot`.
 * Serialized as JSONB in the `engine_state` column. Date fields are
 * stored as ISO strings for JSON safety.
 */
export interface EngineStateSerialized {
  currentTimerKind:
    | 'pick'
    | 'bid_window'
    | 'nomination_window'
    | null;
  pauseState: {
    pausedAt: string;
    remainingMs: number;
    pausedTimerKind: 'bid_window' | 'nomination_window';
  } | null;
  eventsSinceLastSnapshot: number;
}

/**
 * The deserialized form returned to the engine on bootstrap. `Date`
 * fields are real `Date` objects (parsed from ISO strings).
 */
export interface EngineStateDeserialized {
  currentTimerKind:
    | 'pick'
    | 'bid_window'
    | 'nomination_window'
    | null;
  pauseState: {
    pausedAt: Date;
    remainingMs: number;
    pausedTimerKind: 'bid_window' | 'nomination_window';
  } | null;
  eventsSinceLastSnapshot: number;
}

/**
 * Persistence record returned by `readMostRecentSnapshot`. Includes
 * the row id (for retention pruning) and the `engine_version` from
 * the row (for validation against the runtime constant).
 */
export interface SnapshotRecord {
  id: string;
  lastAppliedSeq: number;
  engineVersion: number;
  snapshot: DraftSnapshot;
  engineState: EngineStateDeserialized;
}

/**
 * Discriminated union of bootstrap-time validation outcomes. The
 * `'reason'` field on failure feeds the structured log emit so
 * alert policies can distinguish "expected version mismatch after
 * deploy" (transient high-frequency, then silent) from "snapshot
 * ahead of event log" (genuine bug, alert on first occurrence).
 *
 * Per Decision Log 2026-05-07: same event name
 * (`snapshot.bootstrap.fallback_full_replay`), structured `reason`
 * for filtering.
 */
export type SnapshotBootstrapValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'version_mismatch'
        | 'seq_ahead_of_log'
        | 'seq_below_oldest_event'
        | 'payload_deserialization_failed'
        | 'engine_state_invalid';
      details?: string;
    };

/**
 * Validate a snapshot record against bootstrap invariants. Returns
 * `{ ok: true }` if the snapshot can be used; `{ ok: false, reason }`
 * if bootstrap should fall back to full event-replay.
 */
export function validateSnapshotForBootstrap(
  record: SnapshotRecord,
  currentMaxSeq: number,
  currentMinSeq: number,
): SnapshotBootstrapValidation {
  if (record.engineVersion !== ENGINE_SNAPSHOT_VERSION) {
    return {
      ok: false,
      reason: 'version_mismatch',
      details: `snapshot engineVersion=${record.engineVersion}, runtime=${ENGINE_SNAPSHOT_VERSION}`,
    };
  }
  // Snapshot must not be ahead of the durable log (impossible state).
  if (record.lastAppliedSeq > currentMaxSeq) {
    return {
      ok: false,
      reason: 'seq_ahead_of_log',
      details: `lastAppliedSeq=${record.lastAppliedSeq}, currentMaxSeq=${currentMaxSeq}`,
    };
  }
  // Snapshot must not be older than the oldest event we still have
  // — if it is, the delta we'd compute starts mid-history, missing
  // events that the snapshot's base state doesn't reflect.
  if (currentMinSeq > 0 && record.lastAppliedSeq + 1 < currentMinSeq) {
    return {
      ok: false,
      reason: 'seq_below_oldest_event',
      details: `lastAppliedSeq=${record.lastAppliedSeq}, oldestEventSeq=${currentMinSeq}`,
    };
  }
  // Engine state shape sanity.
  const es = record.engineState;
  if (
    es === null ||
    typeof es !== 'object' ||
    !('currentTimerKind' in es) ||
    !('eventsSinceLastSnapshot' in es)
  ) {
    return {
      ok: false,
      reason: 'engine_state_invalid',
      details: 'engine_state missing required fields',
    };
  }
  // Discriminator value-space check.
  const kind = es.currentTimerKind;
  if (
    kind !== null &&
    kind !== 'pick' &&
    kind !== 'bid_window' &&
    kind !== 'nomination_window'
  ) {
    return {
      ok: false,
      reason: 'engine_state_invalid',
      details: `unknown currentTimerKind=${String(kind)}`,
    };
  }
  // Snapshot payload sanity.
  if (
    record.snapshot === null ||
    typeof record.snapshot !== 'object' ||
    typeof record.snapshot.lobbyId !== 'string' ||
    typeof record.snapshot.format !== 'string'
  ) {
    return {
      ok: false,
      reason: 'payload_deserialization_failed',
      details: 'snapshot_payload missing required fields',
    };
  }
  return { ok: true };
}

/**
 * Serialize the engine's in-memory `pauseState` shape (Date object)
 * for JSONB storage (ISO string).
 */
export function serializeEngineState(input: {
  currentTimerKind:
    | 'pick'
    | 'bid_window'
    | 'nomination_window'
    | null;
  pauseState: {
    pausedAt: Date;
    remainingMs: number;
    pausedTimerKind: 'bid_window' | 'nomination_window';
  } | null;
  eventsSinceLastSnapshot: number;
}): EngineStateSerialized {
  return {
    currentTimerKind: input.currentTimerKind,
    pauseState:
      input.pauseState === null
        ? null
        : {
            pausedAt: input.pauseState.pausedAt.toISOString(),
            remainingMs: input.pauseState.remainingMs,
            pausedTimerKind: input.pauseState.pausedTimerKind,
          },
    eventsSinceLastSnapshot: input.eventsSinceLastSnapshot,
  };
}

/**
 * Deserialize the JSONB `engine_state` row into the engine's
 * in-memory shape (parsing ISO strings back into Date objects).
 * Tolerant of missing optional fields — adding a new optional field
 * doesn't require an `engine_version` bump per the constant's
 * JSDoc.
 */
export function deserializeEngineState(
  payload: unknown,
): EngineStateDeserialized {
  const p = (payload ?? {}) as Partial<EngineStateSerialized>;
  return {
    currentTimerKind: p.currentTimerKind ?? null,
    pauseState:
      p.pauseState == null
        ? null
        : {
            pausedAt: new Date(String(p.pauseState.pausedAt)),
            remainingMs: Number(p.pauseState.remainingMs ?? 0),
            pausedTimerKind:
              p.pauseState.pausedTimerKind === 'nomination_window'
                ? 'nomination_window'
                : 'bid_window',
          },
    eventsSinceLastSnapshot: Number(p.eventsSinceLastSnapshot ?? 0),
  };
}

/**
 * Read the most-recent snapshot for the given league. Returns
 * `null` if no snapshot exists (first-deploy scenario; bootstrap
 * falls back to full event-replay).
 */
export async function readMostRecentSnapshot(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<SnapshotRecord | null> {
  const { data, error } = await supabase
    .from('draft_snapshots')
    .select('id, last_applied_seq, engine_version, snapshot_payload, engine_state')
    .eq('league_id', leagueId)
    .order('last_applied_seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    structuredLogger.error(
      'snapshot.persistence.read_failed',
      { leagueId },
      error,
    );
    throw error;
  }
  if (!data) {
    return null;
  }
  return {
    id: String(data.id),
    lastAppliedSeq: Number(data.last_applied_seq),
    engineVersion: Number(data.engine_version),
    snapshot: data.snapshot_payload as DraftSnapshot,
    engineState: deserializeEngineState(data.engine_state),
  };
}

/**
 * Write a snapshot row + run retention pruning. Pruning gated on
 * `draftStatus`: in-progress drafts keep only `RETENTION_IN_PROGRESS`
 * most recent; completed/cancelled drafts keep ALL snapshots for
 * audit trail.
 *
 * Atomicity: the INSERT and the prune-DELETE are separate calls
 * (no transaction). If the INSERT succeeds but pruning fails, the
 * worst case is a few stale rows accumulate — not a correctness
 * issue. The next successful write retries the prune.
 */
export async function writeSnapshot(
  supabase: SupabaseClient,
  params: {
    leagueId: string;
    lastAppliedSeq: number;
    snapshot: DraftSnapshot;
    engineState: EngineStateSerialized;
    draftStatus: 'not_started' | 'in_progress' | 'completed' | 'cancelled';
  },
): Promise<void> {
  const { error: insertErr } = await supabase
    .from('draft_snapshots')
    .insert({
      league_id: params.leagueId,
      last_applied_seq: params.lastAppliedSeq,
      engine_version: ENGINE_SNAPSHOT_VERSION,
      snapshot_payload: params.snapshot,
      engine_state: params.engineState,
    });
  if (insertErr) {
    structuredLogger.error(
      'snapshot.persistence.write_failed',
      { leagueId: params.leagueId, lastAppliedSeq: params.lastAppliedSeq },
      insertErr,
    );
    throw insertErr;
  }

  structuredLogger.info('snapshot.persistence.written', {
    leagueId: params.leagueId,
    lastAppliedSeq: params.lastAppliedSeq,
    engineVersion: ENGINE_SNAPSHOT_VERSION,
  });

  // Retention: skip pruning for completed/cancelled drafts (audit).
  if (params.draftStatus === 'completed' || params.draftStatus === 'cancelled') {
    structuredLogger.debug('snapshot.persistence.retention_skipped', {
      leagueId: params.leagueId,
      draftStatus: params.draftStatus,
      reason: 'completed_or_cancelled_audit_preserved',
    });
    return;
  }

  // For in-progress drafts: keep RETENTION_IN_PROGRESS most recent.
  // Two-step approach because PostgREST/Supabase doesn't expose
  // subquery DELETE; read the keep-list, then delete the rest.
  const { data: keepRows, error: keepErr } = await supabase
    .from('draft_snapshots')
    .select('id')
    .eq('league_id', params.leagueId)
    .order('last_applied_seq', { ascending: false })
    .limit(RETENTION_IN_PROGRESS);
  if (keepErr) {
    structuredLogger.warn('snapshot.persistence.retention_query_failed', {
      leagueId: params.leagueId,
    });
    return; // non-fatal; row count grows mildly
  }
  const keepIds = (keepRows ?? []).map((r) => String(r.id));
  if (keepIds.length === 0) {
    return;
  }
  const { error: deleteErr, count } = await supabase
    .from('draft_snapshots')
    .delete({ count: 'exact' })
    .eq('league_id', params.leagueId)
    .not('id', 'in', `(${keepIds.map((id) => `"${id}"`).join(',')})`);
  if (deleteErr) {
    structuredLogger.warn('snapshot.persistence.retention_delete_failed', {
      leagueId: params.leagueId,
    });
    return;
  }
  if ((count ?? 0) > 0) {
    structuredLogger.debug('snapshot.persistence.pruned', {
      leagueId: params.leagueId,
      prunedCount: count ?? 0,
    });
  }
}

/**
 * Find the seq of the most-recent durable event for the league.
 * Returns 0 if no events. Used by `processSnapshot` to determine
 * the snapshot's `last_applied_seq` and by bootstrap validation
 * to detect "snapshot ahead of event log."
 */
export async function findMaxEventSeq(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('draft_events')
    .select('seq')
    .eq('league_id', leagueId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? Number(data.seq) : 0;
}

/**
 * Find the seq of the OLDEST durable event for the league. Returns
 * 0 if no events. Used by bootstrap validation to detect "snapshot
 * older than the oldest event we have."
 */
export async function findMinEventSeq(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('draft_events')
    .select('seq')
    .eq('league_id', leagueId)
    .order('seq', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? Number(data.seq) : 0;
}
