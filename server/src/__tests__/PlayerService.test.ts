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

    // ── REGRESSION (2026-09-02 scale audit) ──────────────────────────
    // These reads were `.range(0, 4999)` with no `.order()`. `.range()`
    // is not an escape hatch: PostgREST clamps the ranged response
    // server-side at db-max-rows (1,000 on this project) and returns
    // HTTP 200 with a short body and no error. `player_directory`
    // carries ~1.9k rows for a season, so this method — the one that
    // feeds the DRAFT POOL and FREE AGENTS — was handing callers roughly
    // half the league in physical-row order.
    //
    // That is the same defect that put a fringe player at the top of the
    // draft board (docs/ARCHITECT_INBOX.md), fixed in
    // usePreloadedPlayers.ts and twice in autopickStrategy.ts, and
    // missed here.
    //
    // The mock clamps at 1,000 exactly like the server, so an unpaged
    // read cannot pass.
    it('pages past the PostgREST row clamp instead of silently truncating', async () => {
      const PG_MAX_ROWS = 1000;
      const TOTAL = 1900; // ~prod player_directory for one season

      const directory = Array.from({ length: TOTAL }, (_, i) => ({
        player_id: 8000000 + i,
        full_name: `Player ${i}`,
        position_code: 'C',
        team_abbrev: 'TOR',
        jersey_number: null,
        headshot_url: null,
        eligible_positions: ['C'],
      }));

      const rangeCalls: Array<[number, number]> = [];
      const pagedDirectory: Record<string, any> = {};
      for (const m of ['select', 'eq', 'order']) pagedDirectory[m] = vi.fn(() => pagedDirectory);
      pagedDirectory.range = vi.fn((from: number, to: number) => {
        rangeCalls.push([from, to]);
        const requested = to - from + 1;
        return Promise.resolve({
          data: directory.slice(from, from + Math.min(requested, PG_MAX_ROWS)),
          error: null,
        });
      });

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'player_directory') return pagedDirectory;
        return createChain({ data: [], error: null });
      });

      const result = await service.getAllPlayers();

      expect(result.error).toBeFalsy();
      // Every player, not the first thousand.
      expect(result.players).toHaveLength(TOTAL);
      // No duplicates and no gaps across the page boundary.
      expect(new Set(result.players.map((p: any) => p.id)).size).toBe(TOTAL);
      // Paged, not one wide range: page 1, page 2, then a short page 3.
      expect(rangeCalls[0]).toEqual([0, 999]);
      expect(rangeCalls[1]).toEqual([1000, 1999]);
      // And every page asked for a deterministic sort — paging without
      // one lets adjacent windows overlap and skip.
      expect(pagedDirectory.order).toHaveBeenCalledWith('player_id', { ascending: true });
    });

    // ── REGRESSION (2026-09-02 scale audit) ──────────────────────────
    // Read-through cache with no single-flight: when the 2-minute TTL
    // lapsed, every concurrent request missed and every one of them ran
    // the same four table reads and the same merge. At draft-pool
    // request rates that is a thundering herd against PostgREST once
    // every two minutes.
    it('collapses concurrent cache misses into a single load (no stampede)', async () => {
      let resolveDirectory: (v: any) => void = () => {};
      const gate = new Promise((resolve) => {
        resolveDirectory = resolve;
      });

      const slowDirectory: Record<string, any> = {};
      for (const m of ['select', 'eq', 'order']) slowDirectory[m] = vi.fn(() => slowDirectory);
      slowDirectory.range = vi.fn(() => gate);

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'player_directory') return slowDirectory;
        return createChain({ data: [], error: null });
      });

      // Fifty callers arrive while the first load is still in flight.
      const inFlight = Array.from({ length: 50 }, () => service.getAllPlayers());
      resolveDirectory({ data: [], error: null });
      const results = await Promise.all(inFlight);

      // One load, not fifty.
      expect(slowDirectory.range).toHaveBeenCalledTimes(1);
      expect(mockSupabase.from).toHaveBeenCalledTimes(4); // directory + stats + talent + gsax
      // And every caller got the same answer.
      for (const r of results) {
        expect(r.error).toBeFalsy();
        expect(r.players).toEqual(results[0].players);
      }
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
