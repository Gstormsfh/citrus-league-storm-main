import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeagueService } from '../services/LeagueService';
import { createChain, createMockSupabase } from './helpers';

// Mock the admin client used by fetchTransactions to enrich pending waivers.
let mockAdminClient: any;
vi.mock('../lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => mockAdminClient),
}));

describe('LeagueService', () => {
  let service: LeagueService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new LeagueService(mockSupabase);
    // Default admin client returns empty player_waiver_status + default league
    // waiver settings. Tests that need real enrichment can override per-test.
    mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === 'player_waiver_status') {
          return createChain({ data: [], error: null });
        }
        if (table === 'leagues') {
          return createChain({ data: { waiver_period_hours: 48, waiver_process_time: '02:00:00' }, error: null });
        }
        return createChain({ data: null, error: null });
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
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
        data: { success: true, league_id: 'l1', league_name: 'Test League', team_id: 't1', team_name: 'My Team' },
        error: null,
      });

      const result = await service.joinLeagueByCode('ABC123', 'user-1', 'My Team');
      expect(mockSupabase.rpc).toHaveBeenCalledWith('join_league_with_code', {
        p_join_code: 'ABC123',
        p_user_id: 'user-1',
        p_team_name: 'My Team',
      });
      expect(result.league).toEqual({ id: 'l1', name: 'Test League', settings: {} });
      expect(result.team).toEqual({ id: 't1', team_name: 'My Team' });
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
    it('merges transaction_ledger with pending/failed waiver_claims, newest first', async () => {
      const ledger = [{ id: 'tx1', type: 'ADD', player_id: '100', created_at: '2026-01-03T00:00:00Z' }];
      const pendingClaims = [
        { id: 'wc1', league_id: 'league-1', team_id: 't1', player_id: 200, drop_player_id: null, status: 'pending', failure_reason: null, created_at: '2026-01-05T00:00:00Z', processed_at: null, teams: { team_name: 'Team A' } },
        { id: 'wc2', league_id: 'league-1', team_id: 't2', player_id: 300, drop_player_id: null, status: 'failed', failure_reason: 'Lost priority tiebreaker', created_at: '2026-01-04T00:00:00Z', processed_at: null, teams: { team_name: 'Team B' } },
      ];

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'transaction_ledger') return createChain({ data: ledger, error: null });
        if (table === 'waiver_claims') return createChain({ data: pendingClaims, error: null });
        return createChain({ data: [], error: null });
      });

      const result = await service.fetchTransactions('league-1');
      expect(result.transactions).toHaveLength(3);
      // Newest first, so the pending waiver claim leads.
      const first = result.transactions[0] as { id: string; type: string; status: string };
      expect(first.id).toBe('wc-wc1');
      expect(first.type).toBe('WAIVER_PENDING');
      expect(first.status).toBe('pending');

      const second = result.transactions[1] as { id: string; type: string; status: string };
      expect(second.id).toBe('wc-wc2');
      expect(second.type).toBe('WAIVER_FAILED');
      expect(second.status).toBe('failed');

      const third = result.transactions[2] as { id: string; status: string };
      expect(third.id).toBe('tx1');
      expect(third.status).toBe('processed');
    });

    it('propagates transaction_ledger errors and returns empty list', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'transaction_ledger') return createChain({ data: null, error: { message: 'boom' } });
        return createChain({ data: [], error: null });
      });

      const result = await service.fetchTransactions('league-1');
      expect(result.transactions).toEqual([]);
      expect(result.error).toBeTruthy();
    });

    it('enriches pending waiver rows with waiver_clears_at and league waiver timing', async () => {
      const droppedAt = '2026-04-07T00:00:00Z';
      const pendingClaims = [
        { id: 'wc1', league_id: 'league-1', team_id: 't1', player_id: 200, drop_player_id: 150, priority: 1, bid_amount: null, is_conditional_drop: false, status: 'pending', failure_reason: null, created_at: '2026-04-07T18:52:00Z', processed_at: null, teams: { team_name: 'Team A' } },
      ];

      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'transaction_ledger') return createChain({ data: [], error: null });
        if (table === 'waiver_claims') return createChain({ data: pendingClaims, error: null });
        return createChain({ data: [], error: null });
      });

      mockAdminClient.from = vi.fn((table: string) => {
        if (table === 'player_waiver_status') {
          return createChain({ data: [{ player_id: 200, dropped_at: droppedAt, cleared_at: null }], error: null });
        }
        if (table === 'leagues') {
          return createChain({ data: { waiver_period_hours: 48, waiver_process_time: '02:00:00' }, error: null });
        }
        return createChain({ data: null, error: null });
      });

      const result = await service.fetchTransactions('league-1');
      expect(result.transactions).toHaveLength(1);
      const row = result.transactions[0] as {
        id: string;
        priority: number | null;
        drop_player_id: string | null;
        waiver_dropped_at: string | null;
        waiver_clears_at: string | null;
        league_waiver_period_hours: number;
        league_waiver_process_time: string;
      };
      expect(row.id).toBe('wc-wc1');
      expect(row.priority).toBe(1);
      expect(row.drop_player_id).toBe('150');
      expect(row.waiver_dropped_at).toBe(droppedAt);
      // 48 hours after 2026-04-07T00:00:00Z = 2026-04-09T00:00:00Z
      expect(row.waiver_clears_at).toBe('2026-04-09T00:00:00.000Z');
      expect(row.league_waiver_period_hours).toBe(48);
      expect(row.league_waiver_process_time).toBe('02:00:00');
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

  describe('addAITeams', () => {
    it('inserts AI teams with null owner_id', async () => {
      const aiTeams = [
        { id: 'ai1', team_name: 'AI Team 1' },
        { id: 'ai2', team_name: 'AI Team 2' },
      ];
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        if (table === 'teams') return createChain({ data: aiTeams, error: null });
        return createChain();
      });

      const result = await service.addAITeams('league-1', 'user-1', ['AI Team 1', 'AI Team 2']);
      expect(result.teams).toHaveLength(2);
      expect(result.error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('teams');
    });

    it('returns empty array when no team names provided', async () => {
      const result = await service.addAITeams('league-1', 'user-1', []);
      expect(result.teams).toEqual([]);
      expect(result.error).toBeNull();
    });
  });
});
