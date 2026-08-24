import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@citrus/shared';

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
  | 'DRAFT_START' | 'DRAFT_COMPLETE' | 'DRAFT_RESET' | 'DRAFT_OFFLINE_IMPORT'
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
      // supabase-js RETURNS its error rather than throwing, so the bare
      // `catch {}` that used to be here caught nothing: every rejected audit
      // write vanished without a trace. That is how security_audit_log went
      // 51 days without a row and nothing noticed. Fire-and-forget still
      // means never block the caller — it does not mean never say anything.
      const { error } = await this.supabase.rpc('log_security_event', {
        p_event_type: eventType,
        p_league_id: leagueId || null,
        p_details: details || {},
        p_severity: severity,
      });
      if (error) {
        logger.error('[AuditService] SOC2 audit write REJECTED', {
          eventType,
          severity,
          leagueId: leagueId || null,
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
      }
    } catch (err) {
      // Still never rethrow: audit logging must not break a user operation.
      logger.error('[AuditService] SOC2 audit write THREW', {
        eventType,
        severity,
        leagueId: leagueId || null,
        error: err instanceof Error ? err.message : String(err),
      });
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
    eventType: 'DRAFT_START' | 'DRAFT_COMPLETE' | 'DRAFT_RESET' | 'DRAFT_OFFLINE_IMPORT',
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
