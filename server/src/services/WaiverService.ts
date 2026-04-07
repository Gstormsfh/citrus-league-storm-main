import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, logger } from '@citrus/shared';
import { getSupabaseAdmin } from '../lib/supabase';
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
    const result = await this.queryWaiverClaims((columns) => {
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

    // Enrich with the waiver clear time for each claim's target player so
    // the UI can surface "clears at" and "will process at" timestamps.
    return this.enrichClaimsWithClearTime(result, leagueId);
  }

  private async enrichClaimsWithClearTime(
    result: { claims: Record<string, unknown>[]; error: unknown },
    leagueId: string,
  ): Promise<{ claims: Record<string, unknown>[]; error: unknown }> {
    if (result.error || result.claims.length === 0) return result;
    const playerIds = Array.from(new Set(
      result.claims.map(c => Number(c.player_id)).filter(n => Number.isFinite(n))
    ));
    if (playerIds.length === 0) return result;

    const admin = getSupabaseAdmin();
    const [waiverRes, leagueRes] = await Promise.all([
      admin
        .from('player_waiver_status')
        .select('player_id, dropped_at, cleared_at')
        .eq('league_id', leagueId)
        .is('cleared_at', null)
        .in('player_id', playerIds),
      admin
        .from('leagues')
        .select('waiver_period_hours, waiver_process_time')
        .eq('id', leagueId)
        .single(),
    ]);

    const periodHours = (leagueRes.data as { waiver_period_hours?: number } | null)?.waiver_period_hours ?? 48;
    const processTime = (leagueRes.data as { waiver_process_time?: string } | null)?.waiver_process_time ?? '02:00:00';

    const latestByPlayer = new Map<number, string>();
    for (const row of ((waiverRes.data || []) as Array<{ player_id: number; dropped_at: string }>)) {
      const prev = latestByPlayer.get(row.player_id);
      if (!prev || new Date(row.dropped_at) > new Date(prev)) {
        latestByPlayer.set(row.player_id, row.dropped_at);
      }
    }

    const enriched = result.claims.map(claim => {
      const droppedAt = latestByPlayer.get(Number(claim.player_id));
      if (!droppedAt) return claim;
      const clearsAt = new Date(new Date(droppedAt).getTime() + periodHours * 3600 * 1000);
      return {
        ...claim,
        waiver_dropped_at: droppedAt,
        waiver_clears_at: clearsAt.toISOString(),
        league_waiver_period_hours: periodHours,
        league_waiver_process_time: processTime,
      };
    });

    return { claims: enriched, error: null };
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
    // Use the admin client for the teams lookup so the denominator is
    // always the true league size regardless of the caller's RLS scope.
    // waiver_priority is only written when claims succeed, so without
    // this merge a league would show "#1 of 1" after its first claim.
    const admin = getSupabaseAdmin();
    const [teamsRes, priorityRes] = await Promise.all([
      admin
        .from('teams')
        .select('id, team_name, created_at')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: true }),
      this.supabase
        .from('waiver_priority')
        .select(`${COLUMNS.WAIVER_PRIORITY}, teams(team_name)`)
        .eq('league_id', leagueId)
        .order('priority', { ascending: true }),
    ]);

    if (priorityRes.error) return { priority: [], error: priorityRes.error };

    type PriorityRow = { team_id: string; priority: number; teams?: { team_name: string } | null };
    const explicit = (priorityRes.data || []) as unknown as PriorityRow[];
    const teams = (teamsRes.data || []) as Array<{ id: string; team_name: string; created_at: string }>;

    const ranked = new Map<string, PriorityRow>();
    for (const row of explicit) ranked.set(row.team_id, row);

    const ordered: PriorityRow[] = [...explicit].sort((a, b) => a.priority - b.priority);
    for (const t of teams) {
      if (!ranked.has(t.id)) {
        ordered.push({ team_id: t.id, priority: 0, teams: { team_name: t.team_name } });
      }
    }

    // Renumber 1..N so the UI denominator always matches the real league size.
    const merged = ordered.map((row, idx) => ({ ...row, priority: idx + 1 }));
    return { priority: merged, error: null };
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

  /**
   * Check if a team is an AI team (owner_id IS NULL).
   * AI teams cannot use process_roster_move RPC because it looks up the team
   * via `WHERE owner_id = p_user_id`, which never matches NULL.
   */
  private async isAiTeam(teamId: string): Promise<boolean> {
    const admin = getSupabaseAdmin();
    const { data: team } = await admin
      .from('teams')
      .select('owner_id')
      .eq('id', teamId)
      .single();

    return !team?.owner_id;
  }

  /**
   * Execute a roster move for an AI team using the admin client.
   * Replicates the core logic of process_roster_move RPC but bypasses
   * the owner_id lookup that fails for AI teams (owner_id = NULL).
   * Uses supabaseAdmin to bypass RLS since there is no real user.
   */
  private async executeAiTeamRosterMove(
    leagueId: string,
    teamId: string,
    addPlayerId: number | null,
    dropPlayerId: number | null,
    source = 'AI Team Roster',
  ): Promise<{ success: boolean; error?: string }> {
    const admin = getSupabaseAdmin();

    if (!addPlayerId && !dropPlayerId) {
      return { success: false, error: 'Must specify at least one player to add or drop' };
    }

    try {
      // Read roster size limit
      const { data: league } = await admin
        .from('leagues')
        .select('roster_size, settings')
        .eq('id', leagueId)
        .single();

      const maxRosterSize = league?.roster_size ?? 22;

      // ======== DROP LOGIC ========
      if (dropPlayerId) {
        const { data: assignment } = await admin
          .from('roster_assignments')
          .select('id')
          .eq('league_id', leagueId)
          .eq('team_id', teamId)
          .eq('player_id', dropPlayerId)
          .maybeSingle();

        if (!assignment) {
          return { success: false, error: `Player ${dropPlayerId} is not on this team's roster` };
        }

        const { error: deleteErr } = await admin
          .from('roster_assignments')
          .delete()
          .eq('id', assignment.id);

        if (deleteErr) {
          return { success: false, error: deleteErr.message };
        }

        // Log to transaction_ledger (user_id is NULL for AI teams)
        await admin
          .from('transaction_ledger')
          .insert({
            league_id: leagueId,
            user_id: null,
            team_id: teamId,
            type: 'DROP',
            player_id: String(dropPlayerId),
            source,
            created_at: new Date().toISOString(),
          });

        // Clean up team_lineups
        await admin
          .from('team_lineups')
          .update({
            updated_at: new Date().toISOString(),
          })
          .eq('team_id', teamId)
          .eq('league_id', leagueId);

        // Soft-delete draft pick
        await admin
          .from('draft_picks')
          .update({ deleted_at: new Date().toISOString() })
          .eq('league_id', leagueId)
          .eq('team_id', teamId)
          .eq('player_id', dropPlayerId)
          .is('deleted_at', null);
      }

      // ======== ADD LOGIC ========
      if (addPlayerId) {
        // Check roster size (only if not also dropping)
        if (!dropPlayerId) {
          const { count: currentSize } = await admin
            .from('roster_assignments')
            .select('id', { count: 'exact', head: true })
            .eq('team_id', teamId)
            .eq('league_id', leagueId);

          if ((currentSize ?? 0) >= maxRosterSize) {
            return { success: false, error: `Roster is full (${currentSize} / ${maxRosterSize})` };
          }
        }

        // Enforce goalie limit (match RPC: GREATEST(starting_G + 2, 4))
        const { data: playerInfo } = await admin
          .from('player_directory')
          .select('is_goalie')
          .eq('player_id', addPlayerId)
          .limit(1)
          .maybeSingle();

        if (playerInfo?.is_goalie === true) {
          const settings = league?.settings || {};
          const startingG = Number(settings.rosterSlots?.G ?? 2);
          const goalieLimit = Math.max(startingG + 2, 4);

          const { count: currentGoalies } = await admin
            .from('roster_assignments')
            .select('id', { count: 'exact', head: true })
            .eq('team_id', teamId)
            .eq('league_id', leagueId)
            .in('player_id', await this.getGoaliePlayerIds(admin, teamId, leagueId));

          if ((currentGoalies ?? 0) >= goalieLimit) {
            return { success: false, error: `Goalie limit reached (${currentGoalies} / ${goalieLimit})` };
          }
        }

        // Insert roster assignment
        const { error: insertErr } = await admin
          .from('roster_assignments')
          .insert({
            league_id: leagueId,
            team_id: teamId,
            player_id: String(addPlayerId),
            acquired_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          });

        if (insertErr) {
          if (insertErr.message?.includes('unique') || insertErr.message?.includes('duplicate')) {
            return { success: false, error: 'Player is already on a team in this league' };
          }
          return { success: false, error: insertErr.message };
        }

        // Log to transaction_ledger
        await admin
          .from('transaction_ledger')
          .insert({
            league_id: leagueId,
            user_id: null,
            team_id: teamId,
            type: 'ADD',
            player_id: String(addPlayerId),
            source,
            created_at: new Date().toISOString(),
          });

        // Ensure team_lineups entry exists with new player on bench
        const { data: existingLineup } = await admin
          .from('team_lineups')
          .select('id')
          .eq('team_id', teamId)
          .eq('league_id', leagueId)
          .maybeSingle();

        if (existingLineup) {
          // Append to bench via raw SQL-style update isn't possible,
          // so read-modify-write the bench array
          const { data: lineupData } = await admin
            .from('team_lineups')
            .select('bench')
            .eq('team_id', teamId)
            .eq('league_id', leagueId)
            .single();

          const currentBench = Array.isArray(lineupData?.bench) ? lineupData.bench : [];
          await admin
            .from('team_lineups')
            .update({
              bench: [...currentBench, String(addPlayerId)],
              updated_at: new Date().toISOString(),
            })
            .eq('team_id', teamId)
            .eq('league_id', leagueId);
        } else {
          await admin
            .from('team_lineups')
            .insert({
              league_id: leagueId,
              team_id: teamId,
              bench: [String(addPlayerId)],
              starters: [],
              ir: [],
              slot_assignments: {},
              updated_at: new Date().toISOString(),
            });
        }
      }

      logger.info(`[executeAiTeamRosterMove] Success: team=${teamId.slice(0,8)} add=${addPlayerId} drop=${dropPlayerId}`);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[executeAiTeamRosterMove] Unexpected error:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Helper: get player IDs of goalies on a team's roster.
   * Used for goalie limit enforcement in AI team roster moves.
   */
  private async getGoaliePlayerIds(
    admin: ReturnType<typeof getSupabaseAdmin>,
    teamId: string,
    leagueId: string,
  ): Promise<number[]> {
    const { data: assignments } = await admin
      .from('roster_assignments')
      .select('player_id')
      .eq('team_id', teamId)
      .eq('league_id', leagueId);

    if (!assignments || assignments.length === 0) return [];

    const playerIds = assignments.map((a: { player_id: string }) => parseInt(String(a.player_id), 10));

    const { data: goalies } = await admin
      .from('player_directory')
      .select('player_id')
      .in('player_id', playerIds)
      .eq('is_goalie', true);

    return (goalies || []).map((g: { player_id: number }) => g.player_id);
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

    // Check if player is on waivers (recently dropped) — must use waiver claim instead
    try {
      const { data: onWaivers } = await this.supabase.rpc('is_player_on_waivers', {
        p_league_id: leagueId,
        p_player_id: playerId,
      });
      if (onWaivers === true) {
        return { success: false, error: 'Player is on waivers (recently dropped). Submit a waiver claim instead.' };
      }
    } catch (waiverCheckErr) {
      // If RPC doesn't exist yet, skip the check (graceful degradation)
      logger.warn('[addFreeAgent] Could not check waiver status:', waiverCheckErr);
    }

    // Check if player is already on a roster in this league
    const admin = getSupabaseAdmin();
    const { count: existingCount } = await admin
      .from('roster_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('player_id', String(playerId));
    if (existingCount && existingCount > 0) {
      return { success: false, error: 'Player is already on a roster in this league.' };
    }

    // Pre-check roster size to give clear error before RPC
    if (!dropPlayerId) {
      const { count: rosterCount } = await admin
        .from('roster_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('team_id', teamId);
      const { data: leagueData } = await this.supabase
        .from('leagues')
        .select('roster_size')
        .eq('id', leagueId)
        .single();
      const maxRoster = leagueData?.roster_size || 22;
      if (rosterCount !== null && rosterCount >= maxRoster) {
        return { success: false, error: `Roster is full (${rosterCount}/${maxRoster}). Drop a player first.` };
      }
    }

    // Check if this is an AI team (owner_id = NULL) — requires admin path
    const aiTeam = await this.isAiTeam(teamId);

    if (aiTeam) {
      logger.info(`[addFreeAgent] AI team detected (${teamId.slice(0,8)}), using admin path`);
      return this.executeAiTeamRosterMove(leagueId, teamId, playerId, dropPlayerId);
    }

    // Verify team ownership for human teams
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

    // Execute atomic roster move via RPC (works for human-owned teams)
    const { error } = await this.supabase.rpc('process_roster_move', {
      p_league_id: leagueId,
      p_user_id: userId,
      p_add_player_id: playerId,
      p_drop_player_id: dropPlayerId,
    });

    return { success: !error, error: error?.message };
  }

  /** Drop a player from roster */
  async dropPlayer(leagueId: string, teamId: string, playerId: number, userId: string) {
    // Check if this is an AI team (owner_id = NULL) — requires admin path
    const aiTeam = await this.isAiTeam(teamId);

    if (aiTeam) {
      logger.info(`[dropPlayer] AI team detected (${teamId.slice(0,8)}), using admin path`);
      return this.executeAiTeamRosterMove(leagueId, teamId, null, playerId);
    }

    const { error } = await this.supabase.rpc('process_roster_move', {
      p_league_id: leagueId,
      p_user_id: userId,
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
