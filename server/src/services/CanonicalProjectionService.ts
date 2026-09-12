import type { SupabaseClient } from '@supabase/supabase-js';
import { logger, type CanonicalProjectionContext } from '@citrus/shared';
import { readAllPaged } from '../lib/pagedRead';

type PublishedRun = {
  season: number; run_id: string; revision: string; activated_at: string;
  last_refresh_at: string | null; last_refresh_status: string | null; last_refresh_error: string | null;
  teams?: Array<{ team: string; notes?: unknown }>;
};
type PublishedPlayer = { player_id: string; run_id: string; revision: string; payload: Record<string, unknown> };
const healthPending = new Map<number, Promise<PublishedRun | null>>();
const snapshots = new Map<string, Map<string, CanonicalProjectionContext>>();
const pending = new Map<string, Promise<Map<string, CanonicalProjectionContext>>>();
export function clearCanonicalProjectionCache(): void { snapshots.clear(); pending.clear(); healthPending.clear(); }

/** Only active published views are readable here. Staged runs never supply app context. */
export class CanonicalProjectionService {
  constructor(private supabase: SupabaseClient) {}

  async getPublishedContexts(season: number): Promise<Map<string, CanonicalProjectionContext>> {
    try {
      // Check the active revision even when the ordinary player index is cached.
      let health = healthPending.get(season);
      if (!health) {
        health = (async () => {
          const { data, error } = await this.supabase.from('canonical_published_runs')
            .select('season,run_id,revision,activated_at,last_refresh_at,last_refresh_status,last_refresh_error,teams:payload->teams')
            .eq('season', season).maybeSingle();
          if (error) throw error;
          return data as PublishedRun | null;
        })();
        healthPending.set(season, health);
      }
      let run: PublishedRun | null;
      try { run = await health; } finally { if (healthPending.get(season) === health) healthPending.delete(season); }
      if (!run) return new Map();
      if (!run.run_id || !run.revision || run.season !== season) throw new Error('Invalid published canonical revision');
      const key = `${season}:${run.run_id}:${run.revision}`;
      let contexts = snapshots.get(key);
      if (!contexts) {
        let promise = pending.get(key);
        if (!promise) {
          promise = this.loadSnapshot(run);
          pending.set(key, promise);
        }
        try { contexts = await promise; } finally { if (pending.get(key) === promise) pending.delete(key); }
      }
      // Health can change without publishing another immutable player snapshot.
      return new Map([...contexts].map(([id, context]) => [id, { ...context,
        refresh: { at: run.last_refresh_at, status: run.last_refresh_status, error: run.last_refresh_error },
      }]));
    } catch (error) {
      logger.warn('[CanonicalProjectionService] Published context unavailable', error);
      return new Map();
    }
  }

  private async loadSnapshot(run: PublishedRun): Promise<Map<string, CanonicalProjectionContext>> {
    const result = await readAllPaged<PublishedPlayer>(this.supabase, {
      table: 'canonical_published_players', columns: 'player_id,run_id,revision,payload',
      filters: [['season', run.season], ['run_id', run.run_id], ['revision', run.revision]], orderBy: ['player_id'],
    });
    if (result.error) throw result.error;
    if (!result.data.length) throw new Error('Published canonical player snapshot is empty');
    const contexts = new Map<string, CanonicalProjectionContext>();
    for (const row of result.data) {
      if (row.run_id !== run.run_id || row.revision !== run.revision || contexts.has(row.player_id)) throw new Error('Mixed or duplicate canonical publication');
      const p = row.payload;
      if (!p || String(p.player_id) !== row.player_id) throw new Error('Canonical player identity mismatch');
      contexts.set(row.player_id, {
        season: run.season, run_id: run.run_id, revision: run.revision, activated_at: run.activated_at,
        availability: record(p.availability), role: record(p.role),
        sources: Array.isArray(p.sources) ? p.sources : [],
        team_notes: run.teams?.find(team => team.team === p.team)?.notes ?? null,
        provenance: typeof p.provenance === 'string' ? p.provenance : null,
        status: typeof p.status === 'string' ? p.status : null,
        issues: Array.isArray(p.issues) ? p.issues.filter((v): v is string => typeof v === 'string') : [],
        refresh: { at: run.last_refresh_at, status: run.last_refresh_status, error: run.last_refresh_error },
      });
    }
    // The published pointer may change while pages are read. Never cache a mixed view.
    const { data: current, error } = await this.supabase.from('canonical_published_runs')
      .select('run_id,revision').eq('season', run.season).maybeSingle();
    if (error || current?.run_id !== run.run_id || current?.revision !== run.revision) throw new Error('Canonical publication changed during read');
    snapshots.clear(); // bounded to the currently requested published snapshot
    snapshots.set(`${run.season}:${run.run_id}:${run.revision}`, contexts);
    return contexts;
  }
}
const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
