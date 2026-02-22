import { supabase } from '@/integrations/supabase/client';
import type { PostgrestError } from '@supabase/supabase-js';
import { logger } from '@/utils/logger';
import { Team, LeagueService } from './LeagueService';
import { PlayerService } from './PlayerService';
import { LeagueMembershipService } from './LeagueMembershipService';

export interface DraftPick {
  id: string;
  league_id: string;
  round_number: number;
  pick_number: number;
  team_id: string;
  player_id: string;
  picked_at: string;
  draft_session_id?: string;
  deleted_at?: string | null;
}

export interface DraftOrder {
  id: string;
  league_id: string;
  round_number: number;
  team_order: string[]; // Array of team IDs
  created_at: string;
  draft_session_id?: string;
  deleted_at?: string | null;
}

export interface DraftState {
  currentRound: number;
  currentPick: number;
  totalPicks: number;
  nextTeamId: string | null;
  isComplete: boolean;
  sessionId?: string;
}

export interface DraftSnapshotData {
  teams: Array<{ id: string; name: string; owner: string; color: string }>;
  picks: Array<{
    id: string;
    teamId: string;
    teamName: string;
    playerId: string;
    playerName: string;
    position: string;
    round: number;
    pick: number;
    timestamp: number;
  }>;
  leagueSettings: {
    rounds: number;
    draftOrder: string;
    completedAt: string;
  };
}

export interface DraftSnapshot {
  id: string;
  league_id: string;
  draft_session_id: string;
  snapshot_data: DraftSnapshotData;
  created_at: string;
  created_by: string | null;
}

export const DraftService = {
  /**
   * Get or create active draft session for a league
   * REQUIRES: User must be a member of the league
   */
  async getActiveDraftSession(leagueId: string, userId?: string): Promise<{ sessionId: string; error: unknown }> {
    try {
      // CRITICAL: Validate membership BEFORE accessing draft data (skip if no userId)
      if (userId) {
        await LeagueMembershipService.requireMembership(leagueId, userId);
      }

      // First, check the league status - only look for active sessions if draft is in progress
      const { data: leagueData } = await supabase
        .from('leagues')
        .select('draft_status')
        .eq('id', leagueId)
        .single();
      
      // If draft is not started or queued, always create a new session (don't reuse old ones)
      if (!leagueData || leagueData.draft_status === 'not_started' || leagueData.draft_status === 'queued') {
        const newSessionId = crypto.randomUUID();
        logger.log('Draft not started/queued, creating new session:', newSessionId);
        return { sessionId: newSessionId, error: null };
      }

      // Only look for existing sessions if draft is in progress or completed
      // Check if there's an active session with picks (only non-deleted)
      const { data: existingPicks, error: picksError } = await supabase
        .from('draft_picks')
        .select('draft_session_id')
        .eq('league_id', leagueId)
        .is('deleted_at', null)
        .order('picked_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // If we got picks (even if empty array), check the result
      if (!picksError && existingPicks?.draft_session_id) {
        logger.log('Found existing session from picks:', existingPicks.draft_session_id);
        return { sessionId: existingPicks.draft_session_id, error: null };
      }

      // Check if there's an active session with just draft order (only non-deleted)
      const { data: existingOrder, error: orderError } = await supabase
        .from('draft_order')
        .select('draft_session_id')
        .eq('league_id', leagueId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // If we got an order (even if empty array), check the result
      if (!orderError && existingOrder?.draft_session_id) {
        logger.log('Found existing session from orders:', existingOrder.draft_session_id);
        return { sessionId: existingOrder.draft_session_id, error: null };
      }

      // No existing session found - create new one
      const newSessionId = crypto.randomUUID();
      logger.log('No existing session found, creating new session:', newSessionId);
      return { sessionId: newSessionId, error: null };
    } catch (error: unknown) {
      // If error occurs, create new session
      const newSessionId = crypto.randomUUID();
      logger.log('Error getting session, creating new one:', newSessionId);
      return { sessionId: newSessionId, error: null };
    }
  },

  /**
   * Get all draft picks for a league (active session only)
   * REQUIRES: User must be a member of the league
   */
  async getDraftPicks(leagueId: string, userId: string, sessionId?: string): Promise<{ picks: DraftPick[]; error: unknown }> {
    try {
      // If explicit sessionId provided, filter by it; otherwise get all active picks
      let query = supabase
        .from('draft_picks')
        .select('id, league_id, team_id, player_id, round_number, pick_number, draft_session_id, picked_at, deleted_at')
        .eq('league_id', leagueId)
        .is('deleted_at', null)
        .order('pick_number', { ascending: true });

      if (sessionId) {
        query = query.eq('draft_session_id', sessionId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return { picks: data || [], error: null };
    } catch (error: unknown) {
      return { picks: [], error };
    }
  },

  /**
   * Get draft order for a specific round (active session only)
   * REQUIRES: User must be a member of the league
   */
  async getDraftOrder(leagueId: string, userId: string, roundNumber: number, sessionId?: string): Promise<{ order: DraftOrder | null; error: unknown }> {
    try {
      let query = supabase
        .from('draft_order')
        .select('id, league_id, round_number, team_order, draft_session_id, created_at, deleted_at')
        .eq('league_id', leagueId)
        .eq('round_number', roundNumber)
        .is('deleted_at', null);

      if (sessionId) {
        query = query.eq('draft_session_id', sessionId);
      }

      // Get the most recent order
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      return { order: data || null, error: null };
    } catch (error: unknown) {
      return { order: null, error };
    }
  },

  /**
   * Initialize draft order for a league (snake draft)
   * Creates a new session if resetExisting is true
   * @param customTeamOrder Optional array of team IDs in the desired order. If not provided, uses teams array order.
   */
  async initializeDraftOrder(
    leagueId: string,
    userId: string,
    teams: Team[], 
    totalRounds: number,
    resetExisting: boolean = false,
    customTeamOrder?: string[]
  ): Promise<{ error: unknown; sessionId?: string }> {
    try {
      // Use custom order if provided, otherwise use teams array order
      const teamIds = customTeamOrder || teams.map(t => t.id);
      
      // Validate that all team IDs in custom order exist in teams
      if (customTeamOrder) {
        const teamIdSet = new Set(teams.map(t => t.id));
        const invalidIds = customTeamOrder.filter(id => !teamIdSet.has(id));
        if (invalidIds.length > 0) {
          return { error: new Error(`Invalid team IDs in custom order: ${invalidIds.join(', ')}`), sessionId: undefined };
        }
        // Ensure all teams are included
        if (teamIds.length !== teams.length) {
          return { error: new Error('Custom team order must include all teams'), sessionId: undefined };
        }
      }
      
      // Get or create session
      let sessionId: string;
      if (resetExisting) {
        // Hard delete old orders for this league (all sessions) - completely remove them
        // This prevents unique constraint violations
        await supabase
          .from('draft_order')
          .delete()
          .eq('league_id', leagueId);

        // Create new session
        sessionId = crypto.randomUUID();
      } else {
        // Check if order already exists for this league (in active session)
        const { order: existingOrder } = await this.getDraftOrder(leagueId, userId, 1);
        if (existingOrder?.draft_session_id && !customTeamOrder) {
          // Use existing session only if no custom order is provided
          sessionId = existingOrder.draft_session_id;
          return { error: null, sessionId };
        }
        
        // Before creating new orders, HARD DELETE ALL existing orders for this league
        // The unique constraint is on (league_id, round_number) and doesn't account for deleted_at
        // Hard delete ensures no conflicts when creating new orders
        const { error: deleteError } = await supabase
          .from('draft_order')
          .delete()
          .eq('league_id', leagueId);
        
        if (deleteError) {
          console.warn('Error deleting old draft orders:', deleteError);
          // Continue anyway - might be no existing orders
        }
        
        // Get or create session
        const { sessionId: activeSessionId } = await this.getActiveDraftSession(leagueId, userId);
        sessionId = customTeamOrder ? crypto.randomUUID() : activeSessionId;
      }
      
      // Create draft order for each round (snake draft)
      const orders = [];
      for (let round = 1; round <= totalRounds; round++) {
        const isEvenRound = round % 2 === 0;
        const teamOrder = isEvenRound ? [...teamIds].reverse() : [...teamIds];
        
        orders.push({
          league_id: leagueId,
          round_number: round,
          team_order: teamOrder,
          draft_session_id: sessionId,
        });
      }

      const { error } = await supabase
        .from('draft_order')
        .insert(orders);

      if (error) throw error;
      return { error: null, sessionId };
    } catch (error: unknown) {
      return { error, sessionId: undefined };
    }
  },

  /**
   * Make a draft pick (uses active session)
   */
  async makePick(
    leagueId: string,
    teamId: string,
    playerId: string,
    roundNumber: number,
    pickNumber: number,
    sessionId?: string,
    teamsCount?: number
  ): Promise<{ pick: DraftPick | null; error: unknown; isComplete?: boolean }> {
    // Read-only guard: Block user-initiated picks for demo league
    // But allow initialization (when no picks exist yet)
    if (leagueId === '00000000-0000-0000-0000-000000000001') {
      // Check if this is initialization (no picks exist yet)
      const { count: existingPicksCount } = await supabase
        .from('draft_picks')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .is('deleted_at', null);
      
      // If picks already exist, block (user trying to modify)
      // If no picks exist, allow (initialization)
      if (existingPicksCount && existingPicksCount > 0) {
        return { 
          pick: null, 
          error: new Error('Demo league is read-only. Sign up to create your own league!') 
        };
      }
      // Otherwise, allow the pick (initialization phase)
    }

    try {
      const { sessionId: activeSessionId } = await this.getActiveDraftSession(leagueId);
      const targetSessionId = sessionId || activeSessionId;

      // Check if player is already drafted in this session
      const { data: existing } = await supabase
        .from('draft_picks')
        .select('id')
        .eq('league_id', leagueId)
        .eq('draft_session_id', targetSessionId)
        .eq('player_id', playerId)
        .is('deleted_at', null)
        .maybeSingle();

      if (existing) {
        return { pick: null, error: new Error('Player already drafted in this session') };
      }

      // Check for duplicate pick number in this session
      const { data: duplicatePick } = await supabase
        .from('draft_picks')
        .select('id')
        .eq('league_id', leagueId)
        .eq('draft_session_id', targetSessionId)
        .eq('round_number', roundNumber)
        .eq('pick_number', pickNumber)
        .is('deleted_at', null)
        .maybeSingle();

      if (duplicatePick) {
        return { pick: null, error: new Error('This pick number is already taken in this session') };
      }

      // Insert the pick - try RPC first (bypasses RLS), fallback to direct insert
      let data: DraftPick | null = null;
      let error: PostgrestError | null = null;

      const { data: rpcResult, error: rpcError } = await supabase.rpc('make_draft_pick', {
        p_league_id: leagueId,
        p_team_id: teamId,
        p_player_id: playerId,
        p_round_number: roundNumber,
        p_pick_number: pickNumber,
        p_draft_session_id: targetSessionId
      });

      if (rpcError) {
        // RPC not available - fallback to direct insert
        logger.warn('make_draft_pick RPC failed, falling back to direct insert:', rpcError.message);
        const result = await supabase
          .from('draft_picks')
          .insert({
            league_id: leagueId,
            team_id: teamId,
            player_id: playerId,
            round_number: roundNumber,
            pick_number: pickNumber,
            draft_session_id: targetSessionId,
            picked_at: new Date().toISOString(),
          })
          .select()
          .single();

        data = result.data as unknown as DraftPick | null;
        error = result.error;
      } else {
        // RPC succeeded - fetch the inserted pick
        const { data: pickData, error: fetchError } = await supabase
          .from('draft_picks')
          .select('id, league_id, team_id, player_id, round_number, pick_number, draft_session_id, picked_at, deleted_at')
          .eq('id', rpcResult)
          .single();
        data = pickData as DraftPick | null;
        error = fetchError;
      }

      if (error) throw error;

      // Update league draft status if needed
      const { data: league } = await supabase
        .from('leagues')
        .select('draft_status, draft_rounds, roster_size')
        .eq('id', leagueId)
        .single();

      if (league && league.draft_status === 'not_started') {
        await supabase
          .from('leagues')
          .update({ draft_status: 'in_progress' })
          .eq('id', leagueId);
      }

      // Check if draft is complete (only count active picks in this session)
      const { count } = await supabase
        .from('draft_picks')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('draft_session_id', targetSessionId)
        .is('deleted_at', null);

      // FIX: Get teams count if not provided
      let actualTeamsCount = teamsCount;
      if (!actualTeamsCount) {
        const { count: teamCount } = await supabase
          .from('teams')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', leagueId);
        actualTeamsCount = teamCount || 0;
      }

      // FIX: Use teams.length * draft_rounds, not roster_size
      const totalExpectedPicks = (league?.draft_rounds || 0) * actualTeamsCount;
      const isComplete = count !== null && count >= totalExpectedPicks;
      
      logger.log('Draft completion check:', {
        currentPicks: count,
        expectedPicks: totalExpectedPicks,
        draftRounds: league?.draft_rounds,
        teamsCount: actualTeamsCount,
        isComplete
      });
      
      if (isComplete) {
        logger.log('Draft is complete! Updating league status to completed...');
        const { error: completeError } = await supabase
          .from('leagues')
          .update({ draft_status: 'completed' })
          .eq('id', leagueId);
        
        if (completeError) {
          logger.error('Error updating league to completed:', completeError);
        } else {
          logger.log('League status updated to completed successfully');
          
          // CRITICAL: Sync roster_assignments FIRST (this is the source of truth)
          // Then initialize team_lineups FROM roster_assignments to ensure consistency
          try {
            logger.log('Syncing roster_assignments from draft_picks...');
            const { data: syncResult, error: syncError } = await supabase
              .rpc('sync_roster_assignments_for_league', { p_league_id: leagueId });
            if (syncError) {
              logger.error('RPC sync_roster_assignments failed:', syncError);
              // Fallback: directly insert into roster_assignments
              // CRITICAL: Only use picks from the LATEST draft session to avoid cross-session contamination
              logger.log('Falling back to direct roster_assignments insert...');
              
              // Find the latest draft session ID
              const { data: latestPickData } = await supabase
                .from('draft_picks')
                .select('draft_session_id')
                .eq('league_id', leagueId)
                .is('deleted_at', null)
                .order('picked_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              
              const latestSessionId = latestPickData?.draft_session_id;
              logger.log('Latest draft session:', latestSessionId);
              
              let query = supabase
                .from('draft_picks')
                .select('league_id, team_id, player_id, picked_at')
                .eq('league_id', leagueId)
                .is('deleted_at', null);
              
              // Filter by session if we found one
              if (latestSessionId) {
                query = query.eq('draft_session_id', latestSessionId);
              }
              
              const { data: draftPicksData } = await query;

              if (draftPicksData && draftPicksData.length > 0) {
                // Delete existing assignments first
                await supabase
                  .from('roster_assignments')
                  .delete()
                  .eq('league_id', leagueId);

                // Insert from draft picks as a single batch upsert
                const rosterRows = draftPicksData.map(pick => ({
                  league_id: pick.league_id,
                  team_id: pick.team_id,
                  player_id: pick.player_id,
                  acquired_at: pick.picked_at || new Date().toISOString()
                }));

                const { error: batchError } = await supabase
                  .from('roster_assignments')
                  .upsert(rosterRows, { onConflict: 'league_id,player_id' });

                if (batchError) {
                  logger.warn(`Fallback: Batch upsert error, retrying one-by-one: ${batchError.message}`);
                  // Fall back to individual inserts only if batch fails
                  let insertedCount = 0;
                  for (const row of rosterRows) {
                    const { error: singleErr } = await supabase
                      .from('roster_assignments')
                      .upsert(row, { onConflict: 'league_id,player_id' });
                    if (!singleErr) insertedCount++;
                  }
                  logger.log(`Fallback: Inserted ${insertedCount}/${rosterRows.length} roster assignments`);
                } else {
                  logger.log(`Fallback: Batch inserted ${rosterRows.length} roster assignments`);
                }
              }
            } else {
              logger.log('Roster assignments synced:', syncResult);
              
              // CRITICAL: Verify the sync actually inserted the right number of rows
              // The RPC returns players_synced count — verify it matches draft_picks count
              const syncData = syncResult as { players_synced?: number } | null;
              if (syncData?.players_synced !== undefined) {
                const { count: pickCount } = await supabase
                  .from('draft_picks')
                  .select('*', { count: 'exact', head: true })
                  .eq('league_id', leagueId)
                  .is('deleted_at', null);
                  
                if (pickCount && syncData.players_synced < pickCount) {
                  logger.error(`SYNC MISMATCH: roster_assignments has ${syncData.players_synced} but draft_picks has ${pickCount} active picks`);
                  logger.error('This means some draft picks were NOT synced to roster_assignments!');
                  // Attempt a retry
                  const { data: retryResult } = await supabase
                    .rpc('sync_roster_assignments_for_league', { p_league_id: leagueId });
                  logger.log('Retry sync result:', retryResult);
                } else {
                  logger.log(`✅ Sync verified: ${syncData.players_synced} roster assignments match ${pickCount} draft picks`);
                }
              }
            }
            
            // NOW initialize team_lineups from roster_assignments (after sync is complete)
            try {
              logger.log('Initializing rosters for all teams from roster_assignments...');
              await this.initializeRostersForAllTeams(leagueId);
              logger.log('Roster initialization complete');
            } catch (rosterError: unknown) {
              logger.error('Error initializing rosters:', rosterError);
              // Don't fail the draft completion if roster init fails
            }
          } catch (syncError: unknown) {
            logger.error('Error syncing roster_assignments:', syncError);
          }
          
          // Generate matchups for the entire season immediately after draft completion
          try {
            logger.log('Generating matchups for the entire season...');
            const { MatchupService } = await import('./MatchupService');
            const { LeagueService } = await import('./LeagueService');
            const { getFirstWeekStartDate, getDraftCompletionDate } = await import('@/utils/weekCalculator');
            
            // Get league data to determine first week start
            // Note: This is internal service call, userId should be passed from calling context
            // For now, we'll skip membership check here since this is called after draft completion
            const { league } = await LeagueService.getLeague(leagueId, userId);
            if (league) {
              // Check if this league format uses weekly matchups
              const { getLeagueFormat } = await import('./LeagueService');
              const { FORMAT_HAS_MATCHUPS } = await import('@/types/leagueTypes');
              const fmt = getLeagueFormat(league);
              const needsMatchups = FORMAT_HAS_MATCHUPS[fmt.scoringFormat] ?? true;

              if (!needsMatchups) {
                logger.log(`League format "${fmt.scoringFormat}" does not use weekly matchups - skipping generation`);
              } else {
                const draftCompletionDate = getDraftCompletionDate(league);
                if (draftCompletionDate) {
                  const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);

                  // Get all teams
                  const { teams } = await LeagueService.getLeagueTeams(leagueId);

                  // Generate matchups for all weeks
                  const { error: matchupError } = await MatchupService.generateMatchupsForLeague(
                    leagueId,
                    teams,
                    firstWeekStart,
                    false // Don't force regenerate
                  );

                  if (matchupError) {
                    logger.error('Error generating matchups:', matchupError);
                  } else {
                    logger.log('Matchups generated successfully for entire season');
                  }
                } else {
                  logger.warn('Could not determine draft completion date, skipping matchup generation');
                }
              }
            } else {
              logger.warn('Could not load league data, skipping matchup generation');
            }
          } catch (matchupGenError: unknown) {
            logger.error('Error generating matchups after draft completion:', matchupGenError);
            // Don't fail the draft completion if matchup generation fails
          }
        }
      }

      return { pick: data, error: null, isComplete };
    } catch (error: unknown) {
      return { pick: null, error };
    }
  },

  /**
   * Get current draft state (active session only)
   */
  async getDraftState(
    leagueId: string,
    teams: Team[],
    totalRounds: number,
    userId?: string,
    sessionId?: string
  ): Promise<{ state: DraftState | null; error: unknown }> {
    try {
      // Get all active (non-deleted) picks - no session ID filtering needed
      const { picks } = await this.getDraftPicks(leagueId, userId || '', sessionId);
      const totalPicks = picks.length;

      // Derive session ID from existing picks (if any) instead of generating random ones
      const derivedSessionId = sessionId || (picks.length > 0 ? picks[0].draft_session_id : undefined);

      const currentRound = Math.floor(totalPicks / teams.length) + 1;
      const currentPick = totalPicks + 1;

      if (currentRound > totalRounds) {
        return {
          state: {
            currentRound: totalRounds,
            currentPick: totalPicks,
            totalPicks,
            nextTeamId: null,
            isComplete: true,
            sessionId: derivedSessionId,
          },
          error: null,
        };
      }

      // Get draft order - pass session ID if we have one from picks
      const { order } = await this.getDraftOrder(leagueId, userId || '', currentRound, derivedSessionId);
      if (!order) {
        return { state: null, error: new Error('Draft order not initialized') };
      }

      const pickIndexInRound = (totalPicks % teams.length);
      const nextTeamId = order.team_order[pickIndexInRound] || null;

      return {
        state: {
          currentRound,
          currentPick: currentPick,
          totalPicks,
          nextTeamId,
          isComplete: false,
          sessionId: derivedSessionId || order.draft_session_id,
        },
        error: null,
      };
    } catch (error: unknown) {
      return { state: null, error };
    }
  },

  /**
   * Reset draft for a league (soft delete - safe for testing)
   * Creates a new session for the next draft attempt
   */
  async resetDraft(leagueId: string): Promise<{ error: unknown; newSessionId?: string }> {
    try {
      // Use RPC function that runs as SECURITY DEFINER to bypass RLS
      // Direct .delete() on draft_picks silently fails because there's no DELETE RLS policy
      const { error: rpcError } = await supabase.rpc('nuclear_reset_draft', {
        p_league_id: leagueId
      });

      if (rpcError) {
        logger.error('RPC nuclear_reset_draft failed, falling back to direct deletes:', rpcError);
        // Fallback: try direct deletes (works if RLS policies have been added)
        const { error: picksError } = await supabase
          .from('draft_picks')
          .delete()
          .eq('league_id', leagueId);
        if (picksError) logger.error('Fallback delete draft_picks error:', picksError);

        const { error: orderError } = await supabase
          .from('draft_order')
          .delete()
          .eq('league_id', leagueId);
        if (orderError) logger.error('Fallback delete draft_order error:', orderError);

        // Clean up roster data
        const { data: leagueTeams } = await supabase
          .from('teams')
          .select('id')
          .eq('league_id', leagueId);

        if (leagueTeams && leagueTeams.length > 0) {
          await supabase
            .from('team_lineups')
            .delete()
            .in('team_id', leagueTeams.map(t => t.id));
        }

        await supabase
          .from('roster_assignments')
          .delete()
          .eq('league_id', leagueId);

        // Reset league status
        const { data: currentLeague } = await supabase
          .from('leagues')
          .select('settings')
          .eq('id', leagueId)
          .single();

        const currentSettings = currentLeague?.settings || {};
        const { timerStartedAt: _, ...settingsWithoutTimer } = currentSettings as Record<string, unknown>;

        const { error: leagueError } = await supabase
          .from('leagues')
          .update({
            draft_status: 'not_started',
            scheduled_draft_time: null,
            settings: { ...settingsWithoutTimer, timerStartedAt: null }
          } as any)
          .eq('id', leagueId);

        if (leagueError) throw leagueError;
      }

      // Return new session ID for next draft
      const newSessionId = crypto.randomUUID();
      return { error: null, newSessionId };
    } catch (error: unknown) {
      return { error };
    }
  },

  /**
   * Undo the last draft pick (commissioner only)
   * Soft-deletes the most recent pick and returns the updated state
   */
  async undoLastPick(
    leagueId: string,
    userId: string
  ): Promise<{ undone: DraftPick | null; error: unknown }> {
    try {
      // Get the most recent active pick
      const { data: lastPick, error: fetchError } = await supabase
        .from('draft_picks')
        .select('id, league_id, team_id, player_id, round_number, pick_number, draft_session_id, picked_at, deleted_at')
        .eq('league_id', leagueId)
        .is('deleted_at', null)
        .order('pick_number', { ascending: false })
        .limit(1)
        .single();

      if (fetchError || !lastPick) {
        return { undone: null, error: fetchError || new Error('No picks to undo') };
      }

      // Soft-delete the pick
      const { error: deleteError } = await supabase
        .from('draft_picks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', lastPick.id);

      if (deleteError) {
        return { undone: null, error: deleteError };
      }

      logger.log('Undo last pick:', lastPick.player_id, 'from team:', lastPick.team_id);
      return { undone: lastPick, error: null };
    } catch (error: unknown) {
      return { undone: null, error };
    }
  },

  /**
   * Hard delete draft data (use with caution - for cleanup only)
   */
  async hardDeleteDraft(leagueId: string): Promise<{ error: unknown }> {
    try {
      // First, hard delete all draft picks for this league
      const { error: picksError } = await supabase
        .from('draft_picks')
        .delete()
        .eq('league_id', leagueId);

      if (picksError) {
        logger.error('Error deleting draft picks:', picksError);
        throw picksError;
      }

      // Then, hard delete all draft orders for this league
      const { error: orderError } = await supabase
        .from('draft_order')
        .delete()
        .eq('league_id', leagueId);

      if (orderError) {
        logger.error('Error deleting draft orders:', orderError);
        throw orderError;
      }

      // Finally, reset the league status
      const { error: statusError } = await supabase
        .from('leagues')
        .update({ draft_status: 'not_started' })
        .eq('id', leagueId);

      if (statusError) {
        logger.error('Error updating league status:', statusError);
        // Don't throw - we still want to return success if picks/orders were deleted
        // The status update can be retried
      }

      // Verify the deletion was successful
      const { count: remainingPicks } = await supabase
        .from('draft_picks')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', leagueId);
      
      const { count: remainingOrders } = await supabase
        .from('draft_order')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', leagueId);

      if (remainingPicks && remainingPicks > 0) {
        logger.warn(`Warning: ${remainingPicks} draft picks still exist after deletion`);
      }
      if (remainingOrders && remainingOrders > 0) {
        logger.warn(`Warning: ${remainingOrders} draft orders still exist after deletion`);
      }

      return { error: null };
    } catch (error: unknown) {
      return { error };
    }
  },

  /**
   * Delete ALL draft data across all leagues and reset all leagues to 'not_started'
   * WARNING: This is a destructive operation - use with extreme caution!
   * 
   * Note: This uses RPC to execute SQL directly since Supabase requires WHERE clauses.
   * For a simpler approach, use the SQL script: scripts/delete-all-draft-data.sql
   */
  async deleteAllDraftData(): Promise<{ error: unknown; deletedCounts?: { picks: number; orders: number; leagues: number } }> {
    try {
      // Get counts before deletion for reporting
      const { count: picksCountBefore } = await supabase
        .from('draft_picks')
        .select('*', { count: 'exact', head: true });
      
      const { count: ordersCountBefore } = await supabase
        .from('draft_order')
        .select('*', { count: 'exact', head: true });

      const { count: leaguesCount } = await supabase
        .from('leagues')
        .select('*', { count: 'exact', head: true });

      // RLS policies prevent deleting all at once, so we need to delete by league_id
      // Get all leagues and delete picks/orders for each one
      const { data: allLeagues, error: leaguesFetchError } = await supabase
        .from('leagues')
        .select('id');
      
      if (leaguesFetchError) {
        logger.error('Error fetching leagues for deletion:', leaguesFetchError);
        throw leaguesFetchError;
      }

      // Delete picks and orders for each league
      // This works with RLS because commissioners can delete for their leagues
      for (const league of allLeagues || []) {
        // Delete all picks for this league (RLS will allow if user is commissioner)
        const { error: picksError } = await supabase
          .from('draft_picks')
          .delete()
          .eq('league_id', league.id);
        
        if (picksError) {
          logger.warn(`Error deleting picks for league ${league.id}:`, picksError);
          // Continue with other leagues even if one fails
        }
        
        // Delete all orders for this league (RLS will allow if user is commissioner)
        const { error: orderError } = await supabase
          .from('draft_order')
          .delete()
          .eq('league_id', league.id);
        
        if (orderError) {
          logger.warn(`Error deleting orders for league ${league.id}:`, orderError);
          // Continue with other leagues even if one fails
        }
      }

      // Reset all leagues to 'not_started'
      const { error: leaguesError } = await supabase
        .from('leagues')
        .update({ draft_status: 'not_started' })
        .in('draft_status', ['in_progress', 'completed']);

      if (leaguesError) {
        logger.warn('Error resetting league statuses:', leaguesError);
        // Don't throw - we still want to return success if picks/orders were deleted
      }

      return { 
        error: null,
        deletedCounts: {
          picks: picksCountBefore || 0,
          orders: ordersCountBefore || 0,
          leagues: leaguesCount || 0
        }
      };
    } catch (error: unknown) {
      return { error };
    }
  },

  /**
   * Subscribe to draft picks changes (realtime) - active session only
   * REQUIRES: User must be a member of the league
   */
  subscribeToDraftPicks(
    leagueId: string,
    userId: string,
    callback: (pick: DraftPick) => void,
    sessionId?: string
  ) {
    // Subscribe to ALL pick events for this league
    // No session ID filtering - deleted_at filtering handles old sessions
    // The consumer reloads all picks from DB anyway, so no risk of stale data
    const channel = supabase
      .channel(`draft_picks:${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'draft_picks',
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const pick = payload.new as DraftPick;
          if (!pick.deleted_at) {
            callback(pick);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'draft_picks',
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          // Handle undo (soft-delete) or any update - trigger a refresh
          callback(payload.new as DraftPick);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          logger.error(`Draft picks subscription error for league ${leagueId}`);
        } else if (status === 'TIMED_OUT') {
          logger.warn(`Draft picks subscription timed out for league ${leagueId}, retrying...`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Initialize rosters for all teams in a league after draft completion
   * This ensures every team has a valid lineup saved in team_lineups table
   */
  async initializeRostersForAllTeams(leagueId: string): Promise<{ error: unknown }> {
    try {
      logger.log(`Initializing rosters for all teams in league ${leagueId}...`);
      
      // Get all teams in the league
      const { data: teams, error: teamsError } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId);

      if (teamsError) {
        logger.error('Error fetching teams:', teamsError);
        return { error: teamsError };
      }

      if (!teams || teams.length === 0) {
        logger.log('No teams found in league');
        return { error: null };
      }

      // Get all players (needed for lineup initialization)
      const allPlayers = await PlayerService.getAllPlayers();

      // Get commissioner ID for initializeTeamLineup (needed for membership validation)
      const { data: leagueData } = await supabase
        .from('leagues')
        .select('commissioner_id')
        .eq('id', leagueId)
        .single();
      
      const commissionerId = leagueData?.commissioner_id;

      // Initialize lineup for each team
      const results = await Promise.allSettled(
        teams.map(async (team) => {
          // Use commissioner ID since we're initializing all teams post-draft
          const { lineup, error } = await LeagueService.initializeTeamLineup(
            team.id,
            leagueId,
            allPlayers,
            commissionerId || ''
          );
          
          if (error) {
            logger.error(`Failed to initialize lineup for team ${team.id}:`, error);
            return { teamId: team.id, success: false, error };
          }
          
          logger.log(`Successfully initialized lineup for team ${team.id}`);
          return { teamId: team.id, success: true, lineup };
        })
      );

      // Log summary
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;
      logger.log(`Roster initialization complete: ${successful} successful, ${failed} failed`);

      return { error: null };
    } catch (error: unknown) {
      logger.error('Error initializing rosters for all teams:', error);
      return { error };
    }
  },

  /**
   * Save a draft snapshot for a completed draft
   * Stores the draft board grid data (teams and picks) for later viewing
   */
  async saveDraftSnapshot(
    leagueId: string,
    draftSessionId: string,
    teams: Array<{ id: string; name: string; owner: string; color: string }>,
    draftHistory: Array<{
      id: string;
      teamId: string;
      teamName: string;
      playerId: string;
      playerName: string;
      position: string;
      round: number;
      pick: number;
      timestamp: number;
    }>,
    leagueSettings: {
      rounds: number;
      draftOrder: string;
      completedAt: string;
    }
  ): Promise<{ snapshotId: string | null; error: unknown }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { snapshotId: null, error: 'User not authenticated' };
      }

      // Check if snapshot already exists for this session
      const { data: existing } = await supabase
        .from('draft_snapshots')
        .select('id')
        .eq('league_id', leagueId)
        .eq('draft_session_id', draftSessionId)
        .maybeSingle();

      if (existing) {
        logger.log('Snapshot already exists for this draft session');
        return { snapshotId: existing.id, error: null };
      }

      // Prepare snapshot data
      const snapshotData = {
        teams,
        picks: draftHistory,
        leagueSettings,
      };

      // Insert snapshot
      const { data, error } = await supabase
        .from('draft_snapshots')
        .insert({
          league_id: leagueId,
          draft_session_id: draftSessionId,
          snapshot_data: snapshotData,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (error) throw error;

      logger.log('Draft snapshot saved successfully:', data.id);
      return { snapshotId: data.id, error: null };
    } catch (error: unknown) {
      logger.error('Error saving draft snapshot:', error);
      return { snapshotId: null, error };
    }
  },

  /**
   * Get the most recent draft snapshot for a league
   */
  async getDraftSnapshot(leagueId: string): Promise<{ snapshot: DraftSnapshot | null; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('draft_snapshots')
        .select('*')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return { snapshot: null, error: null };
      }

      return { snapshot: data as unknown as DraftSnapshot, error: null };
    } catch (error: unknown) {
      logger.error('Error getting draft snapshot:', error);
      return { snapshot: null, error };
    }
  },
};

