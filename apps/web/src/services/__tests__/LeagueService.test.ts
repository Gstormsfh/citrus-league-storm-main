import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCK SETUP
// =============================================================================

// API client layer — used by migrated methods (getLeague, createLeague, etc.)
const mockGetLeague = vi.fn();
const mockCreateLeague = vi.fn();
const mockJoinLeague = vi.fn();
const mockGetUserLeagues = vi.fn();
const mockGetTeams = vi.fn();
const mockGetMyTeam = vi.fn();
const mockDeleteTeam = vi.fn();

vi.mock('@/api/leagues', () => ({
  leagueApi: {
    getLeague: (...args: unknown[]) => mockGetLeague(...args),
    createLeague: (...args: unknown[]) => mockCreateLeague(...args),
    joinLeague: (...args: unknown[]) => mockJoinLeague(...args),
    getUserLeagues: (...args: unknown[]) => mockGetUserLeagues(...args),
    getTeams: (...args: unknown[]) => mockGetTeams(...args),
    getMyTeam: (...args: unknown[]) => mockGetMyTeam(...args),
    deleteTeam: (...args: unknown[]) => mockDeleteTeam(...args),
    updateSettings: vi.fn(),
    updateScoringSettings: vi.fn(),
  },
}));

// Supabase mock — still needed for methods not yet migrated (updateScoringSettings, etc.)
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
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
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

vi.mock('@/utils/scoringUtils', () => ({
  ScoringCalculator: vi.fn().mockImplementation(() => ({
    calculateScore: vi.fn().mockReturnValue(0),
  })),
  DEFAULT_SCORING: {},
  extractScoringSettings: vi.fn().mockReturnValue({}),
  createScorerFromLeague: vi.fn().mockReturnValue({
    calculateScore: vi.fn().mockReturnValue(0),
  }),
  EMPTY_CATEGORY_STATS: {},
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

// Also mock the alias path since LeagueService imports via @/services/PlayerService
vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
    getPlayersByIds: vi.fn().mockResolvedValue([]),
  },
  Player: {},
}));

// Mock API client modules (transitive imports from PlayerService and other services)
vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: null }),
  },
}));

vi.mock('@/api/players', () => ({
  playerApi: {
    getTrendingPlayers: vi.fn().mockResolvedValue({ data: [] }),
    recordPlayerTransaction: vi.fn().mockResolvedValue({ data: null }),
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
  // Clear the league request cache between tests
  LeagueService.clearLeagueCache();
});

// =============================================================================
// getLeague (uses leagueApi)
// =============================================================================

describe('LeagueService.getLeague', () => {
  it('returns a league from the API', async () => {
    const league = makeLeague();
    mockGetLeague.mockResolvedValue({ data: league });

    const result = await LeagueService.getLeague('league-1', 'user-1');

    expect(result.league).toEqual(league);
    expect(result.error).toBeNull();
    expect(mockGetLeague).toHaveBeenCalledWith('league-1');
  });

  it('returns null when API returns no data', async () => {
    mockGetLeague.mockResolvedValue({ data: null });

    const result = await LeagueService.getLeague('nonexistent', 'user-1');

    expect(result.league).toBeNull();
    expect(result.error).toBeNull();
  });

  it('returns error when API call fails', async () => {
    const apiError = new Error('Not found');
    mockGetLeague.mockRejectedValue(apiError);

    const result = await LeagueService.getLeague('league-1', 'user-1');

    expect(result.league).toBeNull();
    expect(result.error).toBe(apiError);
  });
});

// =============================================================================
// getLeagueTeams (uses leagueApi)
// =============================================================================

describe('LeagueService.getLeagueTeams', () => {
  it('returns teams from the API', async () => {
    const teams = [
      makeTeam({ id: 'team-1', team_name: 'Team Alpha' }),
      makeTeam({ id: 'team-2', team_name: 'Team Beta', owner_id: 'user-2' }),
    ];
    mockGetTeams.mockResolvedValue({ data: teams });

    const result = await LeagueService.getLeagueTeams('league-1');

    expect(result.teams).toEqual(teams);
    expect(result.error).toBeNull();
    expect(mockGetTeams).toHaveBeenCalledWith('league-1');
  });

  it('returns empty array when API returns null data', async () => {
    mockGetTeams.mockResolvedValue({ data: null });

    const result = await LeagueService.getLeagueTeams('league-1');

    expect(result.teams).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('returns error when API call fails', async () => {
    const apiError = new Error('API failed');
    mockGetTeams.mockRejectedValue(apiError);

    const result = await LeagueService.getLeagueTeams('league-1');

    expect(result.teams).toEqual([]);
    expect(result.error).toBe(apiError);
  });
});

// =============================================================================
// createLeague (uses leagueApi)
// =============================================================================

describe('LeagueService.createLeague', () => {
  it('creates a league and commissioner team successfully', async () => {
    const league = makeLeague();
    const team = makeTeam();
    mockCreateLeague.mockResolvedValue({ data: { league, team } });

    const result = await LeagueService.createLeague('Test League', 'user-1');

    expect(result.league).toEqual(league);
    expect(result.team).toEqual(team);
    expect(result.error).toBeNull();
    expect(mockCreateLeague).toHaveBeenCalledWith({
      name: 'Test League',
      settings: {},
      scoring_settings: undefined,
      roster_size: 21,
      draft_rounds: 21,
    });
  });

  it('returns error when API call fails', async () => {
    const apiError = new Error('duplicate key');
    mockCreateLeague.mockRejectedValue(apiError);

    const result = await LeagueService.createLeague('Dup League', 'user-1');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toBe(apiError);
  });

  it('passes custom roster size, draft rounds, and settings', async () => {
    const league = makeLeague({ roster_size: 15, draft_rounds: 15 });
    const team = makeTeam();
    mockCreateLeague.mockResolvedValue({ data: { league, team } });

    const customSettings = { leagueType: 'fantasy' as const };
    const customScoring = { goals: 3, assists: 2 };

    await LeagueService.createLeague('My League', 'user-1', 15, 15, customSettings, customScoring);

    expect(mockCreateLeague).toHaveBeenCalledWith({
      name: 'My League',
      settings: { leagueType: 'fantasy' },
      scoring_settings: { goals: 3, assists: 2 },
      roster_size: 15,
      draft_rounds: 15,
    });
  });

  it('merges waiver settings into settings', async () => {
    const league = makeLeague();
    const team = makeTeam();
    mockCreateLeague.mockResolvedValue({ data: { league, team } });

    await LeagueService.createLeague(
      'FAAB League', 'user-1', 21, 21,
      { faabBudget: 200 },
      undefined,
      { waiver_type: 'faab' }
    );

    expect(mockCreateLeague).toHaveBeenCalledWith({
      name: 'FAAB League',
      settings: { faabBudget: 200, waiver_type: 'faab' },
      scoring_settings: undefined,
      roster_size: 21,
      draft_rounds: 21,
    });
  });

  it('returns null league and team when API returns empty data', async () => {
    mockCreateLeague.mockResolvedValue({ data: null });

    const result = await LeagueService.createLeague('Test', 'user-1');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toBeNull();
  });
});

// =============================================================================
// joinLeagueByCode (uses leagueApi)
// =============================================================================

describe('LeagueService.joinLeagueByCode', () => {
  it('joins a league successfully via API', async () => {
    const league = makeLeague();
    const team = makeTeam({ owner_id: 'user-2' });
    mockJoinLeague.mockResolvedValue({ data: { league, team } });

    const result = await LeagueService.joinLeagueByCode('ABC123', 'user-2', 'My Team');

    expect(result.league).toEqual(league);
    expect(result.team).toEqual(team);
    expect(result.error).toBeNull();
    expect(mockJoinLeague).toHaveBeenCalledWith({ joinCode: 'ABC123', teamName: 'My Team' });
  });

  it('returns error when join code is empty', async () => {
    const result = await LeagueService.joinLeagueByCode('', 'user-2');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe('Join code is required');
    // API should not have been called
    expect(mockJoinLeague).not.toHaveBeenCalled();
  });

  it('returns error when API call fails', async () => {
    const apiError = new Error('rate limit exceeded');
    mockJoinLeague.mockRejectedValue(apiError);

    const result = await LeagueService.joinLeagueByCode('ABC123', 'user-2');

    expect(result.league).toBeNull();
    expect(result.team).toBeNull();
    expect(result.error).toBe(apiError);
  });

  it('trims whitespace from join code', async () => {
    mockJoinLeague.mockResolvedValue({ data: { league: makeLeague(), team: makeTeam() } });

    await LeagueService.joinLeagueByCode('  ABC123  ', 'user-2');

    expect(mockJoinLeague).toHaveBeenCalledWith({ joinCode: 'ABC123', teamName: undefined });
  });

  it('passes undefined team name when not provided', async () => {
    mockJoinLeague.mockResolvedValue({ data: { league: makeLeague(), team: makeTeam() } });

    await LeagueService.joinLeagueByCode('ABC123', 'user-2');

    expect(mockJoinLeague).toHaveBeenCalledWith({ joinCode: 'ABC123', teamName: undefined });
  });
});

// =============================================================================
// deleteTeam (uses leagueApi)
// =============================================================================

describe('LeagueService.deleteTeam', () => {
  it('deletes a team via API', async () => {
    mockDeleteTeam.mockResolvedValue({ data: { success: true } });

    const result = await LeagueService.deleteTeam('team-1', 'league-1', 'user-1');

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(mockDeleteTeam).toHaveBeenCalledWith('league-1', 'team-1');
  });

  it('returns error when API call fails', async () => {
    const apiError = new Error('Not the commissioner');
    mockDeleteTeam.mockRejectedValue(apiError);

    const result = await LeagueService.deleteTeam('team-1', 'league-1', 'user-2');

    expect(result.success).toBe(false);
    expect(result.error).toBe(apiError);
  });
});

// =============================================================================
// getUserLeagues (uses leagueApi)
// =============================================================================

describe('LeagueService.getUserLeagues', () => {
  it('returns leagues from the API', async () => {
    const leagues = [
      makeLeague({ id: 'league-1', name: 'Commissioner League' }),
      makeLeague({ id: 'league-2', name: 'Member League', commissioner_id: 'other-user' }),
    ];
    mockGetUserLeagues.mockResolvedValue({ data: leagues });

    const result = await LeagueService.getUserLeagues('user-1');

    expect(result.error).toBeNull();
    expect(result.leagues).toHaveLength(2);
    expect(result.leagues.map(l => l.id)).toContain('league-1');
    expect(result.leagues.map(l => l.id)).toContain('league-2');
  });

  it('returns empty array when API returns null data', async () => {
    mockGetUserLeagues.mockResolvedValue({ data: null });

    const result = await LeagueService.getUserLeagues('user-1');

    expect(result.error).toBeNull();
    expect(result.leagues).toEqual([]);
  });

  it('returns error when API call fails', async () => {
    const apiError = new Error('permission denied');
    mockGetUserLeagues.mockRejectedValue(apiError);

    const result = await LeagueService.getUserLeagues('user-1');

    expect(result.leagues).toEqual([]);
    expect(result.error).toBe(apiError);
  });
});

// =============================================================================
// getUserTeam (uses leagueApi)
// =============================================================================

describe('LeagueService.getUserTeam', () => {
  it('returns the user team from the API', async () => {
    const team = makeTeam();
    mockGetMyTeam.mockResolvedValue({ data: team });

    const result = await LeagueService.getUserTeam('league-1', 'user-1');

    expect(result.team).toEqual(team);
    expect(result.error).toBeNull();
    expect(mockGetMyTeam).toHaveBeenCalledWith('league-1');
  });

  it('returns null when API returns no data', async () => {
    mockGetMyTeam.mockResolvedValue({ data: null });

    const result = await LeagueService.getUserTeam('league-1', 'user-2');

    expect(result.team).toBeNull();
    expect(result.error).toBeNull();
  });

  it('returns error on API failure', async () => {
    const apiError = new Error('relation does not exist');
    mockGetMyTeam.mockRejectedValue(apiError);

    const result = await LeagueService.getUserTeam('league-1', 'user-1');

    expect(result.team).toBeNull();
    expect(result.error).toBe(apiError);
  });
});

// =============================================================================
// getLeagueFormat (exported utility function — pure, no API)
// =============================================================================

describe('getLeagueFormat', () => {
  it('returns format settings from league settings', async () => {
    const league = makeLeague({ settings: { leagueType: 'fantasy', scoringFormat: 'h2h-points', draftType: 'snake' } });

    const format = getLeagueFormat(league);

    expect(format.leagueType).toBe('fantasy');
    expect(format.scoringFormat).toBe('h2h-points');
    expect(format.draftType).toBe('snake');
  });

  it('returns defaults when settings is empty', () => {
    const league = makeLeague({ settings: {} });

    const format = getLeagueFormat(league);

    expect(format.leagueType).toBe('fantasy');
    expect(format.scoringFormat).toBe('h2h-points');
    expect(format.draftType).toBe('snake');
  });
});

// =============================================================================
// updateScoringSettings (still uses supabase directly — not yet migrated)
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
});
