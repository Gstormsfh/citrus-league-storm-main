import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, logger, wasMatchupPlayed } from '@citrus/shared';

export class AccountService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Get the current user's profile (RLS ensures they can only see their own) */
  async getProfile() {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) return { success: false as const, error: 'Not authenticated' };

    const { data, error } = await this.supabase
      .from('profiles')
      .select(COLUMNS.PROFILE)
      .eq('id', user.id)
      .maybeSingle();

    if (error) return { success: false as const, error: error.message };
    return { success: true as const, data: data || null };
  }

  async exportUserData() {
    const { data, error } = await this.supabase.rpc('export_user_data');
    if (error) return { success: false, error: error.message };
    const result = data as Record<string, unknown>;
    if (result && result.success === false) return { success: false, error: (result.error as string) || 'Export failed' };
    return { success: true, data: result };
  }

  async deleteAccount() {
    const { data, error } = await this.supabase.rpc('delete_user_account');
    if (error) return { success: false, error: error.message };
    const result = data as Record<string, unknown>;
    if (result && result.success === false) return { success: false, error: (result.error as string) || 'Deletion failed' };
    return { success: true };
  }

  /**
   * Record a GDPR Art. 7 consent grant.
   *
   * public.record_user_consent did not exist until 2026-08-12, and .rpc()
   * returns its error instead of throwing, so this method discarded the error
   * and reported success on every one of 72 signups. Consent is legal
   * evidence: if it did not persist, say so.
   */
  async recordConsent(policyType: string, version: string) {
    const { error } = await this.supabase.rpc('record_user_consent', {
      p_policy_type: policyType,
      p_version: version,
    });
    if (error) {
      logger.error('[AccountService] GDPR consent record REJECTED', {
        policyType, version, code: error.code, message: error.message,
      });
      return { success: false as const, error: error.message };
    }
    return { success: true as const };
  }

  /** GDPR Art. 7(3) — withdraw a consent the user previously gave. */
  async withdrawConsent(policyType: string, version?: string | null) {
    const { data, error } = await this.supabase.rpc('withdraw_user_consent', {
      p_policy_type: policyType,
      p_version: version ?? null,
    });
    if (error) {
      logger.error('[AccountService] consent withdrawal REJECTED', {
        policyType, version, code: error.code, message: error.message,
      });
      return { success: false as const, error: error.message };
    }
    return { success: true as const, data };
  }

  /**
   * What the user still owes: one row per policy in force, each
   * current | outdated | withdrawn | never_given.
   *
   * never_given is the honest state for the 72 accounts that signed up while
   * public.record_user_consent did not exist. They were not backfilled --
   * writing consent rows for people who never gave one manufactures exactly
   * the evidence this ledger exists to provide.
   */
  async getConsentStatus() {
    const { data, error } = await this.supabase.rpc('get_user_consent_status');
    if (error) {
      logger.error('[AccountService] consent status read failed', {
        code: error.code, message: error.message,
      });
      return { success: false as const, error: error.message };
    }
    return { success: true as const, data: data || [] };
  }

  async logSecurityEvent(eventType: string, leagueId: string | null, details: Record<string, unknown>, severity: string = 'INFO') {
    const { error } = await this.supabase.rpc('log_security_event', {
      p_event_type: eventType, p_league_id: leagueId || null,
      p_details: details || {}, p_severity: severity,
    });
    if (error) {
      // Loud but non-blocking. The caller still returns 200 so audit logging
      // can never break a user-facing path; check_audit_trail_integrity is the
      // outside observer that catches sustained failure.
      logger.error('[AccountService] SOC2 audit write REJECTED', {
        eventType, severity, leagueId, code: error.code, message: error.message,
      });
      return { success: false as const, error: error.message };
    }
    return { success: true as const };
  }

  /**
   * Get aggregated performance stats for the authenticated user across all leagues.
   * Returns W-L record, total seasons, and total fantasy points scored.
   */
  async getUserStats(userId: string) {
    // 1. Get all teams owned by this user
    const { data: teams, error: teamsError } = await this.supabase
      .from('teams')
      .select('id, league_id')
      .eq('owner_id', userId);

    if (teamsError) return { success: false as const, error: teamsError.message };
    if (!teams || teams.length === 0) {
      return {
        success: true as const,
        data: { totalSeasons: 0, wins: 0, losses: 0, ties: 0, totalPoints: 0 },
      };
    }

    const teamIds = teams.map((t: { id: string }) => t.id);
    const uniqueLeagueIds = [...new Set(teams.map((t: { league_id: string }) => t.league_id))];

    // 2. Get all completed matchups involving user's teams
    const { data: matchups, error: matchupsError } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP_SLIM)
      .eq('status', 'completed')
      .or(teamIds.map((id: string) => `team1_id.eq.${id}`).join(',') + ',' + teamIds.map((id: string) => `team2_id.eq.${id}`).join(','));

    if (matchupsError) return { success: false as const, error: matchupsError.message };

    let wins = 0;
    let losses = 0;
    let ties = 0;
    let totalPoints = 0;

    interface MatchupRow {
      team1_id: string;
      team2_id: string;
      team1_score: number | string | null;
      team2_score: number | string | null;
    }

    const teamIdSet = new Set(teamIds);

    // A career record must not count weeks nobody played. This read filters
    // on status='completed', but 12 team-matchup rows in production are
    // completed at 0.000-0.000 (seeded, not scored), and the old `else`
    // branch booked every one of them as a career tie. Same defect the
    // standings page carried as "1-1-18" on the demo league, so it shares
    // the same rule rather than growing a second opinion of what a played
    // week is: packages/shared/src/utils/standings.ts.
    ((matchups || []) as unknown as MatchupRow[]).forEach((m) => {
      if (!wasMatchupPlayed({
        team2_id: m.team2_id,
        team1_score: m.team1_score,
        team2_score: m.team2_score,
      })) return;

      const isTeam1 = teamIdSet.has(m.team1_id);
      const myScore = parseFloat(String(isTeam1 ? m.team1_score : m.team2_score)) || 0;
      const oppScore = parseFloat(String(isTeam1 ? m.team2_score : m.team1_score)) || 0;
      totalPoints += myScore;
      if (myScore > oppScore) wins++;
      else if (oppScore > myScore) losses++;
      else ties++;
    });

    return {
      success: true as const,
      data: {
        totalSeasons: uniqueLeagueIds.length,
        wins,
        losses,
        ties,
        totalPoints: Math.round(totalPoints * 100) / 100,
      },
    };
  }
}
