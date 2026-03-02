import { SupabaseClient } from '@supabase/supabase-js';

/**
 * AuditService — Server-side security audit logging with DI Supabase client.
 *
 * Extracted from apps/web/src/services/AuditService.ts.
 * Fire-and-forget pattern — never blocks user operations.
 * SOC 2 CC7.2 compliance for security event logging.
 */

type SecurityEventType =
  | 'AUTH_LOGIN' | 'AUTH_LOGOUT' | 'AUTH_FAILED'
  | 'LEAGUE_CREATE' | 'LEAGUE_DELETE' | 'LEAGUE_JOIN' | 'LEAGUE_LEAVE'
  | 'DRAFT_START' | 'DRAFT_COMPLETE' | 'DRAFT_RESET'
  | 'ROSTER_MOVE' | 'ROSTER_MOVE_FAILED'
  | 'TRADE_OFFER' | 'TRADE_ACCEPT' | 'TRADE_REJECT'
  | 'WAIVER_CLAIM' | 'WAIVER_PROCESS'
  | 'ADMIN_ACTION'
  | 'RLS_BYPASS_ATTEMPT' | 'DATA_EXPORT' | 'SECURITY_VIOLATION';

type Severity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export class AuditService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Log a security event (fire-and-forget) */
  async log(
    eventType: SecurityEventType,
    leagueId?: string | null,
    details?: Record<string, unknown>,
    severity: Severity = 'INFO',
  ) {
    try {
      await this.supabase.rpc('log_security_event', {
        p_event_type: eventType,
        p_league_id: leagueId || null,
        p_details: details || {},
        p_severity: severity,
      });
    } catch {
      // Silent fail — audit logging should never block operations
    }
  }

  async logRosterMove(
    leagueId: string,
    details: { addPlayerId?: string; dropPlayerId?: string; teamId?: string },
    success = true,
  ) {
    await this.log(
      success ? 'ROSTER_MOVE' : 'ROSTER_MOVE_FAILED',
      leagueId,
      details,
      success ? 'INFO' : 'WARN',
    );
  }

  async logDraftEvent(
    eventType: 'DRAFT_START' | 'DRAFT_COMPLETE' | 'DRAFT_RESET',
    leagueId: string,
    details?: Record<string, unknown>,
  ) {
    await this.log(eventType, leagueId, details);
  }

  async logLeagueEvent(
    eventType: 'LEAGUE_CREATE' | 'LEAGUE_DELETE' | 'LEAGUE_JOIN' | 'LEAGUE_LEAVE',
    leagueId: string,
    details?: Record<string, unknown>,
  ) {
    await this.log(eventType, leagueId, details);
  }

  async logSecurityViolation(details: Record<string, unknown>, leagueId?: string) {
    await this.log('SECURITY_VIOLATION', leagueId, details, 'CRITICAL');
  }
}
