import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BestBallService } from '../services/BestBallService';
import { createChain, createMockSupabase } from './helpers';

describe('BestBallService', () => {
  let service: BestBallService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new BestBallService(mockSupabase);
  });

  describe('triggerOptimization', () => {
    it('calls optimize RPC and returns results', async () => {
      const rpcData = [
        { team_id: 't1', players_optimized: 13, total_points: 45.5 },
        { team_id: 't2', players_optimized: 13, total_points: 38.2 },
      ];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: rpcData, error: null });

      const result = await service.triggerOptimization('league-1', '2026-01-15');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('optimize_best_ball_daily_rosters', {
        p_league_id: 'league-1',
        p_roster_date: '2026-01-15',
      });
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({ team_id: 't1', players_optimized: 13, total_points: 45.5 });
      expect(result.error).toBeUndefined();
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Optimization failed' } });

      const result = await service.triggerOptimization('league-1', '2026-01-15');

      expect(result.results).toEqual([]);
      expect(result.error).toBe('Optimization failed');
    });

    it('returns empty results when RPC returns null data', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.triggerOptimization('league-1', '2026-01-15');

      expect(result.results).toEqual([]);
    });
  });

  describe('triggerWeekOptimization', () => {
    it('optimizes each day in the week range', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ team_id: 't1', players_optimized: 13, total_points: 40 }],
        error: null,
      });

      const result = await service.triggerWeekOptimization('league-1', '2026-01-12', '2026-01-14');

      // 3 days: Jan 12, 13, 14
      expect(result.daysOptimized).toBe(3);
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(3);
    });

    it('counts only successful optimizations', async () => {
      let callCount = 0;
      mockSupabase.rpc = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.resolve({ data: null, error: { message: 'Failed' } });
        return Promise.resolve({ data: [{ team_id: 't1', players_optimized: 13, total_points: 40 }], error: null });
      });

      const result = await service.triggerWeekOptimization('league-1', '2026-01-12', '2026-01-14');

      // 2 successful out of 3
      expect(result.daysOptimized).toBe(2);
    });

    it('handles single day range', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ team_id: 't1', players_optimized: 13, total_points: 40 }],
        error: null,
      });

      const result = await service.triggerWeekOptimization('league-1', '2026-01-12', '2026-01-12');

      expect(result.daysOptimized).toBe(1);
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
    });
  });

  describe('getWeeklyBestBallData', () => {
    it('returns full weekly data', async () => {
      const lineup = { starters: [1, 2], bench: [3], ir: [] };
      const assignments = [{ player_id: 1 }, { player_id: 2 }, { player_id: 3 }];
      const players = [
        { player_id: 1, position_code: 'C', eligible_positions: ['C', 'UTIL'] },
        { player_id: 2, position_code: 'LW', eligible_positions: ['LW', 'UTIL'] },
      ];
      const weeklyStats = [
        { player_id: 1, goals: 2, assists: 1 },
        { player_id: 2, goals: 1, assists: 3 },
      ];

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: lineup, error: null });
        if (callCount === 2) return createChain({ data: assignments, error: null });
        if (callCount === 3) return createChain({ data: players, error: null });
        if (callCount === 4) return createChain({ data: weeklyStats, error: null });
        return createChain();
      });

      const result = await service.getWeeklyBestBallData('league-1', 'team-1', 5);

      expect(result.lineup).toEqual(lineup);
      expect(result.playerIds).toEqual([1, 2, 3]);
      expect(result.players).toEqual(players);
      expect(result.weeklyStats).toEqual(weeklyStats);
    });

    it('returns empty data when no roster assignments', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: null, error: null }); // lineup
        if (callCount === 2) return createChain({ data: [], error: null }); // empty assignments
        return createChain();
      });

      const result = await service.getWeeklyBestBallData('league-1', 'team-1', 5);

      expect(result.lineup).toBeNull();
      expect(result.playerIds).toEqual([]);
      expect(result.players).toEqual([]);
      expect(result.weeklyStats).toEqual([]);
    });

    it('returns empty data when assignments is null', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: null, error: null });
        if (callCount === 2) return createChain({ data: null, error: null });
        return createChain();
      });

      const result = await service.getWeeklyBestBallData('league-1', 'team-1', 5);

      expect(result.playerIds).toEqual([]);
      expect(result.players).toEqual([]);
    });

    it('handles null players and weeklyStats gracefully', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: null, error: null });
        if (callCount === 2) return createChain({ data: [{ player_id: 1 }], error: null });
        if (callCount === 3) return createChain({ data: null, error: null }); // null players
        if (callCount === 4) return createChain({ data: null, error: null }); // null stats
        return createChain();
      });

      const result = await service.getWeeklyBestBallData('league-1', 'team-1', 5);

      expect(result.players).toEqual([]);
      expect(result.weeklyStats).toEqual([]);
    });
  });

  describe('getLeagueTeamIds', () => {
    it('returns team IDs for a league', async () => {
      const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
      mockSupabase.from = vi.fn(() => createChain({ data: teams, error: null }));

      const result = await service.getLeagueTeamIds('league-1');

      expect(result).toEqual(teams);
    });

    it('returns empty array when no teams', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getLeagueTeamIds('league-1');

      expect(result).toEqual([]);
    });
  });
});
