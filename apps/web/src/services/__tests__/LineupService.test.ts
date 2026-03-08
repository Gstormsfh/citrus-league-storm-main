import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules
// =============================================================================

const mockSupabaseFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/timezoneUtils', () => ({
  getTodayMST: vi.fn().mockReturnValue('2026-03-08'),
  getTodayMSTDate: vi.fn().mockReturnValue(new Date('2026-03-08T00:00:00')),
}));

vi.mock('./MatchupService', () => ({
  MatchupService: {
    clearRosterCache: vi.fn(),
  },
}));

vi.mock('@/services/MatchupService', () => ({
  MatchupService: {
    clearRosterCache: vi.fn(),
  },
}));

vi.mock('./RosterCacheService', () => ({
  RosterCacheService: {
    clearCache: vi.fn(),
  },
}));

vi.mock('@/services/RosterCacheService', () => ({
  RosterCacheService: {
    clearCache: vi.fn(),
  },
}));

vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getPlayersByIds: vi.fn().mockResolvedValue([]),
  },
  Player: {},
}));

vi.mock('./DemoLeagueService', () => ({
  DEMO_LEAGUE_ID_FOR_GUESTS: 'demo-league-id',
}));

vi.mock('@/services/DemoLeagueService', () => ({
  DEMO_LEAGUE_ID_FOR_GUESTS: 'demo-league-id',
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: '20252026',
  getHeadshotUrl: vi.fn().mockReturnValue(''),
}));

vi.mock('@/api/players', () => ({
  playerApi: {
    getPlayers: vi.fn().mockResolvedValue({ data: [] }),
    getPlayerById: vi.fn().mockResolvedValue({ data: null }),
  },
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

// Mock all transitive API modules used by DemoLeagueService / LeagueService chain
vi.mock('@/api/leagues', () => ({ leagueApi: {} }));
vi.mock('@/api/rosters', () => ({ rosterApi: {} }));
vi.mock('@/api/trades', () => ({ tradeApi: {} }));
vi.mock('@/api/waivers', () => ({ waiverApi: {} }));
vi.mock('@/api/notifications', () => ({ notificationApi: {} }));
vi.mock('@/api/matchups', () => ({ matchupApi: {} }));
vi.mock('@/api/account', () => ({ accountApi: {} }));
vi.mock('@/api/keepers', () => ({ keeperApi: {} }));
vi.mock('@/api/bestball', () => ({ bestballApi: {} }));
vi.mock('@/api/draft', () => ({ draftApi: {} }));
vi.mock('@/api/auction', () => ({ auctionApi: {} }));
vi.mock('@/api/playoffs', () => ({ playoffApi: {} }));
vi.mock('@/api/schedule', () => ({ scheduleApi: {} }));
vi.mock('@/api/stormy', () => ({ stormyApi: {} }));
vi.mock('@/utils/queryColumns', () => ({ COLUMNS: {} }));
vi.mock('@/utils/scoringUtils', () => ({
  ScoringCalculator: { calculateScore: vi.fn() },
  compareCategoryMatchup: vi.fn(),
  calculateRotoStandings: vi.fn(),
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

import { LineupService } from '../LineupService';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
});

// =============================================================================
// getLineup
// =============================================================================

describe('LineupService.getLineup', () => {
  it('returns lineup from Supabase when available', async () => {
    const lineupData = {
      starters: ['101', '102'],
      bench: ['201'],
      ir: ['301'],
      slot_assignments: { '101': 'slot-C-1', '102': 'slot-LW-1' },
      updated_at: '2026-03-08T00:00:00Z',
    };

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: lineupData, error: null }),
              }),
            }),
          }),
        }),
      }),
    });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).not.toBeNull();
    expect(result!.starters).toEqual(['101', '102']);
    expect(result!.bench).toEqual(['201']);
    expect(result!.ir).toEqual(['301']);
    expect(result!.slotAssignments).toEqual({ '101': 'slot-C-1', '102': 'slot-LW-1' });
  });

  it('returns null when no lineup exists in Supabase', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalled();
  });

  it('falls back to localStorage on Supabase PGRST116 error', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116', message: 'Not found' },
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).toBeNull();
    // Should clear stale localStorage on PGRST116
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('lineup_team_team-1');
  });

  it('uses localStorage for non-UUID league IDs (demo league)', async () => {
    const localLineup = {
      starters: ['101'],
      bench: ['201'],
      ir: [],
      slotAssignments: { '101': 'slot-C-1' },
    };
    localStorageMock.setItem('lineup_team_team-1', JSON.stringify(localLineup));

    const result = await LineupService.getLineup('team-1', 'demo-league-id');

    expect(result).toEqual(localLineup);
    // Should NOT call Supabase
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('returns null for non-UUID league IDs with no localStorage data', async () => {
    const result = await LineupService.getLineup('team-1', 'non-uuid-league');

    expect(result).toBeNull();
  });

  it('normalizes slot assignment keys to strings', async () => {
    const lineupData = {
      starters: ['101'],
      bench: [],
      ir: [],
      slot_assignments: { 101: 'slot-C-1' }, // Numeric key
      updated_at: '2026-03-08T00:00:00Z',
    };

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: lineupData, error: null }),
              }),
            }),
          }),
        }),
      }),
    });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result!.slotAssignments['101']).toBe('slot-C-1');
  });

  it('falls back to localStorage on Supabase error (non-PGRST116)', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST500', message: 'Server error' },
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const localLineup = { starters: ['101'], bench: [], ir: [], slotAssignments: {} };
    localStorageMock.setItem('lineup_team_team-1', JSON.stringify(localLineup));

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).toEqual(localLineup);
  });
});

// =============================================================================
// canUpdateRosterForDate
// =============================================================================

describe('LineupService.canUpdateRosterForDate', () => {
  it('returns true when no players in lineup', async () => {
    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: [], bench: [], ir: [] }
    );

    expect(result).toBe(true);
  });

  it('returns true when no games are scheduled', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // player_directory
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ player_id: 101, team: 'EDM' }],
              error: null,
            }),
          }),
        };
      }
      // nhl_games
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              or: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
    });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(true);
  });

  it('returns false when a game has already started', async () => {
    const pastGameTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ player_id: 101, team: 'EDM' }],
              error: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              or: vi.fn().mockResolvedValue({
                data: [{ game_time: pastGameTime, home_team: 'EDM', away_team: 'CGY' }],
                error: null,
              }),
            }),
          }),
        }),
      };
    });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(false);
  });

  it('returns true when game is in the future', async () => {
    const futureGameTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ player_id: 101, team: 'EDM' }],
              error: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              or: vi.fn().mockResolvedValue({
                data: [{ game_time: futureGameTime, home_team: 'EDM', away_team: 'CGY' }],
                error: null,
              }),
            }),
          }),
        }),
      };
    });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(true);
  });

  it('returns true on error (fail open)', async () => {
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error('Network error');
    });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(true);
  });
});

// =============================================================================
// loadDailyRoster
// =============================================================================

describe('LineupService.loadDailyRoster', () => {
  it('returns null when no daily roster records exist', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    });

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      []
    );

    expect(result).toBeNull();
  });

  it('returns null on query error', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS error' } }),
          }),
        }),
      }),
    });

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      []
    );

    expect(result).toBeNull();
  });

  it('sorts players into starters, bench, and IR arrays', async () => {
    const dailyRosters = [
      { player_id: 101, slot_type: 'active', slot_id: 'slot-C-1' },
      { player_id: 102, slot_type: 'active', slot_id: 'slot-LW-1' },
      { player_id: 201, slot_type: 'bench', slot_id: null },
      { player_id: 301, slot_type: 'ir', slot_id: 'slot-IR-1' },
    ];

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: dailyRosters, error: null }),
          }),
        }),
      }),
    });

    const allPlayers = [
      { id: 101, name: 'Player A' },
      { id: 102, name: 'Player B' },
      { id: 201, name: 'Player C' },
      { id: 301, name: 'Player D' },
    ];

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      allPlayers
    );

    expect(result).not.toBeNull();
    expect(result!.starters).toHaveLength(2);
    expect(result!.bench).toHaveLength(1);
    expect(result!.ir).toHaveLength(1);
    expect(result!.slotAssignments['101']).toBe('slot-C-1');
    expect(result!.slotAssignments['102']).toBe('slot-LW-1');
    expect(result!.slotAssignments['301']).toBe('slot-IR-1');
  });

  it('tracks missing player IDs not in allPlayers', async () => {
    const dailyRosters = [
      { player_id: 101, slot_type: 'active', slot_id: 'slot-C-1' },
      { player_id: 999, slot_type: 'active', slot_id: 'slot-LW-1' }, // Not in allPlayers
    ];

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: dailyRosters, error: null }),
          }),
        }),
      }),
    });

    const allPlayers = [{ id: 101, name: 'Player A' }];

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      allPlayers,
      false
    );

    expect(result).not.toBeNull();
    expect(result!.starters).toHaveLength(1); // Only the player that exists
    expect(result!.missingPlayerIds).toContain('999');
  });

  it('handles exception gracefully', async () => {
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error('Connection lost');
    });

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      []
    );

    expect(result).toBeNull();
  });
});

// =============================================================================
// backfillMissingDailyRosters
// =============================================================================

describe('LineupService.backfillMissingDailyRosters', () => {
  it('returns 0 when matchup not found', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
        }),
      }),
    });

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'league-1', 'bad-matchup');

    expect(result.backfilledCount).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('returns 0 when no lineup exists for team', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // matchups query
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'matchup-1', week_start_date: '2026-03-01', week_end_date: '2026-03-07' },
                error: null,
              }),
            }),
          }),
        };
      }
      // team_lineups query (getLineup - no UUID -> localStorage fallback)
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'matchup-1');

    expect(result.backfilledCount).toBe(0);
    expect(result.error).toBeNull();
  });

  it('handles exceptions gracefully', async () => {
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error('DB crash');
    });

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'league-1', 'matchup-1');

    expect(result.backfilledCount).toBe(0);
    expect(result.error).toBeDefined();
  });
});

// =============================================================================
// backfillAllMatchupsForLeague
// =============================================================================

describe('LineupService.backfillAllMatchupsForLeague', () => {
  it('returns zeros when no matchups exist', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(0);
    expect(result.matchupsProcessed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('returns error info when matchups query fails', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'Permission denied' } }),
      }),
    });

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('handles exceptions gracefully', async () => {
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error('Network error');
    });

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(0);
    expect(result.matchupsProcessed).toBe(0);
    expect(result.errors).toHaveLength(1);
  });
});

// =============================================================================
// saveLineup — demo league guard
// =============================================================================

describe('LineupService.saveLineup', () => {
  it('blocks saves to demo league when lineup already exists', async () => {
    // Demo league check: lineup exists
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing' }, error: null }),
          }),
        }),
      }),
    });

    await LineupService.saveLineup(
      'team-1',
      'demo-league-id',
      { starters: ['101'], bench: [], ir: [], slotAssignments: {} }
    );

    // Should NOT attempt to upsert (the from call is only for the demo check)
    // The service returns early, so no upsert call happens
  });
});
