import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoolService } from '../services/PoolService';
import { createChain, createMockSupabase } from './helpers';

// Mock LeagueMembershipService
const mockRequireMembership = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/LeagueMembershipService', () => ({
  LeagueMembershipService: class {
    requireMembership = mockRequireMembership;
  },
}));

// Mock the admin client the scoring RPCs run on
const mockRpc = vi.fn();
vi.mock('../lib/supabase', () => ({
  getSupabaseAdmin: () => ({ rpc: mockRpc }),
  createUserClient: vi.fn(),
  supabaseAdmin: {},
}));

// Mock ScheduleService
const mockGetGamesForDateRange = vi.fn().mockResolvedValue({ games: [] });
vi.mock('../services/ScheduleService', () => ({
  ScheduleService: class {
    getGamesForDateRange = mockGetGamesForDateRange;
  },
}));

describe('PoolService', () => {
  let service: PoolService;
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabase();
    service = new PoolService(mockSupabase);
  });

  // ── getCurrentWeek ──────────────────────────────────────────────────

  describe('getCurrentWeek', () => {
    it('returns a positive week number', () => {
      const week = service.getCurrentWeek();
      expect(week).toBeGreaterThanOrEqual(1);
    });

    it('returns at least 1 even before season start', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 0, 1)); // Jan 1 well before season
      const week = service.getCurrentWeek();
      expect(week).toBeGreaterThanOrEqual(1);
      vi.useRealTimers();
    });
  });

  // ── Pick'em Pool ────────────────────────────────────────────────────

  describe('submitPickemPicks', () => {
    it('submits picks for unlocked games', async () => {
      // Schedule returns games that match the pick game_ids
      mockGetGamesForDateRange.mockResolvedValueOnce({
        games: [
          { id: 'g1', home_team: 'TOR', away_team: 'MTL', status: 'scheduled', game_date: '2099-01-01', game_time: '2099-01-01T23:00:00Z' },
          { id: 'g2', home_team: 'BOS', away_team: 'NYR', status: 'scheduled', game_date: '2099-01-01', game_time: '2099-01-01T23:00:00Z' },
        ],
      });
      const upsertChain = createChain({ error: null });
      mockSupabase.from = vi.fn(() => upsertChain);

      const result = await service.submitPickemPicks('league-1', 'user-1', 1, [
        { game_id: 'g1', picked_team: 'TOR' },
        { game_id: 'g2', picked_team: 'MTL' },
      ]);

      expect(result.success).toBe(true);
      expect(result.submitted).toBe(2);
      expect(result.locked).toBe(0);
    });

    it('throws when all games are locked', async () => {
      mockGetGamesForDateRange.mockResolvedValueOnce({
        games: [
          { id: 'g1', home_team: 'TOR', away_team: 'MTL', status: 'final', game_date: '2025-01-01' },
        ],
      });

      await expect(
        service.submitPickemPicks('league-1', 'user-1', 1, [
          { game_id: 'g1', picked_team: 'TOR' },
        ]),
      ).rejects.toThrow('All selected games have already started');
    });

    it('returns error when upsert fails', async () => {
      // Provide a matching scheduled game so the pick passes the filter
      mockGetGamesForDateRange.mockResolvedValueOnce({
        games: [
          { id: 'g1', home_team: 'TOR', away_team: 'MTL', status: 'scheduled', game_date: '2099-01-01', game_time: '2099-01-01T23:00:00Z' },
        ],
      });
      mockSupabase.from = vi.fn(() => createChain({ error: { message: 'DB error' } }));

      await expect(
        service.submitPickemPicks('league-1', 'user-1', 1, [
          { game_id: 'g1', picked_team: 'TOR' },
        ]),
      ).rejects.toThrow('DB error');
    });
  });

  describe('getPickemPicks', () => {
    it('returns picks for the specified week', async () => {
      const picks = [
        { id: '1', game_id: 'g1', picked_team: 'TOR', is_correct: true },
        { id: '2', game_id: 'g2', picked_team: 'MTL', is_correct: false },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: picks, error: null }));

      const result = await service.getPickemPicks('league-1', 'user-1', 1);

      expect(result).toHaveLength(2);
      expect((result as unknown as Array<{ picked_team: string }>)[0].picked_team).toBe('TOR');
    });

    it('returns empty array when no picks exist', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getPickemPicks('league-1', 'user-1', 1);

      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'Fetch error' } }));

      await expect(
        service.getPickemPicks('league-1', 'user-1', 1),
      ).rejects.toThrow('Fetch error');
    });
  });

  // ── Pool scoring ────────────────────────────────────────────────────
  //
  // Scoring no longer accepts results from the caller. Each scorer delegates to a
  // SECURITY DEFINER RPC that derives its winners from nhl_games, so these tests
  // assert the delegation contract rather than re-testing win/loss arithmetic
  // that now lives in the database.

  describe('pool scoring delegates to the database', () => {
    const cases: Array<[string, string]> = [
      ['scorePickemWeek', 'score_pickem_week'],
      ['scorePickemWeekATS', 'score_pickem_week'],
      ['scoreSurvivorWeek', 'score_survivor_week'],
      ['scoreConfidenceWeek', 'score_confidence_week'],
    ];

    it.each(cases)('%s calls %s with only the league and week', async (method, rpc) => {
      mockRpc.mockResolvedValueOnce({ data: [{}, {}], error: null });
      const result = await (service as any)[method]('league-1', 7);
      expect(mockRpc).toHaveBeenCalledWith(rpc, { p_league_id: 'league-1', p_week_number: 7 });
      expect(result.scored).toBe(2);
    });

    it.each(cases)('%s surfaces an rpc error rather than swallowing it', async (method) => {
      // supabase-js .rpc() RETURNS its error instead of throwing, so a bare await
      // would report success on a failed scoring run.
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
      await expect((service as any)[method]('league-1', 7)).rejects.toThrow('permission denied');
    });

    it('reports zero scored when the rpc returns no rows', async () => {
      mockRpc.mockResolvedValueOnce({ data: [], error: null });
      await expect(service.scoreConfidenceWeek('league-1', 7)).resolves.toEqual({ scored: 0 });
    });

    it('ignores any result set a caller tries to pass', async () => {
      mockRpc.mockResolvedValueOnce({ data: [], error: null });
      await (service as any).scoreConfidenceWeek('league-1', 7, [
        { game_id: 'g1', winning_team: 'WHATEVER-I-SAY' },
      ]);
      expect(mockRpc).toHaveBeenCalledWith('score_confidence_week', {
        p_league_id: 'league-1',
        p_week_number: 7,
      });
    });
  });


  describe('getPickemStandings', () => {
    it('returns aggregated standings sorted by correct picks', async () => {
      const picks = [
        { user_id: 'u1', week_number: 1, is_correct: true },
        { user_id: 'u1', week_number: 1, is_correct: true },
        { user_id: 'u1', week_number: 1, is_correct: false },
        { user_id: 'u2', week_number: 1, is_correct: true },
      ];
      const profiles = [
        { id: 'u1', username: 'Alice', first_name: null, last_name: null },
        { id: 'u2', username: 'Bob', first_name: null, last_name: null },
      ];

      let fromCallCount = 0;
      mockSupabase.from = vi.fn(() => {
        fromCallCount++;
        if (fromCallCount === 1) return createChain({ data: picks, error: null });
        return createChain({ data: profiles, error: null });
      });

      const standings = await service.getPickemStandings('league-1', 'u1');

      expect(mockRequireMembership).toHaveBeenCalledWith('league-1', 'u1');
      expect(standings).toHaveLength(2);
      expect(standings[0].display_name).toBe('Alice');
      expect(standings[0].correct_picks).toBe(2);
      expect(standings[1].display_name).toBe('Bob');
      expect(standings[1].correct_picks).toBe(1);
    });

    it('returns empty array when no scored picks exist', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [], error: null }));

      const standings = await service.getPickemStandings('league-1', 'u1');

      expect(standings).toEqual([]);
    });
  });

  // ── Survivor Pool ───────────────────────────────────────────────────

  describe('submitSurvivorPick', () => {
    it('submits a valid survivor pick', async () => {
      // checkSurvivorEliminated needs: leagues (settings), survivor_selections (count)
      // duplicate check: survivor_selections (previous picks)
      // upsert: survivor_selections
      let fromCallCount = 0;
      mockSupabase.from = vi.fn((table: string) => {
        fromCallCount++;
        if (table === 'leagues') {
          return createChain({ data: { settings: { survivorLives: 1 } }, error: null });
        }
        if (table === 'survivor_selections' && fromCallCount <= 3) {
          // Count check for elimination (count=0 means not eliminated)
          if (fromCallCount === 2) return createChain({ count: 0, error: null });
          // Previous picks (empty = no duplicates)
          if (fromCallCount === 3) return createChain({ data: [], error: null });
        }
        // Upsert
        return createChain({ error: null });
      });

      const result = await service.submitSurvivorPick('league-1', 'user-1', 1, 'TOR');

      expect(result.success).toBe(true);
    });

    it('rejects pick when user is eliminated', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') {
          return createChain({ data: { settings: { survivorLives: 1 } }, error: null });
        }
        // Elimination check: 1 loss = eliminated with 1 life
        return createChain({ count: 1, error: null });
      });

      await expect(
        service.submitSurvivorPick('league-1', 'user-1', 2, 'MTL'),
      ).rejects.toThrow('eliminated');
    });

    it('rejects duplicate team usage', async () => {
      let fromCallCount = 0;
      mockSupabase.from = vi.fn((table: string) => {
        fromCallCount++;
        if (table === 'leagues') {
          return createChain({ data: { settings: { survivorLives: 1 } }, error: null });
        }
        if (fromCallCount === 2) return createChain({ count: 0, error: null }); // not eliminated
        if (fromCallCount === 3) return createChain({ data: [{ picked_team: 'TOR' }], error: null }); // already used TOR
        return createChain({ error: null });
      });

      await expect(
        service.submitSurvivorPick('league-1', 'user-1', 2, 'TOR'),
      ).rejects.toThrow('already used TOR');
    });
  });

  describe('checkSurvivorEliminated', () => {
    it('returns false when under max lives', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') {
          return createChain({ data: { settings: { survivorLives: 2 } }, error: null });
        }
        return createChain({ count: 1, error: null }); // 1 loss, 2 lives
      });

      const eliminated = await service.checkSurvivorEliminated('league-1', 'user-1');

      expect(eliminated).toBe(false);
    });

    it('returns true when losses equal max lives', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') {
          return createChain({ data: { settings: { survivorLives: 1 } }, error: null });
        }
        return createChain({ count: 1, error: null });
      });

      const eliminated = await service.checkSurvivorEliminated('league-1', 'user-1');

      expect(eliminated).toBe(true);
    });

    it('defaults to 1 life when settings missing', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') {
          return createChain({ data: { settings: {} }, error: null });
        }
        return createChain({ count: 1, error: null });
      });

      const eliminated = await service.checkSurvivorEliminated('league-1', 'user-1');

      expect(eliminated).toBe(true);
    });
  });


  describe('getSurvivorStandings', () => {
    it('returns standings sorted by active first then by weeks played', async () => {
      const selections = [
        { user_id: 'u1', week_number: 1, picked_team: 'TOR', is_correct: true },
        { user_id: 'u1', week_number: 2, picked_team: 'MTL', is_correct: true },
        { user_id: 'u2', week_number: 1, picked_team: 'OTT', is_correct: false },
      ];
      const profiles = [
        { id: 'u1', username: 'Alice', first_name: null, last_name: null },
        { id: 'u2', username: 'Bob', first_name: null, last_name: null },
      ];

      let fromCallCount = 0;
      mockSupabase.from = vi.fn((table: string) => {
        fromCallCount++;
        if (table === 'leagues') {
          return createChain({ data: { settings: { survivorLives: 1 } }, error: null });
        }
        if (fromCallCount === 2) return createChain({ data: selections, error: null });
        return createChain({ data: profiles, error: null });
      });

      const standings = await service.getSurvivorStandings('league-1');

      expect(standings).toHaveLength(2);
      // Alice active, Bob eliminated — Alice first
      expect(standings[0].display_name).toBe('Alice');
      expect(standings[0].is_eliminated).toBe(false);
      expect(standings[0].teams_used).toEqual(['TOR', 'MTL']);
      expect(standings[1].display_name).toBe('Bob');
      expect(standings[1].is_eliminated).toBe(true);
    });
  });

  describe('getSurvivorPickHistory', () => {
    it('returns formatted pick history', async () => {
      const data = [
        { week_number: 1, picked_team: 'TOR', is_correct: true },
        { week_number: 2, picked_team: 'MTL', is_correct: false },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data, error: null }));

      const history = await service.getSurvivorPickHistory('league-1', 'user-1');

      expect(history).toEqual([
        { week: 1, team: 'TOR', is_correct: true },
        { week: 2, team: 'MTL', is_correct: false },
      ]);
    });

    it('returns empty array when no history exists', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const history = await service.getSurvivorPickHistory('league-1', 'user-1');

      expect(history).toEqual([]);
    });

    it('throws on database error', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'DB error' } }));

      await expect(
        service.getSurvivorPickHistory('league-1', 'user-1'),
      ).rejects.toThrow('DB error');
    });
  });

  describe('getSurvivorUsedTeams', () => {
    it('returns array of team abbreviations', async () => {
      const data = [{ picked_team: 'TOR' }, { picked_team: 'MTL' }];
      mockSupabase.from = vi.fn(() => createChain({ data, error: null }));

      const teams = await service.getSurvivorUsedTeams('league-1', 'user-1');

      expect(teams).toEqual(['TOR', 'MTL']);
    });

    it('returns empty array when no teams used', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const teams = await service.getSurvivorUsedTeams('league-1', 'user-1');

      expect(teams).toEqual([]);
    });
  });

  // ── Confidence Pool ─────────────────────────────────────────────────

  describe('submitConfidencePicks', () => {
    it('submits valid confidence picks', async () => {
      mockSupabase.from = vi.fn(() => createChain({ error: null }));

      const result = await service.submitConfidencePicks('league-1', 'user-1', 1, [
        { game_id: 'g1', picked_team: 'TOR', confidence_points: 1 },
        { game_id: 'g2', picked_team: 'MTL', confidence_points: 2 },
      ]);

      expect(result.success).toBe(true);
      expect(result.submitted).toBe(2);
      expect(result.locked).toBe(0);
    });

    it('rejects duplicate confidence point values', async () => {
      await expect(
        service.submitConfidencePicks('league-1', 'user-1', 1, [
          { game_id: 'g1', picked_team: 'TOR', confidence_points: 1 },
          { game_id: 'g2', picked_team: 'MTL', confidence_points: 1 },
        ]),
      ).rejects.toThrow('unique confidence point value');
    });

    it('rejects non-sequential confidence point values', async () => {
      await expect(
        service.submitConfidencePicks('league-1', 'user-1', 1, [
          { game_id: 'g1', picked_team: 'TOR', confidence_points: 1 },
          { game_id: 'g2', picked_team: 'MTL', confidence_points: 5 },
        ]),
      ).rejects.toThrow('sequential 1 to');
    });

    it('throws when all games are locked', async () => {
      mockGetGamesForDateRange.mockResolvedValueOnce({
        games: [
          { id: 'g1', status: 'live', game_date: '2025-01-01' },
        ],
      });

      await expect(
        service.submitConfidencePicks('league-1', 'user-1', 1, [
          { game_id: 'g1', picked_team: 'TOR', confidence_points: 1 },
        ]),
      ).rejects.toThrow('All selected games have already started');
    });
  });

  describe('getConfidencePicks', () => {
    it('returns picks ordered by confidence', async () => {
      const picks = [
        { id: '1', game_id: 'g1', picked_team: 'TOR', confidence_points: 3 },
        { id: '2', game_id: 'g2', picked_team: 'MTL', confidence_points: 2 },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: picks, error: null }));

      const result = await service.getConfidencePicks('league-1', 'user-1', 1);

      expect(result).toHaveLength(2);
      expect((result as unknown as Array<{ confidence_points: number }>)[0].confidence_points).toBe(3);
    });

    it('returns empty array when no picks exist', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getConfidencePicks('league-1', 'user-1', 1);

      expect(result).toEqual([]);
    });
  });


  describe('getConfidenceStandings', () => {
    it('returns standings sorted by total points', async () => {
      const picks = [
        { user_id: 'u1', week_number: 1, confidence_points: 3, points_earned: 3, is_correct: true },
        { user_id: 'u1', week_number: 1, confidence_points: 2, points_earned: 0, is_correct: false },
        { user_id: 'u2', week_number: 1, confidence_points: 3, points_earned: 3, is_correct: true },
        { user_id: 'u2', week_number: 1, confidence_points: 2, points_earned: 2, is_correct: true },
      ];
      const profiles = [
        { id: 'u1', username: 'Alice', first_name: null, last_name: null },
        { id: 'u2', username: 'Bob', first_name: null, last_name: null },
      ];

      let fromCallCount = 0;
      mockSupabase.from = vi.fn(() => {
        fromCallCount++;
        if (fromCallCount === 1) return createChain({ data: picks, error: null });
        return createChain({ data: profiles, error: null });
      });

      const standings = await service.getConfidenceStandings('league-1');

      expect(standings).toHaveLength(2);
      // Bob: 5 points, Alice: 3 points
      expect(standings[0].display_name).toBe('Bob');
      expect(standings[0].total_points).toBe(5);
      expect(standings[1].display_name).toBe('Alice');
      expect(standings[1].total_points).toBe(3);
    });

    it('returns empty array when no picks', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: [], error: null }));

      const standings = await service.getConfidenceStandings('league-1');

      expect(standings).toEqual([]);
    });
  });

  // ── Week Games ──────────────────────────────────────────────────────

  describe('getGamesForWeek', () => {
    it('returns games with lock status', async () => {
      mockGetGamesForDateRange.mockResolvedValueOnce({
        games: [
          { id: 'g1', status: 'scheduled', game_date: '2099-12-31', game_time: '19:00:00', home_team: 'TOR', away_team: 'MTL' },
          { id: 'g2', status: 'final', game_date: '2025-01-01', home_team: 'OTT', away_team: 'BOS' },
        ],
      });

      const games = await service.getGamesForWeek(1);

      expect(games).toHaveLength(2);
      expect(games[0].is_locked).toBe(false); // Future game
      expect(games[1].is_locked).toBe(true);  // Final game
    });

    it('returns empty array when no games', async () => {
      const games = await service.getGamesForWeek(1);

      expect(games).toEqual([]);
    });
  });
});
