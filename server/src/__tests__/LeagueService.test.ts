import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeagueService } from '../services/LeagueService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
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

    /**
     * SWEEP FIX (2026-08-18). Neither underlying query carries an ORDER BY and
     * the two result sets are concatenated, so the order Postgres happened to
     * return decided the user's active league — LeagueContext falls through to
     * `leagues[0]` when there is no ?league= param, no in-session selection and
     * no localStorage entry.
     *
     * Field report from production: an account in 18 leagues opened on a
     * playoff-roster-pool created in April and got the playoff nav (Pool Home /
     * My Roster / NHL Bracket) instead of its season-long league. The nav was
     * correct for the league it was handed; the league was arbitrary.
     */
    it('returns newest-first so the default active league is not arbitrary', async () => {
      const older = { id: 'l-old', name: 'April playoff pool', created_at: '2026-04-17T18:55:43.648Z' };
      const newer = { id: 'l-new', name: 'Season-long league', created_at: '2026-08-16T23:21:13.374Z' };

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        // Commissioner query deliberately yields the OLDER league first —
        // the pre-fix concatenation order.
        if (callCount === 1) return createChain({ data: [older], error: null });
        if (callCount === 2) return createChain({ data: [{ league_id: 'l-new' }], error: null });
        return createChain({ data: [newer], error: null });
      });

      const result = await service.getUserLeagues('user-1');
      expect(result.leagues.map((l: { id: string }) => l.id)).toEqual(['l-new', 'l-old']);
    });

    it('breaks created_at ties by id so equal timestamps stay deterministic', async () => {
      const sameTime = '2026-08-16T23:21:13.374Z';
      const b = { id: 'bbb', name: 'B', created_at: sameTime };
      const a = { id: 'aaa', name: 'A', created_at: sameTime };

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: [b, a], error: null });
        return createChain({ data: [], error: null });
      });

      const result = await service.getUserLeagues('user-1');
      expect(result.leagues.map((l: { id: string }) => l.id)).toEqual(['aaa', 'bbb']);
    });

    it('does not crash when created_at is missing', async () => {
      const withDate = { id: 'l1', name: 'Has date', created_at: '2026-08-16T00:00:00.000Z' };
      const noDate = { id: 'l2', name: 'No date' };

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: [noDate, withDate], error: null });
        return createChain({ data: [], error: null });
      });

      const result = await service.getUserLeagues('user-1');
      // Missing timestamps sort to 0 and land last, but nothing throws.
      expect(result.leagues.map((l: { id: string }) => l.id)).toEqual(['l1', 'l2']);
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

  /**
   * Standings are DERIVED from matchups, not read off `teams`.
   *
   * This block used to hand the mock two team rows carrying `wins: 10` and
   * assert only on the array length, which is why it stayed green while the
   * route was a permanent 500: `teams` has no wins column (id, league_id,
   * owner_id, team_name, created_at, updated_at, and nothing else), so the
   * real query answered 42703 on every call. The fixture asserted a shape the
   * database does not have.
   *
   * The full contract lives in services/__tests__/LeagueService.standings.test.ts.
   * What is kept here is the smoke test this block was always meant to be.
   */
  describe('getStandings', () => {
    it('derives a record from matchups', async () => {
      const teams = [
        { id: 't1', league_id: 'league-1', owner_id: 'o1', team_name: 'Team A' },
        { id: 't2', league_id: 'league-1', owner_id: 'o2', team_name: 'Team B' },
      ];
      const matchups = [
        { id: 'm1', league_id: 'league-1', week_number: 1, team1_id: 't1', team2_id: 't2', team1_score: '120.000', team2_score: '100.000', status: 'completed', week_end_date: '2026-01-16' },
        // Never played. Both scores are 0 because nothing was ever scored,
        // not because the two teams drew.
        { id: 'm2', league_id: 'league-1', week_number: 2, team1_id: 't1', team2_id: 't2', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-01-23' },
      ];
      mockSupabase.from = vi.fn((table: string) =>
        createChain({ data: table === 'matchups' ? matchups : teams, error: null }));

      const result = await service.getStandings('league-1');

      expect(result.error).toBeNull();
      expect(result.standings).toHaveLength(2);
      expect(result.standings[0]).toMatchObject({ team_id: 't1', wins: 1, losses: 0, ties: 0 });
      expect(result.standings[1]).toMatchObject({ team_id: 't2', wins: 0, losses: 1, ties: 0 });
    });

    it('never asks `teams` for a wins column', async () => {
      const chain = createChain({ data: [], error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getStandings('league-1');

      for (const call of chain.select.mock.calls) {
        expect(String(call[0])).not.toMatch(/\bwins\b/);
      }
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

    // Audit M8 (2026-09-01): the owner's picture rides along on the same
    // profiles read, explicit columns, null when the owner has none.
    it('carries the owner avatar from the same profiles read', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [
          { id: 't1', owner_id: 'u1', team_name: 'Team A' },
          { id: 't2', owner_id: 'u2', team_name: 'Team B' },
          { id: 'ai', owner_id: null, team_name: 'AI Team 1' },
        ],
        error: null,
      });
      const profiles = createChain({
        data: [
          { id: 'u1', username: 'john', display_name: null, first_name: 'John', last_name: 'Doe', avatar_url: 'https://cdn/john.png' },
          { id: 'u2', username: 'jane', display_name: 'Jane', first_name: null, last_name: null, avatar_url: null },
        ],
        error: null,
      });
      mockSupabase.from = vi.fn(() => profiles);

      const result = await service.getLeagueTeamsWithOwners('league-1');
      expect(profiles.select).toHaveBeenCalledWith('id, username, display_name, first_name, last_name, avatar_url');
      expect(result.teams.map((t: { id: string; avatar_url: string | null }) => [t.id, t.avatar_url])).toEqual([
        ['t1', 'https://cdn/john.png'],
        ['t2', null],
        ['ai', null],
      ]);
      expect(result.teams[2].owner_name).toBe('Unknown');
    });
  });

  describe('attachOwnerAvatars', () => {
    // Audit M8 (2026-09-01): teams have no avatar column; the matchup header
    // and scoreboard discs show the OWNER's profiles.avatar_url.
    it('joins profiles.avatar_url by owner_id with an explicit column list, one query for the league', async () => {
      const profiles = createChain({
        data: [
          { id: 'u1', avatar_url: 'https://cdn/john.png' },
          { id: 'u2', avatar_url: null },
        ],
        error: null,
      });
      mockSupabase.from = vi.fn(() => profiles);

      const result = await service.attachOwnerAvatars([
        { id: 't1', owner_id: 'u1', team_name: 'Team A' },
        { id: 't2', owner_id: 'u2', team_name: 'Team B' },
        { id: 't3', owner_id: 'u1', team_name: 'Team C' },
        { id: 'ai', owner_id: null, team_name: 'AI Team 1' },
      ]);

      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
      expect(profiles.select).toHaveBeenCalledWith('id, avatar_url');
      expect(profiles.select).not.toHaveBeenCalledWith('*');
      // Deduplicated owner ids, null owners excluded.
      expect(profiles.in).toHaveBeenCalledWith('id', ['u1', 'u2']);
      expect(result).toEqual([
        { id: 't1', owner_id: 'u1', team_name: 'Team A', avatar_url: 'https://cdn/john.png' },
        { id: 't2', owner_id: 'u2', team_name: 'Team B', avatar_url: null },
        { id: 't3', owner_id: 'u1', team_name: 'Team C', avatar_url: 'https://cdn/john.png' },
        { id: 'ai', owner_id: null, team_name: 'AI Team 1', avatar_url: null },
      ]);
    });

    it('skips the profiles read entirely when no team has an owner', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [], error: null }));
      const result = await service.attachOwnerAvatars([{ id: 'ai', owner_id: null, team_name: 'AI Team 1' }]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: 'ai', owner_id: null, team_name: 'AI Team 1', avatar_url: null }]);
    });

    it('a failed profiles read degrades to initials (null) rather than failing the teams list', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'boom' } }));
      const result = await service.attachOwnerAvatars([{ id: 't1', owner_id: 'u1', team_name: 'Team A' }]);
      expect(result).toEqual([{ id: 't1', owner_id: 'u1', team_name: 'Team A', avatar_url: null }]);
    });

    it('a blank avatar_url is served as null', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [{ id: 'u1', avatar_url: '' }], error: null }));
      const result = await service.attachOwnerAvatars([{ id: 't1', owner_id: 'u1', team_name: 'Team A' }]);
      expect(result[0].avatar_url).toBeNull();
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

  describe('updateDraftSettings — the draft’s geometry is locked once it starts (2026-09-05)', () => {
    beforeEach(() => {
      // Membership is cached per (league, user) across the file; a stale
      // hit would skip the first two reads and shift every table below.
      LeagueMembershipService.clearCache();
    });

    // Reads, by table: leagues → commissioner check, then settings +
    // draft_status, then the update; teams → the membership row, then the
    // count. Dispatch by table so the order of the two never matters.
    const drive = (draftStatus: string, teamCount: number) => {
      let leagues = 0;
      let teams = 0;
      const update = createChain({ data: null, error: null });
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') {
          leagues++;
          if (leagues === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
          if (leagues === 2) return createChain({ data: { settings: { teamsCount: 12 }, draft_status: draftStatus }, error: null });
          return update;
        }
        if (table === 'teams') {
          teams++;
          if (teams === 1) return createChain({ data: { id: 'team-1' }, error: null });
          return createChain({ data: null, error: null, count: teamCount });
        }
        return createChain({ data: null, error: null });
      });
      return update;
    };

    it('refuses a size or rounds change once the draft is in progress', async () => {
      const update = drive('in_progress', 4);
      const result = await service.updateDraftSettings('league-1', 'user-1', { teams_count: 10 });
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('locked once the draft has started');
      expect(update.update).not.toHaveBeenCalled();
    });

    it('refuses a size below the teams already in the league', async () => {
      const update = drive('not_started', 8);
      const result = await service.updateDraftSettings('league-1', 'user-1', { teams_count: 6 });
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('already has 8 teams');
      expect(update.update).not.toHaveBeenCalled();
    });

    it('writes league_size and settings.teamsCount together before the draft', async () => {
      const update = drive('not_started', 4);
      const result = await service.updateDraftSettings('league-1', 'user-1', { teams_count: 10 });
      expect(result.success).toBe(true);
      expect(update.update).toHaveBeenCalledWith(
        expect.objectContaining({ league_size: 10, settings: expect.objectContaining({ teamsCount: 10 }) }),
      );
    });
  });
});
