import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/utils/logger';

// =============================================================================
// Mock Supabase client
// =============================================================================

const mockRpc = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: (...args: any[]) => mockRpc(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// =============================================================================
// Import AuditService AFTER mocks are registered
// =============================================================================

let AuditService: typeof import('../AuditService').AuditService;

beforeEach(async () => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: null, error: null });

  const mod = await import('../AuditService');
  AuditService = mod.AuditService;
});

// =============================================================================
// Tests
// =============================================================================

describe('AuditService', () => {
  // ---------------------------------------------------------------------------
  // log
  // ---------------------------------------------------------------------------
  describe('log', () => {
    it('calls log_security_event RPC with correct parameters', async () => {
      await AuditService.log('AUTH_LOGIN', 'league-1', { ip: '1.2.3.4' }, 'INFO');

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'AUTH_LOGIN',
        p_league_id: 'league-1',
        p_details: { ip: '1.2.3.4' },
        p_severity: 'INFO',
      });
    });

    it('defaults severity to INFO', async () => {
      await AuditService.log('LEAGUE_CREATE', 'league-1');

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_severity: 'INFO',
      }));
    });

    it('passes null for league_id when not provided', async () => {
      await AuditService.log('AUTH_LOGIN');

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_league_id: null,
      }));
    });

    it('passes empty object for details when not provided', async () => {
      await AuditService.log('AUTH_LOGOUT');

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_details: {},
      }));
    });

    it('does not throw when RPC fails (fire-and-forget)', async () => {
      mockRpc.mockRejectedValue(new Error('Database connection lost'));

      // Should not throw
      await expect(AuditService.log('AUTH_LOGIN')).resolves.toBeUndefined();
    });

    it('logs error to logger when RPC fails', async () => {
      mockRpc.mockRejectedValue(new Error('Database connection lost'));
      // logger is imported at module level (mocked via vi.mock)

      await AuditService.log('AUTH_LOGIN');

      expect(logger.error).toHaveBeenCalledWith(
        '[AuditService] Failed to log event:',
        'AUTH_LOGIN',
        expect.any(Error)
      );
    });
  });

  // ---------------------------------------------------------------------------
  // logLogin
  // ---------------------------------------------------------------------------
  describe('logLogin', () => {
    it('logs AUTH_LOGIN event with timestamp and userAgent', async () => {
      await AuditService.logLogin();

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'AUTH_LOGIN',
        p_league_id: null,
        p_details: expect.objectContaining({
          timestamp: expect.any(String),
          userAgent: expect.any(String),
        }),
      }));
    });
  });

  // ---------------------------------------------------------------------------
  // logLogout
  // ---------------------------------------------------------------------------
  describe('logLogout', () => {
    it('logs AUTH_LOGOUT event with timestamp', async () => {
      await AuditService.logLogout();

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'AUTH_LOGOUT',
        p_league_id: null,
        p_details: expect.objectContaining({
          timestamp: expect.any(String),
        }),
      }));
    });
  });

  // ---------------------------------------------------------------------------
  // logDraftEvent
  // ---------------------------------------------------------------------------
  describe('logDraftEvent', () => {
    it('logs DRAFT_START event', async () => {
      await AuditService.logDraftEvent('DRAFT_START', 'league-1', { teamCount: 10 });

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'DRAFT_START',
        p_league_id: 'league-1',
        p_details: { teamCount: 10 },
      }));
    });

    it('logs DRAFT_COMPLETE event', async () => {
      await AuditService.logDraftEvent('DRAFT_COMPLETE', 'league-1');

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'DRAFT_COMPLETE',
        p_league_id: 'league-1',
      }));
    });

    it('logs DRAFT_RESET event', async () => {
      await AuditService.logDraftEvent('DRAFT_RESET', 'league-1');

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'DRAFT_RESET',
      }));
    });
  });

  // ---------------------------------------------------------------------------
  // logRosterMove
  // ---------------------------------------------------------------------------
  describe('logRosterMove', () => {
    it('logs successful ROSTER_MOVE with INFO severity', async () => {
      await AuditService.logRosterMove(
        'league-1',
        { addPlayerId: 'player-1', dropPlayerId: 'player-2', teamId: 'team-1' },
        true
      );

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'ROSTER_MOVE',
        p_league_id: 'league-1',
        p_details: { addPlayerId: 'player-1', dropPlayerId: 'player-2', teamId: 'team-1' },
        p_severity: 'INFO',
      }));
    });

    it('logs failed ROSTER_MOVE_FAILED with WARN severity', async () => {
      await AuditService.logRosterMove(
        'league-1',
        { addPlayerId: 'player-1', teamId: 'team-1' },
        false
      );

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'ROSTER_MOVE_FAILED',
        p_severity: 'WARN',
      }));
    });

    it('defaults success to true when not provided', async () => {
      await AuditService.logRosterMove('league-1', { teamId: 'team-1' });

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'ROSTER_MOVE',
        p_severity: 'INFO',
      }));
    });
  });

  // ---------------------------------------------------------------------------
  // logLeagueEvent
  // ---------------------------------------------------------------------------
  describe('logLeagueEvent', () => {
    it('logs LEAGUE_CREATE event', async () => {
      await AuditService.logLeagueEvent('LEAGUE_CREATE', 'league-1', { name: 'Test League' });

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'LEAGUE_CREATE',
        p_league_id: 'league-1',
        p_details: { name: 'Test League' },
      }));
    });

    it('logs LEAGUE_JOIN event', async () => {
      await AuditService.logLeagueEvent('LEAGUE_JOIN', 'league-1');

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'LEAGUE_JOIN',
        p_league_id: 'league-1',
      }));
    });
  });

  // ---------------------------------------------------------------------------
  // logSecurityViolation
  // ---------------------------------------------------------------------------
  describe('logSecurityViolation', () => {
    it('logs SECURITY_VIOLATION with CRITICAL severity', async () => {
      await AuditService.logSecurityViolation(
        { attempt: 'RLS bypass', userId: 'attacker-1' },
        'league-1'
      );

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', {
        p_event_type: 'SECURITY_VIOLATION',
        p_league_id: 'league-1',
        p_details: { attempt: 'RLS bypass', userId: 'attacker-1' },
        p_severity: 'CRITICAL',
      });
    });

    it('works without leagueId', async () => {
      await AuditService.logSecurityViolation({ attempt: 'Unauthorized access' });

      expect(mockRpc).toHaveBeenCalledWith('log_security_event', expect.objectContaining({
        p_event_type: 'SECURITY_VIOLATION',
        p_league_id: null,
        p_severity: 'CRITICAL',
      }));
    });
  });
});
