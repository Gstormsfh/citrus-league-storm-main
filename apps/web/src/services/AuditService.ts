import { accountApi } from '@/api/account';
import { logger } from '@/utils/logger';

/**
 * ============================================================================
 * AUDIT SERVICE — SOC 2 CC7.2 Compliance
 * ============================================================================
 * 
 * Centralized audit logging for security-relevant events.
 * Logs are stored in the security_audit_log table in Supabase.
 * 
 * This service is fire-and-forget — audit logging failures should
 * NEVER block user-facing operations.
 * 
 * ============================================================================
 */

type SecurityEventType =
  | 'AUTH_LOGIN' | 'AUTH_LOGOUT' | 'AUTH_FAILED'
  | 'LEAGUE_CREATE' | 'LEAGUE_DELETE' | 'LEAGUE_JOIN' | 'LEAGUE_LEAVE'
  | 'DRAFT_START' | 'DRAFT_COMPLETE' | 'DRAFT_RESET'
  | 'ROSTER_MOVE' | 'ROSTER_MOVE_FAILED'
  | 'TRADE_OFFER' | 'TRADE_ACCEPT' | 'TRADE_REJECT'
  | 'WAIVER_CLAIM' | 'WAIVER_PROCESS'
  | 'ADMIN_ACTION' | 'SECURITY_VIOLATION'
  | 'RLS_BYPASS_ATTEMPT' | 'DATA_EXPORT';

type Severity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export const AuditService = {
  /**
   * Log a security event (fire-and-forget)
   * Never throws — failures are silently logged to console
   */
  async log(
    eventType: SecurityEventType,
    leagueId?: string | null,
    details?: Record<string, unknown>,
    severity: Severity = 'INFO'
  ): Promise<void> {
    try {
      await accountApi.logSecurityEvent(eventType, leagueId, details || {}, severity);
    } catch (error) {
      // Fire-and-forget — never block user operations.
      // Use debug level for auth events (token may already be cleared during sign-out)
      // AUTH_LOGOUT genuinely races the token being cleared, so it stays quiet.
      // AUTH_LOGIN had no such excuse: it was downgraded alongside logout, which
      // is why a 13.9% login capture rate (38 audit rows vs 274 real logins,
      // Apr-Aug 2026) produced no visible signal for four months.
      if (eventType === 'AUTH_LOGOUT') {
        logger.debug('[AuditService] Could not log event (expected during sign-out):', eventType);
      } else {
        logger.error('[AuditService] Failed to log event:', eventType, error);
      }
    }
  },

  /**
   * Log a login event
   */
  async logLogin(): Promise<void> {
    await this.log('AUTH_LOGIN', null, {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent
    });
  },

  /**
   * Log a logout event
   */
  async logLogout(): Promise<void> {
    await this.log('AUTH_LOGOUT', null, {
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log a draft event
   */
  async logDraftEvent(
    eventType: 'DRAFT_START' | 'DRAFT_COMPLETE' | 'DRAFT_RESET',
    leagueId: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.log(eventType, leagueId, details);
  },

  /**
   * Log a roster move
   */
  async logRosterMove(
    leagueId: string,
    details: { addPlayerId?: string; dropPlayerId?: string; teamId?: string },
    success: boolean = true
  ): Promise<void> {
    await this.log(
      success ? 'ROSTER_MOVE' : 'ROSTER_MOVE_FAILED',
      leagueId,
      details,
      success ? 'INFO' : 'WARN'
    );
  },

  /**
   * Log a league management event
   */
  async logLeagueEvent(
    eventType: 'LEAGUE_CREATE' | 'LEAGUE_DELETE' | 'LEAGUE_JOIN' | 'LEAGUE_LEAVE',
    leagueId: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.log(eventType, leagueId, details);
  },

  /**
   * Log a security violation (high severity)
   */
  async logSecurityViolation(
    details: Record<string, unknown>,
    leagueId?: string
  ): Promise<void> {
    await this.log('SECURITY_VIOLATION', leagueId, details, 'CRITICAL');
  }
};
