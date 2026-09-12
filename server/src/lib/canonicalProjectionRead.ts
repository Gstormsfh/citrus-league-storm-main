import type { SupabaseClient } from '@supabase/supabase-js';

type ProjectionRow = Record<string, unknown>;
type Pointer = { season: number; run_id: string; revision: string };

async function readPointer(supabase: SupabaseClient, season: number): Promise<Pointer | null> {
  const { data, error } = await supabase.from('canonical_published_runs')
    .select('season,run_id,revision').eq('season', season).maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  if (!data || data.season !== season || typeof data.run_id !== 'string' || !data.run_id
    || typeof data.revision !== 'string' || !data.revision) {
    throw new Error('Canonical publication pointer unavailable');
  }
  return data;
}

/** Bracket the complete paged result, not each page, with two publication reads.
 * A genuine absent pointer preserves legacy serving. Failed pointer reads never
 * do. Retry one publication race or mismatched result; never return partial rows.
 */
export async function readCanonicalProjectionRows<T extends ProjectionRow>(
  supabase: SupabaseClient,
  season: number,
  readRows: () => Promise<T[]>,
): Promise<T[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await readPointer(supabase, season);
    const rows = await readRows();
    const after = await readPointer(supabase, season);
    const stable = before?.run_id === after?.run_id && before?.revision === after?.revision;
    const matches = !after || rows.every(row => Number(row.season) === season
      && row.projection_run_id === after.run_id && row.projection_revision === after.revision);
    if (stable && matches) return rows;
  }
  throw new Error('Canonical projections changed or contain mismatched publication stamps; retry the request');
}
