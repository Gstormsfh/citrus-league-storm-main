/**
 * DemoLeagueService - Creates and manages the read-only demo league
 * 
 * DEMO LEAGUE PILLARS:
 * 1. Complete Isolation - No owner_id, excluded from user queries
 * 2. Fully Read-Only - All write operations blocked
 * 3. Shared Experience - Same league for all guests
 * 4. Static Data - Matchups pre-populated, never updated
 */

import { supabase } from '@/integrations/supabase/client';
import { LeagueService, LEAGUE_TEAMS_DATA } from './LeagueService';
import { PlayerService, Player } from './PlayerService';
import { DraftService } from './DraftService';
import { MatchupService } from './MatchupService';
import { COLUMNS } from '@/utils/queryColumns';

// Static demo league ID (old approach - not used anymore)
export const DEMO_LEAGUE_ID = '00000000-0000-0000-0000-000000000001';

// REAL league ID to use as read-only demo for guests
// This is the actual league that guests will see (read-only)
export const DEMO_LEAGUE_ID_FOR_GUESTS = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

export const DemoLeagueService = {
  /**
   * Get static demo roster for a team (fallback when DB fails)
   * Returns top 21 players by points for the demo team
   */
  getStaticDemoTeamRoster(teamId: string, allPlayers: Player[]): Player[] {
    // Return top 21 players sorted by points (best first)
    // This ensures we always have a roster to display
    return [...allPlayers]
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .slice(0, 21);
  },

  /**
   * Force reinitialize demo league (useful for debugging)
   * This will delete existing draft picks and recreate everything
   */
  async forceReinitialize(): Promise<{ success: boolean; error: any }> {
    try {
      console.log('[DemoLeagueService] FORCE REINITIALIZING demo league...');
      
      // Delete existing draft picks
      const { error: deletePicksError } = await supabase
        .from('draft_picks')
        .delete()
        .eq('league_id', DEMO_LEAGUE_ID);
      
      if (deletePicksError) {
        console.warn('[DemoLeagueService] Error deleting draft picks:', deletePicksError);
      }
      
      // Delete existing lineups
      const { error: deleteLineupsError } = await supabase
        .from('team_lineups')
        .delete()
        .eq('league_id', DEMO_LEAGUE_ID);
      
      if (deleteLineupsError) {
        console.warn('[DemoLeagueService] Error deleting lineups:', deleteLineupsError);
      }
      
      // Delete existing teams
      const { error: deleteTeamsError } = await supabase
        .from('teams')
        .delete()
        .eq('league_id', DEMO_LEAGUE_ID);
      
      if (deleteTeamsError) {
        console.warn('[DemoLeagueService] Error deleting teams:', deleteTeamsError);
      }
      
      // Delete league
      const { error: deleteLeagueError } = await supabase
        .from('leagues')
        .delete()
        .eq('id', DEMO_LEAGUE_ID);
      
      if (deleteLeagueError) {
        console.warn('[DemoLeagueService] Error deleting league:', deleteLeagueError);
      }
      
      console.log('[DemoLeagueService] Deleted existing demo league, now reinitializing...');
      
      // Reinitialize
      return await this.initializeDemoLeague();
    } catch (error) {
      console.error('[DemoLeagueService] Error in forceReinitialize:', error);
      return { success: false, error };
    }
  },

  /**
   * Check if demo league exists in database
   */
  async demoLeagueExists(): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('leagues')
        .select('id')
        .eq('id', DEMO_LEAGUE_ID)
        .maybeSingle();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        console.error('[DemoLeagueService] Error checking demo league:', error);
        return false;
      }
      
      return !!data;
    } catch (error) {
      console.error('[DemoLeagueService] Error checking demo league:', error);
      return false;
    }
  },

  /**
   * Initialize demo league (idempotent - safe to call multiple times)
   * Includes timeout handling for reliability
   * NOTE: Guests (not logged in) cannot write to database - will return error
   */
  async initializeDemoLeague(timeoutMs: number = 30000): Promise<{ success: boolean; error: any }> {
    const startTime = Date.now();
    
    try {
      // CRITICAL: Check if user is authenticated - guests can't write to database
      // This check MUST happen before any database operations
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          console.log('[DemoLeagueService] Guest user detected - cannot initialize demo league (requires authentication)');
          return { success: false, error: new Error('Guest users cannot initialize demo league - use static fallback instead') };
        }
        console.log('[DemoLeagueService] User authenticated, proceeding with initialization');
      } catch (authCheckError) {
        console.log('[DemoLeagueService] Auth check failed - assuming guest, skipping initialization');
        return { success: false, error: new Error('Authentication check failed - use static fallback instead') };
      }
      
      // Check if demo league already exists
      const exists = await this.demoLeagueExists();
      
      // Check if rosters are populated (check for draft picks)
      let rostersPopulated = false;
      if (exists) {
        const { count: draftPicksCount } = await supabase
          .from('draft_picks')
          .select(COLUMNS.COUNT, { count: 'exact', head: true })
          .eq('league_id', DEMO_LEAGUE_ID)
          .is('deleted_at', null);
        
        rostersPopulated = (draftPicksCount || 0) > 0;
      }
      
      if (exists && rostersPopulated) {
        console.log('[DemoLeagueService] Demo league already exists with rosters, skipping initialization');
        return { success: true, error: null };
      }

      // Check timeout before proceeding
      if (Date.now() - startTime > timeoutMs) {
        console.warn('[DemoLeagueService] Initialization timeout before starting');
        return { success: false, error: new Error('Initialization timeout') };
      }

      let teams = [];
      
      if (!exists) {
        // Double-check authentication before attempting to create league
        const { data: { user: verifyUser }, error: verifyError } = await supabase.auth.getUser();
        if (verifyError || !verifyUser) {
          console.log('[DemoLeagueService] Authentication verification failed - cannot create league');
          return { success: false, error: new Error('Authentication required to create demo league') };
        }
        
        console.log('[DemoLeagueService] Creating demo league...');

        // 1. Create the league
        const { data: league, error: leagueError } = await supabase
          .from('leagues')
          .insert({
            id: DEMO_LEAGUE_ID,
            name: 'Demo League',
            commissioner_id: null, // No owner - system league
            roster_size: 21,
            draft_rounds: 21,
            draft_status: 'completed',
            settings: {},
          })
          .select()
          .single();

        if (leagueError) {
          console.error('[DemoLeagueService] Error creating league:', leagueError);
          // If it's a 401 or RLS error, return a specific error
          if (leagueError.code === '42501' || leagueError.code === 'PGRST301' || leagueError.message?.includes('row-level security')) {
            return { success: false, error: new Error('Guest users cannot create demo league - use static fallback instead') };
          }
          return { success: false, error: leagueError };
        }

        console.log('[DemoLeagueService] League created:', league.id);

        // 2. Create 10 teams (no owner_id - completely isolated)
        for (const teamData of LEAGUE_TEAMS_DATA) {
          const { data: team, error: teamError } = await supabase
            .from('teams')
            .insert({
              id: `${DEMO_LEAGUE_ID}-team-${teamData.id}`,
              league_id: DEMO_LEAGUE_ID,
              owner_id: null, // No user ownership - pillar of isolation
              team_name: teamData.name,
            })
            .select()
            .single();

          if (teamError) {
            console.error(`[DemoLeagueService] Error creating team ${teamData.name}:`, teamError);
            continue;
          }

          teams.push(team);
        }

        console.log(`[DemoLeagueService] Created ${teams.length} teams`);
      } else {
        // League exists but rosters not populated - get existing teams
        console.log('[DemoLeagueService] Demo league exists but rosters not populated, getting existing teams...');
        const { data: existingTeams } = await supabase
          .from('teams')
          .select(COLUMNS.TEAM)
          .eq('league_id', DEMO_LEAGUE_ID);
        teams = existingTeams || [];
        console.log(`[DemoLeagueService] Found ${teams.length} existing teams`);
      }
      
      if (teams.length === 0) {
        console.error('[DemoLeagueService] No teams available for roster population');
        return { success: false, error: new Error('No teams available') };
      }

      // 3. Populate rosters via draft simulation
      const allPlayers = await PlayerService.getAllPlayers();
      
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        console.warn('[DemoLeagueService] Timeout before populating rosters');
        return { success: false, error: new Error('Initialization timeout') };
      }
      
      await this.populateDemoRosters(DEMO_LEAGUE_ID, teams, allPlayers);

      // 4. Initialize default lineups for all teams (non-blocking - can fail silently)
      try {
        await this.initializeDemoLineups(DEMO_LEAGUE_ID, teams, allPlayers);
      } catch (lineupError) {
        console.warn('[DemoLeagueService] Error initializing lineups (non-critical):', lineupError);
      }

      // 5. Create static matchups (non-blocking - can fail silently)
      try {
        await this.createDemoMatchups(DEMO_LEAGUE_ID, teams);
      } catch (matchupError) {
        console.warn('[DemoLeagueService] Error creating matchups (non-critical):', matchupError);
      }

      // Verify that picks were actually inserted
      const { count: finalPicksCount } = await supabase
        .from('draft_picks')
        .select(COLUMNS.COUNT, { count: 'exact', head: true })
        .eq('league_id', DEMO_LEAGUE_ID)
        .is('deleted_at', null);

      if ((finalPicksCount || 0) === 0) {
        console.error('[DemoLeagueService] Initialization completed but no picks found');
        return { success: false, error: new Error('No draft picks were created') };
      }

      console.log('[DemoLeagueService] Demo league initialization complete');
      return { success: true, error: null };
    } catch (error) {
      console.error('[DemoLeagueService] Error initializing demo league:', error);
      return { success: false, error };
    }
  },

  /**
   * Populate rosters via draft simulation - directly insert draft picks
   */
  async populateDemoRosters(
    leagueId: string,
    teams: any[],
    allPlayers: Player[]
  ): Promise<void> {
    try {
      console.log('[DemoLeagueService] Populating rosters via draft simulation...');

      // Sort players by points (best first)
      const sortedPlayers = [...allPlayers].sort((a, b) => (b.points || 0) - (a.points || 0));

      // Create draft session ID
      const sessionId = crypto.randomUUID();

      // Initialize draft order (serpentine) - create draft_order entries
      const draftOrderEntries = [];
      for (let round = 1; round <= 21; round++) {
        const isForward = round % 2 === 1;
        const teamOrder = isForward ? teams : [...teams].reverse();
        const teamIds = teamOrder.map(t => t.id);
        
        draftOrderEntries.push({
          league_id: leagueId,
          round_number: round,
          team_order: teamIds,
          draft_session_id: sessionId,
        });
      }

      // Insert draft order
      const { error: orderError } = await supabase
        .from('draft_order')
        .insert(draftOrderEntries);

      if (orderError) {
        console.warn('[DemoLeagueService] Error creating draft order:', orderError);
      }

      // Directly insert draft picks (bypass DraftService to avoid guards)
      const draftPicks = [];
      let playerIndex = 0;
      const usedPlayerIds = new Set<string>(); // Track used players to avoid duplicates

      // Simulate draft: 10 teams * 21 rounds = 210 picks
      for (let round = 1; round <= 21; round++) {
        const isForward = round % 2 === 1;
        const teamOrder = isForward ? teams : [...teams].reverse();

        for (let pickInRound = 0; pickInRound < teamOrder.length; pickInRound++) {
          const team = teamOrder[pickInRound];
          const pickNumber = (round - 1) * teams.length + pickInRound + 1;

          // Get next available player (skip if already used)
          while (playerIndex < sortedPlayers.length) {
            const player = sortedPlayers[playerIndex];
            playerIndex++;
            
            // Skip if player already used
            if (usedPlayerIds.has(player.id)) {
              continue;
            }
            
            usedPlayerIds.add(player.id);

            draftPicks.push({
              league_id: leagueId,
              team_id: team.id,
              player_id: player.id,
              round_number: round,
              pick_number: pickNumber,
              draft_session_id: sessionId,
              picked_at: new Date().toISOString(),
            });
            break;
          }
        }
      }
      
      console.log(`[DemoLeagueService] Generated ${draftPicks.length} draft picks for ${teams.length} teams`);
      
      if (draftPicks.length === 0) {
        throw new Error('No draft picks generated! Check that teams and players are available.');
      }

      // Batch insert all draft picks (in chunks to avoid size limits)
      console.log(`[DemoLeagueService] Inserting ${draftPicks.length} draft picks in chunks...`);
      
      // Insert in chunks of 50 to avoid potential size limits
      const chunkSize = 50;
      let totalInserted = 0;
      for (let i = 0; i < draftPicks.length; i += chunkSize) {
        const chunk = draftPicks.slice(i, i + chunkSize);
        const { data: insertedData, error: picksError } = await supabase
          .from('draft_picks')
          .insert(chunk)
          .select('id');

        if (picksError) {
          console.error(`[DemoLeagueService] Error inserting draft picks chunk ${i + 1}-${i + chunk.length}:`, picksError);
          console.error('[DemoLeagueService] Sample chunk data:', chunk.slice(0, 2));
          throw picksError;
        }
        totalInserted += insertedData?.length || 0;
        console.log(`[DemoLeagueService] Inserted chunk ${Math.floor(i / chunkSize) + 1}: ${insertedData?.length || 0} picks (${totalInserted}/${draftPicks.length} total)`);
      }

      console.log(`[DemoLeagueService] Successfully inserted ${totalInserted} draft picks`);
      
      // Verify insertion
      const { count: verifyCount, error: verifyError } = await supabase
        .from('draft_picks')
        .select(COLUMNS.COUNT, { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .is('deleted_at', null);
      
      if (verifyError) {
        console.error('[DemoLeagueService] Error verifying picks:', verifyError);
      } else {
        console.log(`[DemoLeagueService] Verified: ${verifyCount} total draft picks in database`);
        
        // Check picks for first team
        if (teams.length > 0) {
          const { count: teamPicksCount } = await supabase
            .from('draft_picks')
            .select(COLUMNS.COUNT, { count: 'exact', head: true })
            .eq('league_id', leagueId)
            .eq('team_id', teams[0].id)
            .is('deleted_at', null);
          console.log(`[DemoLeagueService] Team ${teams[0].team_name} has ${teamPicksCount} picks`);
        }
      }
    } catch (error) {
      console.error('[DemoLeagueService] Error populating rosters:', error);
      throw error;
    }
  },

  /**
   * Initialize default lineups for all demo teams
   */
  async initializeDemoLineups(
    leagueId: string,
    teams: any[],
    allPlayers: Player[]
  ): Promise<void> {
    try {
      console.log('[DemoLeagueService] Initializing default lineups...');

      for (const team of teams) {
        // Get team roster using MatchupService (uses draft picks from database)
        const roster = await MatchupService.getTeamRoster(team.id, leagueId, allPlayers);
        
        // Convert HockeyPlayer[] to Player[] for lineup logic
        const playerRoster: Player[] = roster.map(hp => {
          const player = allPlayers.find(p => p.id === hp.id);
          if (!player) {
            // Create minimal Player object from HockeyPlayer
            return {
              id: hp.id,
              full_name: hp.name,
              position: hp.position,
              team: hp.team || '',
              points: hp.points || 0,
            } as Player;
          }
          return player;
        }).filter((p): p is Player => p !== undefined);

        if (playerRoster.length === 0) continue;

        // Create default lineup (same logic as initializeDefaultLineups)
        const starters: string[] = [];
        const bench: string[] = [];
        const ir: string[] = [];
        const slotAssignments: Record<string, string> = {};

        const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
        const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };

        const getFantasyPosition = (pos: string): string => {
          if (pos === 'G') return 'G';
          if (['C'].includes(pos)) return 'C';
          if (['LW', 'L'].includes(pos)) return 'LW';
          if (['RW', 'R'].includes(pos)) return 'RW';
          if (['D', 'LD', 'RD'].includes(pos)) return 'D';
          return 'UTIL';
        };

        const sortedPlayers = [...playerRoster].sort((a, b) => (b.points || 0) - (a.points || 0));

        sortedPlayers.forEach(p => {
          const playerId = String(p.id);
          const statusLower = p.status?.toLowerCase() || '';
          
          if (statusLower === 'injured' || statusLower === 'suspended' || statusLower === 'ir') {
            if (ir.length < 3) {
              ir.push(playerId);
              slotAssignments[playerId] = `ir-slot-${ir.length}`;
            } else {
              bench.push(playerId);
            }
            return;
          }

          const pos = getFantasyPosition(p.position);
          let assigned = false;

          // Prioritize position-specific slots (especially G and D)
          if (pos === 'G' && slotsFilled['G'] < slotsNeeded['G']) {
            slotsFilled['G']++;
            assigned = true;
            slotAssignments[playerId] = `slot-G-${slotsFilled['G']}`;
          } else if (pos !== 'UTIL' && pos !== 'G' && slotsFilled[pos] < slotsNeeded[pos]) {
            slotsFilled[pos]++;
            assigned = true;
            slotAssignments[playerId] = `slot-${pos}-${slotsFilled[pos]}`;
          } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
            slotsFilled['UTIL']++;
            assigned = true;
            slotAssignments[playerId] = 'slot-UTIL';
          }

          if (assigned) {
            starters.push(playerId);
          } else {
            bench.push(playerId);
          }
        });

        // Position-aware filling: Ensure all 13 slots are filled
        const totalSlotsNeeded = 13;
        if (starters.length < totalSlotsNeeded) {
          // Count current positions
          const currentPositionCounts = {
            C: starters.filter(id => {
              const player = playerRoster.find(p => String(p.id) === id);
              return player && getFantasyPosition(player.position) === 'C';
            }).length,
            LW: starters.filter(id => {
              const player = playerRoster.find(p => String(p.id) === id);
              return player && getFantasyPosition(player.position) === 'LW';
            }).length,
            RW: starters.filter(id => {
              const player = playerRoster.find(p => String(p.id) === id);
              return player && getFantasyPosition(player.position) === 'RW';
            }).length,
            D: starters.filter(id => {
              const player = playerRoster.find(p => String(p.id) === id);
              return player && getFantasyPosition(player.position) === 'D';
            }).length,
            G: starters.filter(id => {
              const player = playerRoster.find(p => String(p.id) === id);
              return player && getFantasyPosition(player.position) === 'G';
            }).length,
            UTIL: starters.filter(id => {
              const player = playerRoster.find(p => String(p.id) === id);
              return player && getFantasyPosition(player.position) === 'UTIL';
            }).length
          };

          // Priority order: Fill critical positions first (G, D), then others
          const priorityOrder: Array<'G' | 'D' | 'C' | 'LW' | 'RW' | 'UTIL'> = ['G', 'D', 'C', 'LW', 'RW', 'UTIL'];
          const remainingBench = [...bench].map(id => {
            const player = playerRoster.find(p => String(p.id) === id);
            return { id, player };
          }).filter(item => item.player).sort((a, b) => (b.player?.points || 0) - (a.player?.points || 0));

          // First pass: Fill missing positions with position-specific players
          for (const pos of priorityOrder) {
            const needed = slotsNeeded[pos];
            const current = currentPositionCounts[pos];
            const missing = needed - current;
            
            if (missing > 0 && starters.length < totalSlotsNeeded) {
              // Find best available players of this position from bench
              const positionPlayers = remainingBench.filter(item => 
                item.player && getFantasyPosition(item.player.position) === pos
              );
              const bestOfPosition = positionPlayers.slice(0, Math.min(missing, totalSlotsNeeded - starters.length));
              
              bestOfPosition.forEach(item => {
                starters.push(item.id);
                const benchIndex = bench.indexOf(item.id);
                if (benchIndex >= 0) {
                  bench.splice(benchIndex, 1);
                }
                const remainingIndex = remainingBench.findIndex(b => b.id === item.id);
                if (remainingIndex >= 0) {
                  remainingBench.splice(remainingIndex, 1);
                }
                slotAssignments[item.id] = `slot-${pos}-${currentPositionCounts[pos] + 1}`;
                currentPositionCounts[pos]++;
              });
            }
          }

          // Second pass: Fill any remaining slots with best available players
          while (starters.length < totalSlotsNeeded && remainingBench.length > 0) {
            const bestItem = remainingBench.shift();
            if (bestItem) {
              starters.push(bestItem.id);
              const benchIndex = bench.indexOf(bestItem.id);
              if (benchIndex >= 0) {
                bench.splice(benchIndex, 1);
              }
              const pos = bestItem.player ? getFantasyPosition(bestItem.player.position) : 'UTIL';
              slotAssignments[bestItem.id] = `slot-${pos}-${Date.now()}`;
            }
          }
        }

        // Save lineup (one-time initialization) - ensure we have all 13 starters
        if (starters.length >= 13 && bench.length > 0) {
          await LeagueService.saveLineup(team.id, leagueId, {
            starters,
            bench,
            ir,
            slotAssignments
          });
          console.log(`[DemoLeagueService] Saved lineup for team ${team.team_name}: ${starters.length} starters, ${bench.length} bench, ${ir.length} IR`);
        } else {
          console.warn(`[DemoLeagueService] Lineup for team ${team.team_name} incomplete: ${starters.length} starters (need 13), ${bench.length} bench`);
        }
      }

      console.log('[DemoLeagueService] Lineups initialized');
    } catch (error) {
      console.error('[DemoLeagueService] Error initializing lineups:', error);
      throw error;
    }
  },

  /**
   * Create static matchups for demo league
   */
  async createDemoMatchups(leagueId: string, teams: any[]): Promise<void> {
    try {
      console.log('[DemoLeagueService] Creating static matchups...');

      // Generate matchups for weeks 1-20
      for (let week = 1; week <= 20; week++) {
        const weekStart = new Date(2024, 0, 1 + (week - 1) * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        // Create round-robin matchups
        for (let i = 0; i < teams.length; i += 2) {
          if (i + 1 < teams.length) {
            const team1 = teams[i];
            const team2 = teams[i + 1];

            // Create matchup
            const { error: matchupError } = await supabase
              .from('matchups')
              .insert({
                league_id: leagueId,
                week_number: week,
                week_start_date: weekStart.toISOString(),
                week_end_date: weekEnd.toISOString(),
                team1_id: team1.id,
                team2_id: team2.id,
                team1_score: Math.floor(Math.random() * 200) + 1000, // Static scores
                team2_score: Math.floor(Math.random() * 200) + 1000,
                status: 'completed',
              });

            if (matchupError) {
              console.warn(`[DemoLeagueService] Error creating matchup week ${week}:`, matchupError);
            }
          }
        }
      }

      console.log('[DemoLeagueService] Matchups created');
    } catch (error) {
      console.error('[DemoLeagueService] Error creating matchups:', error);
      throw error;
    }
  },
};

// Expose for manual initialization (for debugging)
if (typeof window !== 'undefined') {
  (window as any).initDemoLeague = async () => {
    console.log('Manually initializing demo league...');
    const result = await DemoLeagueService.forceReinitialize();
    console.log('Result:', result);
    return result;
  };
  console.log('Demo league initialization available at: window.initDemoLeague()');
}

