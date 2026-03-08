import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules — must be hoisted before imports
// =============================================================================

// Chainable Supabase mock (same pattern as MatchupService.test.ts)
function createChainMock(defaultResolve: { data: any; error: any } = { data: null, error: null }) {
  const chain: Record<string, any> = {};
  chain._resolve = defaultResolve;
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gte', 'gt', 'lt', 'is', 'in', 'or', 'order', 'limit', 'filter',
  ];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.then = (resolve: any, reject?: any) => Promise.resolve(chain._resolve).then(resolve, reject);
  return chain;
}

let defaultChain = createChainMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => defaultChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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

// Mock relative imports used by LineupService
vi.mock('../MatchupService', () => ({
  MatchupService: {
    clearRosterCache: vi.fn(),
    getTeamRoster: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../RosterCacheService', () => ({
  RosterCacheService: {
    clearCache: vi.fn(),
  },
}));

vi.mock('../DemoLeagueService', () => ({
  DEMO_LEAGUE_ID_FOR_GUESTS: 'demo-league-id',
}));

// Mock @/services/PlayerService (used by LineupService with @ path)
vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getPlayersByIds: vi.fn().mockResolvedValue([]),
    getAllPlayers: vi.fn().mockResolvedValue([]),
  },
  Player: {},
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

import { LineupService } from '../LineupService';
import { supabase } from '@/integrations/supabase/client';

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
  defaultChain = createChainMock();
  (supabase.from as any).mockReturnValue(defaultChain);
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
    defaultChain.maybeSingle = vi.fn().mockResolvedValue({ data: lineupData, error: null });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).not.toBeNull();
    expect(result!.starters).toEqual(['101', '102']);
    expect(result!.bench).toEqual(['201']);
    expect(result!.ir).toEqual(['301']);
    expect(result!.slotAssignments).toEqual({ '101': 'slot-C-1', '102': 'slot-LW-1' });
  });

  it('returns null when no lineup exists in Supabase', async () => {
    defaultChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalled();
  });

  it('clears localStorage on Supabase PGRST116 error and returns null', async () => {
    defaultChain.maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'Not found' },
    });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).toBeNull();
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
    expect(supabase.from).not.toHaveBeenCalled();
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
    defaultChain.maybeSingle = vi.fn().mockResolvedValue({ data: lineupData, error: null });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result!.slotAssignments['101']).toBe('slot-C-1');
  });

  it('falls back to localStorage on Supabase error (non-PGRST116)', async () => {
    defaultChain.maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST500', message: 'Server error' },
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
    // First call: player_directory -> returns player
    // Second call: nhl_games -> returns empty
    let callCount = 0;
    (supabase.from as any).mockImplementation(() => {
      callCount++;
      const chain = createChainMock();
      if (callCount === 1) {
        chain._resolve = { data: [{ player_id: 101, team: 'EDM' }], error: null };
      } else {
        chain._resolve = { data: [], error: null };
      }
      return chain;
    });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(true);
  });

  it('returns false when a game has already started', async () => {
    const pastGameTime = new Date(Date.now() - 3600000).toISOString();

    let callCount = 0;
    (supabase.from as any).mockImplementation(() => {
      callCount++;
      const chain = createChainMock();
      if (callCount === 1) {
        chain._resolve = { data: [{ player_id: 101, team: 'EDM' }], error: null };
      } else {
        chain._resolve = {
          data: [{ game_time: pastGameTime, home_team: 'EDM', away_team: 'CGY' }],
          error: null,
        };
      }
      return chain;
    });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(false);
  });

  it('returns true when game is in the future', async () => {
    const futureGameTime = new Date(Date.now() + 3600000).toISOString();

    let callCount = 0;
    (supabase.from as any).mockImplementation(() => {
      callCount++;
      const chain = createChainMock();
      if (callCount === 1) {
        chain._resolve = { data: [{ player_id: 101, team: 'EDM' }], error: null };
      } else {
        chain._resolve = {
          data: [{ game_time: futureGameTime, home_team: 'EDM', away_team: 'CGY' }],
          error: null,
        };
      }
      return chain;
    });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(true);
  });

  it('returns true on error (fail open)', async () => {
    (supabase.from as any).mockImplementation(() => {
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
    defaultChain._resolve = { data: [], error: null };

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      []
    );

    expect(result).toBeNull();
  });

  it('returns null on query error', async () => {
    defaultChain._resolve = { data: null, error: { message: 'RLS error' } };

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
    defaultChain._resolve = { data: dailyRosters, error: null };

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
      { player_id: 999, slot_type: 'active', slot_id: 'slot-LW-1' },
    ];
    defaultChain._resolve = { data: dailyRosters, error: null };

    const allPlayers = [{ id: 101, name: 'Player A' }];

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      allPlayers,
      false
    );

    expect(result).not.toBeNull();
    expect(result!.starters).toHaveLength(1);
    expect(result!.missingPlayerIds).toContain('999');
  });

  it('handles exception gracefully', async () => {
    (supabase.from as any).mockImplementation(() => {
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
    defaultChain.single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'league-1', 'bad-matchup');

    expect(result.backfilledCount).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('returns 0 when no lineup exists for team', async () => {
    // matchup found
    defaultChain.single = vi.fn().mockResolvedValue({
      data: { id: 'matchup-1', week_start_date: '2026-03-01', week_end_date: '2026-03-07' },
      error: null,
    });
    // getLineup -> no data
    defaultChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await LineupService.backfillMissingDailyRosters(
      'team-1',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'matchup-1'
    );

    expect(result.backfilledCount).toBe(0);
    expect(result.error).toBeNull();
  });

  it('handles exceptions gracefully', async () => {
    (supabase.from as any).mockImplementation(() => {
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
    defaultChain._resolve = { data: [], error: null };

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(0);
    expect(result.matchupsProcessed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('returns error info when matchups query fails', async () => {
    defaultChain._resolve = { data: null, error: { message: 'Permission denied' } };

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('handles exceptions gracefully', async () => {
    (supabase.from as any).mockImplementation(() => {
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
    defaultChain.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'existing' },
      error: null,
    });

    await LineupService.saveLineup(
      'team-1',
      'demo-league-id',
      { starters: ['101'], bench: [], ir: [], slotAssignments: {} }
    );

    // Should NOT attempt an upsert since demo league is read-only
    // The from() call is only for the existence check
    expect(defaultChain.upsert).not.toHaveBeenCalled();
  });
});
