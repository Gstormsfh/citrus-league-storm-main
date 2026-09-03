import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DraftPick, DraftOrder, DraftState, DraftSnapshotData, DraftSnapshot } from '../DraftService';

// =============================================================================
// Mock API client layer (DraftService now uses draftApi, not supabase)
// =============================================================================

const mockGetActiveSession = vi.fn();
const mockGetDraftPicks = vi.fn();
const mockGetDraftOrder = vi.fn();
const mockGetDraftState = vi.fn();
const mockMakePick = vi.fn();
const mockInitializeOrder = vi.fn();
const mockResetDraft = vi.fn();
const mockUndoLastPick = vi.fn();
const mockHardDeleteDraft = vi.fn();
const mockGetSnapshot = vi.fn();
const mockSaveSnapshot = vi.fn();
const mockAutopick = vi.fn();
const mockFullAutopick = vi.fn();
const mockGetRankings = vi.fn();
const mockSaveRankings = vi.fn();

vi.mock('@/api/draft', () => ({
  draftApi: {
    getActiveSession: (...args: unknown[]) => mockGetActiveSession(...args),
    getDraftPicks: (...args: unknown[]) => mockGetDraftPicks(...args),
    getDraftOrder: (...args: unknown[]) => mockGetDraftOrder(...args),
    getDraftState: (...args: unknown[]) => mockGetDraftState(...args),
    makePick: (...args: unknown[]) => mockMakePick(...args),
    initializeOrder: (...args: unknown[]) => mockInitializeOrder(...args),
    resetDraft: (...args: unknown[]) => mockResetDraft(...args),
    undoLastPick: (...args: unknown[]) => mockUndoLastPick(...args),
    hardDeleteDraft: (...args: unknown[]) => mockHardDeleteDraft(...args),
    getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
    saveSnapshot: (...args: unknown[]) => mockSaveSnapshot(...args),
    autopick: (...args: unknown[]) => mockAutopick(...args),
    fullAutopick: (...args: unknown[]) => mockFullAutopick(...args),
    getRankings: (...args: unknown[]) => mockGetRankings(...args),
    saveRankings: (...args: unknown[]) => mockSaveRankings(...args),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../LeagueService', () => ({
  LeagueService: {
    getLeague: vi.fn().mockResolvedValue({ league: null, error: null }),
    getLeagueTeams: vi.fn().mockResolvedValue({ teams: [] }),
    initializeTeamLineup: vi.fn().mockResolvedValue({ lineup: null, error: null }),
  },
  Team: {},
  getLeagueFormat: vi.fn().mockReturnValue({ scoringFormat: 'h2h-points', leagueType: 'fantasy', draftType: 'snake' }),
}));

vi.mock('../PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
    getPlayersByIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../LeagueMembershipService', () => ({
  LeagueMembershipService: {
    requireMembership: vi.fn().mockResolvedValue(undefined),
    requireCommissioner: vi.fn().mockResolvedValue(undefined),
  },
}));

// leagueApi mock — DraftService imports leagueApi for post-draft operations
vi.mock('@/api/leagues', () => ({
  leagueApi: {
    getTeams: vi.fn().mockResolvedValue({ data: [] }),
    getLeague: vi.fn().mockResolvedValue({ data: null }),
  },
}));

// Supabase mock still needed for module resolution (subscribeToDraftPicks + some post-draft code)
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      delete: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
  },
}));

// =============================================================================
// Import DraftService AFTER mocks are registered
// =============================================================================

import { DraftService, clearDraftCache } from '../DraftService';

// =============================================================================
// Test setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  clearDraftCache();

  // Set safe defaults for all API mocks
  mockGetActiveSession.mockResolvedValue({ data: { sessionId: 'default-session' } });
  mockGetDraftPicks.mockResolvedValue({ data: [] });
  mockGetDraftOrder.mockResolvedValue({ data: null });
  mockMakePick.mockResolvedValue({ data: { pick: null, isComplete: false } });
  mockInitializeOrder.mockResolvedValue({ data: { sessionId: 'new-session' } });
  mockResetDraft.mockResolvedValue({ data: { newSessionId: 'reset-session' } });
  mockUndoLastPick.mockResolvedValue({ data: { undone: null } });
  mockHardDeleteDraft.mockResolvedValue({ data: null });
  mockGetSnapshot.mockResolvedValue({ data: null });
  mockSaveSnapshot.mockResolvedValue({ data: { snapshotId: null } });
  mockAutopick.mockResolvedValue({ data: null });
  mockFullAutopick.mockResolvedValue({ data: { picks: [] } });
  mockGetRankings.mockResolvedValue({ data: [] });
  mockSaveRankings.mockResolvedValue({ data: null });
});

// =============================================================================
// Interface Type Checks (compile-time validation)
// =============================================================================

describe('DraftService Interfaces', () => {
  it('DraftPick interface has required fields', () => {
    const pick: DraftPick = {
      id: 'pick-1',
      league_id: 'league-1',
      round_number: 1,
      pick_number: 1,
      team_id: 'team-1',
      player_id: 'player-1',
      picked_at: '2025-01-01T00:00:00Z',
    };
    expect(pick.id).toBe('pick-1');
    expect(pick.round_number).toBe(1);
    expect(pick.pick_number).toBe(1);
    expect(pick.team_id).toBe('team-1');
    expect(pick.player_id).toBe('player-1');
    expect(pick.picked_at).toBeDefined();
  });

  it('DraftPick supports optional fields (draft_session_id, deleted_at)', () => {
    const pick: DraftPick = {
      id: 'pick-2',
      league_id: 'league-1',
      round_number: 2,
      pick_number: 5,
      team_id: 'team-2',
      player_id: 'player-5',
      picked_at: '2025-01-01T00:00:00Z',
      draft_session_id: 'session-1',
      deleted_at: null,
    };
    expect(pick.draft_session_id).toBe('session-1');
    expect(pick.deleted_at).toBeNull();
  });

  it('DraftOrder interface has required fields including team_order array', () => {
    const order: DraftOrder = {
      id: 'order-1',
      league_id: 'league-1',
      round_number: 1,
      team_order: ['team-a', 'team-b', 'team-c'],
      created_at: '2025-01-01T00:00:00Z',
    };
    expect(order.team_order).toHaveLength(3);
    expect(order.team_order[0]).toBe('team-a');
  });

  it('DraftState interface tracks draft progress', () => {
    const state: DraftState = {
      currentRound: 3,
      currentPick: 25,
      totalPicks: 24,
      nextTeamId: 'team-3',
      isComplete: false,
      sessionId: 'session-1',
    };
    expect(state.currentRound).toBe(3);
    expect(state.isComplete).toBe(false);
    expect(state.nextTeamId).toBe('team-3');
  });

  it('DraftState marks completed draft with null nextTeamId', () => {
    const state: DraftState = {
      currentRound: 15,
      currentPick: 120,
      totalPicks: 120,
      nextTeamId: null,
      isComplete: true,
    };
    expect(state.isComplete).toBe(true);
    expect(state.nextTeamId).toBeNull();
  });

  it('DraftSnapshotData captures full draft history', () => {
    const snapshot: DraftSnapshotData = {
      teams: [
        { id: 'team-1', name: 'Team Alpha', owner: 'user-1', color: '#FF0000' },
      ],
      picks: [
        {
          id: 'pick-1',
          teamId: 'team-1',
          teamName: 'Team Alpha',
          playerId: 'player-1',
          playerName: 'Sidney Crosby',
          position: 'C',
          round: 1,
          pick: 1,
          timestamp: Date.now(),
        },
      ],
      leagueSettings: {
        rounds: 15,
        draftOrder: 'snake',
        completedAt: '2025-01-01T00:00:00Z',
      },
    };
    expect(snapshot.teams).toHaveLength(1);
    expect(snapshot.picks).toHaveLength(1);
    expect(snapshot.leagueSettings.rounds).toBe(15);
  });

  it('DraftSnapshot wraps DraftSnapshotData with metadata', () => {
    const snapshot: DraftSnapshot = {
      id: 'snapshot-1',
      league_id: 'league-1',
      draft_session_id: 'session-1',
      snapshot_data: {
        teams: [],
        picks: [],
        leagueSettings: { rounds: 10, draftOrder: 'snake', completedAt: '' },
      },
      // No `created_by`: the route's projection (COLUMNS.DRAFT_SNAPSHOT) does
      // not select it, so DraftSnapshot no longer declares it.
      created_at: '2025-01-01T00:00:00Z',
    };
    expect(snapshot.id).toBe('snapshot-1');
    expect(snapshot.draft_session_id).toBe('session-1');
  });
});

// =============================================================================
// getActiveDraftSession
// =============================================================================

describe('DraftService.getActiveDraftSession', () => {
  it('returns session ID from API response', async () => {
    mockGetActiveSession.mockResolvedValue({ data: { sessionId: 'api-session-123' } });

    const { sessionId, error } = await DraftService.getActiveDraftSession('league-1', 'user-1');

    expect(error).toBeNull();
    expect(sessionId).toBe('api-session-123');
    expect(mockGetActiveSession).toHaveBeenCalledWith('league-1');
  });

  it('generates new UUID as fallback when API fails', async () => {
    mockGetActiveSession.mockRejectedValue(new Error('API error'));

    const { sessionId, error } = await DraftService.getActiveDraftSession('league-1', 'user-1');

    // Should NOT throw — creates a new session as fallback
    expect(error).toBeNull();
    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it('works without userId parameter', async () => {
    mockGetActiveSession.mockResolvedValue({ data: { sessionId: 'no-user-session' } });

    const { sessionId, error } = await DraftService.getActiveDraftSession('league-1');

    expect(error).toBeNull();
    expect(sessionId).toBe('no-user-session');
  });
});

// =============================================================================
// getDraftState
// =============================================================================

describe('DraftService.getDraftState', () => {
  const teams = [
    { id: 'team-a', league_id: 'league-1', owner_id: 'user-1', team_name: 'Team A', created_at: '', updated_at: '' },
    { id: 'team-b', league_id: 'league-1', owner_id: 'user-2', team_name: 'Team B', created_at: '', updated_at: '' },
    { id: 'team-c', league_id: 'league-1', owner_id: 'user-3', team_name: 'Team C', created_at: '', updated_at: '' },
    { id: 'team-d', league_id: 'league-1', owner_id: 'user-4', team_name: 'Team D', created_at: '', updated_at: '' },
  ];
  const totalRounds = 3;

  it('computes round 1 pick 1 when no picks exist', async () => {
    mockGetDraftPicks.mockResolvedValue({ data: [] });
    mockGetDraftOrder.mockResolvedValue({
      data: {
        id: 'order-1',
        league_id: 'league-1',
        round_number: 1,
        team_order: ['team-a', 'team-b', 'team-c', 'team-d'],
        created_at: '',
        draft_session_id: 'session-1',
        deleted_at: null,
      },
    });

    const { state, error } = await DraftService.getDraftState('league-1', teams, totalRounds, 'user-1');

    expect(error).toBeNull();
    expect(state).not.toBeNull();
    expect(state!.currentRound).toBe(1);
    expect(state!.currentPick).toBe(1);
    expect(state!.totalPicks).toBe(0);
    expect(state!.isComplete).toBe(false);
    expect(state!.nextTeamId).toBe('team-a');
  });

  it('computes correct state mid-draft (4 picks made = start of round 2)', async () => {
    const existingPicks: DraftPick[] = [
      { id: 'p1', league_id: 'league-1', round_number: 1, pick_number: 1, team_id: 'team-a', player_id: 'pl-1', picked_at: '', draft_session_id: 'session-1' },
      { id: 'p2', league_id: 'league-1', round_number: 1, pick_number: 2, team_id: 'team-b', player_id: 'pl-2', picked_at: '', draft_session_id: 'session-1' },
      { id: 'p3', league_id: 'league-1', round_number: 1, pick_number: 3, team_id: 'team-c', player_id: 'pl-3', picked_at: '', draft_session_id: 'session-1' },
      { id: 'p4', league_id: 'league-1', round_number: 1, pick_number: 4, team_id: 'team-d', player_id: 'pl-4', picked_at: '', draft_session_id: 'session-1' },
    ];

    mockGetDraftPicks.mockResolvedValue({ data: existingPicks });
    mockGetDraftOrder.mockResolvedValue({
      data: {
        id: 'order-2',
        league_id: 'league-1',
        round_number: 2,
        team_order: ['team-d', 'team-c', 'team-b', 'team-a'],
        created_at: '',
        draft_session_id: 'session-1',
        deleted_at: null,
      },
    });

    const { state, error } = await DraftService.getDraftState('league-1', teams, totalRounds, 'user-1');

    expect(error).toBeNull();
    expect(state).not.toBeNull();
    expect(state!.currentRound).toBe(2);
    expect(state!.currentPick).toBe(5);
    expect(state!.totalPicks).toBe(4);
    expect(state!.isComplete).toBe(false);
    expect(state!.nextTeamId).toBe('team-d');
  });

  it('marks draft as complete when all picks made', async () => {
    // 4 teams * 3 rounds = 12 total picks
    const allPicks: DraftPick[] = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i + 1}`,
      league_id: 'league-1',
      round_number: Math.floor(i / 4) + 1,
      pick_number: i + 1,
      team_id: `team-${String.fromCharCode(97 + (i % 4))}`,
      player_id: `pl-${i + 1}`,
      picked_at: '',
      draft_session_id: 'session-1',
    }));

    mockGetDraftPicks.mockResolvedValue({ data: allPicks });

    const { state, error } = await DraftService.getDraftState('league-1', teams, totalRounds, 'user-1');

    expect(error).toBeNull();
    expect(state).not.toBeNull();
    expect(state!.isComplete).toBe(true);
    expect(state!.nextTeamId).toBeNull();
    expect(state!.currentRound).toBe(totalRounds);
    expect(state!.totalPicks).toBe(12);
  });

  it('returns error when draft order is not initialized', async () => {
    mockGetDraftPicks.mockResolvedValue({ data: [] });
    mockGetDraftOrder.mockResolvedValue({ data: null });

    const { state, error } = await DraftService.getDraftState('league-1', teams, totalRounds, 'user-1');

    expect(state).toBeNull();
    expect(error).toBeDefined();
    expect((error as Error).message).toBe('Draft order not initialized');
  });

  it('derives sessionId from existing picks', async () => {
    const picks: DraftPick[] = [
      { id: 'p1', league_id: 'league-1', round_number: 1, pick_number: 1, team_id: 'team-a', player_id: 'pl-1', picked_at: '', draft_session_id: 'derived-session' },
    ];

    mockGetDraftPicks.mockResolvedValue({ data: picks });
    mockGetDraftOrder.mockResolvedValue({
      data: {
        id: 'o1', league_id: 'league-1', round_number: 1,
        team_order: ['team-a', 'team-b', 'team-c', 'team-d'],
        created_at: '', draft_session_id: 'derived-session', deleted_at: null,
      },
    });

    const { state } = await DraftService.getDraftState('league-1', teams, totalRounds, 'user-1');

    expect(state!.sessionId).toBe('derived-session');
  });
});

// =============================================================================
// initializeDraftOrder
// =============================================================================

describe('DraftService.initializeDraftOrder', () => {
  const teams = [
    { id: 'team-1', league_id: 'league-1', owner_id: 'user-1', team_name: 'Team 1', created_at: '', updated_at: '' },
    { id: 'team-2', league_id: 'league-1', owner_id: 'user-2', team_name: 'Team 2', created_at: '', updated_at: '' },
    { id: 'team-3', league_id: 'league-1', owner_id: 'user-3', team_name: 'Team 3', created_at: '', updated_at: '' },
  ];

  it('calls API with correct params for snake draft', async () => {
    mockInitializeOrder.mockResolvedValue({ data: { sessionId: 'new-session-1' } });

    const result = await DraftService.initializeDraftOrder('league-1', 'user-1', teams, 4, true);

    expect(result.error).toBeNull();
    expect(result.sessionId).toBe('new-session-1');
    expect(mockInitializeOrder).toHaveBeenCalledWith('league-1', {
      teams: [{ id: 'team-1' }, { id: 'team-2' }, { id: 'team-3' }],
      totalRounds: 4,
      customTeamOrder: undefined,
      draftType: undefined,
    });
  });

  it('passes linear draft type to API', async () => {
    mockInitializeOrder.mockResolvedValue({ data: { sessionId: 'linear-session' } });

    await DraftService.initializeDraftOrder('league-1', 'user-1', teams, 3, true, undefined, 'linear');

    expect(mockInitializeOrder).toHaveBeenCalledWith('league-1', {
      teams: [{ id: 'team-1' }, { id: 'team-2' }, { id: 'team-3' }],
      totalRounds: 3,
      customTeamOrder: undefined,
      draftType: 'linear',
    });
  });

  it('passes custom team order to API', async () => {
    mockInitializeOrder.mockResolvedValue({ data: { sessionId: 'custom-session' } });

    const customOrder = ['team-3', 'team-1', 'team-2'];
    await DraftService.initializeDraftOrder('league-1', 'user-1', teams, 2, true, customOrder);

    expect(mockInitializeOrder).toHaveBeenCalledWith('league-1', {
      teams: [{ id: 'team-1' }, { id: 'team-2' }, { id: 'team-3' }],
      totalRounds: 2,
      customTeamOrder: customOrder,
      draftType: undefined,
    });
  });

  it('returns error when API rejects (e.g., invalid team IDs)', async () => {
    mockInitializeOrder.mockRejectedValue(new Error('Invalid team IDs in custom order'));

    const result = await DraftService.initializeDraftOrder('league-1', 'user-1', teams, 2, true, ['team-INVALID']);

    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain('Invalid team IDs');
  });

  it('returns error when API rejects (e.g., wrong team count)', async () => {
    mockInitializeOrder.mockRejectedValue(new Error('Custom order must include all teams'));

    const result = await DraftService.initializeDraftOrder('league-1', 'user-1', teams, 2, true, ['team-1']);

    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain('must include all teams');
  });

  it('returns session ID from API response', async () => {
    mockInitializeOrder.mockResolvedValue({ data: { sessionId: 'session-abc' } });

    const result = await DraftService.initializeDraftOrder('league-1', 'user-1', teams, 2, true);

    expect(result.sessionId).toBe('session-abc');
  });
});

// =============================================================================
// makePick
// =============================================================================

describe('DraftService.makePick', () => {
  it('returns error from API when player already drafted', async () => {
    mockMakePick.mockRejectedValue(new Error('Player already drafted in this session'));

    const result = await DraftService.makePick('league-1', 'team-1', 'player-1', 1, 1, 'session-1');

    expect(result.pick).toBeNull();
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain('Player already drafted');
  });

  it('returns error from API when pick number is taken', async () => {
    mockMakePick.mockRejectedValue(new Error('This pick number is already taken in this session'));

    const result = await DraftService.makePick('league-1', 'team-1', 'player-2', 1, 1, 'session-1');

    expect(result.pick).toBeNull();
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain('This pick number is already taken in this session');
  });

  it('returns pick data on successful draft pick', async () => {
    const pickData: DraftPick = {
      id: 'pick-new',
      league_id: 'league-1',
      round_number: 1,
      pick_number: 1,
      team_id: 'team-1',
      player_id: 'player-1',
      picked_at: '2025-01-01T00:00:00Z',
      draft_session_id: 'session-1',
    };
    mockMakePick.mockResolvedValue({ data: { pick: pickData, isComplete: false } });

    const result = await DraftService.makePick('league-1', 'team-1', 'player-1', 1, 1, 'session-1');

    expect(result.pick).toEqual(pickData);
    expect(result.error).toBeNull();
    expect(result.isComplete).toBe(false);
  });

  it('blocks user-initiated picks for demo league when picks exist', async () => {
    const demoLeagueId = '00000000-0000-0000-0000-000000000001';
    // getDraftPicks is called internally for the demo guard
    mockGetDraftPicks.mockResolvedValue({
      data: [
        { id: 'p1', league_id: demoLeagueId, round_number: 1, pick_number: 1, team_id: 't1', player_id: 'pl1', picked_at: '' },
      ],
    });

    const result = await DraftService.makePick(demoLeagueId, 'team-1', 'player-1', 1, 2, 'session-1');

    expect(result.pick).toBeNull();
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain('Demo league is read-only');
  });

  it('passes correct params to API', async () => {
    mockMakePick.mockResolvedValue({ data: { pick: null, isComplete: false } });

    await DraftService.makePick('league-1', 'team-1', 'player-5', 2, 7, 'session-1', 4);

    expect(mockMakePick).toHaveBeenCalledWith('league-1', {
      playerId: 'player-5',
      teamId: 'team-1',
      pickNumber: 7,
      roundNumber: 2,
      draftSessionId: 'session-1',
      teamsCount: 4,
    });
  });
});

// =============================================================================
// resetDraft
// =============================================================================

describe('DraftService.resetDraft', () => {
  it('returns a new session ID after reset', async () => {
    mockResetDraft.mockResolvedValue({ data: { newSessionId: 'reset-session-123' } });

    const result = await DraftService.resetDraft('league-1');

    expect(result.error).toBeNull();
    expect(result.newSessionId).toBe('reset-session-123');
  });

  it('generates UUID fallback when API returns no newSessionId', async () => {
    mockResetDraft.mockResolvedValue({ data: {} });

    const result = await DraftService.resetDraft('league-1');

    expect(result.error).toBeNull();
    expect(result.newSessionId).toBeDefined();
    expect(typeof result.newSessionId).toBe('string');
  });

  it('returns error when API fails', async () => {
    mockResetDraft.mockRejectedValue(new Error('Reset failed'));

    const result = await DraftService.resetDraft('league-1');

    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toBe('Reset failed');
  });
});

// =============================================================================
// undoLastPick
// =============================================================================

describe('DraftService.undoLastPick', () => {
  it('returns the undone pick from API', async () => {
    const lastPick: DraftPick = {
      id: 'pick-10',
      league_id: 'league-1',
      round_number: 3,
      pick_number: 10,
      team_id: 'team-2',
      player_id: 'player-10',
      picked_at: '2025-01-01T00:10:00Z',
      draft_session_id: 'session-1',
      deleted_at: null,
    };

    mockUndoLastPick.mockResolvedValue({ data: { undone: lastPick } });

    const { undone, error } = await DraftService.undoLastPick('league-1', 'user-1');

    expect(error).toBeNull();
    expect(undone).not.toBeNull();
    expect(undone!.id).toBe('pick-10');
    expect(undone!.player_id).toBe('player-10');
  });

  it('returns null when no picks exist to undo', async () => {
    mockUndoLastPick.mockResolvedValue({ data: { undone: null } });

    const { undone, error } = await DraftService.undoLastPick('league-1', 'user-1');

    expect(undone).toBeNull();
    expect(error).toBeNull();
  });

  it('returns error on API failure', async () => {
    mockUndoLastPick.mockRejectedValue(new Error('No picks to undo'));

    const { undone, error } = await DraftService.undoLastPick('league-1', 'user-1');

    expect(undone).toBeNull();
    expect(error).toBeDefined();
  });
});

// =============================================================================
// getDraftPicks
// =============================================================================

describe('DraftService.getDraftPicks', () => {
  it('returns empty array when no picks exist', async () => {
    mockGetDraftPicks.mockResolvedValue({ data: [] });

    const { picks, error } = await DraftService.getDraftPicks('league-1', 'user-1');

    expect(error).toBeNull();
    expect(picks).toEqual([]);
  });

  it('returns picks from API', async () => {
    const mockPicks: DraftPick[] = [
      { id: 'p1', league_id: 'league-1', round_number: 1, pick_number: 1, team_id: 'team-1', player_id: 'pl-1', picked_at: '', draft_session_id: 'session-X' },
    ];
    mockGetDraftPicks.mockResolvedValue({ data: mockPicks });

    const { picks, error } = await DraftService.getDraftPicks('league-1', 'user-1', 'session-X');

    expect(error).toBeNull();
    expect(picks).toHaveLength(1);
    expect(picks[0].draft_session_id).toBe('session-X');
    expect(mockGetDraftPicks).toHaveBeenCalledWith('league-1', 'session-X');
  });

  it('returns error on API failure', async () => {
    mockGetDraftPicks.mockRejectedValue(new Error('API error'));

    const { picks, error } = await DraftService.getDraftPicks('league-1', 'user-1');

    expect(picks).toEqual([]);
    expect(error).toBeDefined();
  });
});

// =============================================================================
// getDraftOrder
// =============================================================================

describe('DraftService.getDraftOrder', () => {
  it('returns null order when none exists', async () => {
    mockGetDraftOrder.mockResolvedValue({ data: null });

    const { order, error } = await DraftService.getDraftOrder('league-1', 'user-1', 1);

    expect(error).toBeNull();
    expect(order).toBeNull();
  });

  it('returns order for specified round', async () => {
    const mockOrder: DraftOrder = {
      id: 'order-3',
      league_id: 'league-1',
      round_number: 3,
      team_order: ['team-c', 'team-b', 'team-a'],
      created_at: '',
      draft_session_id: 'session-1',
      deleted_at: null,
    };

    mockGetDraftOrder.mockResolvedValue({ data: mockOrder });

    const { order, error } = await DraftService.getDraftOrder('league-1', 'user-1', 3);

    expect(error).toBeNull();
    expect(order).not.toBeNull();
    expect(order!.round_number).toBe(3);
    expect(order!.team_order).toEqual(['team-c', 'team-b', 'team-a']);
  });

  it('returns error on API failure', async () => {
    mockGetDraftOrder.mockRejectedValue(new Error('API error'));

    const { order, error } = await DraftService.getDraftOrder('league-1', 'user-1', 1);

    expect(order).toBeNull();
    expect(error).toBeDefined();
  });
});

// =============================================================================
// getDraftSnapshot
// =============================================================================

describe('DraftService.getDraftSnapshot', () => {
  it('returns null when no snapshot exists', async () => {
    mockGetSnapshot.mockResolvedValue({ data: null });

    const { snapshot, error } = await DraftService.getDraftSnapshot('league-1');

    expect(error).toBeNull();
    expect(snapshot).toBeNull();
  });

  it('returns most recent snapshot for league', async () => {
    const mockSnapshot = {
      id: 'snap-1',
      league_id: 'league-1',
      draft_session_id: 'session-1',
      snapshot_data: {
        teams: [],
        picks: [],
        leagueSettings: { rounds: 10, draftOrder: 'snake', completedAt: '' },
      },
      created_at: '2025-01-01T00:00:00Z',
      created_by: 'user-1',
    };

    mockGetSnapshot.mockResolvedValue({ data: mockSnapshot });

    const { snapshot, error } = await DraftService.getDraftSnapshot('league-1');

    expect(error).toBeNull();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.id).toBe('snap-1');
    expect(snapshot!.draft_session_id).toBe('session-1');
  });
});

// =============================================================================
// saveDraftSnapshot
// =============================================================================

describe('DraftService.saveDraftSnapshot', () => {
  it('returns snapshot ID from API', async () => {
    mockSaveSnapshot.mockResolvedValue({ data: { snapshotId: 'new-snap-id' } });

    const result = await DraftService.saveDraftSnapshot(
      'league-1',
      'session-1',
      [],
      [],
      { rounds: 10, draftOrder: 'snake', completedAt: '' }
    );

    expect(result.snapshotId).toBe('new-snap-id');
    expect(result.error).toBeNull();
    expect(mockSaveSnapshot).toHaveBeenCalledWith('league-1', {
      draftSessionId: 'session-1',
      snapshotData: {
        teams: [],
        picks: [],
        leagueSettings: { rounds: 10, draftOrder: 'snake', completedAt: '' },
      },
    });
  });

  it('returns null snapshotId on API failure', async () => {
    mockSaveSnapshot.mockRejectedValue(new Error('Save failed'));

    const result = await DraftService.saveDraftSnapshot(
      'league-1',
      'session-1',
      [],
      [],
      { rounds: 10, draftOrder: 'snake', completedAt: '' }
    );

    expect(result.snapshotId).toBeNull();
    expect(result.error).toBeDefined();
  });
});

// =============================================================================
// Edge Cases — Autopick & Rankings
// =============================================================================

describe('DraftService Edge Cases', () => {
  it('handles empty league (no teams) in getDraftState', async () => {
    mockGetDraftPicks.mockResolvedValue({ data: [] });
    mockGetDraftOrder.mockResolvedValue({ data: null });

    const emptyTeams: any[] = [];
    const { state, error } = await DraftService.getDraftState('league-1', emptyTeams, 10, 'user-1');

    expect(state).toBeNull();
    expect(error).toBeDefined();
  });

  it('autopickForTeam returns error when API returns no player data', async () => {
    mockAutopick.mockRejectedValue(new Error('No available players for autopick'));

    const result = await DraftService.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);

    expect(result.playerId).toBeNull();
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain('No available players');
  });

  it('autopickForTeam returns player data on success', async () => {
    mockAutopick.mockResolvedValue({
      data: { playerId: 42, playerName: 'Connor McDavid', position: 'C', pickId: 'pick-uuid' },
    });

    const result = await DraftService.autopickForTeam('league-1', 'team-1', 'session-1', 1, 1);

    expect(result.playerId).toBe(42);
    expect(result.playerName).toBe('Connor McDavid');
    expect(result.position).toBe('C');
    expect(result.pickId).toBe('pick-uuid');
    expect(result.error).toBeNull();
  });

  it('runFullAutopickDraft returns picks from API', async () => {
    mockFullAutopick.mockResolvedValue({
      data: {
        picks: [
          { round: 1, pick: 1, teamId: 'team-1', playerId: 101, playerName: 'Player A' },
          { round: 1, pick: 2, teamId: 'team-2', playerId: 102, playerName: 'Player B' },
        ],
      },
    });

    const result = await DraftService.runFullAutopickDraft('league-1');

    expect(result.error).toBeNull();
    expect(result.picks).toHaveLength(2);
    expect(result.picks[0]).toEqual({
      round: 1,
      pick: 1,
      teamId: 'team-1',
      playerId: 101,
      playerName: 'Player A',
    });
  });

  it('runFullAutopickDraft returns empty array on API failure', async () => {
    mockFullAutopick.mockRejectedValue(new Error('RPC failed'));

    const result = await DraftService.runFullAutopickDraft('league-1');

    expect(result.picks).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('saveAutopickRankings calls API with correct params', async () => {
    mockSaveRankings.mockResolvedValue({ data: null });

    const rankings = [
      { playerId: 1, rank: 1, positionCode: 'C' },
      { playerId: 2, rank: 2, positionCode: 'LW' },
    ];

    const result = await DraftService.saveAutopickRankings('league-1', 'team-1', rankings);

    expect(result.error).toBeNull();
    expect(mockSaveRankings).toHaveBeenCalledWith('league-1', {
      teamId: 'team-1',
      rankings,
    });
  });

  it('saveAutopickRankings returns error when leagueId is null', async () => {
    const result = await DraftService.saveAutopickRankings(null, 'team-1', []);

    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toContain('leagueId is required');
    expect(mockSaveRankings).not.toHaveBeenCalled();
  });

  it('getAutopickRankings returns empty array on error', async () => {
    mockGetRankings.mockRejectedValue(new Error('Query failed'));

    const result = await DraftService.getAutopickRankings('league-1', 'team-1');

    expect(result.rankings).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('getAutopickRankings returns rankings from API', async () => {
    mockGetRankings.mockResolvedValue({
      data: [
        { playerId: 1, rank: 1, positionCode: 'C', tier: 1 },
        { playerId: 2, rank: 2, positionCode: 'LW', tier: 1 },
      ],
    });

    const result = await DraftService.getAutopickRankings('league-1', 'team-1');

    expect(result.rankings).toHaveLength(2);
    expect(result.error).toBeNull();
  });
});

// =============================================================================
// hardDeleteDraft
// =============================================================================

describe('DraftService.hardDeleteDraft', () => {
  it('returns no error on successful delete', async () => {
    mockHardDeleteDraft.mockResolvedValue({ data: null });

    const result = await DraftService.hardDeleteDraft('league-1');

    expect(result.error).toBeNull();
    expect(mockHardDeleteDraft).toHaveBeenCalledWith('league-1');
  });

  it('returns error on API failure', async () => {
    mockHardDeleteDraft.mockRejectedValue(new Error('Delete failed'));

    const result = await DraftService.hardDeleteDraft('league-1');

    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toBe('Delete failed');
  });
});

// =============================================================================
// subscribeToDraftPicks (still uses supabase realtime — keeps supabase mock)
// =============================================================================

describe('DraftService.subscribeToDraftPicks', () => {
  it('creates a channel subscription and returns unsubscribe function', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const mockChannelObj = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    };
    (supabase.channel as ReturnType<typeof vi.fn>).mockReturnValue(mockChannelObj);

    const callback = vi.fn();
    const unsubscribe = DraftService.subscribeToDraftPicks('league-1', 'user-1', callback);

    expect(typeof unsubscribe).toBe('function');
    expect(supabase.channel).toHaveBeenCalledWith('draft_picks:league-1');
    expect(mockChannelObj.on).toHaveBeenCalled();
    expect(mockChannelObj.subscribe).toHaveBeenCalled();
  });

  it('calls removeChannel when unsubscribe is invoked', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const mockChannelObj: Record<string, any> = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    };
    mockChannelObj.subscribe.mockReturnValue(mockChannelObj);
    (supabase.channel as ReturnType<typeof vi.fn>).mockReturnValue(mockChannelObj);

    const unsubscribe = DraftService.subscribeToDraftPicks('league-1', 'user-1', vi.fn());
    unsubscribe();

    expect(supabase.removeChannel).toHaveBeenCalledWith(mockChannelObj);
  });

  // Regression coverage for the reconnection UX: the draft room relies on
  // the onStatus callback to render the "reconnecting…" / "lost connection"
  // banner. If the service stops calling onStatus, the banner silently
  // disappears and users are back to the pre-playoff state where they had
  // no idea their draft was stalled.
  it('forwards channel lifecycle transitions to the optional onStatus callback', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let capturedSubscribeCallback: ((status: string) => void) | undefined;
    const mockChannelObj: Record<string, any> = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((cb: (status: string) => void) => {
        capturedSubscribeCallback = cb;
        return mockChannelObj;
      }),
    };
    (supabase.channel as ReturnType<typeof vi.fn>).mockReturnValue(mockChannelObj);

    const onStatus = vi.fn();
    DraftService.subscribeToDraftPicks('league-1', 'user-1', vi.fn(), undefined, onStatus);

    // Simulate the broker confirming the subscription.
    capturedSubscribeCallback?.('SUBSCRIBED');
    expect(onStatus).toHaveBeenCalledWith('connected');

    // Simulate a channel error — caller should see 'reconnecting' first
    // (the backoff kicks in inside the service).
    onStatus.mockClear();
    capturedSubscribeCallback?.('CHANNEL_ERROR');
    expect(onStatus).toHaveBeenCalledWith('reconnecting');
  });
});
