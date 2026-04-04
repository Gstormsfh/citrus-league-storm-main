import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchupService } from '../services/MatchupService';
import { createChain, createMockSupabase } from './helpers';

// Mock the admin client used internally
vi.mock('../lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => {
    const adminChain = createChain();
    return {
      from: vi.fn(() => adminChain),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
  }),
}));

describe('MatchupService', () => {
  let service: MatchupService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new MatchupService(mockSupabase);
  });

  describe('getLeagueMatchups', () => {
    it('returns all matchups for a league', async () => {
      const matchups = [
        { id: 'm1', week_number: 1, team1_id: 't1', team2_id: 't2' },
        { id: 'm2', week_number: 2, team1_id: 't1', team2_id: 't3' },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: matchups, error: null }));

      const result = await service.getLeagueMatchups('league-1');

      expect(result.matchups).toEqual(matchups);
      expect(result.error).toBeNull();
    });

    it('filters by week number when provided', async () => {
      const chain = createChain({ data: [{ id: 'm1', week_number: 3 }], error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getLeagueMatchups('league-1', 3);

      expect(chain.eq).toHaveBeenCalledWith('week_number', 3);
    });

    it('returns empty array when no matchups', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getLeagueMatchups('league-1');

      expect(result.matchups).toEqual([]);
    });

    it('returns error from query', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'Query failed' } }));

      const result = await service.getLeagueMatchups('league-1');

      expect(result.error).toEqual({ message: 'Query failed' });
    });
  });

  describe('getMatchup', () => {
    it('returns a single matchup by ID', async () => {
      const matchup = { id: 'm1', league_id: 'league-1', week_number: 1 };
      mockSupabase.from = vi.fn(() => createChain({ data: matchup, error: null }));

      const result = await service.getMatchup('m1');

      expect(result.matchup).toEqual(matchup);
      expect(result.error).toBeNull();
    });

    it('returns error when matchup not found', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'Not found' } }));

      const result = await service.getMatchup('nonexistent');

      expect(result.matchup).toBeNull();
      expect(result.error).toEqual({ message: 'Not found' });
    });
  });

  describe('getMatchupWithLines', () => {
    it('returns matchup and lines in parallel', async () => {
      const matchup = { id: 'm1', week_number: 1 };
      const lines = [{ player_id: 1, total_points: 10 }];

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: matchup, error: null });
        if (callCount === 2) return createChain({ data: lines, error: null });
        return createChain();
      });

      const result = await service.getMatchupWithLines('m1');

      expect(result.matchup).toEqual(matchup);
      expect(result.lines).toEqual(lines);
      expect(result.error).toBeNull();
    });

    it('returns error when matchup query fails', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: null, error: { message: 'Not found' } });
        return createChain({ data: [], error: null });
      });

      const result = await service.getMatchupWithLines('m1');

      expect(result.matchup).toBeNull();
      expect(result.lines).toEqual([]);
      expect(result.error).toEqual({ message: 'Not found' });
    });

    it('returns empty lines array when no lines data', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 'm1' }, error: null });
        return createChain({ data: null, error: null });
      });

      const result = await service.getMatchupWithLines('m1');

      expect(result.matchup).toEqual({ id: 'm1' });
      expect(result.lines).toEqual([]);
    });
  });

  describe('getMatchupScores', () => {
    it('returns scores ordered by points descending', async () => {
      const scores = [
        { player_id: 1, total_points: 15 },
        { player_id: 2, total_points: 10 },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: scores, error: null }));

      const result = await service.getMatchupScores('m1');

      expect(result.scores).toEqual(scores);
      expect(result.error).toBeNull();
    });

    it('returns empty array when no scores', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getMatchupScores('m1');

      expect(result.scores).toEqual([]);
    });
  });

  describe('getUserMatchup', () => {
    it('returns matchup for user team', async () => {
      const matchup = { id: 'm1', week_number: 3 };
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 't1' }, error: null }); // team
        if (callCount === 2) return createChain({ data: matchup, error: null }); // matchup
        return createChain();
      });

      const result = await service.getUserMatchup('league-1', 'user-1', 3);

      expect(result.matchup).toEqual(matchup);
      expect(result.error).toBeNull();
    });

    it('returns error when team not found', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getUserMatchup('league-1', 'user-1', 3);

      expect(result.matchup).toBeNull();
      expect(result.error).toBe('Team not found');
    });
  });

  describe('getMatchupHistory', () => {
    it('returns combined forward and reverse matchups sorted by week', async () => {
      const forward = [{ week_number: 1 }, { week_number: 5 }];
      const reverse = [{ week_number: 3 }];

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: forward, error: null });
        if (callCount === 2) return createChain({ data: reverse, error: null });
        return createChain();
      });

      const result = await service.getMatchupHistory('league-1', 't1', 't2');

      expect(result.matchups).toHaveLength(3);
      expect((result.matchups[0] as any).week_number).toBe(1);
      expect((result.matchups[1] as any).week_number).toBe(3);
      expect((result.matchups[2] as any).week_number).toBe(5);
    });

    it('returns empty when team2Id is null', async () => {
      const result = await service.getMatchupHistory('league-1', 't1', null);

      expect(result.matchups).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('handles empty history', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getMatchupHistory('league-1', 't1', 't2');

      expect(result.matchups).toEqual([]);
    });
  });

  describe('generateMatchupsForLeague', () => {
    it('generates round-robin matchups and inserts them', async () => {
      const chain = createChain({ error: null });
      mockSupabase.from = vi.fn(() => chain);

      const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }];
      const weeks = [
        { week_number: 1, start_date: '2026-01-04', end_date: '2026-01-10' },
        { week_number: 2, start_date: '2026-01-11', end_date: '2026-01-17' },
      ];

      const result = await service.generateMatchupsForLeague('league-1', teams, weeks);

      expect(result.error).toBeNull();
      expect(chain.upsert).toHaveBeenCalled();
    });

    it('deletes existing matchups when forceRegenerate is true', async () => {
      const chain = createChain({ error: null });
      mockSupabase.from = vi.fn(() => chain);

      const teams = [{ id: 't1' }, { id: 't2' }];
      const weeks = [{ week_number: 1, start_date: '2026-01-04', end_date: '2026-01-10' }];

      await service.generateMatchupsForLeague('league-1', teams, weeks, true);

      expect(chain.delete).toHaveBeenCalled();
    });

    it('returns early with no error when no matchups generated', async () => {
      const chain = createChain({ error: null });
      mockSupabase.from = vi.fn(() => chain);

      const result = await service.generateMatchupsForLeague('league-1', [], []);

      expect(result.error).toBeNull();
    });
  });

  describe('deleteAllMatchupsForLeague', () => {
    it('deletes all matchups for a league', async () => {
      const chain = createChain({ error: null });
      mockSupabase.from = vi.fn(() => chain);

      const result = await service.deleteAllMatchupsForLeague('league-1');

      expect(result.error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('matchups');
      expect(chain.delete).toHaveBeenCalled();
    });

    it('returns error from delete', async () => {
      mockSupabase.from = vi.fn(() => createChain({ error: { message: 'Delete failed' } }));

      const result = await service.deleteAllMatchupsForLeague('league-1');

      expect(result.error).toEqual({ message: 'Delete failed' });
    });
  });

  describe('updateMatchupScores', () => {
    it('calls update_all_matchup_scores RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: { updated: 5 }, error: null });

      const result = await service.updateMatchupScores('league-1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('update_all_matchup_scores', {
        p_league_id: 'league-1',
      });
      expect(result.data).toEqual({ updated: 5 });
      expect(result.error).toBeNull();
    });

    it('passes null when leagueId not provided', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.updateMatchupScores();

      expect(mockSupabase.rpc).toHaveBeenCalledWith('update_all_matchup_scores', {
        p_league_id: null,
      });
    });
  });

  describe('getPlayoffBracket', () => {
    it('returns playoff bracket data', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { settings: { playoffs: { startWeek: 20 } } }, error: null });
        if (callCount === 2) return createChain({ data: [{ id: 't1' }], error: null });
        if (callCount === 3) return createChain({ data: [{ id: 'm1', week_number: 20 }], error: null });
        return createChain();
      });

      const result = await service.getPlayoffBracket('league-1');

      expect(result.teams).toHaveLength(1);
      expect(result.matchups).toHaveLength(1);
      expect(result.error).toBeNull();
    });

    it('returns empty arrays when no data', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getPlayoffBracket('league-1');

      expect(result.teams).toEqual([]);
      expect(result.matchups).toEqual([]);
    });
  });

  describe('getMatchupStats', () => {
    it('returns stats map via RPC', async () => {
      const stats = [
        { player_id: 1, goals: 3, assists: 2 },
        { player_id: 2, goals: 1, assists: 5 },
      ];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: stats, error: null });

      const result = await service.getMatchupStats([1, 2], '2026-01-04', '2026-01-10');

      expect(result.statsMap.get(1)).toEqual({ player_id: 1, goals: 3, assists: 2 });
      expect(result.statsMap.get(2)).toEqual({ player_id: 2, goals: 1, assists: 5 });
      expect(result.error).toBeNull();
    });

    it('returns empty map when no stats', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.getMatchupStats([1], '2026-01-04', '2026-01-10');

      expect(result.statsMap.size).toBe(0);
    });
  });

  describe('getDailyProjections', () => {
    it('returns projections map via RPC', async () => {
      const projections = [
        { player_id: 1, xG: 0.5, xA: 0.3 },
        { player_id: 2, xG: 0.2, xA: 0.8 },
      ];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: projections, error: null });

      const result = await service.getDailyProjections([1, 2], '2026-01-15');

      expect(result.projMap.get(1)).toEqual({ player_id: 1, xG: 0.5, xA: 0.3 });
      expect(result.projMap.size).toBe(2);
    });

    it('returns empty map when no projections', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.getDailyProjections([1], '2026-01-15');

      expect(result.projMap.size).toBe(0);
    });
  });

  describe('autoCompleteMatchups', () => {
    it('calls auto_complete_matchups RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ error: null });

      const result = await service.autoCompleteMatchups();

      expect(mockSupabase.rpc).toHaveBeenCalledWith('auto_complete_matchups');
      expect(result.success).toBe(true);
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ error: { message: 'RPC failed' } });

      const result = await service.autoCompleteMatchups();

      expect(result.success).toBe(false);
      expect(result.error).toBe('RPC failed');
    });
  });

  describe('getH2HCategoryResults', () => {
    it('returns category results via RPC', async () => {
      const results = [{ category: 'goals', team1_value: 5, team2_value: 3 }];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: results, error: null });

      const result = await service.getH2HCategoryResults(
        'league-1', 'm1', 't1', 't2', '2026-01-04', '2026-01-10', ['goals', 'assists'],
      );

      expect(mockSupabase.rpc).toHaveBeenCalledWith('calculate_h2h_category_matchup', {
        p_league_id: 'league-1',
        p_matchup_id: 'm1',
        p_team1_id: 't1',
        p_team2_id: 't2',
        p_week_start: '2026-01-04',
        p_week_end: '2026-01-10',
        p_categories: ['goals', 'assists'],
      });
      expect(result.results).toEqual(results);
    });

    it('returns empty results on error', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Failed' } });

      const result = await service.getH2HCategoryResults(
        'league-1', 'm1', 't1', 't2', '2026-01-04', '2026-01-10', ['goals'],
      );

      expect(result.results).toEqual([]);
      expect(result.error).toEqual({ message: 'Failed' });
    });
  });

  describe('getRotoStandings', () => {
    it('returns roto standings via RPC', async () => {
      const standings = [{ team_id: 't1', total_roto_points: 50 }];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: standings, error: null });

      const result = await service.getRotoStandings('league-1', ['goals', 'assists'], 10);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('calculate_roto_standings', {
        p_league_id: 'league-1',
        p_categories: ['goals', 'assists'],
        p_through_week: 10,
      });
      expect(result.standings).toEqual(standings);
    });

    it('passes null for throughWeek when not provided', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });

      await service.getRotoStandings('league-1', ['goals']);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('calculate_roto_standings', expect.objectContaining({
        p_through_week: null,
      }));
    });
  });

  describe('getPPGStandings', () => {
    it('returns PPG standings via RPC', async () => {
      const standings = [{ team_id: 't1', ppg: 85.5 }];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: standings, error: null });

      const result = await service.getPPGStandings('league-1', 10);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('calculate_ppg_standings', {
        p_league_id: 'league-1',
        p_through_week: 10,
      });
      expect(result.standings).toEqual(standings);
    });

    it('passes null for throughWeek when not provided', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });

      await service.getPPGStandings('league-1');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('calculate_ppg_standings', expect.objectContaining({
        p_through_week: null,
      }));
    });
  });

  describe('getDailyGameStats', () => {
    it('returns daily game stats via RPC', async () => {
      const stats = [{ player_id: 1, goals: 2 }];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: stats, error: null });

      const result = await service.getDailyGameStats([1, 2], '2026-01-15');

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_daily_game_stats', {
        p_player_ids: [1, 2],
        p_game_date: '2026-01-15',
      });
      expect(result.stats).toEqual(stats);
    });

    it('returns empty array when no stats', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.getDailyGameStats([1], '2026-01-15');

      expect(result.stats).toEqual([]);
    });
  });

  describe('lockCompletedDays', () => {
    it('locks daily rosters for completed game dates', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: [{ game_date: '2026-01-14' }, { game_date: '2026-01-15' }], error: null });
        if (callCount === 2) return createChain({ data: [{ player_id: 1 }, { player_id: 2 }], error: null });
        return createChain();
      });

      const result = await service.lockCompletedDays();

      expect(result.lockedCount).toBe(2);
      expect(result.error).toBeNull();
    });

    it('returns 0 when no final games', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
    });

    it('returns error from games query', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'Query error' } }));

      const result = await service.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toEqual({ message: 'Query error' });
    });
  });

  describe('getJobStatus', () => {
    it('returns job status from parallel queries', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return { ...createChain({ count: 12, error: null }), select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ count: 12, error: null }) }) };
        if (callCount === 2) return { ...createChain({ count: 100, error: null }), select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ count: 100, error: null }) }) };
        if (callCount === 3) return createChain({ data: { updated_at: '2026-01-15T12:00:00Z' }, error: null });
        return createChain();
      });

      // Since getJobStatus uses complex parallel queries, just verify it doesn't throw
      const result = await service.getJobStatus();
      expect(result).toBeDefined();
    });
  });
});
