import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, logger } from '@citrus/shared';
import { LeagueMembershipService } from './LeagueMembershipService';

/**
 * WaiverService — Server-side waiver claim management with DI Supabase client.
 *
 * Extracted from apps/web/src/services/WaiverService.ts.
 * All 3 waiver types supported: rolling, FAAB, reverse_standings.
 */
export class WaiverService {
  private supabase: SupabaseClient;
  private membership: LeagueMembershipService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.membership = new LeagueMembershipService(supabase);
  }

  /** Check if a team has exceeded add limits */
  async checkTransactionLimits(leagueId: string, teamId: string) {
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const settings = league?.settings || {};
    const weeklyLimit = settings.weekly_add_limit;
    const seasonLimit = settings.season_add_limit;

    // Count ADD transactions
    let weeklyAdds = 0;
    let seasonAdds = 0;

    if (weeklyLimit || seasonLimit) {
      const { count: seasonCount } = await this.supabase
        .from('transaction_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('transaction_type', 'ADD');

      seasonAdds = seasonCount || 0;

      if (seasonLimit && seasonAdds >= seasonLimit) {
        return { allowed: false, reason: 'Season add limit reached', weeklyAdds, seasonAdds };
      }

      if (weeklyLimit) {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
        weekStart.setHours(0, 0, 0, 0);

        const { count: weekCount } = await this.supabase
          .from('transaction_ledger')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId)
          .eq('transaction_type', 'ADD')
          .gte('created_at', weekStart.toISOString());

        weeklyAdds = weekCount || 0;

        if (weeklyAdds >= weeklyLimit) {
          return { allowed: false, reason: 'Weekly add limit reached', weeklyAdds, seasonAdds };
        }
      }
    }

    return { allowed: true, weeklyAdds, seasonAdds };
  }

  /**
   * Run a waiver_claims query with automatic fallback to base columns.
   * If the full column set fails (e.g., bid_amount doesn't exist yet),
   * retries with WAIVER_BASE which only includes columns from the initial migration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async queryWaiverClaims(
    buildQuery: (columns: string) => PromiseLike<{ data: any; error: any }>,
  ): Promise<{ claims: Record<string, unknown>[]; error: unknown }> {
    const { data, error } = await buildQuery(COLUMNS.WAIVER);

    if (error && this.isColumnError(error)) {
      logger.warn('[waivers] Column error, retrying with base columns:', error.message);
      const fallback = await buildQuery(COLUMNS.WAIVER_BASE);
      return { claims: fallback.data || [], error: fallback.error };
    }

    return { claims: data || [], error };
  }

  /** Check if a Supabase error is caused by a missing column */
  private isColumnError(error: { message?: string; code?: string }): boolean {
    const msg = error.message || '';
    return msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found'));
  }

  /** Get waiver claims for a league */
  async getLeagueWaivers(leagueId: string, status?: string) {
    return this.queryWaiverClaims((columns) => {
      let query = this.supabase
        .from('waiver_claims')
        .select(columns)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      return query;
    });
  }

  /** Get waiver claims for a specific team, optionally filtered by status */
  async getTeamWaiverClaims(leagueId: string, teamId: string, status?: string) {
    return this.queryWaiverClaims((columns) => {
      let query = this.supabase
        .from('waiver_claims')
        .select(columns)
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      return query;
    });
  }

  /** Submit a waiver claim */
  async submitWaiverClaim(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null,
  ) {
    // Check add limits
    const limits = await this.checkTransactionLimits(leagueId, teamId);
    if (!limits.allowed) {
      return { success: false, error: limits.reason };
    }

    // Get waiver priority
    const { data: priority } = await this.supabase
      .from('waiver_priority')
      .select('priority')
      .eq('league_id', leagueId)
      .eq('team_id', teamId)
      .single();

    const { data, error } = await this.supabase
      .from('waiver_claims')
      .insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: playerId,
        drop_player_id: dropPlayerId,
        priority: priority?.priority || 999,
        status: 'pending',
      })
      .select(COLUMNS.WAIVER)
      .single();

    return { success: !error, error: error?.message, claimId: (data as any)?.id };
  }

  /** Submit a FAAB bid */
  async submitFAABBid(
    leagueId: string,
    teamId: string,
    playerId: number,
    bidAmount: number,
    dropPlayerId: number | null = null,
    isConditionalDrop = false,
  ) {
    // Validate bid amount
    if (bidAmount < 0) {
      return { success: false, error: 'Bid amount must be non-negative' };
    }

    // Check add limits
    const limits = await this.checkTransactionLimits(leagueId, teamId);
    if (!limits.allowed) {
      return { success: false, error: limits.reason };
    }

    // Check FAAB budget
    const budget = await this.getFAABBudget(leagueId, teamId);
    if (budget !== null && bidAmount > budget) {
      return { success: false, error: `Bid exceeds remaining budget ($${budget})` };
    }

    // Check for existing bid on same player
    const { data: existingBid } = await this.supabase
      .from('waiver_claims')
      .select('id')
      .eq('league_id', leagueId)
      .eq('team_id', teamId)
      .eq('player_id', playerId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingBid) {
      // Update existing bid
      const { error } = await this.supabase
        .from('waiver_claims')
        .update({
          bid_amount: bidAmount,
          drop_player_id: dropPlayerId,
          is_conditional_drop: isConditionalDrop,
        })
        .eq('id', existingBid.id);

      return { success: !error, error: error?.message, claimId: existingBid.id };
    }

    // Insert new bid
    const { data, error } = await this.supabase
      .from('waiver_claims')
      .insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: playerId,
        drop_player_id: dropPlayerId,
        bid_amount: bidAmount,
        is_conditional_drop: isConditionalDrop,
        status: 'pending',
      })
      .select(COLUMNS.WAIVER)
      .single();

    return { success: !error, error: error?.message, claimId: (data as any)?.id };
  }

  /** Cancel a waiver claim */
  async cancelClaim(claimId: string) {
    const { error } = await this.supabase
      .from('waiver_claims')
      .update({ status: 'cancelled' })
      .eq('id', claimId)
      .eq('status', 'pending');

    return { success: !error, error: error?.message };
  }

  /** Get FAAB budget for a team */
  async getFAABBudget(leagueId: string, teamId: string) {
    const { data: budget } = await this.supabase
      .from('faab_budgets')
      .select('remaining_budget')
      .eq('league_id', leagueId)
      .eq('team_id', teamId)
      .maybeSingle();

    if (budget) return budget.remaining_budget;

    // Fallback: calculate from league initial budget minus spent
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const initialBudget = league?.settings?.faab_budget || 100;

    const { data: claims, error: claimsError } = await this.supabase
      .from('waiver_claims')
      .select('bid_amount')
      .eq('league_id', leagueId)
      .eq('team_id', teamId)
      .eq('status', 'successful');

    // If bid_amount column doesn't exist yet, return full budget
    if (claimsError && this.isColumnError(claimsError)) {
      return initialBudget;
    }

    const spent = (claims || []).reduce((sum: number, c: { bid_amount?: number }) => sum + (c.bid_amount || 0), 0);
    return initialBudget - spent;
  }

  /** Get all FAAB budgets for a league */
  async getAllFAABBudgets(leagueId: string) {
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const initialBudget = league?.settings?.faab_budget || 100;

    const { data: teams } = await this.supabase
      .from('teams')
      .select('id, team_name')
      .eq('league_id', leagueId);

    const { data: claims, error: claimsError } = await this.supabase
      .from('waiver_claims')
      .select('team_id, bid_amount')
      .eq('league_id', leagueId)
      .eq('status', 'successful');

    // If bid_amount column doesn't exist, treat all budgets as full
    if (claimsError && this.isColumnError(claimsError)) {
      logger.warn('[waivers] bid_amount column not ready, returning full budgets');
      return (teams || []).map((t: { id: string; team_name: string }) => ({
        team_id: t.id,
        team_name: t.team_name,
        remaining_budget: initialBudget,
        total_spent: 0,
      }));
    }

    const spentByTeam = new Map<string, number>();
    for (const claim of claims || []) {
      const current = spentByTeam.get(claim.team_id) || 0;
      spentByTeam.set(claim.team_id, current + (claim.bid_amount || 0));
    }

    return (teams || []).map((t: any) => ({
      team_id: t.id,
      team_name: t.team_name,
      remaining_budget: initialBudget - (spentByTeam.get(t.id) || 0),
      total_spent: spentByTeam.get(t.id) || 0,
    }));
  }

  /** Get waiver priority for all teams in a league */
  async getWaiverPriority(leagueId: string) {
    const { data, error } = await this.supabase
      .from('waiver_priority')
      .select(`${COLUMNS.WAIVER_PRIORITY}, teams(team_name)`)
      .eq('league_id', leagueId)
      .order('priority', { ascending: true });

    return { priority: data || [], error };
  }

  /** Get league waiver settings */
  async getLeagueWaiverSettings(leagueId: string, userId: string) {
    await this.membership.requireMembership(leagueId, userId);

    const { data, error } = await this.supabase
      .from('leagues')
      .select('waiver_type, waiver_process_time, waiver_period_hours, waiver_game_lock, allow_trades_during_games, settings')
      .eq('id', leagueId)
      .single();

    // If waiver columns don't exist yet, fall back to just settings JSONB
    if (error && this.isColumnError(error)) {
      logger.warn('[waivers] Waiver columns missing on leagues table, using defaults');
      const fallback = await this.supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();

      return {
        settings: {
          waiver_type: 'rolling',
          waiver_process_time: '02:00:00',
          waiver_period_hours: 48,
          waiver_game_lock: true,
          allow_trades_during_games: true,
          settings: fallback.data?.settings || {},
        },
        error: null,
      };
    }

    return { settings: data, error };
  }

  /** Process all pending waivers (via RPC) */
  async processAllPendingWaivers() {
    const { data, error } = await this.supabase.rpc('process_all_pending_waivers');
    return { data, error };
  }

  /** Add free agent (instant pickup via RPC) */
  async addFreeAgent(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null,
    userId?: string,
    skipLimitCheck = false,
  ) {
    if (!skipLimitCheck) {
      const limits = await this.checkTransactionLimits(leagueId, teamId);
      if (!limits.allowed) {
        return { success: false, error: limits.reason };
      }
    }

    // Verify team ownership
    if (userId) {
      const { data: team } = await this.supabase
        .from('teams')
        .select('owner_id')
        .eq('id', teamId)
        .single();

      if (team?.owner_id !== userId) {
        return { success: false, error: 'You do not own this team' };
      }
    }

    // Execute atomic roster move
    const { error } = await this.supabase.rpc('process_roster_move', {
      p_league_id: leagueId,
      p_team_id: teamId,
      p_add_player_id: playerId,
      p_drop_player_id: dropPlayerId,
    });

    return { success: !error, error: error?.message };
  }

  /** Drop a player from roster */
  async dropPlayer(leagueId: string, teamId: string, playerId: number) {
    const { error } = await this.supabase.rpc('process_roster_move', {
      p_league_id: leagueId,
      p_team_id: teamId,
      p_add_player_id: null,
      p_drop_player_id: playerId,
    });

    return { success: !error, error: error?.message };
  }

  /** Update waiver settings (commissioner only) */
  async updateWaiverSettings(
    leagueId: string,
    commissionerId: string,
    settings: Record<string, any>,
  ) {
    await this.membership.requireCommissioner(leagueId, commissionerId);

    const { error } = await this.supabase
      .from('leagues')
      .update({
        ...settings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.supabase.rpc('notify_league_members', {
        p_league_id: leagueId,
        p_message: 'Waiver settings have been updated by the commissioner.',
        p_title: 'Waiver Settings Updated',
      });

      // Recalculate priority if switching to reverse_standings
      if (settings.waiver_type === 'reverse_standings') {
        await this.supabase.rpc('recalculate_reverse_standings_priority', {
          p_league_id: leagueId,
        });
      }
    }

    return { success: !error, error };
  }
}
