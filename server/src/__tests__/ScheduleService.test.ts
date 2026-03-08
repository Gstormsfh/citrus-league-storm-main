import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleService } from '../services/ScheduleService';
import { createChain, createMockSupabase } from './helpers';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new ScheduleService(mockSupabase);
  });

  describe('getGamesForDateRange', () => {
    it('returns games within date range', async () => {
      const games = [
        { game_id: 1, game_date: '2026-01-01', home_team: 'EDM', away_team: 'TOR' },
        { game_id: 2, game_date: '2026-01-02', home_team: 'COL', away_team: 'BOS' },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: games, error: null }));

      const result = await service.getGamesForDateRange('2026-01-01', '2026-01-07');
      expect(result.games).toEqual(games);
      expect(result.error).toBeNull();
    });

    it('returns empty array when no games', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getGamesForDateRange('2026-07-01', '2026-07-07');
      expect(result.games).toEqual([]);
    });
  });

  describe('getGamesForTeams', () => {
    it('groups games by team', async () => {
      const games = [
        { home_team: 'EDM', away_team: 'TOR', game_date: '2026-01-01' },
        { home_team: 'COL', away_team: 'EDM', game_date: '2026-01-02' },
        { home_team: 'TOR', away_team: 'BOS', game_date: '2026-01-03' },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: games, error: null }));

      const result = await service.getGamesForTeams(['EDM', 'TOR']);
      expect(result.gamesByTeam.get('EDM')).toHaveLength(2);
      expect(result.gamesByTeam.get('TOR')).toHaveLength(2);
    });

    it('normalizes team abbreviations to uppercase', async () => {
      const chain = createChain({ data: [], error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getGamesForTeams(['edm', 'tor']);
      expect(chain.or).toHaveBeenCalledWith(expect.stringContaining('EDM'));
    });
  });

  describe('getNextGameForTeam', () => {
    it('returns the next scheduled game', async () => {
      const game = { game_id: 1, home_team: 'EDM', away_team: 'TOR', game_date: '2026-03-08' };
      mockSupabase.from = vi.fn(() => createChain({ data: game, error: null }));

      const result = await service.getNextGameForTeam('edm');
      expect(result.game).toEqual(game);
    });

    it('returns null when no upcoming games', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getNextGameForTeam('EDM');
      expect(result.game).toBeNull();
    });
  });

  describe('hasGamesOnDateBatch', () => {
    it('returns map of team game presence', async () => {
      const games = [{ home_team: 'EDM', away_team: 'TOR' }];
      mockSupabase.from = vi.fn(() => createChain({ data: games }));

      const result = await service.hasGamesOnDateBatch(['EDM', 'COL'], '2026-01-01');
      expect(result.get('EDM')).toBe(true);
      expect(result.get('COL')).toBe(false);
    });
  });

  describe('getFantasyWeeks', () => {
    it('returns weeks ordered by week_number', async () => {
      const weeks = [
        { week_number: 1, start_date: '2025-10-05', end_date: '2025-10-11' },
        { week_number: 2, start_date: '2025-10-12', end_date: '2025-10-18' },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: weeks, error: null }));

      const result = await service.getFantasyWeeks();
      expect(result.weeks).toEqual(weeks);
    });
  });

  describe('getGamesRemainingInWeek', () => {
    it('returns count of remaining games', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [{ game_id: 1 }, { game_id: 2 }] }));

      const count = await service.getGamesRemainingInWeek('EDM', '2026-01-05', '2026-01-11');
      expect(count).toBe(2);
    });

    it('returns 0 when no games remaining', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [] }));

      const count = await service.getGamesRemainingInWeek('EDM', '2026-01-05', '2026-01-11');
      expect(count).toBe(0);
    });
  });

  describe('getTotalGamesInWeek', () => {
    it('returns total game count in week', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [{ game_id: 1 }, { game_id: 2 }, { game_id: 3 }] }));

      const count = await service.getTotalGamesInWeek('EDM', '2026-01-05', '2026-01-11');
      expect(count).toBe(3);
    });
  });
});
