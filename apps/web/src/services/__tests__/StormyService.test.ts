import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const mockFrom = vi.fn(() => createChainMock());

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
}));

vi.mock('@/utils/scheduleMaximizer', () => ({
  fetchGamesForTeams: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/utils/projectionHelper', () => ({
  getWeeklyProjections: vi.fn().mockResolvedValue(new Map()),
}));

// =============================================================================
// Import after mocks
// =============================================================================

import { StormyService } from '../StormyService';
import type { StormyContext, StormyMessage } from '../StormyService';

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
});
