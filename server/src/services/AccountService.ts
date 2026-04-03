import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';

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

  async recordConsent(policyType: string, version: string) {
    await this.supabase.rpc('record_user_consent', { p_policy_type: policyType, p_version: version });
    return { success: true };
  }

  async logSecurityEvent(eventType: string, leagueId: string | null, details: Record<string, unknown>, severity: string = 'INFO') {
    await this.supabase.rpc('log_security_event', {
      p_event_type: eventType, p_league_id: leagueId || null,
      p_details: details || {}, p_severity: severity,
    });
    return { success: true };
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

    ((matchups || []) as unknown as MatchupRow[]).forEach((m) => {
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
