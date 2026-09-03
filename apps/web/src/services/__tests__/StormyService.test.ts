import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// =============================================================================
// Mock Supabase client
// =============================================================================

function createChainMock() {
  const chain: Record<string, any> = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'or', 'order', 'limit', 'filter', 'gt', 'gte'];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'auth-user-1' } },
});

const mockFunctionsInvoke = vi.fn().mockResolvedValue({
  data: { response: 'Hello! I am Stormy.' },
  error: null,
});

// Declared with rest parameters so the mock-module factories below can
// forward `(...args: unknown[])` into it: supabase.from is called with a
// table name, and a zero-argument spy cannot be spread into.
const mockFrom = vi.fn((..._args: unknown[]) => createChainMock());

// Chunk 11g.9 (2026-08-24): Stormy moved off the `stormy-chat` Edge
// Function and onto POST /api/stormy/chat, so sendMessage is mocked at
// the apiClient boundary now, not at supabase.functions.invoke.
//
// ApiError must be a real class here — StormyService branches on
// `err instanceof ApiError` to decide whether to surface the server's
// user-facing rate-limit copy or rethrow.
//
// Both live inside vi.hoisted() because vi.mock factories are hoisted
// to the top of the module: a plain `class MockApiError` declaration
// below would be in the temporal dead zone when the factory runs.
const { MockApiError, mockApiPost } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    data: unknown;
    constructor(message: string, status: number, data?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    MockApiError,
    mockApiPost: vi.fn().mockResolvedValue({
      data: { response: 'Stormy says hello!' },
    }),
  };
});

vi.mock('@/api/client', () => ({
  API_BASE_URL: '',
  ApiError: MockApiError,
  apiClient: {
    get: vi.fn(),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
    functions: {
      invoke: (...args: unknown[]) => mockFunctionsInvoke(...args),
    },
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/seasonConstants')>()),
  CURRENT_SEASON: 2025,
}));

vi.mock('@/utils/weekCalculator', () => ({
  getFirstWeekStartDate: vi.fn().mockReturnValue(new Date('2024-10-06')),
  getCurrentWeekNumber: vi.fn().mockReturnValue(10),
  getWeekStartDate: vi.fn().mockReturnValue(new Date('2024-12-08')),
  getWeekEndDate: vi.fn().mockReturnValue(new Date('2024-12-14')),
  getWeekLabel: vi.fn().mockReturnValue('Week 10'),
  getScheduleLength: vi.fn().mockReturnValue(20),
  // fetchLeagueContext calls this on the draft date before any of the
  // above. It was missing from this mock for as long as no test reached
  // the fetcher; the fetcher's own try/catch would have swallowed the
  // resulting throw and returned an almost empty context.
  clampToSeasonStart: vi.fn((d: Date) => d),
}));

vi.mock('@/utils/scheduleMaximizer', () => ({
  fetchGamesForTeams: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/utils/projectionHelper', () => ({
  getWeeklyProjections: vi.fn().mockResolvedValue(new Map()),
}));

// fetchLeagueContext reaches its data through dynamic imports of the API
// modules and PlayerService. vi.mock applies to those too, and hoisting
// means the mocks below have to be built inside vi.hoisted like ApiError.
const { mockLeagueApi, mockRosterApi, mockMatchupApi, mockPlayerApi, mockGetPlayersByIds } = vi.hoisted(() => ({
  mockLeagueApi: { getTeams: vi.fn(), getLeague: vi.fn() },
  mockRosterApi: { getLeagueRosters: vi.fn(), getLineup: vi.fn() },
  mockMatchupApi: { getLeagueMatchups: vi.fn() },
  mockPlayerApi: { getRosProjections: vi.fn() },
  mockGetPlayersByIds: vi.fn(),
}));

vi.mock('@/api/leagues', () => ({ leagueApi: mockLeagueApi }));
vi.mock('@/api/rosters', () => ({ rosterApi: mockRosterApi }));
vi.mock('@/api/matchups', () => ({ matchupApi: mockMatchupApi }));
vi.mock('@/api/players', () => ({ playerApi: mockPlayerApi }));
vi.mock('@/services/PlayerService', () => ({
  PlayerService: { getPlayersByIds: (...args: unknown[]) => mockGetPlayersByIds(...args) },
}));

// =============================================================================
// Import after mocks
// =============================================================================

import { StormyService, fetchLeagueContext } from '../StormyService';
import type { StormyContext, StormyMessage } from '../StormyService';
import { getWeeklyProjections } from '@/utils/projectionHelper';
import { fetchGamesForTeams } from '@/utils/scheduleMaximizer';

// =============================================================================
// Tests
// =============================================================================

describe('StormyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChainMock());
    mockGetUser.mockResolvedValue({ data: { user: { id: 'auth-user-1' } } });
    mockApiPost.mockResolvedValue({
      data: { response: 'Stormy says hello!' },
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------
  describe('sendMessage', () => {
    it('calls POST /api/stormy/chat with message and history', async () => {
      const history: StormyMessage[] = [
        { role: 'user', content: 'Who should I start?' },
        { role: 'assistant', content: 'Check your lineup.' },
      ];

      const result = await StormyService.sendMessage('What about my goalie?', history);

      expect(mockApiPost).toHaveBeenCalledWith('/api/stormy/chat', {
        message: 'What about my goalie?',
        conversationHistory: [
          { role: 'user', content: 'Who should I start?' },
          { role: 'assistant', content: 'Check your lineup.' },
        ],
        context: '',
      });
      expect(result.response).toBe('Stormy says hello!');
      expect(result.error).toBeUndefined();
    });

    it('includes context string when context is provided', async () => {
      const context: StormyContext = {
        page: 'matchup',
        leagueName: 'Test League',
        teamName: 'My Team',
      };

      await StormyService.sendMessage('Help me', [], context);

      const call = mockApiPost.mock.calls[0];
      expect(call[1].context).toContain('Page: matchup');
      expect(call[1].context).toContain('League: Test League');
      expect(call[1].context).toContain("User's team: My Team");
    });

    it('surfaces the server rate-limit message from a 429', async () => {
      mockApiPost.mockRejectedValue(
        new MockApiError('API request failed with status 429', 429, {
          error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' },
        }),
      );

      const result = await StormyService.sendMessage('Hello', []);

      expect(result.response).toBe('');
      expect(result.error).toBe('Rate limit exceeded');
    });

    it('falls back to the ApiError message when no envelope error is present', async () => {
      mockApiPost.mockRejectedValue(
        new MockApiError('Stormy is unreachable', 502, undefined),
      );

      const result = await StormyService.sendMessage('Hello', []);

      expect(result.response).toBe('');
      expect(result.error).toBe('Stormy is unreachable');
    });

    it('catches exceptions and returns error message', async () => {
      mockApiPost.mockRejectedValue(new Error('Network timeout'));

      const result = await StormyService.sendMessage('Hello', []);

      expect(result.response).toBe('');
      expect(result.error).toBe('Network timeout');
    });

    it('returns usage data when available', async () => {
      mockApiPost.mockResolvedValue({
        data: {
          response: 'Answer here',
          usage: {
            messagesUsed: 2,
            dailyLimit: 3,
            inputTokens: 500,
            outputTokens: 200,
          },
        },
        error: null,
      });

      const result = await StormyService.sendMessage('Test', []);

      expect(result.usage?.messagesUsed).toBe(2);
      expect(result.usage?.dailyLimit).toBe(3);
    });

    it('throttles guest users after 1 message', async () => {
      // Make it a guest
      mockGetUser.mockResolvedValue({ data: { user: null } });

      // We need a fresh service instance to reset guest counter
      vi.resetModules();

      // Re-register mocks for the fresh module
      vi.doMock('@/integrations/supabase/client', () => ({
        supabase: {
          from: (...args: unknown[]) => mockFrom(...args),
          rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
          auth: {
            getUser: (...args: unknown[]) => mockGetUser(...args),
            getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
          },
          functions: {
            invoke: (...args: unknown[]) => mockFunctionsInvoke(...args),
          },
        },
      }));
      vi.doMock('@/api/client', () => ({
        API_BASE_URL: '',
        ApiError: MockApiError,
        apiClient: {
          get: vi.fn(),
          post: (...args: unknown[]) => mockApiPost(...args),
          put: vi.fn(),
          patch: vi.fn(),
          delete: vi.fn(),
        },
      }));
      vi.doMock('@/utils/logger', () => ({
        logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }));
      // 2026-08-12, ledger 364. Last hand-written seasonConstants mock in the web
      // suite: last session's sweep converted the vi.mock forms to importOriginal
      // and missed vi.doMock. Inert today -- StormyService imports no season
      // constants, verified -- but a hand-written module mock omits every export
      // it does not list, so it breaks the moment that stops being true.
      vi.doMock('@/utils/seasonConstants', async (importOriginal) => ({
        ...(await importOriginal<typeof import('@/utils/seasonConstants')>()),
        CURRENT_SEASON: 2025,
      }));
      vi.doMock('@/utils/weekCalculator', () => ({
        getFirstWeekStartDate: vi.fn(), getCurrentWeekNumber: vi.fn(),
        getWeekStartDate: vi.fn(), getWeekEndDate: vi.fn(),
        getWeekLabel: vi.fn(), getScheduleLength: vi.fn(),
      }));
      vi.doMock('@/utils/scheduleMaximizer', () => ({
        fetchGamesForTeams: vi.fn().mockResolvedValue(new Map()),
      }));
      vi.doMock('@/utils/projectionHelper', () => ({
        getWeeklyProjections: vi.fn().mockResolvedValue(new Map()),
      }));

      const mod = await import('../StormyService');
      const freshService = mod.StormyService;

      // First guest message should succeed
      const result1 = await freshService.sendMessage('Hello', []);
      expect(result1.response).toBe('Stormy says hello!');

      // Second guest message should be throttled
      const result2 = await freshService.sendMessage('Another', []);
      expect(result2.error).toContain('Sign up');
    });

    it('includes scoring settings and extra context in context string', async () => {
      const context: StormyContext = {
        page: 'roster',
        scoringSettings: 'G:3 A:2',
        rosterSummary: 'C McDavid 50pts',
        matchupSummary: 'Week 10: 100-90',
        standingsSummary: '1. Team Alpha 8-2',
        extra: 'Free agents available',
      };

      await StormyService.sendMessage('test', [], context);

      const call = mockApiPost.mock.calls[0];
      const contextStr = call[1].context;
      expect(contextStr).toContain('Page: roster');
      expect(contextStr).toContain('League scoring: G:3 A:2');
      expect(contextStr).toContain('=== YOUR DRAFTED ROSTER ===');
      expect(contextStr).toContain('=== CURRENT MATCHUP ===');
      expect(contextStr).toContain('=== STANDINGS ===');
      expect(contextStr).toContain('=== AVAILABLE PLAYERS (Not Yet Drafted) ===');
    });
  });

  // ---------------------------------------------------------------------------
  // Static utility methods (accessed via constructor)
  // ---------------------------------------------------------------------------
  describe('static utility methods', () => {
    it('summarizeRoster formats players correctly', () => {
      // Access static method via the class prototype
      const StormyServiceImpl = (StormyService as any).constructor;

      const roster = [
        { name: 'McDavid', position: 'C', team: 'EDM', points: 50, projectedPoints: 5.2 },
        { name: 'Draisaitl', position: 'C', team: 'EDM', points: 45 },
      ];

      const summary = StormyServiceImpl.summarizeRoster(roster);

      expect(summary).toContain('C McDavid (EDM) 50 pts proj 5.2');
      expect(summary).toContain('C Draisaitl (EDM) 45 pts');
    });

    it('summarizeRoster returns "Empty roster" for empty array', () => {
      const StormyServiceImpl = (StormyService as any).constructor;
      const summary = StormyServiceImpl.summarizeRoster([]);
      expect(summary).toBe('Empty roster');
    });

    it('summarizeMatchup formats matchup correctly', () => {
      const StormyServiceImpl = (StormyService as any).constructor;

      const matchup = {
        userTeam: 'My Team',
        userScore: 120,
        opponentTeam: 'Rival Team',
        opponentScore: 105,
        weekNumber: 10,
        status: 'in_progress',
      };

      const summary = StormyServiceImpl.summarizeMatchup(matchup);

      expect(summary).toContain('Week 10 (in_progress)');
      expect(summary).toContain('My Team: 120 pts');
      expect(summary).toContain('Rival Team: 105 pts');
    });
  });

  // ---------------------------------------------------------------------------
  // The failure copy (COPY_VOICE: a naked "Something went wrong." is banned)
  // ---------------------------------------------------------------------------
  describe('failure copy', () => {
    it('names Stormy and offers the door when the thrown value carries no message', async () => {
      // A thrown string is the case where userMessage falls back to the
      // caller's copy; an Error's own message passes through (tested above).
      mockApiPost.mockRejectedValue('boom');

      const result = await StormyService.sendMessage('Hello', []);

      expect(result.response).toBe('');
      expect(result.error).toBe('Stormy could not answer that one. Try again in a moment.');
    });
  });

  // ---------------------------------------------------------------------------
  // Context-line tokens (2026-09-03 voice rewrite 2)
  //
  // The prompt documents these shapes literally under "What Data You Have"
  // and server/src/lib/stormy/__tests__/systemPrompt.test.ts pins them
  // there. This side pins the code that writes them.
  // ---------------------------------------------------------------------------
  describe('context-line tokens', () => {
    const Impl = (StormyService as any).constructor;

    it('xgPair writes goals against expected, and nothing when there is no xG', () => {
      expect(Impl.xgPair(30, 21.4)).toBe(' xG:21.4 G-xG:+8.6');
      expect(Impl.xgPair(18, 22.25)).toBe(' xG:22.3 G-xG:-4.3');
      expect(Impl.xgPair(30, 0)).toBe('');
      expect(Impl.xgPair(30, null)).toBe('');
      expect(Impl.xgPair(30, undefined)).toBe('');
    });

    it('toiPerGame writes minutes a night, and nothing without ice time or games', () => {
      expect(Impl.toiPerGame(62 * 18.4 * 60, 62)).toBe(' TOI/GP:18.4');
      expect(Impl.toiPerGame(0, 62)).toBe('');
      expect(Impl.toiPerGame(undefined, 62)).toBe('');
      expect(Impl.toiPerGame(5000, 0)).toBe('');
    });

    it('gsaxToken keeps the bare shape and adds the sample only when the row carries it', () => {
      expect(
        Impl.gsaxToken({ goalie_id: 1, regressed_gsax: 8.2, total_shots_faced: 1204, total_xga: 92.4, total_ga: 84 }),
      ).toBe(' GSAx:+8.2[primary shots:1204 xGA:92.4 GA:84]');
      expect(
        Impl.gsaxToken({ goalie_id: 1, regressed_gsax: -4.8, total_shots_faced: null, total_xga: null, total_ga: null }),
      ).toBe(' GSAx:-4.8');
      expect(Impl.gsaxToken({ goalie_id: 1, regressed_gsax: null, total_shots_faced: 10, total_xga: 1, total_ga: 1 })).toBe('');
      expect(Impl.gsaxToken(undefined)).toBe('');
    });

    it('rosToken mirrors the free-agent list shape', () => {
      expect(
        Impl.rosToken({ player_id: 1, player_name: 'x', position: 'C', team_abbrev: 'NJD', total_projected_points: 412.49, avg_points_per_game: 5.1, games_remaining: 61 }),
      ).toBe(' ROS:412.5pts 61GR');
      expect(Impl.rosToken(undefined)).toBe('');
    });

    it('scoreGapLine states the gap from his side, and stays silent before there is a score', () => {
      expect(Impl.scoreGapLine(120.5, 105.2)).toBe('Gap: you lead by 15.3');
      expect(Impl.scoreGapLine(105.5, 117.8)).toBe('Gap: you trail by 12.3');
      expect(Impl.scoreGapLine(100, 100)).toBe('Gap: level');
      expect(Impl.scoreGapLine(null, 100)).toBeNull();
      expect(Impl.scoreGapLine(100, undefined)).toBeNull();
    });

    it('weeklyProjectionLine labels the opponent figure as a whole roster', () => {
      expect(Impl.weeklyProjectionLine(84.2, 22.1, 91.0)).toBe(
        'Projected this week: your starters 84.2, your bench 22.1, their whole roster 91.0 (their lineup is not visible)',
      );
      expect(Impl.weeklyProjectionLine(84.2, 22.1, null)).toBe(
        'Projected this week: your starters 84.2, your bench 22.1',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // fetchLeagueContext: the whole serialised context, line by line
  // ---------------------------------------------------------------------------
  describe('fetchLeagueContext', () => {
    const skater = (over: Record<string, unknown>) => ({
      position: 'C', games_played: 0, goals: 0, assists: 0, points: 0, plus_minus: 0,
      shots: 0, hits: 0, blocks: 0, pim: 0, ppp: 0, shp: 0, icetime_seconds: 0, xGoals: 0,
      wins: null, losses: null, ot_losses: null, saves: null, goals_against_average: null,
      save_percentage: null, highDangerSavePct: 0, goalsSavedAboveExpected: 0,
      eligible_positions: ['C'], jersey_number: null, status: 'active', headshot_url: null,
      last_updated: null, roster_status: 'ACT',
      ...over,
    });
    const goalie = (over: Record<string, unknown>) => skater({ position: 'G', eligible_positions: ['G'], ...over });

    beforeEach(() => {
      mockLeagueApi.getTeams.mockResolvedValue({
        data: [
          { id: 't1', team_name: 'Lime', owner_id: 'auth-user-1' },
          { id: 't2', team_name: 'Rival', owner_id: 'someone-else' },
        ],
      });
      mockLeagueApi.getLeague.mockResolvedValue({
        data: {
          draft_status: 'completed', updated_at: '2024-10-01T00:00:00Z',
          roster_slots: { C: 2, G: 1 }, league_size: 2, roster_size: 3,
        },
      });
      mockRosterApi.getLeagueRosters.mockResolvedValue({
        data: [
          { team_id: 't1', player_id: '1' }, { team_id: 't1', player_id: '2' }, { team_id: 't1', player_id: '3' },
          { team_id: 't2', player_id: '9' },
        ],
      });
      mockRosterApi.getLineup.mockResolvedValue({ data: { starters: ['1', '3'], bench: ['2'], ir: [] } });
      mockMatchupApi.getLeagueMatchups.mockResolvedValue({
        data: [{ week_number: 10, team1_id: 't1', team2_id: 't2', team1_score: 105.5, team2_score: 117.8, status: 'in_progress' }],
      });
      mockPlayerApi.getRosProjections.mockResolvedValue({
        data: [
          { player_id: 1, player_name: 'Marchetti', position: 'C', team_abbrev: 'NJD', total_projected_points: 412.5, avg_points_per_game: 5.1, games_remaining: 61 },
          { player_id: 77, player_name: 'Reyes', position: 'G', team_abbrev: 'SEA', total_projected_points: 168.4, avg_points_per_game: 3.2, games_remaining: 52 },
        ],
      });
      mockGetPlayersByIds.mockResolvedValue([
        skater({ id: '1', full_name: 'Marchetti', team: 'NJD', games_played: 62, goals: 30, assists: 40, points: 70, ppp: 20, shots: 210, hits: 15, blocks: 20, pim: 12, xGoals: 21.4, icetime_seconds: 62 * 18.4 * 60 }),
        skater({ id: '2', full_name: 'Okafor', team: 'SEA', games_played: 60, goals: 10, assists: 12, points: 22, roster_status: 'IR' }),
        goalie({ id: '3', full_name: 'Brannigan', team: 'NJD', goalie_gp: 41, wins: 20, saves: 1100, goals_against: 98, shutouts: 2, save_percentage: 0.912 }),
        skater({ id: '9', full_name: 'Lindahl', team: 'SEA', games_played: 61, goals: 30, assists: 25, points: 55, xGoals: 21.4 }),
      ]);
      // Rest parameters, matching mockFrom's declared (...args: unknown[])
      // signature; the table name arrives as args[0].
      mockFrom.mockImplementation((...args: unknown[]) => {
        const table = args[0] as string;
        const chain = createChainMock();
        if (table === 'player_talent_metrics') {
          chain.in = vi.fn().mockResolvedValue({ data: [{ player_id: 1, xg_per_60: 1.42, xg_rating: 'Elite' }] });
        }
        if (table === 'goalie_gsax_primary') {
          chain.in = vi.fn().mockResolvedValue({
            data: [{ goalie_id: 3, regressed_gsax: -4.8, total_shots_faced: 1204, total_xga: 92.4, total_ga: 98 }],
          });
        }
        return chain;
      });
      vi.mocked(getWeeklyProjections).mockResolvedValue(new Map([[1, 8.4], [2, 3.1], [3, 4.2], [9, 6.0]]));
      // 2024-12-09 is a Monday. Dates are parsed as local midnight by the
      // serialiser, so the day names do not depend on the runner's zone.
      vi.mocked(fetchGamesForTeams).mockResolvedValue(new Map([
        ['NJD', [{ game_date: '2024-12-09' }, { game_date: '2024-12-11' }, { game_date: '2024-12-14' }]],
        ['SEA', [{ game_date: '2024-12-10' }, { game_date: '2024-12-12' }]],
      ]) as any);
    });

    it('writes goals against expected, ice time and ROS on his lines, and the GSAx sample on his goalie', async () => {
      const ctx = await fetchLeagueContext('L1', 'auth-user-1');

      expect(ctx.rosterSummary).toContain(
        'START C Marchetti (NJD) 62GP 30G 40A 70PTS 1.1PPG 20PPP 210SOG 15HIT 20BLK 12PIM xG:21.4 G-xG:+8.6 TOI/GP:18.4 xG/60:1.42[Elite] 3GP/wk[Mon,Wed,Sat] wkProj:8.4 ROS:412.5pts 61GR',
      );
      expect(ctx.rosterSummary).toContain(
        'START G Brannigan (NJD) 41GP 20W 1100SV 98GA 2SO 0.912SV% GSAx:-4.8[primary shots:1204 xGA:92.4 GA:98] 3GP/wk[Mon,Wed,Sat] wkProj:4.2',
      );
      // No xG, no ice time, no talent row, no ROS row: the tokens are absent,
      // not zero. The NHL roster status still lands as a tag.
      expect(ctx.rosterSummary).toContain(
        'BENCH C Okafor (SEA) 60GP 10G 12A 22PTS 0.4PPG 0SOG 0HIT 0BLK 0PIM [IR] 2GP/wk[Tue,Thu] wkProj:3.1',
      );
      expect(ctx.rosterSummary).not.toMatch(/Okafor[^\n]*(xG:|TOI\/GP:|ROS:)/);
    });

    it('writes the gap, the projection on both sides, and the opponent with the same tokens', async () => {
      const ctx = await fetchLeagueContext('L1', 'auth-user-1');

      expect(ctx.matchupSummary).toContain('Week 10 (in_progress)\nLime: 105.5 pts\nRival: 117.8 pts\nGap: you trail by 12.3');
      expect(ctx.matchupSummary).toContain(
        'Projected this week: your starters 12.6, your bench 3.1, their whole roster 6.0 (their lineup is not visible)',
      );
      expect(ctx.matchupSummary).toContain('  C Lindahl (SEA) 61GP 30G 55PTS 0.9PPG xG:21.4 G-xG:+8.6 2GP/wk wkProj:6.0');
    });

    it('folds the opponent into the projection and schedule requests it already makes', async () => {
      await fetchLeagueContext('L1', 'auth-user-1');

      expect(vi.mocked(getWeeklyProjections)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getWeeklyProjections).mock.calls[0][0]).toEqual([1, 2, 3, 9]);
      expect(vi.mocked(fetchGamesForTeams)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetchGamesForTeams).mock.calls[0][0]).toEqual(['NJD', 'SEA']);
      // The wider GSAx select rides on the one goalie_gsax_primary query.
      const gsaxCalls = mockFrom.mock.calls.filter((call) => (call as unknown[])[0] === 'goalie_gsax_primary');
      expect(gsaxCalls).toHaveLength(1);
    });

    it('keeps the free-agent list, so a roster ROS can be read against a free agent ROS', async () => {
      const ctx = await fetchLeagueContext('L1', 'auth-user-1');

      expect(ctx.extra).toContain('Top Available Free Agents:\nG Reyes (SEA) ROS:168.4pts 3.2PPG 52GR');
      expect(ctx.extra).not.toContain('Marchetti');
      expect(ctx.extra).toContain('Roster slots: C:2 G:1 (3 total)');
    });

    it('serialises nothing the AI-voice guard bans, at runtime as well as in source', async () => {
      // aiVoiceGuard.test.ts scans this file's literals; the assembled
      // context is what the model actually reads, and this is the check
      // on that. The vocabulary is the shared JSON, not a copy.
      const here = resolve(fileURLToPath(import.meta.url), '..');
      const voice = JSON.parse(
        readFileSync(resolve(here, '../../../../../packages/shared/src/constants/aiVoice.json'), 'utf8'),
      ) as {
        bannedPhrases: Array<{ name: string; pattern: string }>;
        accuracyClaims: Array<{ name: string; pattern: string }>;
        moatOverstatement: { name: string; pattern: string };
        emDash: { char: string };
      };
      const ctx = await fetchLeagueContext('L1', 'auth-user-1');
      const Impl = (StormyService as any).constructor;
      const text = Impl.buildContextString({ page: 'matchup', ...ctx });

      expect(text.includes(voice.emDash.char)).toBe(false);
      for (const p of [...voice.bannedPhrases, ...voice.accuracyClaims, voice.moatOverstatement]) {
        expect(new RegExp(p.pattern, 'i').test(text), `${p.name} in the serialised context`).toBe(false);
      }
    });
  });
});
