import type { SupabaseClient } from '@supabase/supabase-js';

export interface MetricSelector {
  metric: string;
  variant: string;
  unit: string;
  season: number;
  game_type: 'regular' | 'playoff';
  population: string;
  feature_version: string;
  model_version: string;
}
export interface PublishedMetricValue {
  entityId: number;
  value: number | null;
  availability: 'available' | 'unavailable';
  reason: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Background read-model adapter. Requires service-role access to evidence.
 * Not wired into existing readers until the schema/serving rollout is approved.
 * Exact variant/version selection prevents substituting a different xG family.
 */
export class AnalyticsPublicationService {
  constructor(private readonly db: SupabaseClient, private readonly now = () => Date.now()) {}

  async readLatest(selector: MetricSelector, maxSourceAgeMs: number) {
    if (!Number.isFinite(maxSourceAgeMs) || maxSourceAgeMs <= 0) throw new Error('A positive freshness policy is required');
    let query = this.db.from('analytics_publications').select(
      'id,published_at,batch:analytics_metric_batches!inner(id,source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,expected_entities,validation)',
    );
    for (const [key, value] of Object.entries(selector)) query = query.eq(`batch.${key}`, value);
    const { data, error } = await query.order('id', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`Analytics publication read failed: ${error.message}`);
    if (!data) return null;
    const envelope: unknown = data;
    if (!record(envelope) || !record(envelope.batch)) throw new Error('Malformed publication');
    const batch = envelope.batch;
    for (const [key, value] of Object.entries(selector)) {
      if (batch[key] !== value) throw new Error('Publication variant/version mismatch');
    }
    if (typeof batch.id !== 'string' || typeof batch.data_cutoff !== 'string' ||
        typeof batch.source_snapshot_id !== 'string' || typeof batch.code_revision !== 'string' ||
        !/^[a-f0-9]{40}$/.test(batch.code_revision) ||
        !record(batch.validation) || batch.validation.status !== 'passed' ||
        !Array.isArray(batch.validation.entity_ids)) throw new Error('Missing publication evidence');
    const expected = batch.validation.entity_ids;
    if (!expected.length || !expected.every(Number.isSafeInteger) ||
        new Set(expected).size !== expected.length || batch.expected_entities !== expected.length) {
      throw new Error('Invalid entity manifest');
    }
    const cutoff = Date.parse(batch.data_cutoff);
    const now = this.now();
    if (!Number.isFinite(cutoff) || cutoff > now) throw new Error('Invalid source cutoff');
    const freshness = batch.validation.freshness_observed_at;
    const observed = typeof freshness === 'string' ? Date.parse(freshness) : NaN;
    if (!Number.isFinite(observed) || observed > cutoff) throw new Error('Missing or invalid source freshness evidence');
    const stale = now - observed > maxSourceAgeMs;
    const rows: PublishedMetricValue[] = [];
    for (let offset = 0; offset < expected.length; offset += 500) {
      const page = await this.db.from('analytics_metric_values')
        .select('entity_id,value,availability,reason', { count: 'exact' })
        .eq('batch_id', batch.id).order('entity_id').range(offset, offset + 499);
      if (page.error) throw new Error(`Analytics values read failed: ${page.error.message}`);
      const values: unknown = page.data;
      if (page.count !== expected.length || !Array.isArray(values) ||
          values.length !== Math.min(500, expected.length - offset)) throw new Error('Incomplete publication values');
      for (const value of values) {
        if (!record(value) || typeof value.entity_id !== 'number' || !expected.includes(value.entity_id) ||
            typeof value.reason !== 'string') throw new Error('Unexpected metric identity');
        const available = value.availability === 'available';
        if ((available && (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.reason !== 'verified')) ||
            (!available && (value.availability !== 'unavailable' || value.value !== null || value.reason === 'verified'))) {
          throw new Error('Invalid metric availability');
        }
        rows.push({ entityId: value.entity_id, value: available && !stale ? value.value as number : null,
          availability: available && !stale ? 'available' : 'unavailable', reason: stale ? 'stale_source' : value.reason });
      }
    }
    if (new Set(rows.map(r => r.entityId)).size !== expected.length) throw new Error('Duplicate publication entities');
    return { batchId: batch.id, sourceSnapshotId: batch.source_snapshot_id,
      dataCutoff: batch.data_cutoff, sourceObservedAt: freshness as string,
      codeRevision: batch.code_revision, selector, values: rows };
  }
}
