import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Setup
// =============================================================================

function createChainableMock() {
  const chain: Record<string, any> = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'not', 'is', 'in', 'order', 'limit', 'filter'];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

let mockChain = createChainableMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

// Mock API client modules used transitively
vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/api/leagues', () => ({ leagueApi: {} }));
vi.mock('@/api/matchups', () => ({ matchupApi: {} }));
vi.mock('@/api/players', () => ({ playerApi: {} }));
vi.mock('@/api/rosters', () => ({ rosterApi: {} }));

vi.mock('../ScheduleService', () => ({
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
  mockChain = createChainableMock();
  const mod = await import('../PoolService');
  PoolService = mod.PoolService;

  const { supabase } = await import('@/integrations/supabase/client');
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
});

// =============================================================================
// Pick'em Pool
// =============================================================================

describe('PoolService.submitPickemPicks', () => {
  it('upserts picks for unlocked games', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const { ScheduleService } = await import('../ScheduleService');

    // All games are not started (future dates)
    (ScheduleService.getGamesForDateRange as ReturnType<typeof vi.fn>).mockResolvedValue({
      games: [
        { id: 'game-1', home_team: 'TOR', away_team: 'MTL', status: 'scheduled', game_date: '2099-12-31', game_time: '23:00:00' },
        { id: 'game-2', home_team: 'BOS', away_team: 'NYR', status: 'scheduled', game_date: '2099-12-31', game_time: '23:00:00' },
      ],
    });

    let upsertedData: any = null;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'pool_picks') {
        chain.upsert.mockImplementation((data: any) => {
          upsertedData = data;
          // upsert() is a terminal call — returns { data, error } directly
          return Promise.resolve({ data: null, error: null });
        });
      }
      return chain;
    });

    const result = await PoolService.submitPickemPicks('league-1', 'user-1', 5, [
      { game_id: 'game-1', picked_team: 'TOR' },
      { game_id: 'game-2', picked_team: 'BOS' },
    ]);

    expect(result.success).toBe(true);
    expect(upsertedData).not.toBeNull();
    expect(upsertedData).toHaveLength(2);
    expect(upsertedData[0].picked_team).toBe('TOR');
    expect(upsertedData[0].is_correct).toBeNull(); // Not yet scored
  });

  it('rejects all picks when all games have started', async () => {
    const { ScheduleService } = await import('../ScheduleService');

    (ScheduleService.getGamesForDateRange as ReturnType<typeof vi.fn>).mockResolvedValue({
      games: [
        { id: 'game-1', home_team: 'TOR', away_team: 'MTL', status: 'live', game_date: '2026-01-15', game_time: '19:00:00' },
      ],
    });

    const result = await PoolService.submitPickemPicks('league-1', 'user-1', 5, [
      { game_id: 'game-1', picked_team: 'TOR' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('already started');
  });

  it('handles DB error gracefully', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const { ScheduleService } = await import('../ScheduleService');

    (ScheduleService.getGamesForDateRange as ReturnType<typeof vi.fn>).mockResolvedValue({
      games: [],
    });

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const chain = createChainableMock();
      chain.upsert.mockResolvedValue({ data: null, error: { message: 'Table not found' } });
      return chain;
    });

    const result = await PoolService.submitPickemPicks('league-1', 'user-1', 5, [
      { game_id: 'game-1', picked_team: 'TOR' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Table not found');
  });
});

describe('PoolService.getPickemPicks', () => {
  it('returns picks for a user and week', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'pool_picks') {
        chain.order.mockResolvedValue({
          data: [
            { id: 'pick-1', league_id: 'league-1', user_id: 'user-1', week_number: 5, game_id: 'g1', picked_team: 'TOR', is_correct: true },
            { id: 'pick-2', league_id: 'league-1', user_id: 'user-1', week_number: 5, game_id: 'g2', picked_team: 'MTL', is_correct: false },
          ],
          error: null,
        });
      }
      return chain;
    });

    const result = await PoolService.getPickemPicks('league-1', 'user-1', 5);

    expect(result).toHaveLength(2);
    expect(result[0].picked_team).toBe('TOR');
    expect(result[0].is_correct).toBe(true);
  });

  it('returns empty array on error', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Network error');
    });

    const result = await PoolService.getPickemPicks('league-1', 'user-1', 5);

    expect(result).toEqual([]);
  });
});

// =============================================================================
// Pick'em Scoring
// =============================================================================

describe('PoolService.scorePickemWeek', () => {
  it('marks correct picks as true and incorrect as false', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const updateCalls: Array<{ id: string; is_correct: boolean }> = [];

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'pool_picks') {
        // First call: fetch picks
        chain.eq.mockReturnValue(chain);
        chain.select.mockReturnValue(chain);

        // Simulate fetching picks and then updating them
        // The service calls .select().eq().eq() first (returns picks),
        // then calls .update().eq() for each pick.
        const picks = [
          { id: 'pick-1', game_id: 'g1', picked_team: 'TOR', spread_value: null },
          { id: 'pick-2', game_id: 'g2', picked_team: 'MTL', spread_value: null },
        ];

        // Terminal eq resolves with picks data
        let eqCallCount = 0;
        chain.eq.mockImplementation((...args: any[]) => {
          eqCallCount++;
          if (eqCallCount === 2) {
            // After league_id + week_number eq: return picks
            return Promise.resolve({ data: picks, error: null });
          }
          return chain;
        });

        chain.update.mockImplementation((data: any) => {
          updateCalls.push(data);
          const updateChain = createChainableMock();
          updateChain.eq.mockResolvedValue({ data: null, error: null });
          return updateChain;
        });
      }
      return chain;
    });

    const result = await PoolService.scorePickemWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TOR' },
      { game_id: 'g2', winning_team: 'BOS' }, // MTL picked but BOS won
    ]);

    expect(result.scored).toBe(2);
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0].is_correct).toBe(true);  // TOR picked, TOR won
    expect(updateCalls[1].is_correct).toBe(false); // MTL picked, BOS won
  });

  it('treats TIE as incorrect (industry standard)', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const updateCalls: Array<{ is_correct: boolean }> = [];

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'pool_picks') {
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount === 2) {
            return Promise.resolve({
              data: [{ id: 'pick-1', game_id: 'g1', picked_team: 'TOR', spread_value: null }],
              error: null,
            });
          }
          return chain;
        });

        chain.update.mockImplementation((data: any) => {
          updateCalls.push(data);
          const updateChain = createChainableMock();
          updateChain.eq.mockResolvedValue({ data: null, error: null });
          return updateChain;
        });
      }
      return chain;
    });

    const result = await PoolService.scorePickemWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TIE' },
    ]);

    expect(result.scored).toBe(1);
    expect(updateCalls[0].is_correct).toBe(false); // Tie = incorrect
  });

  it('treats POSTPONED as incorrect (industry standard)', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const updateCalls: Array<{ is_correct: boolean }> = [];

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'pool_picks') {
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount === 2) {
            return Promise.resolve({
              data: [{ id: 'pick-1', game_id: 'g1', picked_team: 'TOR', spread_value: null }],
              error: null,
            });
          }
          return chain;
        });

        chain.update.mockImplementation((data: any) => {
          updateCalls.push(data);
          const updateChain = createChainableMock();
          updateChain.eq.mockResolvedValue({ data: null, error: null });
          return updateChain;
        });
      }
      return chain;
    });

    const result = await PoolService.scorePickemWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'POSTPONED' },
    ]);

    expect(result.scored).toBe(1);
    expect(updateCalls[0].is_correct).toBe(false); // Postponed = incorrect
  });

  it('returns error when fetch fails', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'pool_picks') {
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount === 2) {
            return Promise.resolve({
              data: null,
              error: { message: 'Permission denied' },
            });
          }
          return chain;
        });
      }
      return chain;
    });

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
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { survivorLives: 1 } },
          error: null,
        });
      }
      if (table === 'survivor_selections') {
        // isSurvivorEliminated: .select('id', {count, head}).eq().eq().eq()
        // 3rd .eq() is terminal and returns count
        let eqCount = 0;
        chain.eq.mockImplementation(() => {
          eqCount++;
          if (eqCount >= 3) {
            return Promise.resolve({ count: 1, data: null, error: null });
          }
          return chain;
        });
      }
      return chain;
    });

    const result = await PoolService.submitSurvivorPick('league-1', 'user-1', 5, 'TOR');

    expect(result.success).toBe(false);
    expect(result.error).toContain('eliminated');
  });

  it('rejects duplicate team usage', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const { ScheduleService } = await import('../ScheduleService');

    (ScheduleService.getGamesForDateRange as ReturnType<typeof vi.fn>).mockResolvedValue({
      games: [
        { id: 'g1', home_team: 'TOR', away_team: 'MTL', status: 'scheduled', game_date: '2099-12-31', game_time: '23:00:00' },
      ],
    });

    let survivorCallCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { survivorLives: 3 } },
          error: null,
        });
      }
      if (table === 'survivor_selections') {
        survivorCallCount++;
        if (survivorCallCount === 1) {
          // isSurvivorEliminated: .select('id', {count:'exact', head:true}).eq().eq().eq()
          // Terminal eq returns count
          let eqCount = 0;
          chain.eq.mockImplementation(() => {
            eqCount++;
            if (eqCount >= 3) {
              return Promise.resolve({ count: 0, data: null, error: null });
            }
            return chain;
          });
        } else if (survivorCallCount === 2) {
          // Previous picks: .select('picked_team').eq().eq()
          let eqCount = 0;
          chain.eq.mockImplementation(() => {
            eqCount++;
            if (eqCount >= 2) {
              return Promise.resolve({
                data: [{ picked_team: 'TOR' }, { picked_team: 'BOS' }],
                error: null,
              });
            }
            return chain;
          });
        }
      }
      return chain;
    });

    const result = await PoolService.submitSurvivorPick('league-1', 'user-1', 5, 'TOR');

    expect(result.success).toBe(false);
    expect(result.error).toContain('already used TOR');
  });
});

describe('PoolService.scoreSurvivorWeek', () => {
  it('scores each selection correctly', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const updateCalls: Array<{ is_correct: boolean }> = [];

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'survivor_selections') {
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount === 2) {
            return Promise.resolve({
              data: [
                { id: 'sel-1', picked_team: 'TOR' },
                { id: 'sel-2', picked_team: 'MTL' },
              ],
              error: null,
            });
          }
          return chain;
        });

        chain.update.mockImplementation((data: any) => {
          updateCalls.push(data);
          const updateChain = createChainableMock();
          updateChain.eq.mockResolvedValue({ data: null, error: null });
          return updateChain;
        });
      }
      return chain;
    });

    const result = await PoolService.scoreSurvivorWeek('league-1', 5, [
      { team: 'TOR', won: true },
      { team: 'MTL', won: false },
    ]);

    expect(result.scored).toBe(2);
    expect(updateCalls[0].is_correct).toBe(true);  // TOR won
    expect(updateCalls[1].is_correct).toBe(false); // MTL lost
  });
});

// =============================================================================
// Confidence Pool
// =============================================================================

describe('PoolService.submitConfidencePicks', () => {
  it('rejects duplicate confidence point values', async () => {
    const { ScheduleService } = await import('../ScheduleService');

    (ScheduleService.getGamesForDateRange as ReturnType<typeof vi.fn>).mockResolvedValue({
      games: [], // No games to lock
    });

    const result = await PoolService.submitConfidencePicks('league-1', 'user-1', 5, [
      { game_id: 'g1', picked_team: 'TOR', confidence_points: 3 },
      { game_id: 'g2', picked_team: 'MTL', confidence_points: 3 }, // Duplicate!
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('unique confidence point');
  });

  it('rejects non-sequential confidence values', async () => {
    const { ScheduleService } = await import('../ScheduleService');

    (ScheduleService.getGamesForDateRange as ReturnType<typeof vi.fn>).mockResolvedValue({
      games: [],
    });

    const result = await PoolService.submitConfidencePicks('league-1', 'user-1', 5, [
      { game_id: 'g1', picked_team: 'TOR', confidence_points: 1 },
      { game_id: 'g2', picked_team: 'MTL', confidence_points: 5 }, // Should be 2, not 5
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('sequential');
  });

  it('accepts valid sequential 1-to-N confidence values', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const { ScheduleService } = await import('../ScheduleService');

    (ScheduleService.getGamesForDateRange as ReturnType<typeof vi.fn>).mockResolvedValue({
      games: [],
    });

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'confidence_picks') {
        chain.upsert.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

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
    const { supabase } = await import('@/integrations/supabase/client');

    const updateCalls: Array<{ is_correct: boolean; points_earned: number }> = [];

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'confidence_picks') {
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount === 2) {
            return Promise.resolve({
              data: [
                { id: 'cp-1', game_id: 'g1', picked_team: 'TOR', confidence_points: 5 },
                { id: 'cp-2', game_id: 'g2', picked_team: 'MTL', confidence_points: 3 },
              ],
              error: null,
            });
          }
          return chain;
        });

        chain.update.mockImplementation((data: any) => {
          updateCalls.push(data);
          const updateChain = createChainableMock();
          updateChain.eq.mockResolvedValue({ data: null, error: null });
          return updateChain;
        });
      }
      return chain;
    });

    const result = await PoolService.scoreConfidenceWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TOR' },  // Correct — earns 5 pts
      { game_id: 'g2', winning_team: 'BOS' },  // Wrong — earns 0 pts
    ]);

    expect(result.scored).toBe(2);
    expect(updateCalls[0].is_correct).toBe(true);
    expect(updateCalls[0].points_earned).toBe(5);
    expect(updateCalls[1].is_correct).toBe(false);
    expect(updateCalls[1].points_earned).toBe(0);
  });

  it('treats TIE and POSTPONED as 0 points (industry standard)', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const updateCalls: Array<{ is_correct: boolean; points_earned: number }> = [];

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'confidence_picks') {
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount === 2) {
            return Promise.resolve({
              data: [
                { id: 'cp-1', game_id: 'g1', picked_team: 'TOR', confidence_points: 5 },
                { id: 'cp-2', game_id: 'g2', picked_team: 'MTL', confidence_points: 4 },
              ],
              error: null,
            });
          }
          return chain;
        });

        chain.update.mockImplementation((data: any) => {
          updateCalls.push(data);
          const updateChain = createChainableMock();
          updateChain.eq.mockResolvedValue({ data: null, error: null });
          return updateChain;
        });
      }
      return chain;
    });

    await PoolService.scoreConfidenceWeek('league-1', 5, [
      { game_id: 'g1', winning_team: 'TIE' },
      { game_id: 'g2', winning_team: 'POSTPONED' },
    ]);

    expect(updateCalls[0].is_correct).toBe(false);
    expect(updateCalls[0].points_earned).toBe(0);
    expect(updateCalls[1].is_correct).toBe(false);
    expect(updateCalls[1].points_earned).toBe(0);
  });
});

// =============================================================================
// Survivor Used Teams
// =============================================================================

describe('PoolService.getSurvivorUsedTeams', () => {
  it('returns list of previously used team abbreviations', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'survivor_selections') {
        // .select('picked_team').eq('league_id', ...).eq('user_id', ...)
        // The second .eq() is the terminal call, so it must resolve
        let eqCount = 0;
        chain.eq.mockImplementation(() => {
          eqCount++;
          if (eqCount >= 2) {
            return Promise.resolve({
              data: [{ picked_team: 'TOR' }, { picked_team: 'BOS' }, { picked_team: 'MTL' }],
              error: null,
            });
          }
          return chain;
        });
      }
      return chain;
    });

    const result = await PoolService.getSurvivorUsedTeams('league-1', 'user-1');

    expect(result).toEqual(['TOR', 'BOS', 'MTL']);
  });

  it('returns empty array on error', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB error');
    });

    const result = await PoolService.getSurvivorUsedTeams('league-1', 'user-1');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// Survivor Pick History
// =============================================================================

describe('PoolService.getSurvivorPickHistory', () => {
  it('returns picks mapped to simplified format', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'survivor_selections') {
        // .select().eq().eq().order() — order() is terminal
        chain.order.mockResolvedValue({
          data: [
            { week_number: 1, picked_team: 'TOR', is_correct: true },
            { week_number: 2, picked_team: 'BOS', is_correct: false },
            { week_number: 3, picked_team: 'MTL', is_correct: null },
          ],
          error: null,
        });
      }
      return chain;
    });

    const result = await PoolService.getSurvivorPickHistory('league-1', 'user-1');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ week: 1, team: 'TOR', is_correct: true });
    expect(result[1]).toEqual({ week: 2, team: 'BOS', is_correct: false });
    expect(result[2]).toEqual({ week: 3, team: 'MTL', is_correct: null });
  });
});
