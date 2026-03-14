import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';
import { LeagueMembershipService } from './LeagueMembershipService';

/**
 * LeagueService — Server-side league management with dependency-injected Supabase client.
 *
 * Extracted from apps/web/src/services/LeagueService.ts.
 * All business logic preserved; browser-specific code removed.
 */
export class LeagueService {
  private supabase: SupabaseClient;
  private membership: LeagueMembershipService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.membership = new LeagueMembershipService(supabase);
  }

  /** Get all leagues for a user (commissioner + team owner, deduplicated) */
  async getUserLeagues(userId: string) {
    const { data: commissionerLeagues } = await this.supabase
      .from('leagues')
      .select(COLUMNS.LEAGUE)
      .eq('commissioner_id', userId);

    const { data: teamData } = await this.supabase
      .from('teams')
      .select('league_id')
      .eq('owner_id', userId);

    const teamLeagueIds = (teamData || []).map((t: { league_id: string }) => t.league_id);

    let memberLeagues: Record<string, unknown>[] = [];
    if (teamLeagueIds.length > 0) {
      const { data } = await this.supabase
        .from('leagues')
        .select(COLUMNS.LEAGUE)
        .in('id', teamLeagueIds);
      memberLeagues = (data || []) as unknown as Record<string, unknown>[];
    }

    const allLeagues = [...(commissionerLeagues || []), ...memberLeagues];
    const unique = Array.from(new Map(allLeagues.map((l: Record<string, unknown>) => [l.id, l])).values());
    return { leagues: unique, error: null };
  }

  /** Get a specific league (membership-gated) */
  async getLeague(leagueId: string, userId: string) {
    await this.membership.requireMembership(leagueId, userId);

    const { data, error } = await this.supabase
      .from('leagues')
      .select(COLUMNS.LEAGUE)
      .eq('id', leagueId)
      .single();

    return { league: data, error };
  }

  /** Create a new league with commissioner team + optional FAAB budget */
  async createLeague(
    name: string,
    commissionerId: string,
    rosterSize?: number,
    draftRounds?: number,
    settings?: Record<string, any>,
    scoringSettings?: Record<string, number>,
    waiverSettings?: Record<string, any>,
  ) {
    // Create league
    const { data: leagueData, error: leagueError } = await this.supabase
      .from('leagues')
      .insert({
        name,
        commissioner_id: commissionerId,
        roster_size: rosterSize || 21,
        draft_rounds: draftRounds || 21,
        settings: settings || {},
        scoring_settings: scoringSettings || null,
      })
      .select(COLUMNS.LEAGUE)
      .single();

    const league = leagueData as any;
    if (leagueError || !league) {
      return { league: null, team: null, error: leagueError };
    }

    // Get commissioner profile for default team name
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('username, first_name, last_name, default_team_name')
      .eq('id', commissionerId)
      .single();

    const teamName = profile?.default_team_name
      || (profile?.first_name ? `${profile.first_name}'s Team` : 'My Team');

    // Create commissioner's team
    const { data: teamData, error: teamError } = await this.supabase
      .from('teams')
      .insert({
        league_id: league.id,
        owner_id: commissionerId,
        team_name: teamName,
      })
      .select(COLUMNS.TEAM)
      .single();
    const team = teamData as any;

    // Initialize FAAB budget if enabled
    if (waiverSettings?.waiver_type === 'faab' || settings?.waiver_type === 'faab') {
      const initialBudget = waiverSettings?.faab_budget || settings?.faab_budget || 100;
      if (team) {
        await this.supabase.from('faab_budgets').insert({
          league_id: league.id,
          team_id: team.id,
          initial_budget: initialBudget,
          remaining_budget: initialBudget,
        });
      }
    }

    return { league, team, error: teamError };
  }

  /** Join a league using an invite code (atomic RPC) */
  async joinLeagueByCode(joinCode: string, userId: string, teamName?: string) {
    if (!joinCode || !userId) {
      return { league: null, team: null, error: 'Join code and user ID are required' };
    }

    const { data, error } = await this.supabase.rpc('join_league_with_code', {
      p_join_code: joinCode.toUpperCase().trim(),
      p_user_id: userId,
      p_team_name: teamName || null,
    });

    if (error) {
      return { league: null, team: null, error: error.message };
    }

    // Parse RPC response
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return {
      league: result?.league || null,
      team: result?.team || null,
      error: result?.error || null,
    };
  }

  /** Update waiver settings (commissioner only) */
  async updateWaiverSettings(
    leagueId: string,
    userId: string,
    settings: {
      waiver_process_time?: string;
      waiver_period_hours?: number;
      waiver_game_lock?: boolean;
      waiver_type?: 'rolling' | 'faab' | 'reverse_standings';
      allow_trades_during_games?: boolean;
    },
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { error } = await this.supabase
      .from('leagues')
      .update({
        waiver_process_time: settings.waiver_process_time,
        waiver_period_hours: settings.waiver_period_hours,
        waiver_game_lock: settings.waiver_game_lock,
        waiver_type: settings.waiver_type,
        allow_trades_during_games: settings.allow_trades_during_games,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Waiver settings have been updated by the commissioner.');
    }

    return { success: !error, error };
  }

  /** Update scoring settings (commissioner only, locked after games scored) */
  async updateScoringSettings(
    leagueId: string,
    userId: string,
    scoringSettings: { skater?: Record<string, number>; goalie?: Record<string, number> },
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    // Check if any matchups have been scored
    const { count } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);

    if (count && count > 0) {
      return { success: false, error: 'Cannot change scoring after games have been scored' };
    }

    const { error } = await this.supabase
      .from('leagues')
      .update({
        scoring_settings: scoringSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Scoring settings have been updated by the commissioner.');
    }

    return { success: !error, error };
  }

  /** Update draft settings (commissioner only) */
  async updateDraftSettings(
    leagueId: string,
    userId: string,
    draftSettings: { draft_rounds?: number; pickTimeLimit?: number; draft_status?: string; scheduled_draft_time?: string },
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const currentSettings = league?.settings || {};
    const updatedSettings = { ...currentSettings };
    if (draftSettings.pickTimeLimit !== undefined) {
      updatedSettings.pickTimeLimit = draftSettings.pickTimeLimit;
    }

    const updatePayload: Record<string, any> = {
      settings: updatedSettings,
      updated_at: new Date().toISOString(),
    };
    if (draftSettings.draft_rounds !== undefined) {
      updatePayload.draft_rounds = draftSettings.draft_rounds;
    }
    if (draftSettings.draft_status !== undefined) {
      updatePayload.draft_status = draftSettings.draft_status;
    }
    if (draftSettings.scheduled_draft_time !== undefined) {
      updatePayload.scheduled_draft_time = draftSettings.scheduled_draft_time;
    }

    const { error } = await this.supabase
      .from('leagues')
      .update(updatePayload)
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Draft settings have been updated by the commissioner.');
    }

    return { success: !error, error };
  }

  /** Update roster slot settings (commissioner only, locked after draft) */
  async updateRosterSlotSettings(
    leagueId: string,
    userId: string,
    rosterSlots: Record<string, number>,
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings, draft_status')
      .eq('id', leagueId)
      .single();

    if (league?.draft_status === 'completed') {
      return { success: false, error: 'Cannot change roster slots after draft is completed' };
    }

    const currentSettings = league?.settings || {};
    const updatedSettings = { ...currentSettings, rosterSlots };

    // Calculate new roster size from slots
    const newRosterSize = Object.values(rosterSlots).reduce((sum: number, v: number) => sum + (v || 0), 0);

    const { error } = await this.supabase
      .from('leagues')
      .update({
        settings: updatedSettings,
        roster_size: newRosterSize,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Roster slot settings have been updated by the commissioner.');
    }

    return { success: !error, error };
  }

  /** Get all teams in a league (uses RPC to avoid RLS recursion) */
  async getLeagueTeams(leagueId: string) {
    const { data, error } = await this.supabase.rpc('get_league_teams', {
      p_league_id: leagueId,
    });

    if (error) {
      // Fallback to direct query
      const { data: fallback, error: fbError } = await this.supabase
        .from('teams')
        .select(COLUMNS.TEAM)
        .eq('league_id', leagueId);
      return { teams: fallback || [], error: fbError };
    }

    return { teams: data || [], error: null };
  }

  /** Get teams with owner profile names */
  async getLeagueTeamsWithOwners(leagueId: string) {
    const { teams, error } = await this.getLeagueTeams(leagueId);
    if (error || !teams.length) return { teams: [], error };

    const ownerIds = [...new Set(teams.map((t: { owner_id: string }) => t.owner_id).filter(Boolean))];
    let profiles: { id: string; username: string | null; first_name: string | null; last_name: string | null }[] = [];
    if (ownerIds.length > 0) {
      const { data } = await this.supabase
        .from('profiles')
        .select('id, username, first_name, last_name')
        .in('id', ownerIds);
      profiles = data || [];
    }

    const profileMap = new Map(profiles.map((p: { id: string; username: string | null; first_name: string | null; last_name: string | null }) => [p.id, p]));
    const teamsWithOwners = teams.map((t: { owner_id: string; [key: string]: unknown }) => {
      const profile = profileMap.get(t.owner_id);
      const ownerName = profile
        ? (profile.first_name && profile.last_name
            ? `${profile.first_name} ${profile.last_name}`
            : profile.username || 'Unknown')
        : 'Unknown';
      return { ...t, owner_name: ownerName };
    });

    return { teams: teamsWithOwners, error: null };
  }

  /** Get the user's team in a specific league */
  async getUserTeam(leagueId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('teams')
      .select(COLUMNS.TEAM)
      .eq('league_id', leagueId)
      .eq('owner_id', userId)
      .maybeSingle();

    return { team: data, error };
  }

  /** Delete a team (commissioner only) */
  async deleteTeam(teamId: string, leagueId: string, userId: string) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { error } = await this.supabase
      .from('teams')
      .delete()
      .eq('id', teamId)
      .eq('league_id', leagueId);

    return { success: !error, error };
  }

  /** Update league settings (generic) */
  async updateSettings(leagueId: string, userId: string, settings: Record<string, any>, scoringSettings?: Record<string, any>) {
    await this.membership.requireCommissioner(leagueId, userId);

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (settings !== undefined) updatePayload.settings = settings;
    if (scoringSettings !== undefined) updatePayload.scoring_settings = scoringSettings;

    const { data, error } = await this.supabase
      .from('leagues')
      .update(updatePayload)
      .eq('id', leagueId)
      .select(COLUMNS.LEAGUE)
      .single();

    return { league: data, error };
  }

  /** Get league standings sorted by wins */
  async getStandings(leagueId: string) {
    const { data, error } = await this.supabase
      .from('teams')
      .select('id, team_name, owner_id, wins, losses, ties, points_for, points_against')
      .eq('league_id', leagueId)
      .order('wins', { ascending: false });

    return { standings: data || [], error };
  }

  /** Fetch transactions from the transaction ledger */
  async fetchTransactions(leagueId: string) {
    const { data, error } = await this.supabase
      .from('transaction_ledger')
      .select('*, teams(team_name), profiles(username, first_name, last_name)')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(50);

    return { transactions: data || [], error };
  }

  /** Update keeper/dynasty settings (commissioner only, locked after draft) */
  async updateKeeperSettings(
    leagueId: string,
    userId: string,
    keeperSettings: { keeperEnabled: boolean; keeperCount: number; keeperPenalty: string; dynastyMode: boolean },
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings, draft_status')
      .eq('id', leagueId)
      .single();

    if (league?.draft_status === 'completed') {
      return { success: false, error: 'Keeper settings cannot be changed after the draft is completed' };
    }

    const currentSettings = league?.settings || {};
    const { error } = await this.supabase
      .from('leagues')
      .update({
        settings: {
          ...currentSettings,
          keeperEnabled: keeperSettings.keeperEnabled,
          keeperCount: keeperSettings.keeperCount,
          keeperPenalty: keeperSettings.keeperPenalty,
          dynastyMode: keeperSettings.dynastyMode,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, 'Commissioner updated keeper/dynasty settings.');
    }

    return { success: !error, error };
  }

  /** Update category settings (commissioner only, locked after draft) */
  async updateCategorySettings(
    leagueId: string,
    userId: string,
    categories: string[],
  ) {
    await this.membership.requireCommissioner(leagueId, userId);

    if (!categories || categories.length < 2) {
      return { success: false, error: 'At least 2 categories are required' };
    }

    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings, draft_status')
      .eq('id', leagueId)
      .single();

    if (league?.draft_status === 'completed') {
      return { success: false, error: 'Category settings cannot be changed after the draft is completed' };
    }

    const currentSettings = league?.settings || {};
    const { error } = await this.supabase
      .from('leagues')
      .update({
        settings: { ...currentSettings, categories },
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.notifyLeagueMembers(leagueId, `Commissioner updated stat categories (${categories.length} categories).`);
    }

    return { success: !error, error };
  }

  /** Notify all league members via RPC (with fallback) */
  async notifyLeagueMembers(leagueId: string, message: string, title?: string) {
    try {
      await this.supabase.rpc('notify_league_members', {
        p_league_id: leagueId,
        p_message: message,
        p_title: title || 'League Update',
      });
    } catch {
      // Fallback: insert notifications directly for each team owner
      try {
        const { data: teams } = await this.supabase
          .from('teams')
          .select('owner_id')
          .eq('league_id', leagueId);

        if (teams && teams.length > 0) {
          const notifications = teams.map((t: { owner_id: string }) => ({
            user_id: t.owner_id,
            league_id: leagueId,
            type: 'SYSTEM',
            title: title || 'League Update',
            message,
          }));
          await this.supabase.from('notifications').insert(notifications);
        }
      } catch {
        // Silent fail — notifications are best-effort
      }
    }
  }
}
