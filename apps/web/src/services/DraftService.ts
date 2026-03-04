import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { logger } from '@/utils/logger';
import { Team, LeagueService } from './LeagueService';
import { PlayerService } from './PlayerService';
import { draftApi } from '@/api/draft';

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

// ─── Request deduplication for draft fetches ─────────────────────
const DRAFT_CACHE_TTL = 30_000; // 30 seconds
const draftRequestCache = new Map<string, { promise: Promise<any>; timestamp: number }>();

function getDraftCachedOrFetch<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = draftRequestCache.get(cacheKey);
  if (existing && Date.now() - existing.timestamp < DRAFT_CACHE_TTL) {
    return existing.promise as Promise<T>;
  }
  const promise = fetcher().finally(() => {
    setTimeout(() => {
      const entry = draftRequestCache.get(cacheKey);
      if (entry && entry.promise === promise) {
        draftRequestCache.delete(cacheKey);
      }
    }, DRAFT_CACHE_TTL);
  });
  draftRequestCache.set(cacheKey, { promise, timestamp: Date.now() });
  return promise;
}

export const DraftService = {
  /**
   * Get or create active draft session for a league
   */
  async getActiveDraftSession(leagueId: string, _userId?: string): Promise<{ sessionId: string; error: unknown }> {
    try {
      const response = await draftApi.getActiveSession(leagueId);
      return { sessionId: response.data!.sessionId, error: null };
    } catch (error: unknown) {
      // Fallback: generate new session if API fails
      const newSessionId = crypto.randomUUID();
      logger.warn('getActiveDraftSession API failed, using new session:', newSessionId);
      return { sessionId: newSessionId, error: null };
    }
  },

  /**
   * Get all draft picks for a league (active session only)
   */
  async getDraftPicks(leagueId: string, _userId: string, sessionId?: string): Promise<{ picks: DraftPick[]; error: unknown }> {
    return getDraftCachedOrFetch(`draftPicks:${leagueId}:${sessionId || ''}`, async () => {
      try {
        const response = await draftApi.getDraftPicks(leagueId, sessionId);
        return { picks: response.data || [], error: null };
      } catch (error: unknown) {
        return { picks: [], error };
      }
    });
  },

  /**
   * Get draft order for a specific round (active session only)
   */
  async getDraftOrder(leagueId: string, _userId: string, roundNumber: number, sessionId?: string): Promise<{ order: DraftOrder | null; error: unknown }> {
    try {
      const response = await draftApi.getDraftOrder(leagueId, roundNumber, sessionId);
      return { order: response.data || null, error: null };
    } catch (error: unknown) {
      return { order: null, error };
    }
  },

  /**
   * Initialize draft order for a league (snake draft)
   */
  async initializeDraftOrder(
    leagueId: string,
    _userId: string,
    teams: Team[],
    totalRounds: number,
    _resetExisting: boolean = false,
    customTeamOrder?: string[],
    draftType?: string
  ): Promise<{ error: unknown; sessionId?: string }> {
    try {
      const response = await draftApi.initializeOrder(leagueId, {
        teams: teams.map(t => ({ id: t.id })),
        totalRounds,
        customTeamOrder,
        draftType,
      });
      return { error: null, sessionId: response.data?.sessionId };
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
    if (leagueId === '00000000-0000-0000-0000-000000000001') {
      const { picks } = await this.getDraftPicks(leagueId, '', sessionId);
      if (picks.length > 0) {
        return {
          pick: null,
          error: new Error('Demo league is read-only. Sign up to create your own league!')
        };
      }
    }

    try {
      const response = await draftApi.makePick(leagueId, {
        playerId,
        teamId,
        pickNumber,
        roundNumber,
        draftSessionId: sessionId,
        teamsCount,
      });

      const pick = response.data?.pick || null;
      const isComplete = response.data?.isComplete || false;

      if (isComplete) {
        // Post-draft-completion tasks (still using supabase for now — will migrate later)
        logger.log('Draft is complete! Running post-completion tasks...');

        try {
          // Initialize rosters for all teams
          logger.log('Initializing rosters for all teams from roster_assignments...');
          await this.initializeRostersForAllTeams(leagueId);
          logger.log('Roster initialization complete');
        } catch (rosterError: unknown) {
          logger.error('Error initializing rosters:', rosterError);
        }

        // Save draft snapshot
        try {
          logger.log('Saving draft snapshot...');
          const targetSessionId = sessionId || pick?.draft_session_id || '';
          const { data: snapshotTeams } = await supabase
            .from('teams').select('id, team_name, owner_id').eq('league_id', leagueId);
          const { picks: snapshotPicks } = await this.getDraftPicks(leagueId, '', targetSessionId);
          if (snapshotTeams && snapshotPicks) {
            const playerIds = snapshotPicks.map(p => p.player_id);
            const players = playerIds.length > 0
              ? await PlayerService.getPlayersByIds(playerIds)
              : [];
            const playerMap = new Map(players.map(p => [String(p.id), p]));

            await this.saveDraftSnapshot(
              leagueId,
              targetSessionId,
              snapshotTeams.map(t => ({ id: t.id, name: t.team_name, owner: t.owner_id || 'AI', color: '' })),
              snapshotPicks.map(p => {
                const player = playerMap.get(String(p.player_id));
                return {
                  id: p.id, teamId: p.team_id, teamName: snapshotTeams.find(t => t.id === p.team_id)?.team_name || '',
                  playerId: p.player_id, playerName: player?.full_name || '', position: player?.position || '', round: p.round_number,
                  pick: p.pick_number, timestamp: new Date(p.picked_at).getTime(),
                };
              }),
              { rounds: 0, draftOrder: 'snake', completedAt: new Date().toISOString() }
            );
            logger.log('Draft snapshot saved successfully');
          }
        } catch (snapshotError: unknown) {
          logger.error('Error saving draft snapshot (non-critical):', snapshotError);
        }

        // Generate matchups
        try {
          logger.log('Generating matchups for the entire season...');
          const { MatchupService } = await import('./MatchupService');
          const { LeagueService: LS } = await import('./LeagueService');
          const { getFirstWeekStartDate, getDraftCompletionDate } = await import('@/utils/weekCalculator');
          const { getLeagueFormat } = await import('./LeagueService');
          const { FORMAT_HAS_MATCHUPS } = await import('@/types/leagueTypes');

          const { league } = await LS.getLeague(leagueId, _userId);
          if (league) {
            const fmt = getLeagueFormat(league);
            const needsMatchups = FORMAT_HAS_MATCHUPS[fmt.scoringFormat] ?? true;

            if (needsMatchups) {
              const draftCompletionDate = getDraftCompletionDate(league);
              if (draftCompletionDate) {
                const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
                const { teams } = await LS.getLeagueTeams(leagueId);
                await MatchupService.generateMatchupsForLeague(leagueId, teams, firstWeekStart, false);
                logger.log('Matchups generated successfully for entire season');
              }
            }
          }
        } catch (matchupGenError: unknown) {
          logger.error('Error generating matchups after draft completion:', matchupGenError);
        }
      }

      return { pick, error: null, isComplete };
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
    _userId?: string,
    sessionId?: string
  ): Promise<{ state: DraftState | null; error: unknown }> {
    try {
      // Get all active picks via API
      const { picks } = await this.getDraftPicks(leagueId, '', sessionId);
      const totalPicks = picks.length;

      // Derive session ID from existing picks
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

      // Get draft order via API
      const { order } = await this.getDraftOrder(leagueId, '', currentRound, derivedSessionId);
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
   * Reset draft for a league
   */
  async resetDraft(leagueId: string): Promise<{ error: unknown; newSessionId?: string }> {
    try {
      const response = await draftApi.resetDraft(leagueId);
      return { error: null, newSessionId: response.data?.newSessionId || crypto.randomUUID() };
    } catch (error: unknown) {
      return { error };
    }
  },

  /**
   * Undo the last draft pick (commissioner only)
   */
  async undoLastPick(
    leagueId: string,
    _userId: string
  ): Promise<{ undone: DraftPick | null; error: unknown }> {
    try {
      const response = await draftApi.undoLastPick(leagueId);
      return { undone: response.data?.undone || null, error: null };
    } catch (error: unknown) {
      return { undone: null, error };
    }
  },

  /**
   * Hard delete draft data (use with caution - for cleanup only)
   */
  async hardDeleteDraft(leagueId: string): Promise<{ error: unknown }> {
    try {
      await draftApi.hardDeleteDraft(leagueId);
      return { error: null };
    } catch (error: unknown) {
      return { error };
    }
  },

  /**
   * Delete ALL draft data across all leagues — admin only
   * NOTE: This still uses Supabase directly as it's an admin-only operation
   */
  async deleteAllDraftData(): Promise<{ error: unknown; deletedCounts?: { picks: number; orders: number; leagues: number } }> {
    try {
      const { count: picksCountBefore } = await supabase
        .from('draft_picks')
        .select('*', { count: 'exact', head: true });

      const { count: ordersCountBefore } = await supabase
        .from('draft_order')
        .select('*', { count: 'exact', head: true });

      const { count: leaguesCount } = await supabase
        .from('leagues')
        .select('*', { count: 'exact', head: true });

      const { data: allLeagues } = await supabase
        .from('leagues')
        .select('id');

      for (const league of allLeagues || []) {
        await supabase.from('draft_picks').delete().eq('league_id', league.id);
        await supabase.from('draft_order').delete().eq('league_id', league.id);
      }

      await supabase
        .from('leagues')
        .update({ draft_status: 'not_started' })
        .in('draft_status', ['in_progress', 'completed']);

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
   * Subscribe to draft picks changes (realtime)
   * NOTE: Stays on Supabase — realtime channels don't go through REST
   */
  subscribeToDraftPicks(
    leagueId: string,
    _userId: string,
    callback: (pick: DraftPick) => void,
    _sessionId?: string
  ) {
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
   * NOTE: Still uses Supabase directly — will migrate when roster routes are done
   */
  async initializeRostersForAllTeams(leagueId: string): Promise<{ error: unknown }> {
    try {
      logger.log(`Initializing rosters for all teams in league ${leagueId}...`);

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

      const allPlayers = await PlayerService.getAllPlayers();

      const { data: leagueData } = await supabase
        .from('leagues')
        .select('commissioner_id')
        .eq('id', leagueId)
        .single();

      const commissionerId = leagueData?.commissioner_id;

      const results = await Promise.allSettled(
        teams.map(async (team) => {
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
      const snapshotData = { teams, picks: draftHistory, leagueSettings };
      const response = await draftApi.saveSnapshot(leagueId, {
        draftSessionId,
        snapshotData,
      });
      return { snapshotId: response.data?.snapshotId || null, error: null };
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
      const response = await draftApi.getSnapshot(leagueId);
      return { snapshot: response.data || null, error: null };
    } catch (error: unknown) {
      logger.error('Error getting draft snapshot:', error);
      return { snapshot: null, error };
    }
  },

  // ============================================================================
  // AUTOPICK DRAFT SUPPORT
  // ============================================================================

  /**
   * Autopick the next player for a specific team.
   */
  async autopickForTeam(
    leagueId: string,
    teamId: string,
    sessionId: string,
    roundNumber: number,
    pickNumber: number
  ): Promise<{ playerId: number | null; playerName: string | null; position: string | null; pickId: string | null; error: unknown }> {
    try {
      const response = await draftApi.autopick(leagueId, {
        teamId,
        sessionId,
        roundNumber,
        pickNumber,
      });
      const result = response.data;
      return {
        playerId: result?.playerId || null,
        playerName: result?.playerName || null,
        position: result?.position || null,
        pickId: result?.pickId || null,
        error: null,
      };
    } catch (error: unknown) {
      logger.error('Autopick failed:', error);
      return { playerId: null, playerName: null, position: null, pickId: null, error };
    }
  },

  /**
   * Run a full autopick draft for the entire league.
   */
  async runFullAutopickDraft(
    leagueId: string
  ): Promise<{ picks: Array<{ round: number; pick: number; teamId: string; playerId: number; playerName: string }>; error: unknown }> {
    try {
      const response = await draftApi.fullAutopick(leagueId);
      return { picks: response.data?.picks || [], error: null };
    } catch (error: unknown) {
      logger.error('Full autopick draft failed:', error);
      return { picks: [], error };
    }
  },

  /**
   * Save autopick rankings for a team.
   */
  async saveAutopickRankings(
    leagueId: string | null,
    teamId: string | null,
    rankings: Array<{ playerId: number; rank: number; positionCode: string }>
  ): Promise<{ error: unknown }> {
    try {
      if (!leagueId) {
        return { error: new Error('leagueId is required') };
      }
      await draftApi.saveRankings(leagueId, { teamId, rankings });
      return { error: null };
    } catch (error: unknown) {
      logger.error('Error saving autopick rankings:', error);
      return { error };
    }
  },

  /**
   * Get autopick rankings for a team.
   */
  async getAutopickRankings(
    leagueId: string,
    teamId?: string
  ): Promise<{ rankings: Array<{ playerId: number; rank: number; positionCode: string; tier: number }>; error: unknown }> {
    try {
      const response = await draftApi.getRankings(leagueId, teamId);
      return { rankings: response.data || [], error: null };
    } catch (error: unknown) {
      logger.error('Error fetching autopick rankings:', error);
      return { rankings: [], error };
    }
  },
};

// Re-export userId as _ parameter for backward compatibility with callers
// that pass userId (now handled by JWT on the server)
