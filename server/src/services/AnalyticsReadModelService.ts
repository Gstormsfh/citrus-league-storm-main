import { getCurrentSeason, logger, type ToiPublication } from '@citrus/shared';
import { getSupabaseAdmin } from '../lib/supabase';
import { AnalyticsPublicationService, type MetricSelector } from './AnalyticsPublicationService';

type Snapshot = Awaited<ReturnType<AnalyticsPublicationService['readLatest']>>;
export const TOI_SOURCE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const REFRESH_MS = 60_000;
const MAX_CACHE_AGE_MS = 3 * REFRESH_MS;
export const toiSelector = (season: number): MetricSelector => ({ metric: 'avg_toi_per_game',
  variant: 'official-reconciled', unit: 'minutes_per_appearance', season, game_type: 'regular',
  population: 'skaters', feature_version: 'official-appearance-v2', model_version: 'none' });

/** Background-only privileged reads. Requests use an atomic in-memory snapshot.
 * A failed refresh invalidates the snapshot; startup and unsupported scopes fail closed.
 */
export class AnalyticsReadModelService {
  private snapshot: Snapshot = null;
  private refreshedAt = 0;
  private values = new Map<number, NonNullable<Snapshot>['values'][number]>();
  private inFlight: Promise<void> | null = null;
  private failure = 'publication_not_loaded';
  constructor(private readonly reader: Pick<AnalyticsPublicationService, 'readLatest'>,
    private readonly enabled: () => boolean, private readonly now = () => Date.now()) {}

  refresh(): Promise<void> {
    if (!this.enabled()) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        this.snapshot = await this.reader.readLatest(toiSelector(getCurrentSeason()), TOI_SOURCE_MAX_AGE_MS);
        this.refreshedAt = this.now();
        this.values = new Map(this.snapshot?.values.map(row => [row.entityId, row]) ?? []);
        this.failure = this.snapshot ? 'entity_not_published' : 'publication_missing';
        logger.info('Analytics TOI read model refreshed', { batchId: this.snapshot?.batchId ?? null });
      } catch (error) {
        this.snapshot = null;
        this.values.clear();
        this.failure = 'publication_read_failed';
        logger.error('Analytics TOI read model refresh failed', error);
      }
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  read(playerId: number, season: number, gameType = 'regular'): ToiPublication | undefined {
    if (!this.enabled()) return undefined;
    const snapshot = this.snapshot;
    let reason = this.failure;
    let value: number | null = null;
    const scoped = snapshot?.selector.season === season && gameType === 'regular';
    if (gameType !== 'regular' || season !== getCurrentSeason()) reason = 'unsupported_scope';
    else if (snapshot && scoped) {
      if (this.now() - this.refreshedAt > MAX_CACHE_AGE_MS) reason = 'stale_read_model';
      else if (this.now() - Date.parse(snapshot.sourceObservedAt) > TOI_SOURCE_MAX_AGE_MS) reason = 'stale_source';
      else {
        const row = this.values.get(playerId);
        reason = row?.reason ?? 'entity_not_published';
        if (row?.availability === 'available') value = row.value;
      }
    }
    return { availability: value === null ? 'unavailable' : 'available', value, reason,
      metric: 'avg_toi_per_game', model_version: 'none', season,
      game_type: gameType === 'playoff' ? 'playoff' : 'regular', population: 'skaters',
      source_snapshot_id: scoped ? snapshot!.sourceSnapshotId : null,
      data_cutoff: scoped ? snapshot!.dataCutoff : null,
      feature_version: 'official-appearance-v2', variant: 'official-reconciled', unit: 'minutes_per_appearance',
      batch_id: scoped ? snapshot!.batchId : null,
      source_observed_at: scoped ? snapshot!.sourceObservedAt : null,
      code_revision: scoped ? snapshot!.codeRevision : null };
  }
}

export const analyticsReadModel = new AnalyticsReadModelService({
  readLatest: (selector, maxAge) => new AnalyticsPublicationService(getSupabaseAdmin()).readLatest(selector, maxAge),
}, () => process.env.ANALYTICS_TOI_PUBLICATIONS_ENABLED === 'true');

export function startAnalyticsReadModel(): () => void {
  if (process.env.ANALYTICS_TOI_PUBLICATIONS_ENABLED !== 'true') return () => {};
  void analyticsReadModel.refresh();
  const timer = setInterval(() => { void analyticsReadModel.refresh(); }, REFRESH_MS);
  timer.unref();
  return () => clearInterval(timer);
}
