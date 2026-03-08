import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerService } from '../services/PlayerService';
import { createChain, createMockSupabase } from './helpers';

describe('PlayerService', () => {
  let service: PlayerService;
  let mockSupabase: any;

  beforeEach(() => {
    PlayerService.clearCache();
    mockSupabase = createMockSupabase();
    service = new PlayerService(mockSupabase);
  });

  describe('getAllPlayers', () => {
    it('fetches and merges player data from multiple tables', async () => {
      const directory = [
        { player_id: 1, full_name: 'Connor McDavid', position_code: 'C', current_team_abbrev: 'EDM', sweater_number: 97, headshot_url: '', roster_status: 'active' },
        { player_id: 2, full_name: 'Auston Matthews', position_code: 'C', current_team_abbrev: 'TOR', sweater_number: 34, headshot_url: '', roster_status: 'IR' },
      ];
      const stats = [
        { player_id: 1, games_played: 50, nhl_goals: 30, nhl_assists: 45, nhl_points: 75, nhl_shots_on_goal: 200, nhl_hits: 10, nhl_blocks: 5, nhl_pim: 12, nhl_ppp: 10, nhl_shp: 1, nhl_plus_minus: 15 },
      ];
      const talents = [{ player_id: 1, xg_per_60: 1.5, xg_rating: 95 }];

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'player_directory') return createChain({ data: directory, error: null });
        if (table === 'player_season_stats') return createChain({ data: stats, error: null });
        if (table === 'player_talent_metrics') return createChain({ data: talents, error: null });
        if (table === 'goalie_gsax_primary') return createChain({ data: [], error: null });
        return createChain();
      });

      const result = await service.getAllPlayers();
      expect(result.error).toBeNull();
      expect(result.players).toHaveLength(2);

      const mcdavid = result.players.find((p: any) => p.id === 1);
      expect(mcdavid.full_name).toBe('Connor McDavid');
      expect(mcdavid.goals).toBe(30);
      expect(mcdavid.xg_per_60).toBe(1.5);
      expect(mcdavid.status).toBe('active');

      const matthews = result.players.find((p: any) => p.id === 2);
      expect(matthews.status).toBe('injured');
    });

    it('returns cached data on second call', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [], error: null }));

      await service.getAllPlayers();
      const callCount1 = mockSupabase.from.mock.calls.length;

      await service.getAllPlayers();
      const callCount2 = mockSupabase.from.mock.calls.length;

      expect(callCount2).toBe(callCount1);
    });
  });

  describe('getPlayersByIds', () => {
    it('returns empty array for empty input', async () => {
      const result = await service.getPlayersByIds([]);
      expect(result.players).toHaveLength(0);
      expect(result.error).toBeNull();
    });

    it('fetches and merges player data by IDs', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'player_directory') {
          return createChain({ data: [{ player_id: 123, full_name: 'Test', position_code: 'C' }], error: null });
        }
        return createChain({ data: [], error: null });
      });

      const result = await service.getPlayersByIds(['123']);
      expect(result.players).toHaveLength(1);
    });
  });

  describe('searchPlayers', () => {
    it('filters players by name (case-insensitive)', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'player_directory') {
          return createChain({
            data: [
              { player_id: 1, full_name: 'Connor McDavid', position_code: 'C', current_team_abbrev: 'EDM' },
              { player_id: 2, full_name: 'Leon Draisaitl', position_code: 'C', current_team_abbrev: 'EDM' },
            ],
            error: null,
          });
        }
        return createChain({ data: [], error: null });
      });

      const result = await service.searchPlayers('mcdavid');
      expect(result.players).toHaveLength(1);
      expect(result.players[0].full_name).toBe('Connor McDavid');
    });
  });

  describe('getPlayer', () => {
    it('returns a single player by ID', async () => {
      const player = { player_id: 123, full_name: 'Test Player' };
      mockSupabase.from = vi.fn(() => createChain({ data: player, error: null }));

      const result = await service.getPlayer(123);
      expect(result.player).toEqual(player);
    });
  });

  describe('getPlayerStats', () => {
    it('returns stats for a player', async () => {
      const stats = [{ player_id: 1, games_played: 50 }];
      mockSupabase.from = vi.fn(() => createChain({ data: stats, error: null }));

      const result = await service.getPlayerStats(1);
      expect(result.stats).toEqual(stats);
    });
  });

  describe('getTrendingPlayers', () => {
    it('returns trending map from RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [
          { player_id: 1, add_count: 50, net_adds: 30 },
          { player_id: 2, add_count: 25, net_adds: 10 },
        ],
        error: null,
      });

      const result = await service.getTrendingPlayers();
      expect(result.trending.size).toBe(2);
      expect(result.trending.get(1)).toEqual({ addCount: 50, netAdds: 30 });
    });

    it('returns empty map on RPC error', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

      const result = await service.getTrendingPlayers();
      expect(result.trending.size).toBe(0);
      expect(result.error).toBeTruthy();
    });
  });

  describe('getRosterAssignmentCount', () => {
    it('returns count for a team', async () => {
      mockSupabase.from = vi.fn(() => createChain({ count: 15, error: null }));

      const result = await service.getRosterAssignmentCount('team-1', 'league-1');
      expect(result.count).toBe(15);
    });
  });
});
