import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeagueService } from '../services/LeagueService';
import { createChain, createMockSupabase } from './helpers';

describe('LeagueService', () => {
  let service: LeagueService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new LeagueService(mockSupabase);
  });

  describe('getUserLeagues', () => {
    it('returns deduplicated leagues for a user', async () => {
      const league1 = { id: 'l1', name: 'League 1' };
      const league2 = { id: 'l2', name: 'League 2' };

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: [league1], error: null });
        if (callCount === 2) return createChain({ data: [{ league_id: 'l1' }, { league_id: 'l2' }], error: null });
        return createChain({ data: [league1, league2], error: null });
      });

      const result = await service.getUserLeagues('user-1');
      expect(result.error).toBeNull();
      expect(result.leagues.length).toBeGreaterThanOrEqual(1);
    });

    it('handles user with no leagues', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [], error: null }));

      const result = await service.getUserLeagues('user-no-leagues');
      expect(result.error).toBeNull();
      expect(result.leagues).toHaveLength(0);
    });
  });

  describe('createLeague', () => {
    it('creates league with commissioner team', async () => {
      const mockLeague = { id: 'league-1', name: 'Test League' };
      const mockTeam = { id: 'team-1', team_name: "John's Team" };

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: mockLeague, error: null });
        if (table === 'profiles') return createChain({ data: { username: 'john', first_name: 'John' }, error: null });
        if (table === 'teams') return createChain({ data: mockTeam, error: null });
        return createChain();
      });

      const result = await service.createLeague('Test League', 'user-1');
      expect(result.league).toEqual(mockLeague);
      expect(result.error).toBeNull();
    });

    it('returns error when league creation fails', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'Insert failed' } }));

      const result = await service.createLeague('Test', 'user-1');
      expect(result.league).toBeNull();
      expect(result.error).toBeTruthy();
    });

    it('initializes FAAB budget when waiver type is faab', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { id: 'league-1' }, error: null });
        if (table === 'profiles') return createChain({ data: { username: 'test' }, error: null });
        if (table === 'teams') return createChain({ data: { id: 'team-1' }, error: null });
        if (table === 'faab_budgets') return createChain({ error: null });
        return createChain();
      });

      await service.createLeague(
        'FAAB League', 'user-1', undefined, undefined,
        { waiver_type: 'faab', faab_budget: 200 },
      );
      expect(mockSupabase.from).toHaveBeenCalledWith('faab_budgets');
    });
  });

  describe('joinLeagueByCode', () => {
    it('calls join_league_with_code RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { league: { id: 'l1' }, team: { id: 't1' } },
        error: null,
      });

      const result = await service.joinLeagueByCode('ABC123', 'user-1', 'My Team');
      expect(mockSupabase.rpc).toHaveBeenCalledWith('join_league_with_code', {
        p_join_code: 'ABC123',
        p_user_id: 'user-1',
        p_team_name: 'My Team',
      });
      expect(result.league).toEqual({ id: 'l1' });
    });

    it('rejects empty join code', async () => {
      const result = await service.joinLeagueByCode('', 'user-1');
      expect(result.error).toBeTruthy();
    });

    it('rejects empty user ID', async () => {
      const result = await service.joinLeagueByCode('ABC', '');
      expect(result.error).toBeTruthy();
    });
  });

  describe('getStandings', () => {
    it('returns teams ordered by wins', async () => {
      const teams = [
        { id: 't1', team_name: 'Team A', wins: 10, losses: 2 },
        { id: 't2', team_name: 'Team B', wins: 8, losses: 4 },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: teams, error: null }));

      const result = await service.getStandings('league-1');
      expect(result.standings).toHaveLength(2);
    });
  });

  describe('fetchTransactions', () => {
    it('returns transactions', async () => {
      const transactions = [{ id: 'tx1', created_at: '2026-01-01' }];
      mockSupabase.from = vi.fn(() => createChain({ data: transactions, error: null }));

      const result = await service.fetchTransactions('league-1');
      expect(result.transactions).toEqual(transactions);
    });
  });

  describe('getLeagueTeams', () => {
    it('uses RPC with fallback to direct query', async () => {
      const teams = [{ id: 't1', team_name: 'Team A' }];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: teams, error: null });

      const result = await service.getLeagueTeams('league-1');
      expect(result.teams).toEqual(teams);
    });

    it('falls back to direct query when RPC fails', async () => {
      const teams = [{ id: 't1', team_name: 'Team A' }];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC error' } });
      mockSupabase.from = vi.fn(() => createChain({ data: teams, error: null }));

      const result = await service.getLeagueTeams('league-1');
      expect(result.teams).toEqual(teams);
    });
  });

  describe('getLeagueTeamsWithOwners', () => {
    it('returns teams with owner names', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ id: 't1', owner_id: 'u1', team_name: 'Team A' }],
        error: null,
      });
      mockSupabase.from = vi.fn(() => createChain({
        data: [{ id: 'u1', username: 'john', first_name: 'John', last_name: 'Doe' }],
        error: null,
      }));

      const result = await service.getLeagueTeamsWithOwners('league-1');
      expect(result.teams).toHaveLength(1);
      expect(result.teams[0].owner_name).toBe('John Doe');
    });
  });

  describe('getUserTeam', () => {
    it('returns the user team in a league', async () => {
      const team = { id: 't1', team_name: 'My Team' };
      mockSupabase.from = vi.fn(() => createChain({ data: team, error: null }));

      const result = await service.getUserTeam('league-1', 'user-1');
      expect(result.team).toEqual(team);
    });
  });
});
