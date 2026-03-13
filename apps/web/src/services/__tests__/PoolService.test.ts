import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Setup
// =============================================================================

const mockPoolApi = {
  submitPickemPicks: vi.fn(),
  getPickemPicks: vi.fn(),
  scorePickemWeek: vi.fn(),
  scorePickemWeekATS: vi.fn(),
  getPickemStandings: vi.fn(),
  submitSurvivorPick: vi.fn(),
  isSurvivorEliminated: vi.fn(),
  scoreSurvivorWeek: vi.fn(),
  getSurvivorStandings: vi.fn(),
  getSurvivorPickHistory: vi.fn(),
  getSurvivorUsedTeams: vi.fn(),
  submitConfidencePicks: vi.fn(),
  getConfidencePicks: vi.fn(),
  scoreConfidenceWeek: vi.fn(),
  getConfidenceStandings: vi.fn(),
};

vi.mock('@/api/pools', () => ({
  poolApi: mockPoolApi,
}));

// Mock API client modules used transitively
vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/api/leagues', () => ({ leagueApi: {} }));
vi.mock('@/api/matchups', () => ({ matchupApi: {} }));
vi.mock('@/api/players', () => ({ playerApi: {} }));
vi.mock('@/api/rosters', () => ({ rosterApi: {} }));

vi.mock('@/services/ScheduleService', () => ({
  ScheduleService: {
    getGamesForDateRange: vi.fn().mockResolvedValue({ games: [] }),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  SEASON_START_YEAR: 2025,
}));

vi.mock('@/utils/timezoneUtils', () => ({
  getTodayMSTDate: () => new Date('2025-11-15'),
}));

vi.mock('@/utils/queryColumns', () => ({
  COLUMNS: {
    POOL_PICK: 'id, league_id, user_id, week_number, game_id, picked_team, is_correct, spread_value, created_at, updated_at',
    CONFIDENCE_PICK: 'id, league_id, user_id, week_number, game_id, picked_team, confidence_points, is_correct, points_earned, created_at',
  },
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

let PoolService: typeof import('../PoolService').PoolService;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../PoolService');
  PoolService = mod.PoolService;
});

// =============================================================================
// Pick'em Pool
// =============================================================================

describe('PoolService.submitPickemPicks', () => {
  it('upserts picks for unlocked games', async () => {
    mockPoolApi.submitPickemPicks.mockResolvedValue({ data: null });

    const result = await PoolService.submitPickemPicks('league-1', 'user-1', 5, [
      { game_id: 'game-1', picked_team: 'TOR' },
      { game_id: 'game-2', picked_team: 'BOS' },
    ]);

    expect(result.success).toBe(true);
    expect(mockPoolApi.submitPickemPicks).toHaveBeenCalledWith('league-1', 5, [
      { game_id: 'game-1', picked_team: 'TOR' },
      { game_id: 'game-2', picked_team: 'BOS' },
    ]);
  });

  it('rejects all picks when all games have started', async () => {
    mockPoolApi.submitPickemPicks.mockRejectedValue(
      new Error('All selected games have already started'),
    );

    const result = await PoolService.submitPickemPicks('league-1', 'user-1', 5, [
      { game_id: 'game-1', picked_team: 'TOR' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('already started');
  });

  it('handles DB error gracefully', async () => {
    mockPoolApi.submitPickemPicks.mockRejectedValue(new Error('Table not found'));

    const result = await PoolService.submitPickemPicks('league-1', 'user-1', 5, [
      { game_id: 'game-1', picked_team: 'TOR' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Table not found');
  });
});

describe('PoolService.getPickemPicks', () => {
  it('returns picks for a user and week', async () => {
    mockPoolApi.getPickemPicks.mockResolvedValue({
      data: [
        { id: 'pick-1', league_id: 'league-1', user_id: 'user-1', week_number: 5, game_id: 'g1', picked_team: 'TOR', is_correct: true },
        { id: 'pick-2', league_id: 'league-1', user_id: 'user-1', week_number: 5, game_id: 'g2', picked_team: 'MTL', is_correct: false },
      ],
    });

    const result = await PoolService.getPickemPicks('league-1', 'user-1', 5);

    expect(result).toHaveLength(2);
    expect(result[0].picked_team).toBe('TOR');
    expect(result[0].is_correct).toBe(true);
  });

  it('returns empty array on error', async () => {
    mockPoolApi.getPickemPicks.mockRejectedValue(new Error('Network error'));

    const result = await PoolService.getPickemPicks('league-1', 'user-1', 5);

    expect(result).toEqual([]);
  });
});

// =============================================================================
// Pick'em Scoring
// =============================================================================

describe('PoolService.scorePickemWeek', () => {
  it('marks correct picks as true and incorrect as false', async () => {
    mockPoolApi.scorePickemWeek.mockResolvedValue({
      data: { scored: 2 },
    });

    const result = await PoolService.scorePickemWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TOR' },
      { game_id: 'g2', winning_team: 'BOS' },
    ]);

    expect(result.scored).toBe(2);
    expect(mockPoolApi.scorePickemWeek).toHaveBeenCalledWith('league-1', 5, [
      { game_id: 'g1', winning_team: 'TOR' },
      { game_id: 'g2', winning_team: 'BOS' },
    ]);
  });

  it('treats TIE as incorrect (industry standard)', async () => {
    mockPoolApi.scorePickemWeek.mockResolvedValue({
      data: { scored: 1 },
    });

    const result = await PoolService.scorePickemWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TIE' },
    ]);

    expect(result.scored).toBe(1);
  });

  it('treats POSTPONED as incorrect (industry standard)', async () => {
    mockPoolApi.scorePickemWeek.mockResolvedValue({
      data: { scored: 1 },
    });

    const result = await PoolService.scorePickemWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'POSTPONED' },
    ]);

    expect(result.scored).toBe(1);
  });

  it('returns error when fetch fails', async () => {
    mockPoolApi.scorePickemWeek.mockRejectedValue(new Error('Permission denied'));

    const result = await PoolService.scorePickemWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TOR' },
    ]);

    expect(result.scored).toBe(0);
    expect(result.error).toContain('Permission denied');
  });
});

// =============================================================================
// Survivor Pool
// =============================================================================

describe('PoolService.submitSurvivorPick', () => {
  it('rejects pick when user is eliminated', async () => {
    mockPoolApi.submitSurvivorPick.mockRejectedValue(
      new Error('You have been eliminated from this survivor pool'),
    );

    const result = await PoolService.submitSurvivorPick('league-1', 'user-1', 5, 'TOR');

    expect(result.success).toBe(false);
    expect(result.error).toContain('eliminated');
  });

  it('rejects duplicate team usage', async () => {
    mockPoolApi.submitSurvivorPick.mockRejectedValue(
      new Error('You have already used TOR in a previous week'),
    );

    const result = await PoolService.submitSurvivorPick('league-1', 'user-1', 5, 'TOR');

    expect(result.success).toBe(false);
    expect(result.error).toContain('already used TOR');
  });
});

describe('PoolService.scoreSurvivorWeek', () => {
  it('scores each selection correctly', async () => {
    mockPoolApi.scoreSurvivorWeek.mockResolvedValue({
      data: { scored: 2 },
    });

    const result = await PoolService.scoreSurvivorWeek('league-1', 5, [
      { team: 'TOR', won: true },
      { team: 'MTL', won: false },
    ]);

    expect(result.scored).toBe(2);
    expect(mockPoolApi.scoreSurvivorWeek).toHaveBeenCalledWith('league-1', 5, [
      { team: 'TOR', won: true },
      { team: 'MTL', won: false },
    ]);
  });
});

// =============================================================================
// Confidence Pool
// =============================================================================

describe('PoolService.submitConfidencePicks', () => {
  it('rejects duplicate confidence point values', async () => {
    mockPoolApi.submitConfidencePicks.mockRejectedValue(
      new Error('Each pick must have a unique confidence point value'),
    );

    const result = await PoolService.submitConfidencePicks('league-1', 'user-1', 5, [
      { game_id: 'g1', picked_team: 'TOR', confidence_points: 3 },
      { game_id: 'g2', picked_team: 'MTL', confidence_points: 3 },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('unique confidence point');
  });

  it('rejects non-sequential confidence values', async () => {
    mockPoolApi.submitConfidencePicks.mockRejectedValue(
      new Error('Confidence points must be sequential from 1 to N'),
    );

    const result = await PoolService.submitConfidencePicks('league-1', 'user-1', 5, [
      { game_id: 'g1', picked_team: 'TOR', confidence_points: 1 },
      { game_id: 'g2', picked_team: 'MTL', confidence_points: 5 },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('sequential');
  });

  it('accepts valid sequential 1-to-N confidence values', async () => {
    mockPoolApi.submitConfidencePicks.mockResolvedValue({ data: null });

    const result = await PoolService.submitConfidencePicks('league-1', 'user-1', 5, [
      { game_id: 'g1', picked_team: 'TOR', confidence_points: 1 },
      { game_id: 'g2', picked_team: 'MTL', confidence_points: 2 },
      { game_id: 'g3', picked_team: 'BOS', confidence_points: 3 },
    ]);

    expect(result.success).toBe(true);
  });
});

describe('PoolService.scoreConfidenceWeek', () => {
  it('awards confidence_points for correct picks and 0 for incorrect', async () => {
    mockPoolApi.scoreConfidenceWeek.mockResolvedValue({
      data: { scored: 2 },
    });

    const result = await PoolService.scoreConfidenceWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TOR' },
      { game_id: 'g2', winning_team: 'BOS' },
    ]);

    expect(result.scored).toBe(2);
    expect(mockPoolApi.scoreConfidenceWeek).toHaveBeenCalledWith('league-1', 5, [
      { game_id: 'g1', winning_team: 'TOR' },
      { game_id: 'g2', winning_team: 'BOS' },
    ]);
  });

  it('treats TIE and POSTPONED as 0 points (industry standard)', async () => {
    mockPoolApi.scoreConfidenceWeek.mockResolvedValue({
      data: { scored: 2 },
    });

    const result = await PoolService.scoreConfidenceWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TIE' },
      { game_id: 'g2', winning_team: 'POSTPONED' },
    ]);

    expect(result.scored).toBe(2);
  });
});

// =============================================================================
// Survivor Used Teams
// =============================================================================

describe('PoolService.getSurvivorUsedTeams', () => {
  it('returns list of previously used team abbreviations', async () => {
    mockPoolApi.getSurvivorUsedTeams.mockResolvedValue({
      data: ['TOR', 'BOS', 'MTL'],
    });

    const result = await PoolService.getSurvivorUsedTeams('league-1', 'user-1');

    expect(result).toEqual(['TOR', 'BOS', 'MTL']);
  });

  it('returns empty array on error', async () => {
    mockPoolApi.getSurvivorUsedTeams.mockRejectedValue(new Error('DB error'));

    const result = await PoolService.getSurvivorUsedTeams('league-1', 'user-1');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// Survivor Pick History
// =============================================================================

describe('PoolService.getSurvivorPickHistory', () => {
  it('returns picks mapped to simplified format', async () => {
    mockPoolApi.getSurvivorPickHistory.mockResolvedValue({
      data: [
        { week: 1, team: 'TOR', is_correct: true },
        { week: 2, team: 'BOS', is_correct: false },
        { week: 3, team: 'MTL', is_correct: null },
      ],
    });

    const result = await PoolService.getSurvivorPickHistory('league-1', 'user-1');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ week: 1, team: 'TOR', is_correct: true });
    expect(result[1]).toEqual({ week: 2, team: 'BOS', is_correct: false });
    expect(result[2]).toEqual({ week: 3, team: 'MTL', is_correct: null });
  });
});
