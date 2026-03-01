import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Build a chainable mock factory. Each chainable method returns `this` so that
// calls like `.from('x').select('y').eq('a', 'b').single()` work seamlessly.
// Terminal methods (`single`, `maybeSingle`) are separate so tests can override
// the resolved value per-call.

function createChainMock() {
  const chain: Record<string, any> = {};
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'is', 'in', 'not', 'or', 'gte', 'lte', 'lt', 'gt', 'filter',
    'order', 'limit',
  ];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

let defaultChain = createChainMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => defaultChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/timezoneUtils', () => ({
  getTodayMST: vi.fn().mockReturnValue('2026-02-28'),
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: '20252026',
}));

vi.mock('../LeagueMembershipService', () => ({
  LeagueMembershipService: {
    requireMembership: vi.fn().mockResolvedValue(undefined),
    requireCommissioner: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
    getPlayersByIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../DraftService', () => ({
  DraftService: {},
}));

vi.mock('../MatchupService', () => ({
  MatchupService: {},
}));

vi.mock('../RosterCacheService', () => ({
  RosterCacheService: {},
}));

vi.mock('../DemoLeagueService', () => ({
  DEMO_LEAGUE_ID_FOR_GUESTS: 'demo-league-id',
}));

vi.mock('@/types/leagueTypes', () => ({
  extractFormatSettings: vi.fn().mockReturnValue({
    leagueType: 'fantasy',
    scoringFormat: 'h2h-points',
    draftType: 'snake',
  }),
}));

// =============================================================================
// Import AFTER mocks are registered
// =============================================================================

import { supabase } from '@/integrations/supabase/client';
import { LeagueMembershipService } from '../LeagueMembershipService';

// Import the service under test
import { LeagueService, getLeagueFormat } from '../LeagueService';
import type { League, Team } from '../LeagueService';

// =============================================================================
// HELPERS
// =============================================================================

/** Rebuild a fresh chain mock and wire it into `supabase.from`. */
function resetChain() {
  defaultChain = createChainMock();
  (supabase.from as any).mockReturnValue(defaultChain);
}

/**
 * Configure `supabase.from` to return different chain mocks depending on the
 * table name. This is critical for methods that query multiple tables.
 */
function perTableChains(map: Record<string, ReturnType<typeof createChainMock>>) {
  (supabase.from as any).mockImplementation((table: string) => {
    return map[table] ?? defaultChain;
  });
  return map;
}

/** Factory for a valid League object. */
function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 'league-1',
    name: 'Test League',
    commissioner_id: 'user-1',
    draft_status: 'not_started',
    join_code: 'ABC123',
    roster_size: 21,
    draft_rounds: 21,
    settings: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Factory for a valid Team object. */
function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    league_id: 'league-1',
    owner_id: 'user-1',
    team_name: "User's Team",
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  resetChain();
  (supabase.rpc as any).mockResolvedValue({ data: null, error: null });
});

// =============================================================================
// getLeague
// =============================================================================

describe('LeagueService.getLeague', () => {
  it('returns a league when the user is a member', async () => {
    const league = makeLeague();
    defaultChain.single.mockResolvedValue({ data: league, error: null });

    const result = await LeagueService.getLeague('league-1', 'user-1');

    expect(result.league).toEqual(league);
    expect(result.error).toBeNull();
    expect(LeagueMembershipService.requireMembership).toHaveBeenCalledWith('league-1', 'user-1');
    expect(supabase.from).toHaveBeenCalledWith('leagues');
  });

  it('returns null when the league is not found (Supabase error)', async () => {
    const pgError = { code: 'PGRST116', message: 'No rows found', details: '', hint: '' };
    defaultChain.single.mockResolvedValue({ data: null, error: pgError });

    const result = await LeagueService.getLeague('nonexistent', 'user-1');

    expect(result.league).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('returns error when membership check fails', async () => {
    const membershipError = new Error('Not a member of this league');
    (LeagueMembershipService.requireMembership as any).mockRejectedValueOnce(membershipError);

    const result = await LeagueService.getLeague('league-1', 'outsider');

    expect(result.league).toBeNull();
    expect(result.error).toBe(membershipError);
  });

  it('returns error when Supabase query fails', async () => {
    const dbError = { code: '42P01', message: 'relation does not exist', details: '', hint: '' };
    defaultChain.single.mockResolvedValue({ data: null, error: dbError });

    const result = await LeagueService.getLeague('league-1', 'user-1');

    expect(result.league).toBeNull();
    expect(result.error).toEqual(dbError);
  });
});

// =============================================================================
// getLeagueTeams
// =============================================================================

describe('LeagueService.getLeagueTeams', () => {
  it('returns teams from the RPC function', async () => {
    const teams = [
      makeTeam({ id: 'team-1', team_name: 'Team Alpha' }),
      makeTeam({ id: 'team-2', team_name: 'Team Beta', owner_id: 'user-2' }),
    ];
    (supabase.rpc as any).mockResolvedValue({ data: teams, error: null });

    const result = await LeagueService.getLeagueTeams('league-1');

    expect(result.teams).toEqual(teams);
    expect(result.error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('get_league_teams', { p_league_id: 'league-1' });
  });

  it('returns empty array when no teams exist', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: null });

    const result = await LeagueService.getLeagueTeams('league-1');

    expect(result.teams).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('returns error when RPC fails', async () => {
    const rpcError = { code: 'P0001', message: 'RPC failed', details: '', hint: '' };
    (supabase.rpc as any).mockResolvedValue({ data: null, error: rpcError });

    const result = await LeagueService.getLeagueTeams('league-1');

    expect(result.teams).toEqual([]);
    expect(result.error).toEqual(rpcError);
  });
});

// =============================================================================
// createLeague
// =============================================================================

describe('LeagueService.createLeague', () => {
  it('creates a league and commissioner team successfully', async () => {
    const league = makeLeague();
    const team = makeTeam();

    // First call: insert into leagues -> select -> single
    // Second call: select from profiles -> eq -> single
    // Third call: insert into teams -> select -> single
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: league, error: null });

    const profileChain = createChainMock();
    profileChain.single.mockResolvedValue({
      data: { username: 'TestUser', default_team_name: null },
      error: null,
    });

    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({ data: team, error: null });

    let fromCallCount = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      fromCallCount++;
      if (table === 'leagues') return leagueChain;
      if (table === 'profiles') return profileChain;
      if (table === 'teams') return teamChain;
      return defaultChain;
    });

    const result = await LeagueService.createLeague('Test League', 'user-1');

    expect(result.league).toEqual(league);
    expect(result.team).toEqual(team);
    expect(result.error).toBeNull();
    expect(supabase.from).toHaveBeenCalledWith('leagues');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(supabase.from).toHaveBeenCalledWith('teams');
  });

  it('uses default_team_name from profile when available', async () => {
    const league = makeLeague();
    const team = makeTeam({ team_name: 'My Custom Team' });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: league, error: null });

    const profileChain = createChainMock();
    profileChain.single.mockResolvedValue({
      data: { username: 'TestUser', default_team_name: 'My Custom Team' },
      error: null,
    });

    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({ data: team, error: null });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'profiles') return profileChain;
      if (table === 'teams') return teamChain;
      return defaultChain;
    });

    const result = await LeagueService.createLeague('Test League', 'user-1');

    expect(result.team).toEqual(team);
    expect(result.error).toBeNull();
    // Verify the team chain's insert was called with the custom team name
    expect(teamChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ team_name: 'My Custom Team' })
    );
  });

  it('falls back to username-based team name when default_team_name is not set', async () => {
    const league = makeLeague();
    const team = makeTeam({ team_name: "TestUser's Team" });

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: league, error: null });

    const profileChain = createChainMock();
    profileChain.single.mockResolvedValue({
      data: { username: 'TestUser', default_team_name: null },
      error: null,
    });

    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({ data: team, error: null });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'profiles') return profileChain;
      if (table === 'teams') return teamChain;
      return defaultChain;
    });

    const result = await LeagueService.createLeague('Test League', 'user-1');

    expect(result.error).toBeNull();
    expect(teamChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ team_name: "TestUser's Team" })
    );
  });

  it('returns error when league insert fails', async () => {
    const insertError = { code: '23505', message: 'duplicate key', details: '', hint: '' };
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: null, error: insertError });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      return defaultChain;
    });

    const result = await LeagueService.createLeague('Dup League', 'user-1');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toEqual(insertError);
  });

  it('returns error when team insert fails', async () => {
    const league = makeLeague();
    const teamError = { code: '23503', message: 'foreign key violation', details: '', hint: '' };

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: league, error: null });

    const profileChain = createChainMock();
    profileChain.single.mockResolvedValue({
      data: { username: 'User', default_team_name: null },
      error: null,
    });

    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({ data: null, error: teamError });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'profiles') return profileChain;
      if (table === 'teams') return teamChain;
      return defaultChain;
    });

    const result = await LeagueService.createLeague('Test League', 'user-1');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toEqual(teamError);
  });

  it('passes custom roster size, draft rounds, and settings', async () => {
    const league = makeLeague({ roster_size: 15, draft_rounds: 15 });
    const team = makeTeam();

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: league, error: null });

    const profileChain = createChainMock();
    profileChain.single.mockResolvedValue({
      data: { username: 'User', default_team_name: null },
      error: null,
    });

    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({ data: team, error: null });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'profiles') return profileChain;
      if (table === 'teams') return teamChain;
      return defaultChain;
    });

    const customSettings = { leagueType: 'fantasy' as const };
    const customScoring = { goals: 3, assists: 2 };

    await LeagueService.createLeague('My League', 'user-1', 15, 15, customSettings, customScoring);

    expect(leagueChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My League',
        commissioner_id: 'user-1',
        roster_size: 15,
        draft_rounds: 15,
        settings: customSettings,
        scoring_settings: customScoring,
      })
    );
  });

  it('initializes FAAB budget when waiver type is faab', async () => {
    const league = makeLeague();
    const team = makeTeam();

    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({ data: league, error: null });

    const profileChain = createChainMock();
    profileChain.single.mockResolvedValue({
      data: { username: 'User', default_team_name: null },
      error: null,
    });

    const teamChain = createChainMock();
    teamChain.single.mockResolvedValue({ data: team, error: null });

    const faabChain = createChainMock();

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return leagueChain;
      if (table === 'profiles') return profileChain;
      if (table === 'teams') return teamChain;
      if (table === 'faab_budgets') return faabChain;
      return defaultChain;
    });

    const result = await LeagueService.createLeague(
      'FAAB League', 'user-1', 21, 21,
      { faabBudget: 200 },
      undefined,
      { waiver_type: 'faab' }
    );

    expect(result.error).toBeNull();
    expect(supabase.from).toHaveBeenCalledWith('faab_budgets');
    expect(faabChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        league_id: league.id,
        team_id: team.id,
        initial_budget: 200,
        remaining_budget: 200,
      })
    );
  });
});

// =============================================================================
// joinLeagueByCode
// =============================================================================

describe('LeagueService.joinLeagueByCode', () => {
  it('joins a league successfully via RPC', async () => {
    const league = makeLeague();
    const team = makeTeam({ owner_id: 'user-2' });

    (supabase.rpc as any).mockResolvedValue({
      data: { success: true, league, team },
      error: null,
    });

    const result = await LeagueService.joinLeagueByCode('ABC123', 'user-2', 'My Team');

    expect(result.league).toEqual(league);
    expect(result.team).toEqual(team);
    expect(result.error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('join_league_with_code', {
      p_join_code: 'ABC123',
      p_user_id: 'user-2',
      p_team_name: 'My Team',
    });
  });

  it('returns error when join code is empty', async () => {
    const result = await LeagueService.joinLeagueByCode('', 'user-2');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe('Join code is required');
    // RPC should not have been called
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns error when user ID is empty', async () => {
    const result = await LeagueService.joinLeagueByCode('ABC123', '');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe('User ID is required');
  });

  it('returns error when RPC call fails', async () => {
    const rpcError = { code: 'P0001', message: 'rate limit exceeded', details: '', hint: '' };
    (supabase.rpc as any).mockResolvedValue({ data: null, error: rpcError });

    const result = await LeagueService.joinLeagueByCode('ABC123', 'user-2');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toEqual(rpcError);
  });

  it('returns error when RPC reports failure (already a member)', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { success: false, error: 'You are already a member of this league' },
      error: null,
    });

    const result = await LeagueService.joinLeagueByCode('ABC123', 'user-1');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe('You are already a member of this league');
  });

  it('trims whitespace from join code', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { success: true, league: makeLeague(), team: makeTeam() },
      error: null,
    });

    await LeagueService.joinLeagueByCode('  ABC123  ', 'user-2');

    expect(supabase.rpc).toHaveBeenCalledWith('join_league_with_code', {
      p_join_code: 'ABC123',
      p_user_id: 'user-2',
      p_team_name: null,
    });
  });

  it('passes null team name when not provided', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: { success: true, league: makeLeague(), team: makeTeam() },
      error: null,
    });

    await LeagueService.joinLeagueByCode('ABC123', 'user-2');

    expect(supabase.rpc).toHaveBeenCalledWith('join_league_with_code', {
      p_join_code: 'ABC123',
      p_user_id: 'user-2',
      p_team_name: null,
    });
  });
});

// =============================================================================
// deleteTeam (commissioner-only team deletion)
// =============================================================================

describe('LeagueService.deleteTeam', () => {
  it('deletes a team when the user is commissioner', async () => {
    const teamChain = createChainMock();
    // delete() -> eq() -> eq() resolves as the chain (no terminal method)
    // The chain itself resolves with no error since delete returns { error }
    teamChain.eq.mockReturnValue(teamChain);
    // The final awaited result: just needs to resolve with { error: null }
    // In Supabase, .delete().eq().eq() returns a promise-like object
    // We make the last .eq() call resolve
    let eqCount = 0;
    teamChain.eq.mockImplementation(() => {
      eqCount++;
      if (eqCount === 2) {
        // Second .eq() is the terminal call — return a thenable
        return Promise.resolve({ data: null, error: null });
      }
      return teamChain;
    });

    perTableChains({ teams: teamChain });

    const result = await LeagueService.deleteTeam('team-1', 'league-1', 'user-1');

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(LeagueMembershipService.requireCommissioner).toHaveBeenCalledWith('league-1', 'user-1');
  });

  it('returns error when the user is not commissioner', async () => {
    const authError = new Error('Not the commissioner');
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValueOnce(authError);

    const result = await LeagueService.deleteTeam('team-1', 'league-1', 'user-2');

    expect(result.success).toBe(false);
    expect(result.error).toBe(authError);
  });

  it('returns error when database delete fails', async () => {
    const deleteError = { code: '23503', message: 'cascade failed', details: '', hint: '' };
    const teamChain = createChainMock();
    let eqCount = 0;
    teamChain.eq.mockImplementation(() => {
      eqCount++;
      if (eqCount === 2) {
        return Promise.resolve({ data: null, error: deleteError });
      }
      return teamChain;
    });

    perTableChains({ teams: teamChain });

    const result = await LeagueService.deleteTeam('team-1', 'league-1', 'user-1');

    expect(result.success).toBe(false);
    expect(result.error).toEqual(deleteError);
  });
});

// =============================================================================
// getUserLeagues
// =============================================================================

describe('LeagueService.getUserLeagues', () => {
  it('returns combined and deduplicated leagues', async () => {
    const league1 = makeLeague({ id: 'league-1', name: 'Commissioner League' });
    const league2 = makeLeague({ id: 'league-2', name: 'Member League', commissioner_id: 'other-user' });

    // First from('leagues') call: commissioner leagues
    const commLeagueChain = createChainMock();
    // The chain ends at .order() which is not a terminal, so the chain itself must resolve
    commLeagueChain.order.mockResolvedValue({ data: [league1], error: null });

    // from('teams') call: user's teams
    const teamsChain = createChainMock();
    teamsChain.neq.mockResolvedValue({
      data: [{ id: 'team-2', league_id: 'league-2', team_name: 'My Team', owner_id: 'user-1' }],
      error: null,
    });

    // Second from('leagues') call: owner leagues (by ID in list)
    const ownerLeagueChain = createChainMock();
    ownerLeagueChain.order.mockResolvedValue({ data: [league2], error: null });

    let leagueCallCount = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') {
        leagueCallCount++;
        if (leagueCallCount === 1) return commLeagueChain;
        return ownerLeagueChain;
      }
      if (table === 'teams') return teamsChain;
      return defaultChain;
    });

    const result = await LeagueService.getUserLeagues('user-1');

    expect(result.error).toBeNull();
    expect(result.leagues).toHaveLength(2);
    expect(result.leagues.map(l => l.id)).toContain('league-1');
    expect(result.leagues.map(l => l.id)).toContain('league-2');
  });

  it('deduplicates leagues where user is both commissioner and team owner', async () => {
    const league = makeLeague({ id: 'league-1' });

    const commLeagueChain = createChainMock();
    commLeagueChain.order.mockResolvedValue({ data: [league], error: null });

    const teamsChain = createChainMock();
    teamsChain.neq.mockResolvedValue({
      data: [{ id: 'team-1', league_id: 'league-1', team_name: 'My Team', owner_id: 'user-1' }],
      error: null,
    });

    const ownerLeagueChain = createChainMock();
    ownerLeagueChain.order.mockResolvedValue({ data: [league], error: null });

    let leagueCallCount = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') {
        leagueCallCount++;
        if (leagueCallCount === 1) return commLeagueChain;
        return ownerLeagueChain;
      }
      if (table === 'teams') return teamsChain;
      return defaultChain;
    });

    const result = await LeagueService.getUserLeagues('user-1');

    expect(result.error).toBeNull();
    // Should deduplicate — league-1 appears from both commissioner and team owner queries
    expect(result.leagues).toHaveLength(1);
    expect(result.leagues[0].id).toBe('league-1');
  });

  it('returns empty array when user has no leagues', async () => {
    const commLeagueChain = createChainMock();
    commLeagueChain.order.mockResolvedValue({ data: [], error: null });

    const teamsChain = createChainMock();
    teamsChain.neq.mockResolvedValue({ data: [], error: null });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return commLeagueChain;
      if (table === 'teams') return teamsChain;
      return defaultChain;
    });

    const result = await LeagueService.getUserLeagues('user-1');

    expect(result.error).toBeNull();
    expect(result.leagues).toEqual([]);
  });

  it('returns error when commissioner leagues query fails', async () => {
    const queryError = { code: '42501', message: 'permission denied', details: '', hint: '' };

    const commLeagueChain = createChainMock();
    commLeagueChain.order.mockResolvedValue({ data: null, error: queryError });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') return commLeagueChain;
      return defaultChain;
    });

    const result = await LeagueService.getUserLeagues('user-1');

    expect(result.leagues).toEqual([]);
    expect(result.error).toEqual(queryError);
  });
});

// =============================================================================
// getUserTeam
// =============================================================================

describe('LeagueService.getUserTeam', () => {
  it('returns the user team in the league', async () => {
    const team = makeTeam();
    defaultChain.single.mockResolvedValue({ data: team, error: null });

    const result = await LeagueService.getUserTeam('league-1', 'user-1');

    expect(result.team).toEqual(team);
    expect(result.error).toBeNull();
    expect(supabase.from).toHaveBeenCalledWith('teams');
  });

  it('returns null when user has no team in the league (PGRST116)', async () => {
    const noRowsError = { code: 'PGRST116', message: 'No rows', details: '', hint: '' };
    defaultChain.single.mockResolvedValue({ data: null, error: noRowsError });

    const result = await LeagueService.getUserTeam('league-1', 'user-2');

    // PGRST116 is handled gracefully — no error thrown
    expect(result.team).toBeNull();
    expect(result.error).toBeNull();
  });

  it('returns error for non-PGRST116 database errors', async () => {
    const dbError = { code: '42P01', message: 'relation does not exist', details: '', hint: '' };
    defaultChain.single.mockResolvedValue({ data: null, error: dbError });

    const result = await LeagueService.getUserTeam('league-1', 'user-1');

    expect(result.team).toBeNull();
    expect(result.error).toEqual(dbError);
  });
});

// =============================================================================
// getLeagueFormat (exported utility function)
// =============================================================================

describe('getLeagueFormat', () => {
  it('returns format settings from league settings', async () => {
    // extractFormatSettings is mocked to return defaults
    const league = makeLeague({ settings: { leagueType: 'fantasy', scoringFormat: 'h2h-points', draftType: 'snake' } });

    const format = getLeagueFormat(league);

    expect(format.leagueType).toBe('fantasy');
    expect(format.scoringFormat).toBe('h2h-points');
    expect(format.draftType).toBe('snake');
  });

  it('returns defaults when settings is empty', () => {
    const league = makeLeague({ settings: {} });

    const format = getLeagueFormat(league);

    // Defaults from the mock (extractFormatSettings returns fantasy/h2h-points/snake)
    expect(format.leagueType).toBe('fantasy');
    expect(format.scoringFormat).toBe('h2h-points');
    expect(format.draftType).toBe('snake');
  });
});

// =============================================================================
// updateScoringSettings
// =============================================================================

describe('LeagueService.updateScoringSettings', () => {
  it('updates scoring settings when draft is not completed', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { draft_status: 'not_started' },
      error: null,
    });

    const updateChain = createChainMock();
    updateChain.eq.mockResolvedValue({ data: null, error: null });

    let leagueCallCount = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') {
        leagueCallCount++;
        if (leagueCallCount === 1) return leagueChain;  // select draft_status
        return updateChain;  // update scoring_settings
      }
      return defaultChain;
    });

    // Mock the notify RPC
    (supabase.rpc as any).mockResolvedValue({ data: { success: true }, error: null });

    const scoring = { skater: { goals: 3, assists: 2 }, goalie: { wins: 4 } };
    const result = await LeagueService.updateScoringSettings('league-1', 'user-1', scoring);

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(LeagueMembershipService.requireCommissioner).toHaveBeenCalledWith('league-1', 'user-1');
  });

  it('blocks scoring changes when games have started', async () => {
    const leagueChain = createChainMock();
    leagueChain.single.mockResolvedValue({
      data: { draft_status: 'completed' },
      error: null,
    });

    // The daily rosters count query: select('*', { count: 'exact', head: true }).eq()
    const rosterChain = createChainMock();
    rosterChain.eq.mockResolvedValue({ data: null, error: null, count: 5 });

    let leagueCallCount = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'leagues') {
        leagueCallCount++;
        return leagueChain;
      }
      if (table === 'fantasy_daily_rosters') return rosterChain;
      return defaultChain;
    });

    const result = await LeagueService.updateScoringSettings('league-1', 'user-1', { skater: { goals: 5 } });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain('cannot be changed after games have started');
  });

  it('returns error when user is not commissioner', async () => {
    const authError = new Error('Not the commissioner');
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValueOnce(authError);

    const result = await LeagueService.updateScoringSettings('league-1', 'user-2', { skater: { goals: 3 } });

    expect(result.success).toBe(false);
    expect(result.error).toBe(authError);
  });
});

// =============================================================================
// updateWaiverSettings
// =============================================================================

describe('LeagueService.updateWaiverSettings', () => {
  it('updates waiver settings when the user is commissioner', async () => {
    const updateChain = createChainMock();
    updateChain.eq.mockResolvedValue({ data: null, error: null });

    perTableChains({ leagues: updateChain });

    // Mock the notify RPC
    (supabase.rpc as any).mockResolvedValue({ data: { success: true }, error: null });

    const result = await LeagueService.updateWaiverSettings('league-1', 'user-1', {
      waiver_type: 'faab',
      waiver_period_hours: 24,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(LeagueMembershipService.requireCommissioner).toHaveBeenCalledWith('league-1', 'user-1');
  });

  it('returns error when user is not commissioner', async () => {
    const authError = new Error('Not the commissioner');
    (LeagueMembershipService.requireCommissioner as any).mockRejectedValueOnce(authError);

    const result = await LeagueService.updateWaiverSettings('league-1', 'user-2', {
      waiver_type: 'rolling',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(authError);
  });
});

// =============================================================================
// simulateLeagueFill
// =============================================================================

describe('LeagueService.simulateLeagueFill', () => {
  it('creates AI teams to fill the league', async () => {
    const existingTeams = [
      { id: 'team-1', team_name: "Commissioner's Team", owner_id: 'user-1' },
    ];

    // First from('teams') call: .select().eq().order() — read existing teams
    const readChain = createChainMock();
    readChain.order.mockResolvedValue({ data: existingTeams, error: null });

    // Second from('teams') call: .insert().select() — insert new teams
    const insertChain = createChainMock();
    insertChain.select.mockResolvedValue({ data: [], error: null });

    let teamCallCount = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'teams') {
        teamCallCount++;
        if (teamCallCount === 1) return readChain;
        return insertChain;
      }
      return defaultChain;
    });

    const result = await LeagueService.simulateLeagueFill('league-1', 4);

    expect(result.error).toBeNull();
    // Should insert 3 AI teams (4 target - 1 existing)
    expect(insertChain.insert).toHaveBeenCalled();
    const insertedTeams = insertChain.insert.mock.calls[0][0];
    expect(insertedTeams).toHaveLength(3);
    expect(insertedTeams[0].team_name).toBe('AI Team 1');
    expect(insertedTeams[0].owner_id).toBeNull();
  });

  it('does nothing when league already has enough teams', async () => {
    const existingTeams = Array.from({ length: 12 }, (_, i) => ({
      id: `team-${i}`,
      team_name: `Team ${i}`,
      owner_id: i === 0 ? 'user-1' : null,
    }));

    const readChain = createChainMock();
    readChain.order.mockResolvedValue({ data: existingTeams, error: null });

    perTableChains({ teams: readChain });

    const result = await LeagueService.simulateLeagueFill('league-1', 12);

    expect(result.error).toBeNull();
    // insert should not have been called (only one from('teams') call for the read)
    expect(readChain.insert).not.toHaveBeenCalled();
  });

  it('returns error when fetching existing teams fails', async () => {
    const queryError = { code: '42P01', message: 'relation does not exist', details: '', hint: '' };
    const readChain = createChainMock();
    readChain.order.mockResolvedValue({ data: null, error: queryError });

    perTableChains({ teams: readChain });

    const result = await LeagueService.simulateLeagueFill('league-1');

    expect(result.error).toEqual(queryError);
  });

  it('avoids duplicate AI team numbers', async () => {
    const existingTeams = [
      { id: 'team-1', team_name: "Commissioner's Team", owner_id: 'user-1' },
      { id: 'team-2', team_name: 'AI Team 1', owner_id: null },
      { id: 'team-3', team_name: 'AI Team 2', owner_id: null },
    ];

    // First from('teams') call: read existing teams
    const readChain = createChainMock();
    readChain.order.mockResolvedValue({ data: existingTeams, error: null });

    // Second from('teams') call: insert new teams
    const insertChain = createChainMock();
    insertChain.select.mockResolvedValue({ data: [], error: null });

    let teamCallCount = 0;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'teams') {
        teamCallCount++;
        if (teamCallCount === 1) return readChain;
        return insertChain;
      }
      return defaultChain;
    });

    const result = await LeagueService.simulateLeagueFill('league-1', 5);

    expect(result.error).toBeNull();
    const insertedTeams = insertChain.insert.mock.calls[0][0];
    // Should create AI Team 3 and AI Team 4 (skipping 1 and 2)
    expect(insertedTeams).toHaveLength(2);
    expect(insertedTeams[0].team_name).toBe('AI Team 3');
    expect(insertedTeams[1].team_name).toBe('AI Team 4');
  });
});
