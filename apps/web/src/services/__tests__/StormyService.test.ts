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

vi.mock('@/utils/seasonConstants', () => ({
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
    mockFunctionsInvoke.mockResolvedValue({
      data: { response: 'Stormy says hello!' },
      error: null,
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------
  describe('sendMessage', () => {
    it('calls edge function with message and history', async () => {
      const history: StormyMessage[] = [
        { role: 'user', content: 'Who should I start?' },
        { role: 'assistant', content: 'Check your lineup.' },
      ];

      const result = await StormyService.sendMessage('What about my goalie?', history);

      expect(mockFunctionsInvoke).toHaveBeenCalledWith('stormy-chat', {
        body: {
          message: 'What about my goalie?',
          conversationHistory: [
            { role: 'user', content: 'Who should I start?' },
            { role: 'assistant', content: 'Check your lineup.' },
          ],
          context: '',
        },
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

      const call = mockFunctionsInvoke.mock.calls[0];
      expect(call[1].body.context).toContain('Page: matchup');
      expect(call[1].body.context).toContain('League: Test League');
      expect(call[1].body.context).toContain("User's team: My Team");
    });

    it('returns error from edge function data.error', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { error: 'Rate limit exceeded' },
        error: null,
      });

      const result = await StormyService.sendMessage('Hello', []);

      expect(result.response).toBe('');
      expect(result.error).toBe('Rate limit exceeded');
    });

    it('returns error when edge function invocation fails', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Edge function unreachable' },
      });

      const result = await StormyService.sendMessage('Hello', []);

      expect(result.response).toBe('');
      expect(result.error).toBe('Edge function unreachable');
    });

    it('catches exceptions and returns error message', async () => {
      mockFunctionsInvoke.mockRejectedValue(new Error('Network timeout'));

      const result = await StormyService.sendMessage('Hello', []);

      expect(result.response).toBe('');
      expect(result.error).toBe('Network timeout');
    });

    it('returns usage data when available', async () => {
      mockFunctionsInvoke.mockResolvedValue({
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
      vi.doMock('@/utils/logger', () => ({
        logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }));
      vi.doMock('@/utils/seasonConstants', () => ({ CURRENT_SEASON: 2025 }));
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

      const call = mockFunctionsInvoke.mock.calls[0];
      const contextStr = call[1].body.context;
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
