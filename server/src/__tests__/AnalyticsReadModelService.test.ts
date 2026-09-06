import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentSeason } from '@citrus/shared';
import { AnalyticsReadModelService, analyticsReadModel, startAnalyticsReadModel, toiSelector, TOI_SOURCE_MAX_AGE_MS } from '../services/AnalyticsReadModelService';
import { AnalyticsPublicationService } from '../services/AnalyticsPublicationService';
import { PlayerDashboardService, clearDashboardIndexCache, clearPlayerDashboardCache } from '../services/PlayerDashboardService';
import { createChain, createMockSupabase } from './helpers';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-05T12:00:00Z')); clearDashboardIndexCache(); clearPlayerDashboardCache(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function fixture() {
  let enabled = true;
  const selector = toiSelector(getCurrentSeason());
  const metadata = { ...selector, id: 'first', source_snapshot_id: 'receipt', code_revision: 'a'.repeat(40),
    data_cutoff: new Date().toISOString(), expected_entities: 1,
    validation: { status: 'passed', entity_ids: [17], freshness_observed_at: new Date().toISOString(),
      gate_version: 'official-appearance-v2', evidence_sha256: 'a'.repeat(64) } };
  const publication = createChain({ data: { batch: metadata }, error: null });
  const values = createChain({ data: [{ entity_id: 17, value: 20, availability: 'available', reason: 'verified' }], count: 1, error: null });
  const evidence = createMockSupabase({ analytics_publications: publication, analytics_metric_values: values });
  const reader = new AnalyticsPublicationService(evidence);
  const model = new AnalyticsReadModelService(reader, () => enabled);
  const user = createMockSupabase({
    player_directory: createChain({ data: [{ player_id: 17, full_name: 'Player', position_code: 'C' }], error: null }),
    player_talent_metrics: createChain({ data: [{ player_id: 17, avg_toi_per_game: 99 }], error: null }),
  });
  const service = new PlayerDashboardService(user, undefined, model);
  return { model, service, user, evidence, publication, metadata, disable: () => { enabled = false; } };
}

describe('publication read model at dashboard service boundary', () => {
  it('starts background refresh only when enabled and cancels its timer on shutdown', async () => {
    const refresh = vi.spyOn(analyticsReadModel, 'refresh').mockResolvedValue();
    vi.stubEnv('ANALYTICS_TOI_PUBLICATIONS_ENABLED', 'false');
    startAnalyticsReadModel()();
    expect(refresh).not.toHaveBeenCalled();
    vi.stubEnv('ANALYTICS_TOI_PUBLICATIONS_ENABLED', 'true');
    const stop = startAnalyticsReadModel();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('is opt-in, starts unavailable, and never queries evidence on a request', async () => {
    const f = fixture();
    f.disable();
    await f.model.refresh();
    expect((await f.service.getDashboardIndex()).players[0]).toMatchObject({ avg_toi_per_game: 99 });
    expect(f.evidence.from).not.toHaveBeenCalled();
    expect(f.model.read(17, getCurrentSeason())).toBeUndefined();
    const fresh = fixture();
    expect((await fresh.service.getDashboardIndex()).players[0]).toMatchObject({ avg_toi_per_game: null,
      toi_publication: { reason: 'publication_not_loaded', availability: 'unavailable' } });
    expect(fresh.evidence.from).not.toHaveBeenCalled();
  });

  it('overlays publish, revision, rollback and missing publication across one cached index', async () => {
    const f = fixture();
    await f.service.getDashboardIndex();
    const userQueries = f.user.from.mock.calls.length;
    for (const id of ['first', 'revision', 'first']) {
      f.metadata.id = id;
      await f.model.refresh();
      const queries = f.evidence.from.mock.calls.length;
      const row = (await f.service.getDashboardIndex()).players[0];
      expect(row).toMatchObject({ avg_toi_per_game: 20, toi_publication: { batch_id: id, value: 20 } });
      expect(f.evidence.from).toHaveBeenCalledTimes(queries);
      expect(f.user.from).toHaveBeenCalledTimes(userQueries);
    }
    f.publication.maybeSingle.mockResolvedValue({ data: null, error: null });
    await f.model.refresh();
    expect((await f.service.getDashboardIndex()).players[0]).toMatchObject({ avg_toi_per_game: null,
      toi_publication: { reason: 'publication_missing' } });
    f.disable();
    expect((await f.service.getDashboardIndex()).players[0].avg_toi_per_game).toBe(99);
  });

  it('fails closed on malformed evidence and expires cached freshness on every read', async () => {
    const f = fixture();
    f.metadata.validation.freshness_observed_at = new Date(Date.now() - TOI_SOURCE_MAX_AGE_MS + 1000).toISOString();
    await f.model.refresh();
    expect(f.model.read(17, getCurrentSeason())?.value).toBe(20);
    vi.setSystemTime(Date.now() + 1001);
    expect(f.model.read(17, getCurrentSeason())).toMatchObject({ value: null, reason: 'stale_source' });
    f.metadata.validation.freshness_observed_at = new Date().toISOString();
    f.metadata.data_cutoff = new Date().toISOString();
    await f.model.refresh();
    vi.setSystemTime(Date.now() + 180001);
    expect(f.model.read(17, getCurrentSeason())).toMatchObject({ value: null, reason: 'stale_read_model' });
    f.metadata.code_revision = 'malformed';
    await f.model.refresh();
    expect(f.model.read(17, getCurrentSeason())).toMatchObject({ value: null, reason: 'publication_read_failed' });
  });

  it('overlays detail caches and refuses mismatched season/game type and absent entities', async () => {
    const f = fixture();
    const request = { playerId: 17, season: getCurrentSeason(), gameType: 'regular' as const };
    expect((await f.service.getPlayerDashboard(request)).payload?.talent?.avg_toi_per_game).toBeNull();
    const queries = f.user.from.mock.calls.length;
    await f.model.refresh();
    expect((await f.service.getPlayerDashboard(request)).payload).toMatchObject({
      talent: { avg_toi_per_game: 20 }, toi_publication: { batch_id: 'first' } });
    expect(f.user.from).toHaveBeenCalledTimes(queries);
    expect(f.model.read(17, request.season, 'playoff')).toMatchObject({ value: null, reason: 'unsupported_scope' });
    expect(f.model.read(17, request.season - 1)).toMatchObject({ value: null, reason: 'unsupported_scope' });
    expect(f.model.read(18, request.season)).toMatchObject({ value: null, reason: 'entity_not_published' });
  });

  it('coalesces overlapping background refreshes', async () => {
    const readLatest = vi.fn().mockResolvedValue(null);
    const model = new AnalyticsReadModelService({ readLatest }, () => true);
    await Promise.all([model.refresh(), model.refresh(), model.refresh()]);
    expect(readLatest).toHaveBeenCalledTimes(1);
  });
});
