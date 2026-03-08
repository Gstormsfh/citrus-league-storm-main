import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';

export class KeeperService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async designateKeeper(leagueId: string, teamId: string, playerId: string, seasonYear: number, originalDraftRound?: number) {
    const { data, error } = await this.supabase
      .from('keeper_designations')
      .insert({
        league_id: leagueId, team_id: teamId, player_id: playerId,
        season_year: seasonYear, original_draft_round: originalDraftRound || null, status: 'designated',
      })
      .select(COLUMNS.KEEPER_DESIGNATION).single();

    if (error) {
      if (error.code === '23505') return { success: false, error: 'Player is already designated as a keeper' };
      return { success: false, error: error.message };
    }
    return { success: true, designation: data };
  }

  async releaseKeeper(keeperDesignationId: string, teamId: string) {
    const { error } = await this.supabase
      .from('keeper_designations')
      .update({ status: 'released' })
      .eq('id', keeperDesignationId).eq('team_id', teamId)
      .in('status', ['designated', 'approved']);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async getTeamKeepers(leagueId: string, teamId: string, seasonYear: number) {
    const { data, error } = await this.supabase
      .from('keeper_designations')
      .select('id, league_id, team_id, player_id, season_year, keeper_round, keeper_penalty_type, original_draft_round, years_kept, designated_at, approved_by, status')
      .eq('league_id', leagueId).eq('team_id', teamId).eq('season_year', seasonYear)
      .in('status', ['designated', 'approved', 'locked'])
      .order('designated_at', { ascending: true });
    return { keepers: data ?? [], error };
  }

  async getLeagueKeepers(leagueId: string, seasonYear: number) {
    const { data, error } = await this.supabase
      .from('keeper_designations')
      .select('id, league_id, team_id, player_id, season_year, keeper_round, keeper_penalty_type, original_draft_round, years_kept, designated_at, approved_by, status')
      .eq('league_id', leagueId).eq('season_year', seasonYear)
      .in('status', ['designated', 'approved', 'locked'])
      .order('team_id', { ascending: true });
    return { keepers: data ?? [], error };
  }

  async validateKeepers(leagueId: string, teamId: string, seasonYear: number) {
    const { data, error } = await this.supabase.rpc('validate_keeper_selections', {
      p_league_id: leagueId, p_team_id: teamId, p_season_year: seasonYear,
    });
    if (error) return { is_valid: false, error_message: error.message, keepers_count: 0, max_keepers: 0, error };
    const result = data?.[0] || data;
    return {
      is_valid: result?.is_valid ?? false,
      error_message: result?.error_message ?? null,
      keepers_count: result?.keepers_count ?? 0,
      max_keepers: result?.max_keepers ?? 0,
    };
  }

  async getKeeperDraftCosts(leagueId: string, teamId: string, seasonYear: number) {
    const { data, error } = await this.supabase.rpc('get_keeper_draft_costs', {
      p_league_id: leagueId, p_team_id: teamId, p_season_year: seasonYear,
    });
    return { costs: data ?? [], error };
  }

  async lockKeepersForSeason(leagueId: string, seasonYear: number) {
    const { data, error } = await this.supabase.rpc('lock_keepers_for_season', {
      p_league_id: leagueId, p_season_year: seasonYear,
    });
    if (error) return { results: [], error: error.message };

    const results = (data || []).map((row: { team_id: string; keepers_locked: number; rounds_consumed?: number[] }) => ({
      team_id: row.team_id, keepers_locked: row.keepers_locked, rounds_consumed: row.rounds_consumed || [],
    }));

    const totalKeepers = results.reduce((sum, r) => sum + r.keepers_locked, 0);
    try {
      await this.supabase.rpc('notify_league_members', {
        p_league_id: leagueId,
        p_title: 'Keepers Locked',
        p_message: `${totalKeepers} keeper(s) have been locked for the ${seasonYear}-${seasonYear + 1} season.`,
        p_notification_type: 'SYSTEM',
      });
    } catch {}

    return { results };
  }

  async updateKeeperSettings(leagueId: string, commissionerId: string, settings: {
    keeperEnabled: boolean; keeperCount: number; keeperPenalty: string; dynastyMode: boolean;
  }) {
    const { data: league } = await this.supabase
      .from('leagues').select('commissioner_id, settings').eq('id', leagueId).single();
    if (!league || league.commissioner_id !== commissionerId) {
      return { success: false, error: 'Only the commissioner can update keeper settings' };
    }

    const existingSettings = (league.settings || {}) as Record<string, unknown>;
    const updatedSettings = {
      ...existingSettings,
      keeperEnabled: settings.keeperEnabled,
      keeperCount: settings.dynastyMode ? 999 : settings.keeperCount,
      keeperPenalty: settings.keeperPenalty,
      dynastyMode: settings.dynastyMode,
    };

    const { error } = await this.supabase.from('leagues').update({ settings: updatedSettings }).eq('id', leagueId);
    if (error) return { success: false, error: error.message };

    try {
      const mode = settings.dynastyMode ? 'Dynasty' : settings.keeperEnabled ? `Keeper (${settings.keeperCount})` : 'Standard';
      await this.supabase.rpc('notify_league_members', {
        p_league_id: leagueId, p_title: 'Keeper Settings Updated',
        p_message: `League format changed to: ${mode}`, p_notification_type: 'SYSTEM',
      });
    } catch {}

    return { success: true };
  }
}
