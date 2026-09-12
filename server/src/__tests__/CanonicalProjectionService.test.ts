import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanonicalProjectionService, clearCanonicalProjectionCache } from '../services/CanonicalProjectionService';
import { PlayerDashboardService, clearDashboardIndexCache } from '../services/PlayerDashboardService';
import { getProjectionsSeason } from '@citrus/shared';
import { createChain, createMockSupabase } from './helpers';
const run = { season: 2026, run_id: 'run1', revision: 'rev1', activated_at: '2026-09-12', last_refresh_at: null, last_refresh_status: null, last_refresh_error: null, teams: [{ team: 'NYR', notes: ['Imported scenario'] }] };
const row = { player_id: '1', run_id: 'run1', revision: 'rev1', payload: { player_id: '1', team: 'NYR', status: 'projected', availability: { status: 'out', authority: 'imported_scenario' }, role: { conditioned: false, not_conditioned_reason: 'No role model' }, sources: [{ path: 'edits.json' }], provenance: 'MANUAL' } };
beforeEach(clearCanonicalProjectionCache);
describe('published canonical context read', () => {
  it('returns null context when nothing is published and never reads staged tables', async () => {
    const db = createMockSupabase();
    expect((await new CanonicalProjectionService(db).getPublishedContexts(2026)).size).toBe(0);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith('canonical_published_runs');
  });
  it('preserves imported authority and unconditioned role without changing forecast or actuals', async () => {
    const db = createMockSupabase({ canonical_published_runs: createChain({ data: run, error: null }), canonical_published_players: createChain({ data: [row], error: null }) });
    const context = (await new CanonicalProjectionService(db).getPublishedContexts(2026)).get('1');
    expect(context?.availability?.authority).toBe('imported_scenario');
    expect(context?.role?.conditioned).toBe(false);
    expect(context?.team_notes).toEqual(['Imported scenario']);
    expect(context?.revision).toBe('rev1');
    expect(context).not.toHaveProperty('gp');
  });
  it('reloads published player context when the revision changes despite an existing snapshot cache', async () => {
    let active = run;
    let player = row;
    const db = createMockSupabase();
    db.from = vi.fn((table: string) => createChain({ data: table === 'canonical_published_runs' ? active : [player], error: null }));
    const service = new CanonicalProjectionService(db);
    await service.getPublishedContexts(2026);
    active = { ...run, run_id: 'run2', revision: 'rev2' };
    player = { ...row, run_id: 'run2', revision: 'rev2' };
    expect((await service.getPublishedContexts(2026)).get('1')?.revision).toBe('rev2');
    expect(db.from.mock.calls.filter(([table]: [string]) => table === 'canonical_published_players')).toHaveLength(2);
  });
  it('rejects identity mismatch, duplicate IDs and mixed revisions', async () => {
    for (const rows of [[{ ...row, player_id: '2' }], [row, row], [{ ...row, revision: 'old' }]]) {
      const db = createMockSupabase({ canonical_published_runs: createChain({ data: run, error: null }), canonical_published_players: createChain({ data: rows, error: null }) });
      await expect(new CanonicalProjectionService(db).getPublishedContexts(2026)).rejects.toThrow();
    }
  });
  it('does not return previous context when the published view fails', async () => {
    const db = createMockSupabase({ canonical_published_runs: createChain({ data: null, error: { message: 'not deployed' } }) });
    await expect(new CanonicalProjectionService(db).getPublishedContexts(2026)).rejects.toEqual({ message: 'not deployed' });
  });
  it('pages beyond the API row clamp and pins every page to the same run', async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ ...row, player_id: String(id), payload: { ...row.payload, player_id: String(id) } }));
    const playerChain = createChain();
    playerChain.range.mockImplementation((from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }));
    const db = createMockSupabase({ canonical_published_runs: createChain({ data: run, error: null }), canonical_published_players: playerChain });
    expect((await new CanonicalProjectionService(db).getPublishedContexts(2026)).size).toBe(1001);
    expect(playerChain.range).toHaveBeenCalledTimes(2);
    expect(playerChain.eq).toHaveBeenCalledWith('revision', 'rev1');
  });
  it('withholds context when the active pointer changes during pagination', async () => {
    const runChain = createChain();
    runChain.maybeSingle.mockResolvedValueOnce({ data: run, error: null }).mockResolvedValueOnce({ data: { ...run, revision: 'rev2' }, error: null });
    const db = createMockSupabase({ canonical_published_runs: runChain, canonical_published_players: createChain({ data: [row], error: null }) });
    await expect(new CanonicalProjectionService(db).getPublishedContexts(2026)).rejects.toThrow('changed during read');
  });

  it('updates context over a cached dashboard without altering historical actuals', async () => {
    clearDashboardIndexCache();
    let active = { ...run, season: getProjectionsSeason() };
    const db = createMockSupabase();
    db.from = vi.fn((table: string) => {
      const data = table === 'canonical_published_runs' ? active :
        table === 'canonical_published_players' ? [{ ...row, revision: active.revision }] :
        table === 'player_directory' ? [{ player_id: 1, full_name: 'Fixture', position_code: 'C', team_abbrev: 'NYR', eligible_positions: 'C,LW' }] :
        table === 'player_season_stats' ? [{ player_id: 1, games_played: 7, nhl_goals: 2 }] :
        table === 'player_ros_projections' ? [{ player_id: 1, games_remaining: 70, projected_goals: active.revision === 'rev1' ? 10 : 20, projection_run_id: active.run_id, projection_revision: active.revision }] : [];
      return createChain({ data, error: null });
    });
    const service = new PlayerDashboardService(db);
    const first = (await service.getDashboardIndex()).players[0];
    active = { ...active, revision: 'rev2' };
    const second = (await service.getDashboardIndex()).players[0];
    expect(first.canonical_context?.revision).toBe('rev1');
    expect(second.canonical_context?.revision).toBe('rev2');
    expect(second.gp).toBe(7);
    expect(second.goals).toBe(2);
    expect(first.proj_goals).toBe(10);
    expect(second.proj_goals).toBe(20);
    expect(second.eligible_positions).toEqual(['C', 'LW']);
    active = { ...active, last_refresh_at: '2026-09-13T00:00:00Z' as any };
    const refreshed = (await service.getDashboardIndex()).players[0];
    expect(refreshed.canonical_context?.refresh.at).toBe('2026-09-13T00:00:00Z');
    expect(db.from.mock.calls.filter(([table]: [string]) => table === 'player_directory')).toHaveLength(3);
  });

  it('withholds legacy forecast counts beside published context while preserving actuals', async () => {
    clearDashboardIndexCache();
    const active = { ...run, season: getProjectionsSeason() };
    const db = createMockSupabase({
      canonical_published_runs: createChain({ data: active, error: null }),
      canonical_published_players: createChain({ data: [row], error: null }),
      player_directory: createChain({ data: [{ player_id: 1, full_name: 'Fixture', position_code: 'C', team_abbrev: 'NYR' }], error: null }),
      player_season_stats: createChain({ data: [{ player_id: 1, games_played: 7, nhl_goals: 2 }], error: null }),
      player_ros_projections: createChain({ data: [{ player_id: 1, projected_goals: 999, projection_run_id: 'old', projection_revision: 'old' }], error: null }),
    });
    const player = (await new PlayerDashboardService(db).getDashboardIndex()).players[0];
    expect(player.canonical_context?.revision).toBe('rev1');
    expect(player.proj_goals).toBeNull();
    expect(player.projection_season).toBeNull();
    expect(player.goals).toBe(2);
    expect(player.gp).toBe(7);
  });

  it('keeps actuals but never falls back to legacy forecasts on unknown publication', async () => {
    clearDashboardIndexCache();
    const db = createMockSupabase({
      canonical_published_runs: createChain({ data: null, error: { message: 'Offline' } }),
      player_directory: createChain({ data: [{ player_id: 1, full_name: 'Fixture', position_code: 'C', team_abbrev: 'NYR' }], error: null }),
      player_season_stats: createChain({ data: [{ player_id: 1, games_played: 7, nhl_goals: 2 }], error: null }),
      player_ros_projections: createChain({ data: [{ player_id: 1, projected_goals: 999 }], error: null }),
    });
    const result = await new PlayerDashboardService(db).getDashboardIndex();
    expect(result.players[0].goals).toBe(2);
    expect(result.players[0].proj_goals).toBeNull();
    expect(result.players[0].canonical_context).toBeNull();
  });

});
