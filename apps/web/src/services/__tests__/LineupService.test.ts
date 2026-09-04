import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules — must be hoisted before imports
// =============================================================================

vi.mock('@/api/rosters', () => ({
  rosterApi: {
    saveLineup: vi.fn(),
    getLineup: vi.fn(),
    getDailyRoster: vi.fn(),
    // NOTE: these resolve to the transport envelope { data: payload }, because
    // that is what apiClient returns — server routes reply with ok(c, payload).
    // Mocking the payload flat is what let LineupService read the wrong level
    // and still pass.
    canUpdateRoster: vi.fn(),
    backfillDailyRosters: vi.fn(),
    backfillAllMatchups: vi.fn(),
    initializeLineup: vi.fn(),
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
import { MatchupService } from '../MatchupService';
import { RosterCacheService } from '../RosterCacheService';
import { rosterApi } from '@/api/rosters';

// Cast to access mock methods
const mockRosterApi = rosterApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

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
  it('returns lineup from API when available', async () => {
    mockRosterApi.getLineup.mockResolvedValue({
      starters: ['101', '102'],
      bench: ['201'],
      ir: ['301'],
      slot_assignments: { '101': 'slot-C-1', '102': 'slot-LW-1' },
    });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).not.toBeNull();
    expect(result!.starters).toEqual(['101', '102']);
    expect(result!.bench).toEqual(['201']);
    expect(result!.ir).toEqual(['301']);
    expect(result!.slotAssignments).toEqual({ '101': 'slot-C-1', '102': 'slot-LW-1' });
  });

  it('returns null when no lineup exists', async () => {
    mockRosterApi.getLineup.mockResolvedValue(null);

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalled();
  });

  it('clears localStorage when API returns data', async () => {
    localStorageMock.setItem('lineup_team_team-1', JSON.stringify({ starters: ['old'] }));

    mockRosterApi.getLineup.mockResolvedValue({
      starters: ['101'],
      bench: [],
      ir: [],
      slot_assignments: {},
    });

    await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

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
    // Should NOT call API
    expect(mockRosterApi.getLineup).not.toHaveBeenCalled();
  });

  it('returns null for non-UUID league IDs with no localStorage data', async () => {
    const result = await LineupService.getLineup('team-1', 'non-uuid-league');

    expect(result).toBeNull();
  });

  it('normalizes slot assignment keys to strings', async () => {
    mockRosterApi.getLineup.mockResolvedValue({
      starters: ['101'],
      bench: [],
      ir: [],
      slot_assignments: { 101: 'slot-C-1' }, // Numeric key
    });

    const result = await LineupService.getLineup('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(result!.slotAssignments['101']).toBe('slot-C-1');
  });

  it('falls back to localStorage on API error', async () => {
    mockRosterApi.getLineup.mockRejectedValue(new Error('Network error'));

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
    // Should not call API when there are no players
    expect(mockRosterApi.canUpdateRoster).not.toHaveBeenCalled();
  });

  it('returns true when API says roster can be updated', async () => {
    mockRosterApi.canUpdateRoster.mockResolvedValue({ data: { canUpdate: true } });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(true);
    expect(mockRosterApi.canUpdateRoster).toHaveBeenCalledWith('2026-03-08', [101]);
  });

  // This is the test that made the bug invisible. It mocked { canUpdate: false }
  // FLAT, which the API never returns — the real body is { data: { canUpdate } }.
  // Against the flat mock the old `result?.canUpdate ?? true` read false and the
  // test went green, while in production it read undefined, fell through to
  // `?? true`, and let anyone move a player whose game had already started.
  it('returns false when API says roster cannot be updated', async () => {
    mockRosterApi.canUpdateRoster.mockResolvedValue({ data: { canUpdate: false } });

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(false);
  });

  it('fails open on a flat body — proof it reads .data and not the root', async () => {
    // If someone reverts to reading the envelope root, the mock below starts
    // returning false again and this test fails.
    mockRosterApi.canUpdateRoster.mockResolvedValue(
      { canUpdate: false } as unknown as { data: { canUpdate: boolean } },
    );

    const result = await LineupService.canUpdateRosterForDate(
      'team-1',
      new Date('2026-03-08'),
      { starters: ['101'], bench: [], ir: [] }
    );

    expect(result).toBe(true);
  });

  it('returns true on error (fail open)', async () => {
    mockRosterApi.canUpdateRoster.mockRejectedValue(new Error('Network error'));

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
    mockRosterApi.getDailyRoster.mockResolvedValue([]);

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      []
    );

    expect(result).toBeNull();
  });

  it('returns null when API returns null', async () => {
    mockRosterApi.getDailyRoster.mockResolvedValue(null);

    const result = await LineupService.loadDailyRoster(
      'team-1',
      'matchup-1',
      '2026-03-07',
      []
    );

    expect(result).toBeNull();
  });

  it('sorts players into starters, bench, and IR arrays', async () => {
    mockRosterApi.getDailyRoster.mockResolvedValue([
      { player_id: 101, slot_type: 'active', slot_id: 'slot-C-1' },
      { player_id: 102, slot_type: 'active', slot_id: 'slot-LW-1' },
      { player_id: 201, slot_type: 'bench', slot_id: null },
      { player_id: 301, slot_type: 'ir', slot_id: 'slot-IR-1' },
    ]);

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
    mockRosterApi.getDailyRoster.mockResolvedValue([
      { player_id: 101, slot_type: 'active', slot_id: 'slot-C-1' },
      { player_id: 999, slot_type: 'active', slot_id: 'slot-LW-1' },
    ]);

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
    mockRosterApi.getDailyRoster.mockRejectedValue(new Error('Connection lost'));

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
  // ENVELOPE (2026-08-25). Every server route answers with ok(c, payload),
  // which serialises as { data: payload }, and apiClient resolves to that JSON
  // verbatim. These mocks used to return the payload FLAT — a shape the real
  // API has never produced — so they passed while the service read
  // result.backfilledCount, got undefined, and reported 0 for every call.
  // A test that mocks a fictional response shape cannot fail when the code
  // reads the real one wrong, which is exactly what happened here.
  it('returns result from API', async () => {
    mockRosterApi.backfillDailyRosters.mockResolvedValue({
      data: { backfilledCount: 5, error: null },
    });

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'league-1', 'matchup-1');

    expect(result.backfilledCount).toBe(5);
    expect(result.error).toBeNull();
    expect(mockRosterApi.backfillDailyRosters).toHaveBeenCalledWith('league-1', 'team-1', 'matchup-1');
  });

  it('returns 0 when API returns no data', async () => {
    mockRosterApi.backfillDailyRosters.mockResolvedValue(null);

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'league-1', 'matchup-1');

    expect(result.backfilledCount).toBe(0);
  });

  it('surfaces a service-level error carried inside the payload', async () => {
    mockRosterApi.backfillDailyRosters.mockResolvedValue({
      data: { backfilledCount: 0, error: 'Matchup not found' },
    });

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'league-1', 'matchup-1');

    expect(result.error).toBe('Matchup not found');
  });

  it('reads the payload from .data, never from the envelope root', async () => {
    // Regression guard. A flat body is what the old mocks pretended the API
    // returned; if the service ever reads the root again this goes green-to-red.
    mockRosterApi.backfillDailyRosters.mockResolvedValue({
      backfilledCount: 5,
      error: null,
    } as unknown as { data: { backfilledCount: number; error: string | null } });

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'league-1', 'matchup-1');

    expect(result.backfilledCount).toBe(0);
  });

  it('handles exceptions gracefully', async () => {
    mockRosterApi.backfillDailyRosters.mockRejectedValue(new Error('DB crash'));

    const result = await LineupService.backfillMissingDailyRosters('team-1', 'league-1', 'matchup-1');

    expect(result.backfilledCount).toBe(0);
    expect(result.error).toBeDefined();
  });
});

// =============================================================================
// backfillAllMatchupsForLeague
// =============================================================================

describe('LineupService.backfillAllMatchupsForLeague', () => {
  it('returns result from API', async () => {
    mockRosterApi.backfillAllMatchups.mockResolvedValue({
      data: { totalBackfilled: 10, matchupsProcessed: 3, errors: [] },
    });

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(10);
    expect(result.matchupsProcessed).toBe(3);
    expect(result.errors).toEqual([]);
    expect(mockRosterApi.backfillAllMatchups).toHaveBeenCalledWith('league-1');
  });

  it('returns zeros when API returns null', async () => {
    mockRosterApi.backfillAllMatchups.mockResolvedValue(null);

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(0);
    expect(result.matchupsProcessed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('handles exceptions gracefully', async () => {
    mockRosterApi.backfillAllMatchups.mockRejectedValue(new Error('Network error'));

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(0);
    expect(result.matchupsProcessed).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('passes through per-matchup errors the server collected', async () => {
    // The whole point of the endpoint: tell the commissioner WHICH teams
    // failed. Reading the wrong level of the envelope returned [] every time,
    // so a half-broken backfill looked identical to a clean one.
    mockRosterApi.backfillAllMatchups.mockResolvedValue({
      data: {
        totalBackfilled: 4,
        matchupsProcessed: 3,
        errors: [{ matchup: 'm-2', team: 'team2_id', error: 'insert failed' }],
      },
    });

    const result = await LineupService.backfillAllMatchupsForLeague('league-1');

    expect(result.totalBackfilled).toBe(4);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].matchup).toBe('m-2');
  });
});

// =============================================================================
// saveLineup
// =============================================================================

describe('LineupService.saveLineup', () => {
  it('blocks saves to demo league', async () => {
    await LineupService.saveLineup(
      'team-1',
      'demo-league-id',
      { starters: ['101'], bench: [], ir: [], slotAssignments: {} }
    );

    // Should NOT call API since demo league is read-only
    expect(mockRosterApi.saveLineup).not.toHaveBeenCalled();
  });

  it('calls API and clears caches on success', async () => {
    mockRosterApi.saveLineup.mockResolvedValue({ success: true });

    await LineupService.saveLineup(
      'team-1',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      { starters: ['101'], bench: ['201'], ir: [], slotAssignments: { '101': 'slot-C-1' } }
    );

    expect(mockRosterApi.saveLineup).toHaveBeenCalledWith(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'team-1',
      expect.objectContaining({
        starters: ['101'],
        bench: ['201'],
        ir: [],
        slot_assignments: { '101': 'slot-C-1' },
      })
    );
    expect(MatchupService.clearRosterCache).toHaveBeenCalledWith('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(RosterCacheService.clearCache).toHaveBeenCalledWith('team-1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('lineup_team_team-1');
  });

  it('falls back to localStorage when API fails', async () => {
    mockRosterApi.saveLineup.mockRejectedValue(new Error('API unavailable'));

    await LineupService.saveLineup(
      'team-1',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      { starters: ['101'], bench: [], ir: [], slotAssignments: {} }
    );

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'lineup_team_team-1',
      expect.any(String)
    );
    // Should still clear caches even with localStorage fallback
    expect(MatchupService.clearRosterCache).toHaveBeenCalled();
    expect(RosterCacheService.clearCache).toHaveBeenCalled();
  });

  it('passes targetDate and options to API', async () => {
    mockRosterApi.saveLineup.mockResolvedValue({ success: true });

    await LineupService.saveLineup(
      'team-1',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      { starters: ['101'], bench: [], ir: [], slotAssignments: {} },
      '2026-03-08',
      { allowPlayerRemoval: true }
    );

    expect(mockRosterApi.saveLineup).toHaveBeenCalledWith(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'team-1',
      expect.objectContaining({
        target_date: '2026-03-08',
        allow_player_removal: true,
      })
    );
  });

  // THE SERVER SAID NO (2026-09-03). The catch block treated a 4xx like a
  // dead network: stash the lineup in localStorage and resolve. So every
  // refusal the server writes for the manager (validateSlotAssignments and
  // validateIrPlacements in server/src/lib/leagueRules.ts, the game-lock
  // 409) vanished, the roster page toasted "Lineup Updated", and the server
  // kept a different lineup. The shapes below are what api/client.ts throws:
  // an ApiError carries the HTTP status and the server's sentence; a request
  // the server never answered is a fetch TypeError, a TimeoutError, or the
  // client's own status-0 ApiError once its retries are spent.
  describe('when the server refuses the lineup (a 4xx)', () => {
    const LEAGUE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const lineup = { starters: ['101'], bench: ['201'], ir: ['301'], slotAssignments: { '101': 'slot-C-1', '301': 'ir-slot-1' } };
    const refusal = (status: number, message: string) =>
      Object.assign(new Error(message), { name: 'ApiError', status });

    it.each([
      [400, "Connor McDavid isn't listed IR or LTIR, so an IR slot can't hold him. Bench him, or move a player with official IR/LTIR status there."],
      [400, 'This league has 3 IR slots and 4 players are headed there. Bench one first.'],
      [400, 'A G player cannot fill slot-C-1.'],
      [409, "Connor McDavid's game has started."],
      [403, 'You can only edit your own lineup'],
    ])('rejects with the server sentence and status %s when asked to, and writes nothing to localStorage', async (status, message) => {
      const thrown = refusal(status, message);
      mockRosterApi.saveLineup.mockRejectedValue(thrown);

      const err = await LineupService.saveLineup('team-1', LEAGUE, lineup, '2026-03-08', { rejectOnRefusal: true })
        .then(() => null, (e: unknown) => e);

      // The very error the client threw, so the page can read .status and .message.
      expect(err).toBe(thrown);
      expect((err as Error).message).toBe(message);
      expect((err as { status: number }).status).toBe(status);
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
      // The server still holds the lineup it had; the caches stay valid.
      expect(MatchupService.clearRosterCache).not.toHaveBeenCalled();
      expect(RosterCacheService.clearCache).not.toHaveBeenCalled();
    });

    it('resolves for a caller that did not ask (the background initialisers), still writing nothing', async () => {
      mockRosterApi.saveLineup.mockRejectedValue(refusal(403, 'You can only edit your own lineup'));

      await expect(LineupService.saveLineup('team-1', LEAGUE, lineup)).resolves.toBeUndefined();

      expect(localStorageMock.setItem).not.toHaveBeenCalled();
      expect(MatchupService.clearRosterCache).not.toHaveBeenCalled();
    });
  });

  describe('when the server never answered', () => {
    const LEAGUE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const lineup = { starters: ['101'], bench: [], ir: [], slotAssignments: {} };

    it.each([
      ['a fetch TypeError', new TypeError('Failed to fetch')],
      ['a timeout', Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })],
      ['the client\'s status-0 ApiError after its retries', Object.assign(new Error('Network error, retrying'), { name: 'ApiError', status: 0 })],
      ['a 503 the retries never got past', Object.assign(new Error('Server returned 503'), { name: 'ApiError', status: 503 })],
      ['an error with no status at all', new Error('API unavailable')],
    ])('%s falls back to localStorage as before, even when refusals would reject', async (_label, thrown) => {
      mockRosterApi.saveLineup.mockRejectedValue(thrown);

      await expect(
        LineupService.saveLineup('team-1', LEAGUE, lineup, '2026-03-08', { rejectOnRefusal: true }),
      ).resolves.toBeUndefined();

      expect(localStorageMock.setItem).toHaveBeenCalledWith('lineup_team_team-1', expect.any(String));
      const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1] as string);
      expect(stored).toEqual({ starters: ['101'], bench: [], ir: [], slotAssignments: {} });
      expect(MatchupService.clearRosterCache).toHaveBeenCalledWith('team-1', LEAGUE);
      expect(RosterCacheService.clearCache).toHaveBeenCalledWith('team-1', LEAGUE);
    });
  });
});

// =============================================================================
// initializeTeamLineup
// =============================================================================

describe('LineupService.initializeTeamLineup', () => {
  it('returns lineup from API', async () => {
    mockRosterApi.initializeLineup.mockResolvedValue({
      data: {
        starters: ['101', '102'],
        bench: ['201'],
        ir: [],
        slot_assignments: { '101': 'slot-C-1', '102': 'slot-LW-1' },
      },
    });

    const result = await LineupService.initializeTeamLineup('team-1', 'league-1', [], 'user-1');

    expect(result.lineup).not.toBeNull();
    expect(result.lineup!.starters).toEqual(['101', '102']);
    expect(result.lineup!.bench).toEqual(['201']);
    expect(result.lineup!.slotAssignments).toEqual({ '101': 'slot-C-1', '102': 'slot-LW-1' });
    expect(result.error).toBeNull();
    expect(mockRosterApi.initializeLineup).toHaveBeenCalledWith('league-1', 'team-1');
  });

  it('returns null lineup when API returns null', async () => {
    mockRosterApi.initializeLineup.mockResolvedValue(null);

    const result = await LineupService.initializeTeamLineup('team-1', 'league-1', [], 'user-1');

    expect(result.lineup).toBeNull();
    expect(result.error).toBeNull();
  });

  it('returns null lineup when the server computed none ({ data: null })', async () => {
    mockRosterApi.initializeLineup.mockResolvedValue({ data: null });

    const result = await LineupService.initializeTeamLineup('team-1', 'league-1', [], 'user-1');

    expect(result.lineup).toBeNull();
    expect(result.error).toBeNull();
  });

  it('ignores a flat body — proof it reads .data and not the root', async () => {
    // The old mock shape. Reading the envelope root produced a lineup whose
    // every field was undefined, which the `|| []` fallbacks turned into an
    // empty lineup — the server's slot computation thrown away in silence.
    mockRosterApi.initializeLineup.mockResolvedValue({
      starters: ['101'],
      bench: [],
      ir: [],
      slot_assignments: {},
    } as unknown as { data: null });

    const result = await LineupService.initializeTeamLineup('team-1', 'league-1', [], 'user-1');

    expect(result.lineup).toBeNull();
  });

  it('handles exceptions gracefully', async () => {
    mockRosterApi.initializeLineup.mockRejectedValue(new Error('Server error'));

    const result = await LineupService.initializeTeamLineup('team-1', 'league-1', [], 'user-1');

    expect(result.lineup).toBeNull();
    expect(result.error).toBeDefined();
  });
});
