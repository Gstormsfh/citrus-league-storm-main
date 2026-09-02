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
        { player_id: 1, full_name: 'Connor McDavid', position_code: 'C', team_abbrev: 'EDM', jersey_number: '97', headshot_url: '' },
        { player_id: 2, full_name: 'Auston Matthews', position_code: 'C', team_abbrev: 'TOR', jersey_number: '34', headshot_url: '' },
      ];
      const stats = [
        { player_id: 1, games_played: 50, nhl_goals: 30, nhl_assists: 45, nhl_points: 75, nhl_shots_on_goal: 200, nhl_hits: 10, nhl_blocks: 5, nhl_pim: 12, nhl_ppp: 10, nhl_shp: 1, nhl_plus_minus: 15 },
      ];
      const talents = [
        { player_id: 1, xg_per_60: 1.5, xg_rating: 95 },
        { player_id: 2, roster_status: 'IR' },
      ];

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

    // ── goalie games played (2026-08-26) ─────────────────────────────────
    // player_season_stats carries two counters. `games_played` counts games
    // DRESSED — for a goalie that includes every night he backed up —
    // while `goalie_gp` counts games PLAYED. buildPlayer handed the skater
    // column to everyone, so a goalie's GP was his team's dressed count and
    // every per-game rate derived from it was wrong by the ratio between
    // them. Production, season 2025: Vasilevskiy 75 dressed / 58 played;
    // across 102 goalies the columns average 51.2 and 27.1. His TOI/game
    // rendered ~26:00 instead of ~59:00.
    //
    // Three screens had each patched this locally with slightly different
    // expressions, which is why one goalie showed different numbers on
    // different pages. These tests pin the single upstream answer.
    it('gives a goalie his APPEARANCES, not the nights he dressed', async () => {
      const directory = [
        { player_id: 10, full_name: 'Andrei Vasilevskiy', position_code: 'G', team_abbrev: 'TBL', jersey_number: '88', headshot_url: '' },
        { player_id: 11, full_name: 'Cale Makar', position_code: 'D', team_abbrev: 'COL', jersey_number: '8', headshot_url: '' },
      ];
      const stats = [
        { player_id: 10, games_played: 75, goalie_gp: 58, nhl_wins: 39, nhl_losses: 15, nhl_ot_losses: 4, nhl_save_pct: 0.91234, nhl_gaa: 2.30853, nhl_toi_seconds: 205845 },
        { player_id: 11, games_played: 80, goalie_gp: 0, nhl_goals: 30, nhl_assists: 62, nhl_toi_seconds: 120000 },
      ];

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'player_directory') return createChain({ data: directory, error: null });
        if (table === 'player_season_stats') return createChain({ data: stats, error: null });
        if (table === 'player_talent_metrics') return createChain({ data: [], error: null });
        if (table === 'goalie_gsax_primary') return createChain({ data: [], error: null });
        return createChain();
      });

      const { players } = await service.getAllPlayers();
      const vasy = players.find((p: any) => p.id === 10)!;
      const makar = players.find((p: any) => p.id === 11)!;

      expect(vasy.is_goalie).toBe(true);
      expect(vasy.games_played).toBe(58);       // goalie_gp, NOT 75
      expect(vasy.goalie_gp).toBe(58);          // still exposed explicitly

      // The skater is untouched — this change must not move his number.
      expect(makar.is_goalie).toBe(false);
      expect(makar.games_played).toBe(80);
    });

    it('makes a starting goalie TOI/game come out near 60 minutes', async () => {
      // The reason the raw number matters. 205,845s over 75 dressed games is
      // 45.7 min/game, which no goalie has ever played; over 58 appearances
      // it is 59.1, which is what a starter actually plays. Any consumer
      // dividing icetime by games_played was producing the first number.
      const directory = [{ player_id: 10, full_name: 'Andrei Vasilevskiy', position_code: 'G', team_abbrev: 'TBL', jersey_number: '88', headshot_url: '' }];
      const stats = [{ player_id: 10, games_played: 75, goalie_gp: 58, nhl_toi_seconds: 205845 }];

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'player_directory') return createChain({ data: directory, error: null });
        if (table === 'player_season_stats') return createChain({ data: stats, error: null });
        if (table === 'player_talent_metrics') return createChain({ data: [], error: null });
        if (table === 'goalie_gsax_primary') return createChain({ data: [], error: null });
        return createChain();
      });

      const { players } = await service.getAllPlayers();
      const p = players[0];
      const toiPerGame = p.icetime_seconds / p.games_played / 60;
      expect(toiPerGame).toBeGreaterThan(55);
      expect(toiPerGame).toBeLessThan(62);
    });

    it('reports zero appearances for a goalie who dressed but never played', async () => {
      // Not a data gap to paper over. All four such rows in season 2025
      // (Cossa, Posch, Petersen, Villalta) also carry zero saves, zero TOI
      // and zero decisions. Zero is the honest card; falling back to the
      // dressed count would invent appearances that did not happen.
      const directory = [{ player_id: 12, full_name: 'Cal Petersen', position_code: 'G', team_abbrev: 'MIN', jersey_number: '40', headshot_url: '' }];
      const stats = [{ player_id: 12, games_played: 2, goalie_gp: 0, nhl_saves: 0, nhl_shots_faced: 0, nhl_toi_seconds: 0 }];

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'player_directory') return createChain({ data: directory, error: null });
        if (table === 'player_season_stats') return createChain({ data: stats, error: null });
        if (table === 'player_talent_metrics') return createChain({ data: [], error: null });
        if (table === 'goalie_gsax_primary') return createChain({ data: [], error: null });
        return createChain();
      });

      const { players } = await service.getAllPlayers();
      expect(players[0].games_played).toBe(0);
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
              { player_id: 1, full_name: 'Connor McDavid', position_code: 'C', team_abbrev: 'EDM' },
              { player_id: 2, full_name: 'Leon Draisaitl', position_code: 'C', team_abbrev: 'EDM' },
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
