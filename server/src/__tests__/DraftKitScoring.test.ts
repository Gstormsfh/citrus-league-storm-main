import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftKitService } from '../services/DraftKitService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { PlayerDashboardService } from '../services/PlayerDashboardService';
import type { DashboardIndexEntry } from '../services/PlayerDashboardService';
import { createChain, createMockSupabase } from './helpers';

const entry = (id: number, extra = {}): DashboardIndexEntry => ({
  id, name: `Player ${id}`, position: 'C', is_goalie: false, gp: 80,
  proj_gp: 40, proj_fantasy_points: id === 1 ? 900 : 100, proj_fantasy_ppg: 9,
  proj_goals: id === 1 ? 20 : 5, proj_hits: id === 1 ? 1 : 100,
  ...extra,
} as DashboardIndexEntry);

beforeEach(() => vi.restoreAllMocks());
describe('Draft Kit league scoring', () => {
  it('reorders ranks, tiers and percentiles under league weights without mutating the cache', () => {
    const service = new DraftKitService(createMockSupabase());
    const entries = [entry(1), entry(2)];
    const { cards } = service.buildCards(entries, new Map(), new Map(), { skater: { hits: 2 } });
    expect(cards.map(c => c.playerId)).toEqual([2, 1]);
    expect(cards[0]).toMatchObject({ projectedFantasyPoints: 200, projectedFantasyPpg: 5,
      projectedGames: 40, cohortRank: 1, tier: 1, valuePercentile: 100 });
    expect(cards[1].projectedFantasyPoints).toBe(2);
    expect(entries[0].proj_fantasy_points).toBe(900);
    expect(service.buildCards(entries, new Map(), new Map()).cards[0].projectedFantasyPoints).toBe(900);
  });

  it('scores already allocated goalie season counts once and divides by their own starts', () => {
    const service = new DraftKitService(createMockSupabase());
    const goalies = [entry(1, { position: 'G', is_goalie: true, proj_gp: 60, proj_wins: 30,
      proj_saves: 1500, proj_goals_against: 150 }), entry(2, { position: 'G', is_goalie: true,
      proj_gp: 24, proj_wins: 12, proj_saves: 600, proj_goals_against: 60 })];
    const { cards } = service.buildCards(goalies, new Map(), new Map(),
      { goalie: { wins: 4, saves: 0.1, goals_against: -1 } });
    expect(cards.map(c => [c.projectedFantasyPoints, c.projectedFantasyPpg, c.projectedGames]))
      .toEqual([[120, 2, 60], [48, 2, 24]]);
  });

  it('retains explicit zero scoring and does not reuse default totals when components are absent', () => {
    const service = new DraftKitService(createMockSupabase());
    const { cards } = service.buildCards([entry(1), entry(2, { proj_goals: null, proj_hits: null })],
      new Map(), new Map(), { skater: { goals: 0 } });
    expect(cards[0].projectedFantasyPoints).toBe(0);
    expect(cards[1].projectedFantasyPoints).toBeNull();
  });

  it('does not publish a partial score when an enabled component is missing', () => {
    const service = new DraftKitService(createMockSupabase());
    const skater = service.buildCards([entry(1, { proj_assists: null })], new Map(), new Map(),
      { skater: { goals: 3, assists: 2 } }).cards[0];
    expect(skater.projectedFantasyPoints).toBeNull();
    const goalie = entry(2, { is_goalie: true, position: 'G', proj_saves: 600,
      proj_goals_against: null, save_pct: null });
    expect(service.buildCards([goalie], new Map(), new Map(),
      { goalie: { saves: 0.1, goals_against: -1 } }).cards[0].projectedFantasyPoints).toBeNull();
    expect(service.buildCards([goalie], new Map(), new Map(),
      { goalie: { saves: 0.1, goals_against: 0 } }).cards[0].projectedFantasyPoints).toBe(60);
  });

  it('uses the existing supported save-percentage GA derivation when that enabled field is absent', () => {
    const service = new DraftKitService(createMockSupabase());
    const goalie = entry(2, { is_goalie: true, position: 'G', proj_saves: 900,
      proj_goals_against: null, save_pct: 0.9 });
    expect(service.buildCards([goalie], new Map(), new Map(),
      { goalie: { saves: 0.2, goals_against: -1 } }).cards[0].projectedFantasyPoints).toBe(80);
  });

  it('preserves a supported zero-start goalie as zero rather than a default-score fallback', () => {
    const service = new DraftKitService(createMockSupabase());
    const goalie = entry(2, { is_goalie: true, position: 'G', proj_gp: 0,
      proj_wins: 0, proj_saves: 0, proj_shutouts: 0, proj_goals_against: 0 });
    expect(service.buildCards([goalie], new Map(), new Map(),
      { goalie: { wins: 4, saves: 0.2, goals_against: -1 } }).cards[0])
      .toMatchObject({ projectedFantasyPoints: 0, projectedFantasyPpg: 0, projectedGames: 0 });
  });

  it('uses effective rules on the assembled board', async () => {
    vi.spyOn(LeagueMembershipService.prototype, 'verifyMembership').mockResolvedValue(true);
    vi.spyOn(PlayerDashboardService.prototype, 'getDashboardIndex').mockResolvedValue({
      players: [entry(1), entry(2)], error: null,
    } as Awaited<ReturnType<PlayerDashboardService['getDashboardIndex']>>);
    const db = createMockSupabase({
      stat_catalog: createChain({ data: [{ stat_key: 'hits', applies_to: 'skater' }], error: null }),
    }, { data: [{ stat_key: 'hits', multiplier: 2 }], error: null });
    const service = new DraftKitService(db);
    vi.spyOn(service, 'getTier').mockResolvedValue('suite');
    const result = await service.getBoard({ leagueId: 'league', userId: 'user' });
    expect(result.error).toBeNull();
    expect(result.board?.cards[0]).toMatchObject({ playerId: 2, projectedFantasyPoints: 200 });
    expect(db.rpc).toHaveBeenCalledWith('get_effective_scoring_rules', { p_league_id: 'league' });
  });

  it('rejects nonmembers before reading league rules or assembling any board', async () => {
    vi.spyOn(LeagueMembershipService.prototype, 'verifyMembership').mockResolvedValue(false);
    const db = createMockSupabase();
    await expect(new DraftKitService(db).getBoard({ leagueId: 'league', userId: 'user' }))
      .rejects.toMatchObject({ status: 403 });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('fails visibly if an explicitly requested league has unavailable rules', async () => {
    vi.spyOn(LeagueMembershipService.prototype, 'verifyMembership').mockResolvedValue(true);
    const db = createMockSupabase({ stat_catalog: createChain({ data: [], error: null }) });
    await expect(new DraftKitService(db).getBoard({ leagueId: 'league', userId: 'user' }))
      .rejects.toMatchObject({ status: 503 });
    expect(db.rpc).toHaveBeenCalledWith('get_effective_scoring_rules', { p_league_id: 'league' });
  });
});
