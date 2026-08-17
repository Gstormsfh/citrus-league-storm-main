import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/utils/logger';

// =============================================================================
// Mock API client
// =============================================================================

const mockLogSecurityEvent = vi.fn();

vi.mock('@/api/account', () => ({
  accountApi: {
    logSecurityEvent: (...args: any[]) => mockLogSecurityEvent(...args),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
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
  mockLogSecurityEvent.mockResolvedValue({ data: null, error: undefined });

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
    it('calls logSecurityEvent API with correct parameters', async () => {
      await AuditService.log('AUTH_LOGIN', 'league-1', { ip: '1.2.3.4' }, 'INFO');

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'AUTH_LOGIN',
        'league-1',
        { ip: '1.2.3.4' },
        'INFO'
      );
    });

    it('defaults severity to INFO', async () => {
      await AuditService.log('LEAGUE_CREATE', 'league-1');

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'LEAGUE_CREATE',
        'league-1',
        {},
        'INFO'
      );
    });

    it('passes null for league_id when not provided', async () => {
      await AuditService.log('AUTH_LOGIN');

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'AUTH_LOGIN',
        undefined,
        {},
        'INFO'
      );
    });

    it('passes empty object for details when not provided', async () => {
      await AuditService.log('AUTH_LOGOUT');

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'AUTH_LOGOUT',
        undefined,
        {},
        'INFO'
      );
    });

    it('does not throw when API call fails (fire-and-forget)', async () => {
      mockLogSecurityEvent.mockRejectedValue(new Error('Database connection lost'));

      // Should not throw
      await expect(AuditService.log('AUTH_LOGIN')).resolves.toBeUndefined();
    });

    it('logs debug message for sign-out when API call fails', async () => {
      mockLogSecurityEvent.mockRejectedValue(new Error('Database connection lost'));

      await AuditService.log('AUTH_LOGOUT');

      // Only AUTH_LOGOUT genuinely races the token being cleared, so only it
      // stays quiet. See AuditService.ts:46.
      expect(logger.debug).toHaveBeenCalledWith(
        '[AuditService] Could not log event (expected during sign-out):',
        'AUTH_LOGOUT'
      );
    });

    // REGRESSION GUARD (2026-08-18, consolidation merge). AUTH_LOGIN used to
    // be downgraded to debug alongside AUTH_LOGOUT. That hid login-audit
    // failures completely: 38 audit rows against 274 real logins over four
    // months (13.9% capture) with no visible signal. AuditService.ts now
    // routes AUTH_LOGIN to error; this test is what stops it being quietly
    // downgraded a second time.
    it('logs error for failed AUTH_LOGIN (never downgraded to debug)', async () => {
      mockLogSecurityEvent.mockRejectedValue(new Error('Database connection lost'));

      await AuditService.log('AUTH_LOGIN');

      expect(logger.error).toHaveBeenCalledWith(
        '[AuditService] Failed to log event:',
        'AUTH_LOGIN',
        expect.any(Error)
      );
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.anything(),
        'AUTH_LOGIN'
      );
    });

    it('logs error for non-auth events when API call fails', async () => {
      mockLogSecurityEvent.mockRejectedValue(new Error('Database connection lost'));

      await AuditService.log('LEAGUE_CREATE', 'league-1');

      expect(logger.error).toHaveBeenCalledWith(
        '[AuditService] Failed to log event:',
        'LEAGUE_CREATE',
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

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'AUTH_LOGIN',
        null,
        expect.objectContaining({
          timestamp: expect.any(String),
          userAgent: expect.any(String),
        }),
        'INFO'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // logLogout
  // ---------------------------------------------------------------------------
  describe('logLogout', () => {
    it('logs AUTH_LOGOUT event with timestamp', async () => {
      await AuditService.logLogout();

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'AUTH_LOGOUT',
        null,
        expect.objectContaining({
          timestamp: expect.any(String),
        }),
        'INFO'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // logDraftEvent
  // ---------------------------------------------------------------------------
  describe('logDraftEvent', () => {
    it('logs DRAFT_START event', async () => {
      await AuditService.logDraftEvent('DRAFT_START', 'league-1', { teamCount: 10 });

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'DRAFT_START',
        'league-1',
        { teamCount: 10 },
        'INFO'
      );
    });

    it('logs DRAFT_COMPLETE event', async () => {
      await AuditService.logDraftEvent('DRAFT_COMPLETE', 'league-1');

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'DRAFT_COMPLETE',
        'league-1',
        {},
        'INFO'
      );
    });

    it('logs DRAFT_RESET event', async () => {
      await AuditService.logDraftEvent('DRAFT_RESET', 'league-1');

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'DRAFT_RESET',
        'league-1',
        {},
        'INFO'
      );
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

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'ROSTER_MOVE',
        'league-1',
        { addPlayerId: 'player-1', dropPlayerId: 'player-2', teamId: 'team-1' },
        'INFO'
      );
    });

    it('logs failed ROSTER_MOVE_FAILED with WARN severity', async () => {
      await AuditService.logRosterMove(
        'league-1',
        { addPlayerId: 'player-1', teamId: 'team-1' },
        false
      );

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'ROSTER_MOVE_FAILED',
        'league-1',
        { addPlayerId: 'player-1', teamId: 'team-1' },
        'WARN'
      );
    });

    it('defaults success to true when not provided', async () => {
      await AuditService.logRosterMove('league-1', { teamId: 'team-1' });

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'ROSTER_MOVE',
        'league-1',
        { teamId: 'team-1' },
        'INFO'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // logLeagueEvent
  // ---------------------------------------------------------------------------
  describe('logLeagueEvent', () => {
    it('logs LEAGUE_CREATE event', async () => {
      await AuditService.logLeagueEvent('LEAGUE_CREATE', 'league-1', { name: 'Test League' });

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'LEAGUE_CREATE',
        'league-1',
        { name: 'Test League' },
        'INFO'
      );
    });

    it('logs LEAGUE_JOIN event', async () => {
      await AuditService.logLeagueEvent('LEAGUE_JOIN', 'league-1');

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'LEAGUE_JOIN',
        'league-1',
        {},
        'INFO'
      );
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

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'SECURITY_VIOLATION',
        'league-1',
        { attempt: 'RLS bypass', userId: 'attacker-1' },
        'CRITICAL'
      );
    });

    it('works without leagueId', async () => {
      await AuditService.logSecurityViolation({ attempt: 'Unauthorized access' });

      expect(mockLogSecurityEvent).toHaveBeenCalledWith(
        'SECURITY_VIOLATION',
        undefined,
        { attempt: 'Unauthorized access' },
        'CRITICAL'
      );
    });
  });
});
