import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DashboardIndexEntry } from '@citrus/shared';
import { projectionsStrategy, selectAutopickPlayer } from '../autopickStrategy';

const index = vi.hoisted(() => vi.fn());
vi.mock('../../services/PlayerDashboardService', () => ({ PlayerDashboardService: class { getDashboardIndex = index; } }));
const LEAGUE = 'league';
const TEAM = 'team';
const context = { status: 'projected', run_id: 'current', revision: 'r1' };
function player(id: number, overrides: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry {
  return { id, team: 'TOR', position: 'C', is_goalie: false,
    canonical_context: context, projection_run_id: 'current', projection_revision: 'r1',
    gp: 0, goals: 0, assists: 0, sog: 0, blocks: 0, hits: 0, pim: 0, ppp: 0, shp: 0,
    wins: 0, saves: 0, shutouts: 0, goals_against: 0,
    proj_gp: 84, proj_goals: 20, proj_assists: 0, proj_sog: 0, proj_blocks: 0,
    proj_hits: 0, proj_pim: 0, proj_ppp: 0, proj_shp: 0, proj_plus_minus: 0,
    ...overrides } as DashboardIndexEntry;
}
function db(opts: { drafted?: number[]; owned?: number[]; queue?: number[]; scoring?: unknown;
  caps?: Record<string, number>; error?: string } = {}): SupabaseClient {
  return { from(table: string) {
    if (!['leagues', 'draft_picks_v2', 'draft_queues'].includes(table)) throw new Error(`Unexpected legacy read: ${table}`);
    let team = false;
    const query = {
      select: () => query,
      eq: (key: string) => { if (key === 'team_id') team = true; return query; },
      order: () => query,
      maybeSingle: async () => ({ data: { settings: { teamsCount: 12, rosterSlots: opts.caps },
        scoring_settings: opts.scoring ?? { skater: { goals: 1 } } }, error: opts.error === table ? { message: 'failed' } : null }),
      then: (resolve: (value: unknown) => void) => resolve({
        data: (table === 'draft_queues' ? opts.queue ?? [] : team ? opts.owned ?? [] : opts.drafted ?? []).map(player_id => ({ player_id })),
        error: opts.error === table ? { message: 'failed' } : null }),
    };
    return query;
  } } as unknown as SupabaseClient;
}
const run = (supabase = db(), excludePlayerIds?: Set<number>) => projectionsStrategy({ leagueId: LEAGUE, teamId: TEAM, supabase, excludePlayerIds });
beforeEach(() => index.mockReset());
function board(players: DashboardIndexEntry[]) { index.mockResolvedValue({ players, error: null }); }

describe('published league-scored timeout autopick', () => {
  it('changes the pick with league weights, including omitted categories being disabled', async () => {
    board([player(1, { proj_goals: 30, proj_hits: 2 }), player(2, { proj_goals: 2, proj_hits: 100 })]);
    expect(await run()).toMatchObject({ playerId: 1 });
    expect(await run(db({ scoring: { skater: { hits: 1 } } }))).toMatchObject({ playerId: 2 });
  });
  it('uses the published full workload for a zero-history rookie without a prior-games cap', async () => {
    board([player(1, { gp: 82, proj_goals: 20 }), player(2, { gp: 0, proj_gp: 84, proj_goals: 21 })]);
    expect(await run()).toMatchObject({ playerId: 2 });
  });
  it('scores goalie season components once, without an extra appearance multiplier or VORP', async () => {
    board([player(1, { proj_goals: 50 }), player(2, { is_goalie: true, position: 'G', proj_gp: 20,
      proj_wins: 10, proj_saves: 100, proj_shutouts: 0, proj_goals_against: 20 })]);
    expect(await run(db({ scoring: { skater: { goals: 1 }, goalie: { wins: 1, saves: 0.2, goals_against: -1 } } }))).toMatchObject({ playerId: 1 });
  });
  it('keeps zero and negative forecasts ahead of missing forecasts', async () => {
    board([player(1, { canonical_context: null, goals: 100 }), player(2, { proj_goals: 5 }), player(3, { proj_gp: 0, proj_goals: 0 })]);
    const scoring = { skater: { goals: -1 } };
    expect(await run(db({ scoring }))).toMatchObject({ playerId: 3 });
    expect(await run(db({ scoring, drafted: [3] }))).toMatchObject({ playerId: 2 });
  });
  it('withholds mixed-revision or missing enabled components instead of using benchmark totals', async () => {
    board([player(1, { projection_revision: 'stale', proj_goals: 500 }), player(2, { proj_hits: null, proj_goals: 999 }), player(3)]);
    expect(await run(db({ scoring: { skater: { goals: 1, hits: 1 } } }))).toMatchObject({ playerId: 3 });
  });
  it('uses measured historical order only after forecasts, retaining unprojected rookies', async () => {
    board([player(1, { canonical_context: null, goals: 10 }), player(2, { canonical_context: null, goals: 0 })]);
    expect(await run()).toMatchObject({ playerId: 1 });
    expect(await run(db({ drafted: [1] }))).toMatchObject({ playerId: 2 });
  });
  it('scores measured plus/minus when forecasts are unavailable', async () => {
    board([player(1, { canonical_context: null, plus_minus: -10 }), player(2, { canonical_context: null, plus_minus: 5 })]);
    expect(await run(db({ scoring: { skater: { plus_minus: 1 } } }))).toMatchObject({ playerId: 2 });
  });
  it('excludes drafted and keeper IDs, deduplicates identities, and excludes teamless players', async () => {
    board([player(1), player(1), player(2), player(3, { team: ' ' }), player(4)]);
    expect(await run(db({ drafted: [1] }), new Set([2]))).toMatchObject({ playerId: 4 });
  });
  it('uses deterministic numeric player-ID ties regardless of index order', async () => {
    board([player(10), player(2)]);
    expect(await run()).toMatchObject({ playerId: 2 });
  });
  it('retains the whole paged dashboard cohort past 1,000 players', async () => {
    board(Array.from({ length: 1300 }, (_, i) => player(i + 1, { proj_goals: i })));
    expect(await run()).toMatchObject({ playerId: 1300 });
  });
  it('honors grouped forward caps and counts an owned identity once', async () => {
    board([player(1), player(2, { position: 'LW', proj_goals: 100 }), player(3, { position: 'D' })]);
    expect(await run(db({ owned: [1, 1], drafted: [1], caps: { F: 1, D: 1 } }))).toMatchObject({ playerId: 3 });
    expect(await run(db({ owned: [1, 1], drafted: [1], caps: { F: 2, D: 1 } }))).toMatchObject({ playerId: 2 });
  });
  it('uses the best remaining player after all position caps are exhausted', async () => {
    board([player(1)]);
    expect(await run(db({ caps: { C: 0 } }))).toMatchObject({ playerId: 1, source: 'draft_value_caps_exhausted' });
  });
  it('preserves explicit queue priority over scoring and caps without reading the dashboard', async () => {
    expect(await selectAutopickPlayer({ leagueId: LEAGUE, teamId: TEAM, supabase: db({ queue: [2, 1] }) })).toMatchObject({ playerId: 2 });
    expect(index).not.toHaveBeenCalled();
  });
  it.each(['leagues', 'draft_picks_v2'])('does not guess after %s read failure', async error => {
    board([player(1)]);
    expect(await run(db({ error }))).toEqual({ ok: false, reason: 'no_eligible_players' });
  });
  it('reports exhaustion and index failure without fabricating a pick', async () => {
    board([player(1)]);
    expect(await run(db({ drafted: [1] }))).toEqual({ ok: false, reason: 'no_eligible_players' });
    index.mockResolvedValue({ players: [], error: new Error('unavailable') });
    expect(await run()).toEqual({ ok: false, reason: 'no_eligible_players' });
  });
  it('walks custom strategies until the first success', async () => {
    const last = vi.fn();
    expect(await selectAutopickPlayer({ leagueId: LEAGUE, teamId: TEAM, supabase: db() }, [
      async () => ({ ok: false, reason: 'no_eligible_players' }),
      async () => ({ ok: true, playerId: 8, source: 'test' }), last,
    ])).toMatchObject({ playerId: 8 });
    expect(last).not.toHaveBeenCalled();
  });
});
