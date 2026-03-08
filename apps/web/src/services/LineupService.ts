/**
 * LineupService — Extracted from LeagueService.ts
 *
 * Contains all lineup-related methods:
 * - saveLineup()
 * - getLineup()
 * - initializeTeamLineup()
 * - canUpdateRosterForDate()
 * - loadDailyRoster()
 * - backfillMissingDailyRosters()
 * - backfillAllMatchupsForLeague()
 * - createDailyRosterSnapshots()
 */

import { Player, PlayerService } from "@/services/PlayerService";
import { supabase } from "@/integrations/supabase/client";
import { MatchupService } from "./MatchupService";
import { RosterCacheService } from "./RosterCacheService";
import { DEMO_LEAGUE_ID_FOR_GUESTS } from "./DemoLeagueService";
import { logger } from "@/utils/logger";
import { getTodayMST, getTodayMSTDate } from "@/utils/timezoneUtils";

export const LineupService = {
  /**
   * Save lineup configuration to Supabase (with localStorage fallback)
   * Stores player IDs and their slot assignments in shared database
   * @param leagueId - Required for league isolation
   * @param targetDate - Optional: If set, only save to this specific date (Yahoo-style per-day rosters)
   */
  async saveLineup(teamId: string | number, leagueId: string, lineup: {
    starters: (string | number)[],
    bench: (string | number)[],
    ir: (string | number)[],
    slotAssignments: Record<string, string>
  }, targetDate?: string, options?: { allowPlayerRemoval?: boolean }) {
    logger.debug('[LineupService.saveLineup] Called with teamId:', teamId, 'leagueId:', leagueId, 'lineup:', {
      starters: lineup.starters?.length || 0,
      bench: lineup.bench?.length || 0,
      ir: lineup.ir?.length || 0,
      starterIds: lineup.starters
    });

    // Read-only guard: Block all lineup saves for demo league EXCEPT during initialization
    // Check if this is initialization (no lineup exists yet) vs user modification (lineup exists)
    if (leagueId === DEMO_LEAGUE_ID_FOR_GUESTS) {
      // Check if lineup already exists - if yes, block (user trying to modify)
      // If no, allow (initialization)
      const { data: existingLineup } = await supabase
        .from('team_lineups')
        .select('id')
        .eq('league_id', leagueId)
        .eq('team_id', String(teamId))
        .maybeSingle();

      if (existingLineup) {
        // Lineup exists - user trying to modify, block it
        logger.warn('[saveLineup] Demo league is read-only. Sign up to create your own league!');
        return; // Silently fail - demo league is read-only
      }
      // No lineup exists - this is initialization, allow it
    }

    // Convert all IDs to strings for consistency
    const lineupToSave = {
      starters: lineup.starters.map(id => String(id)),
      bench: lineup.bench.map(id => String(id)),
      ir: lineup.ir.map(id => String(id)),
      slotAssignments: lineup.slotAssignments
    };

    // VALIDATION: Ensure all player IDs in lineup are currently owned
    // CRITICAL FIX: Use roster_assignments (source of truth), NOT draft_picks
    // draft_picks can have stale session data, deleted_at mismatches, and cross-session duplicates
    // roster_assignments is the atomic, constraint-enforced source of truth
    try {
      const allLineupPlayerIds = [
        ...lineupToSave.starters,
        ...lineupToSave.bench,
        ...lineupToSave.ir
      ];

      if (allLineupPlayerIds.length > 0) {
        // Query roster_assignments (source of truth) to get current roster
        const { data: currentRosterData, error: rosterError } = await supabase
          .from('roster_assignments')
          .select('player_id')
          .eq('team_id', String(teamId))
          .eq('league_id', leagueId);

        if (!rosterError && currentRosterData) {
          const validPlayerIds = new Set(currentRosterData.map((p: { player_id: string }) => String(p.player_id)));
          const invalidPlayerIds = allLineupPlayerIds.filter(id => !validPlayerIds.has(id));

          if (invalidPlayerIds.length > 0) {
            logger.error('[LINEUP VALIDATION] ========================================');
            logger.error('[LINEUP VALIDATION] CRITICAL: Lineup contains player IDs not in roster_assignments!');
            logger.error('[LINEUP VALIDATION] Invalid IDs:', invalidPlayerIds);
            logger.error('[LINEUP VALIDATION] These players are not in roster_assignments (source of truth)');
            logger.error('[LINEUP VALIDATION] Filtering them out before save...');
            logger.error('[LINEUP VALIDATION] ========================================');

            // Filter out invalid IDs
            lineupToSave.starters = lineupToSave.starters.filter(id => validPlayerIds.has(id));
            lineupToSave.bench = lineupToSave.bench.filter(id => validPlayerIds.has(id));
            lineupToSave.ir = lineupToSave.ir.filter(id => validPlayerIds.has(id));

            // Remove invalid IDs from slot assignments
            Object.keys(lineupToSave.slotAssignments).forEach(playerId => {
              if (!validPlayerIds.has(playerId)) {
                delete lineupToSave.slotAssignments[playerId];
              }
            });

          }
        } else if (rosterError) {
          logger.warn('[LINEUP VALIDATION] Could not read roster_assignments, skipping validation:', rosterError);
        }
      }
    } catch (validationError) {
      logger.error('[LINEUP VALIDATION] Validation failed:', validationError);
      // Continue with save - don't block due to validation errors
    }

    // ROSTER PROTECTION: Validate no players are being accidentally lost
    // This is the CRITICAL guard against the McDavid disappearing bug
    const allowPlayerRemoval = options?.allowPlayerRemoval ?? false;

    try {
      const currentLineup = await this.getLineup(teamId, leagueId);
      if (currentLineup) {
        const currentPlayerIds = new Set([
          ...(currentLineup.starters || []),
          ...(currentLineup.bench || []),
          ...(currentLineup.ir || [])
        ]);
        const newPlayerIds = new Set([
          ...lineupToSave.starters,
          ...lineupToSave.bench,
          ...lineupToSave.ir
        ]);

        // Check if any players are being removed
        const removedPlayers = Array.from(currentPlayerIds).filter(id => !newPlayerIds.has(id));

        if (removedPlayers.length > 0) {
          logger.error('[ROSTER PROTECTION] ========================================');
          logger.error('[ROSTER PROTECTION] CRITICAL: Players would be REMOVED!');
          logger.error('[ROSTER PROTECTION] Removed players:', removedPlayers);
          logger.error('[ROSTER PROTECTION] Team:', teamId, 'League:', leagueId);
          logger.error('[ROSTER PROTECTION] Current roster size:', currentPlayerIds.size);
          logger.error('[ROSTER PROTECTION] New roster size:', newPlayerIds.size);
          logger.error('[ROSTER PROTECTION] allowPlayerRemoval:', allowPlayerRemoval);

          // Log each removed player for audit trail
          removedPlayers.forEach(playerId => {
            logger.error(`[ROSTER PROTECTION] WOULD REMOVE: Player ID ${playerId}`);
          });
          logger.error('[ROSTER PROTECTION] ========================================');

          // CRITICAL: Block the save if removal wasn't explicitly allowed
          if (!allowPlayerRemoval) {
            logger.error('[ROSTER PROTECTION] BLOCKED: Save rejected to prevent data loss!');
            logger.error('[ROSTER PROTECTION] To allow player removal, pass { allowPlayerRemoval: true }');
            // Return early - DO NOT SAVE
            return;
          } else {
            logger.warn('[ROSTER PROTECTION] ALLOWED: Player removal explicitly permitted');
          }
        }
      }
    } catch (validationError) {
      logger.error('[ROSTER PROTECTION] Validation check failed:', validationError);
      // If we can't validate, be conservative and allow the save
      // This prevents blocking legitimate saves due to network issues
    }

    try {
      // Try Supabase first (shared database, with league_id for isolation)
      const { error, data } = await supabase
        .from('team_lineups')
        .upsert({
          league_id: leagueId,
          team_id: teamId,
          starters: lineupToSave.starters,
          bench: lineupToSave.bench,
          ir: lineupToSave.ir,
          slot_assignments: lineupToSave.slotAssignments,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'league_id,team_id'
        })
        .select()
        .single();

      if (error) {
        logger.warn('[saveLineup] Supabase save failed, using localStorage fallback:', error);
        throw error; // Fall through to localStorage
      }

      // Verify the save was successful
      if (data) {
        // Save confirmed by Supabase response
      }

      // Supabase save succeeded - clear any stale localStorage data to prevent conflicts
      const key = `lineup_team_${teamId}`;
      localStorage.removeItem(key);

      // Clear roster cache when lineup is saved so matchup page shows updated lineup
      MatchupService.clearRosterCache(String(teamId), leagueId);
      // Clear roster page cache to force fresh load when user navigates back
      RosterCacheService.clearCache(String(teamId), leagueId);

      // Create daily roster snapshots for current matchup week
      // ONLY when a specific targetDate is set (Yahoo-style per-day rosters)
      // When no targetDate is set, the user is editing their "default" lineup in team_lineups,
      // which the Matchup page reads directly for today/future dates.
      // This prevents one generic edit from overwriting all per-day customizations.
      if (targetDate) {
        await this.createDailyRosterSnapshots(teamId, leagueId, lineupToSave, targetDate);
      }
    } catch (error) {
      // Fallback to localStorage if Supabase fails (offline mode, errors, etc.)
      try {
        const key = `lineup_team_${teamId}`;
        localStorage.setItem(key, JSON.stringify(lineupToSave));

        // Still clear cache even if using localStorage fallback
        MatchupService.clearRosterCache(String(teamId), leagueId);
        RosterCacheService.clearCache(String(teamId), leagueId);

        // Only create daily snapshots for specific dates (same guard as primary path)
        if (targetDate) {
          await this.createDailyRosterSnapshots(teamId, leagueId, lineupToSave, targetDate);
        }
      } catch (localError) {
        logger.error('Failed to save lineup to both Supabase and localStorage:', localError);
      }
    }
  },

  /**
   * Backfill missing past day roster records for a matchup
   * This ensures fantasy_daily_rosters has complete data for score calculation
   * Only inserts records that DON'T already exist (uses INSERT with ON CONFLICT DO NOTHING)
   */
  async backfillMissingDailyRosters(
    teamId: string | number,
    leagueId: string,
    matchupId: string
  ): Promise<{ backfilledCount: number; error: unknown }> {
    try {
      // Get matchup dates
      const { data: matchup, error: matchupError } = await supabase
        .from('matchups')
        .select('id, week_start_date, week_end_date')
        .eq('id', matchupId)
        .single();

      if (matchupError || !matchup) {
        logger.error('[backfillMissingDailyRosters] Matchup not found:', matchupError);
        return { backfilledCount: 0, error: matchupError };
      }

      // Get current lineup for this team
      const savedLineup = await this.getLineup(teamId, leagueId);
      if (!savedLineup || !savedLineup.starters) {
        return { backfilledCount: 0, error: null };
      }

      // Generate all dates in the matchup week
      // CRITICAL: Append 'T00:00:00' to force local-time parsing.
      // Without it, new Date("2026-03-01") is parsed as UTC midnight,
      // which in MST (UTC-7) becomes Feb 28 5pm — shifting the date back 1 day.
      const weekStart = new Date(matchup.week_start_date + 'T00:00:00');
      const weekEnd = new Date(matchup.week_end_date + 'T00:00:00');
      const weekDates: string[] = [];
      const currentDate = new Date(weekStart);
      while (currentDate <= weekEnd) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        weekDates.push(`${year}-${month}-${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Check which dates already have records
      const { data: existingRecords } = await supabase
        .from('fantasy_daily_rosters')
        .select('roster_date, player_id')
        .eq('team_id', String(teamId))
        .eq('matchup_id', matchupId);

      const existingKeys = new Set(
        (existingRecords || []).map(r => `${r.player_id}_${r.roster_date}`)
      );

      // Create records for missing days using current lineup
      const recordsToInsert: Array<{
        league_id: string;
        team_id: string;
        matchup_id: string;
        player_id: number;
        roster_date: string;
        slot_type: 'active' | 'bench' | 'ir';
        slot_id: string | null;
        is_locked: boolean;
        locked_at: string | null;
      }> = [];

      for (const dateStr of weekDates) {
        // Add starters
        for (const playerId of savedLineup.starters) {
          const key = `${playerId}_${dateStr}`;
          if (!existingKeys.has(key)) {
            recordsToInsert.push({
              league_id: leagueId,
              team_id: String(teamId),
              matchup_id: matchupId,
              player_id: parseInt(playerId),
              roster_date: dateStr,
              slot_type: 'active',
              slot_id: savedLineup.slot_assignments?.[playerId] || null,
              is_locked: true, // Mark as locked since we're backfilling
              locked_at: new Date().toISOString()
            });
          }
        }

        // Add bench
        for (const playerId of savedLineup.bench || []) {
          const key = `${playerId}_${dateStr}`;
          if (!existingKeys.has(key)) {
            recordsToInsert.push({
              league_id: leagueId,
              team_id: String(teamId),
              matchup_id: matchupId,
              player_id: parseInt(playerId),
              roster_date: dateStr,
              slot_type: 'bench',
              slot_id: null,
              is_locked: true,
              locked_at: new Date().toISOString()
            });
          }
        }

        // Add IR
        for (const playerId of savedLineup.ir || []) {
          const key = `${playerId}_${dateStr}`;
          if (!existingKeys.has(key)) {
            recordsToInsert.push({
              league_id: leagueId,
              team_id: String(teamId),
              matchup_id: matchupId,
              player_id: parseInt(playerId),
              roster_date: dateStr,
              slot_type: 'ir',
              slot_id: savedLineup.slot_assignments?.[playerId] || null,
              is_locked: true,
              locked_at: new Date().toISOString()
            });
          }
        }
      }

      if (recordsToInsert.length > 0) {
        // Insert with ON CONFLICT DO NOTHING to be safe
        const { error: insertError } = await supabase
          .from('fantasy_daily_rosters')
          .upsert(recordsToInsert, {
            onConflict: 'team_id,matchup_id,player_id,roster_date',
            ignoreDuplicates: true // Don't overwrite existing records
          });

        if (insertError) {
          logger.error('[backfillMissingDailyRosters] Error inserting records:', insertError);
          return { backfilledCount: 0, error: insertError };
        }

      }

      return { backfilledCount: recordsToInsert.length, error: null };

    } catch (error) {
      logger.error('[backfillMissingDailyRosters] Exception:', error);
      return { backfilledCount: 0, error };
    }
  },

  /**
   * Manual backfill for ALL teams in ALL matchups for a league
   * Use this to ensure all historical data exists
   */
  async backfillAllMatchupsForLeague(leagueId: string): Promise<{
    totalBackfilled: number;
    matchupsProcessed: number;
    errors: Array<{ matchup?: string; team?: string; error: unknown }>
  }> {
    try {
      logger.debug('[LineupService] Starting backfill for ALL matchups in league:', leagueId);

      // Get all matchups for this league
      const { data: matchups, error: matchupsError } = await supabase
        .from('matchups')
        .select('id, team1_id, team2_id, week_start_date, week_end_date')
        .eq('league_id', leagueId);

      if (matchupsError) {
        logger.error('[LineupService] Error fetching matchups:', matchupsError);
        return { totalBackfilled: 0, matchupsProcessed: 0, errors: [{ error: matchupsError }] };
      }

      if (!matchups || matchups.length === 0) {
        logger.debug('[LineupService] No matchups found for league:', leagueId);
        return { totalBackfilled: 0, matchupsProcessed: 0, errors: [] };
      }

      logger.debug(`[LineupService] Found ${matchups.length} matchups to backfill`);

      let totalBackfilled = 0;
      const errors: Array<{ matchup?: string; team?: string; error: unknown }> = [];

      for (const matchup of matchups) {
        logger.debug(`[LineupService] Processing matchup ${matchup.id}...`);

        // Backfill team1
        if (matchup.team1_id) {
          try {
            const result = await this.backfillMissingDailyRosters(
              matchup.team1_id,
              leagueId,
              matchup.id
            );
            totalBackfilled += result.backfilledCount;
            if (result.error) {
              errors.push({ matchup: matchup.id, team: 'team1', error: result.error });
            }
          } catch (err) {
            errors.push({ matchup: matchup.id, team: 'team1', error: err });
          }
        }

        // Backfill team2
        if (matchup.team2_id) {
          try {
            const result = await this.backfillMissingDailyRosters(
              matchup.team2_id,
              leagueId,
              matchup.id
            );
            totalBackfilled += result.backfilledCount;
            if (result.error) {
              errors.push({ matchup: matchup.id, team: 'team2', error: result.error });
            }
          } catch (err) {
            errors.push({ matchup: matchup.id, team: 'team2', error: err });
          }
        }
      }

      logger.debug(`[LineupService] Backfill complete: ${totalBackfilled} records for ${matchups.length} matchups`);
      if (errors.length > 0) {
        logger.error('[LineupService] Errors during backfill:', errors);
      }

      return { totalBackfilled, matchupsProcessed: matchups.length, errors };
    } catch (error) {
      logger.error('[LineupService] Exception in backfillAllMatchupsForLeague:', error);
      return { totalBackfilled: 0, matchupsProcessed: 0, errors: [{ error }] };
    }
  },

  /**
   * Create daily roster snapshots for current matchup week
   * Updates fantasy_daily_rosters table for future days in the week
   * @param targetDate - If provided, only save to this specific date (Yahoo-style per-day rosters)
   *                     If not provided, save to today and all future dates (cascade)
   */
  async createDailyRosterSnapshots(
    teamId: string | number,
    leagueId: string,
    lineup: {
      starters: string[],
      bench: string[],
      ir: string[],
      slotAssignments: Record<string, string>
    },
    targetDate?: string
  ) {
    try {
      // Get current matchup for this team
      const { data: matchups } = await supabase
        .from('matchups')
        .select('id, week_start_date, week_end_date, team1_id, team2_id')
        .eq('league_id', leagueId)
        .or(`team1_id.eq.${teamId},team2_id.eq.${teamId}`)
        .gte('week_end_date', getTodayMST()) // Current or future weeks
        .order('week_start_date', { ascending: true })
        .limit(1);

      if (!matchups || matchups.length === 0) {
        return;
      }

      const matchup = matchups[0];
      // CRITICAL: Append 'T00:00:00' to force local-time parsing.
      // Without it, new Date("2026-03-01") is parsed as UTC midnight,
      // which in MST (UTC-7) becomes Feb 28 5pm — shifting the date back 1 day.
      const weekStart = new Date(matchup.week_start_date + 'T00:00:00');
      const weekEnd = new Date(matchup.week_end_date + 'T00:00:00');
      const today = getTodayMSTDate();
      today.setHours(0, 0, 0, 0);

      // Generate all dates in the week (Sun-Sat)
      const weekDates: Date[] = [];
      const currentDate = new Date(weekStart);
      while (currentDate <= weekEnd) {
        weekDates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Get all player IDs and their teams for lock checking
      const allPlayerIds = [...lineup.starters, ...lineup.bench, ...lineup.ir].map(id => parseInt(id));

      // Get player teams from player_directory
      const playerTeamMap = new Map<number, string>();
      if (allPlayerIds.length > 0) {
        const { data: players } = await supabase
          .from('player_directory')
          .select('player_id, team_abbrev')
          .in('player_id', allPlayerIds);

        if (players) {
          players.forEach((p: { player_id: number; team_abbrev: string | null }) => {
            if (p.team_abbrev) {
              playerTeamMap.set(p.player_id, p.team_abbrev);
            }
          });
        }
      }

      // =============================================================================
      // CRITICAL FIX: Yahoo/Sleeper/ESPN-style roster locking
      // =============================================================================
      // RULE 1: NEVER touch past dates - they are frozen forever
      // RULE 2: Today's players can only be changed BEFORE their game starts
      // RULE 3: Future dates are always updatable
      // =============================================================================
      const rosterRecords: Array<{
        league_id: string;
        team_id: string;
        matchup_id: string;
        player_id: number;
        roster_date: string;
        slot_type: 'active' | 'bench' | 'ir';
        slot_id: string | null;
        is_locked: boolean;
        locked_at: string | null;
      }> = [];
      const todayStr = getTodayMST();
      const todayDate = getTodayMSTDate();
      todayDate.setHours(0, 0, 0, 0);

      // Filter to only include TODAY and FUTURE dates
      // PAST DATES ARE PERMANENTLY FROZEN - NO EXCEPTIONS
      let futureDates = weekDates.filter(date => {
        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);
        return dateOnly >= todayDate;
      });

      // ============================================================
      // YAHOO/SLEEPER STYLE: If targetDate is specified, only save
      // to that specific date (not all future dates)
      // This enables unique lineups for each day of the week
      // ============================================================
      if (targetDate) {
        futureDates = futureDates.filter(date =>
          date.toISOString().split('T')[0] === targetDate
        );
        if (futureDates.length === 0) {
          return;
        }
      }

      const pastDatesSkipped = weekDates.length - futureDates.length;

      for (const date of futureDates) {
        const dateStr = date.toISOString().split('T')[0];
        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);

        // Check if this is TODAY - if so, check if any games have started
        // Only lock players whose games have started TODAY
        const isToday = dateStr === todayStr;

        // Get games for this date to check lock status per player
        const { data: games } = await supabase
          .from('nhl_games')
          .select('game_time, status, home_team, away_team')
          .eq('game_date', dateStr)
          .in('status', ['scheduled', 'live', 'final']);

        // Build map of team -> game info for quick lookup
        const teamGameMap = new Map<string, { gameTime?: string; status: string }>();
        (games || []).forEach((game: { game_time: string | null; status: string; home_team: string | null; away_team: string | null }) => {
          if (game.home_team) {
            teamGameMap.set(game.home_team, { gameTime: game.game_time, status: game.status });
          }
          if (game.away_team) {
            teamGameMap.set(game.away_team, { gameTime: game.game_time, status: game.status });
          }
        });

        // Helper to check if a player is locked for this date (game started or finished)
        const isPlayerLockedForDate = (playerId: number): boolean => {
          // Only check lock status for TODAY - future dates are never locked
          if (!isToday) return false;

          const now = new Date();
          const team = playerTeamMap.get(playerId);
          if (!team) return false; // Can't determine team, don't lock

          const gameInfo = teamGameMap.get(team);
          if (!gameInfo) return false; // No game scheduled today, not locked

          // If game is final or live, player is locked
          if (gameInfo.status === 'final' || gameInfo.status === 'live') {
            return true;
          }

          // If game is scheduled, check if game_time has passed
          if (gameInfo.status === 'scheduled' && gameInfo.gameTime) {
            const gameStart = new Date(gameInfo.gameTime);
            if (gameStart < now) {
              return true; // Game time has passed
            }
          }

          return false;
        };

        // Create records for all players with per-player lock status
        // Starters
        for (const playerId of lineup.starters) {
          const pid = parseInt(playerId);
          const isLocked = isPlayerLockedForDate(pid);
          rosterRecords.push({
            league_id: leagueId,
            team_id: String(teamId),
            matchup_id: matchup.id,
            player_id: pid,
            roster_date: dateStr,
            slot_type: 'active',
            slot_id: lineup.slotAssignments[playerId] || null,
            is_locked: isLocked,
            locked_at: isLocked ? new Date().toISOString() : null
          });
        }

        // Bench
        for (const playerId of lineup.bench) {
          const pid = parseInt(playerId);
          const isLocked = isPlayerLockedForDate(pid);
          rosterRecords.push({
            league_id: leagueId,
            team_id: String(teamId),
            matchup_id: matchup.id,
            player_id: pid,
            roster_date: dateStr,
            slot_type: 'bench',
            slot_id: null,
            is_locked: isLocked,
            locked_at: isLocked ? new Date().toISOString() : null
          });
        }

        // IR
        for (const playerId of lineup.ir) {
          const pid = parseInt(playerId);
          const isLocked = isPlayerLockedForDate(pid);
          rosterRecords.push({
            league_id: leagueId,
            team_id: String(teamId),
            matchup_id: matchup.id,
            player_id: pid,
            roster_date: dateStr,
            slot_type: 'ir',
            slot_id: lineup.slotAssignments[playerId] || null,
            is_locked: isLocked,
            locked_at: isLocked ? new Date().toISOString() : null
          });
        }
      }

      // CRITICAL: Query existing locked records to prevent overwriting past days
      // This prevents users from retroactively changing their lineups
      if (rosterRecords.length > 0) {
        // Query all existing records for this matchup/team that are locked
        const { data: existingLocked, error: queryError } = await supabase
          .from('fantasy_daily_rosters')
          .select('player_id, roster_date, is_locked, slot_type')
          .eq('team_id', String(teamId))
          .eq('matchup_id', matchup.id)
          .eq('is_locked', true);

        if (queryError) {
          logger.error('[createDailyRosterSnapshots] Error querying locked records:', queryError);
        }

        // Create a Set of locked keys for fast lookup
        const lockedSet = new Set(
          (existingLocked || []).map(r => `${r.player_id}_${r.roster_date}`)
        );

        // Filter out records that are already locked
        // NEVER overwrite a locked day - this prevents score manipulation
        const recordsToUpsert = rosterRecords.filter(record => {
          // Append 'T00:00:00' to force local-time parsing (avoid UTC midnight shift)
          const recordDate = new Date(record.roster_date + 'T00:00:00');
          recordDate.setHours(0, 0, 0, 0);

          // Check if this specific player+date combination is locked
          const key = `${record.player_id}_${record.roster_date}`;
          const isLockedInDB = lockedSet.has(key);

          if (isLockedInDB) {
            // Skip this record - don't overwrite locked days
            return false;
          }

          return true;
        });

        // Upsert only unlocked records
        if (recordsToUpsert.length > 0) {
          const { error } = await supabase
            .from('fantasy_daily_rosters')
            .upsert(recordsToUpsert, {
              onConflict: 'team_id,matchup_id,player_id,roster_date',
              ignoreDuplicates: false
            });

          if (error) {
            logger.error('[createDailyRosterSnapshots] Error upserting daily rosters:', error);
          }
        }
      }
    } catch (error) {
      logger.error('[createDailyRosterSnapshots] Error:', error);
    }
  },

  /**
   * Check if roster can be updated for a specific date
   * Returns false if any player's game has started
   */
  async canUpdateRosterForDate(
    teamId: string | number,
    date: Date,
    lineup: {
      starters: string[],
      bench: string[],
      ir: string[]
    }
  ): Promise<boolean> {
    try {
      const dateStr = date.toISOString().split('T')[0];
      const now = new Date();

      // Get all player IDs in lineup
      const allPlayerIds = [...lineup.starters, ...lineup.bench, ...lineup.ir].map(id => parseInt(id));

      if (allPlayerIds.length === 0) {
        return true; // No players, can update
      }

      // Get player teams from player_directory
      const { data: players } = await supabase
        .from('player_directory')
        .select('player_id, team')
        .in('player_id', allPlayerIds);

      if (!players || players.length === 0) {
        return true; // Can't determine teams, allow update
      }

      // Get team abbreviations
      const teamAbbrevs = [...new Set(players.map(p => p.team).filter(Boolean))];

      if (teamAbbrevs.length === 0) {
        return true; // No teams found, allow update
      }

      // Check if any games for these teams have started on this date
      const { data: games } = await supabase
        .from('nhl_games')
        .select('game_time, home_team, away_team')
        .eq('game_date', dateStr)
        .in('home_team', teamAbbrevs)
        .or(`away_team.in.(${teamAbbrevs.join(',')})`);

      if (!games || games.length === 0) {
        return true; // No games on this date, can update
      }

      // Check if any game has started
      for (const game of games) {
        if (game.game_time) {
          const gameStart = new Date(game.game_time);
          if (gameStart < now) {
            // Game has started - cannot update roster for this date
            return false;
          }
        }
      }

      return true; // All games are in the future, can update
    } catch (error) {
      logger.error('[canUpdateRosterForDate] Error:', error);
      return true; // On error, allow update (fail open)
    }
  },

  /**
   * Load saved lineup configuration from Supabase (with localStorage fallback)
   * Returns lineup from shared database, or falls back to localStorage
   * @param leagueId - Required for league isolation
   */
  async getLineup(teamId: string | number, leagueId: string): Promise<{
    starters: string[],
    bench: string[],
    ir: string[],
    slotAssignments: Record<string, string>
  } | null> {
    try {
      // Skip Supabase query if leagueId is not a valid UUID (e.g., 'demo-league-id')
      // UUIDs are 36 characters with dashes: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leagueId);
      if (!isValidUUID) {
        // For non-UUID league IDs (like demo league), skip Supabase and try localStorage
        const key = `lineup_team_${teamId}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          return JSON.parse(saved);
        }
        return null;
      }

      // Try Supabase first (shared database, with league_id for isolation)
      // Order by updated_at to ensure we get the most recent lineup
      const { data, error } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments, updated_at')
        .eq('team_id', teamId)
        .eq('league_id', leagueId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        // PGRST116 is "not found", which is OK - no lineup exists yet
        if (error.code === 'PGRST116') {
          // No lineup in Supabase - clear any stale localStorage data
          const key = `lineup_team_${teamId}`;
          localStorage.removeItem(key);
          return null;
        }
        // Actual error (network, permission, etc.) - fall back to localStorage
        logger.warn('[getLineup] Supabase query error, trying localStorage fallback:', error);
        const key = `lineup_team_${teamId}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          return JSON.parse(saved);
        }
        return null;
      }

      if (data) {
        // Supabase data found - clear any stale localStorage data to prevent conflicts
        const key = `lineup_team_${teamId}`;
        localStorage.removeItem(key);

        // Normalize slot assignment keys to strings for consistency
        const rawSlotAssignments = (data.slot_assignments || {}) as Record<string | number, string>;
        const normalizedSlotAssignments: Record<string, string> = {};
        Object.entries(rawSlotAssignments).forEach(([playerId, slotId]) => {
          normalizedSlotAssignments[String(playerId)] = slotId;
        });

        return {
          starters: (data.starters || []) as string[],
          bench: (data.bench || []) as string[],
          ir: (data.ir || []) as string[],
          slotAssignments: normalizedSlotAssignments
        };
      }

      // No data found in Supabase (null result, not an error) - clear localStorage and return null
      // Don't fall back to localStorage when Supabase returns null, as that indicates no lineup exists
      const key = `lineup_team_${teamId}`;
      localStorage.removeItem(key);
      return null;
    } catch (error) {
      // Only fallback to localStorage on actual exceptions (network failures, etc.)
      try {
        const key = `lineup_team_${teamId}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (localError) {
        logger.error('[getLineup] Failed to load lineup from both Supabase and localStorage:', localError);
      }
      return null;
    }
  },

  /**
   * Load frozen daily roster from fantasy_daily_rosters table
   * SINGLE SOURCE OF TRUTH for historical lineup data
   * Used by both Roster and Matchup tabs to ensure consistency
   * @param fetchMissingPlayers - If true, fetch dropped/traded players not in allPlayers
   *
   * IMPORTANT: This should ONLY be called for PAST dates, not today/future
   */
  async loadDailyRoster<T extends { id: number | string }>(
    teamId: string,
    matchupId: string,
    rosterDate: string,
    allPlayers: T[],  // All available players to map from (Player[] or HockeyPlayer[])
    fetchMissingPlayers: boolean = false
  ): Promise<{
    starters: T[];
    bench: T[];
    ir: T[];
    slotAssignments: Record<string, string>;
    missingPlayerIds?: string[];  // Players that were in frozen roster but not found
  } | null> {
    try {
      // EXACT query from Roster.tsx lines 662-667
      const { data: dailyRosters, error: rosterError } = await supabase
        .from('fantasy_daily_rosters')
        .select('player_id, slot_type, slot_id')
        .eq('team_id', String(teamId))
        .eq('matchup_id', matchupId)
        .eq('roster_date', rosterDate);

      if (rosterError) {
        logger.error('[LineupService.loadDailyRoster] Error:', rosterError);
        return null;
      }

      if (!dailyRosters || dailyRosters.length === 0) {
        return null;
      }

      // Build roster arrays - EXACT logic from Roster.tsx lines 674-698
      const playerMap = new Map(allPlayers.map(p => [String(p.id), p]));
      const starters: T[] = [];
      const bench: T[] = [];
      const ir: T[] = [];
      const slotAssignments: Record<string, string> = {};
      const missingPlayerIds: string[] = [];

      // First pass: identify missing players (dropped/traded)
      dailyRosters.forEach((entry: { player_id: number; slot_type: string; slot_id: string | null }) => {
        const playerId = String(entry.player_id);
        if (!playerMap.has(playerId)) {
          missingPlayerIds.push(playerId);
        }
      });

      // Fetch missing players if requested (Yahoo/Sleeper behavior for dropped/traded players)
      if (fetchMissingPlayers && missingPlayerIds.length > 0) {
        const missingPlayers = await PlayerService.getPlayersByIds(missingPlayerIds);

        // Transform to same format as allPlayers and add to map
        missingPlayers.forEach((player: Player) => {
          // Create a minimal player object that matches T type structure
          const transformedPlayer = {
            id: player.id,
            name: player.full_name || player.name || 'Unknown Player',
            position: player.position || 'UTIL',
            number: parseInt(player.jersey_number || '0'),
            starter: false,
            stats: {
              gamesPlayed: player.games_played || 0,
              goals: player.goals || 0,
              assists: player.assists || 0,
              points: player.points || 0,
              plusMinus: player.plus_minus || 0,
              shots: player.shots || 0,
              hits: player.hits || 0,
              blockedShots: player.blocks || 0,
              xGoals: player.xGoals || 0,
              wins: player.wins || 0,
              saves: player.saves || 0,
              gaa: player.gaa || 0,
              svPct: player.svPct || 0,
            },
            fantasyPoints: player.fantasy_points || 0,
            projectedPoints: player.projected_points || 0,
            team: player.team || '',
            teamAbbreviation: player.team_abbreviation || player.team || '',
            headshot_url: player.headshot_url,
            status: player.status,
            wasDropped: true,  // Flag for UI to show "no longer on roster" indicator
          } as unknown as T;

          playerMap.set(String(player.id), transformedPlayer);
        });
      }

      // Second pass: build roster arrays
      dailyRosters.forEach((entry: { player_id: number; slot_type: string; slot_id: string | null }) => {
        const playerId = String(entry.player_id);
        const player = playerMap.get(playerId);
        if (!player) {
          return; // Skip players not found (should be rare if fetchMissingPlayers worked)
        }

        if (entry.slot_type === 'active') {
          starters.push(player);
          if (entry.slot_id) {
            slotAssignments[playerId] = entry.slot_id;
          }
        } else if (entry.slot_type === 'bench') {
          bench.push(player);
        } else if (entry.slot_type === 'ir') {
          ir.push(player);
          if (entry.slot_id) {
            slotAssignments[playerId] = entry.slot_id;
          }
        }
      });

      return { starters, bench, ir, slotAssignments, missingPlayerIds };
    } catch (error) {
      logger.error('[LineupService.loadDailyRoster] Exception:', error);
      return null;
    }
  },

  /**
   * Initialize lineup for a team from their draft picks
   * Auto-assigns players to starter/bench/IR slots and saves to team_lineups table
   */
  async initializeTeamLineup(
    teamId: string,
    leagueId: string,
    allPlayers: Player[],
    userId: string
  ): Promise<{
    lineup: { starters: string[]; bench: string[]; ir: string[]; slotAssignments: Record<string, string> } | null;
    error: unknown
  }> {
    try {
      // CRITICAL FIX: Read from roster_assignments (source of truth) instead of draft_picks
      // This ensures we get exactly the players that were synced by sync_roster_assignments_for_league
      const { data: rosterAssignments, error: rosterError } = await supabase
        .from('roster_assignments')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId);

      if (rosterError) {
        logger.error(`Error fetching roster_assignments for team ${teamId}:`, rosterError);
        return { lineup: null, error: rosterError };
      }

      if (!rosterAssignments || rosterAssignments.length === 0) {
        return { lineup: null, error: null };
      }

      // Map roster assignments to players
      const playerIds = rosterAssignments.map(r => r.player_id);
      const teamPlayers = allPlayers.filter(p => playerIds.includes(String(p.id)));

      if (teamPlayers.length < rosterAssignments.length) {
        const matchedIds = new Set(teamPlayers.map(p => String(p.id)));
        const unmatchedIds = playerIds.filter((id: string) => !matchedIds.has(String(id)));
        logger.error(`[initializeTeamLineup] Team ${teamId}: Missing ${unmatchedIds.length} players! Unmatched IDs:`, unmatchedIds);
      }

      if (teamPlayers.length === 0) {
        return { lineup: null, error: null };
      }

      // Helper function to transform position to fantasy slot
      const getFantasyPosition = (position: string): 'C' | 'LW' | 'RW' | 'D' | 'G' | 'UTIL' => {
        const pos = position?.toUpperCase() || '';
        if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
        if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
        if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
        if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
        if (['G', 'GOALIE'].includes(pos)) return 'G';
        return 'UTIL';
      };

      // Helper to calculate slot assignments
      const calculateInitialSlotAssignments = (starters: Player[]) => {
        const assignments: Record<string, string> = {};
        const playersByPos: Record<string, Player[]> = {
          'C': [], 'LW': [], 'RW': [], 'D': [], 'G': [], 'UTIL': []
        };

        starters.forEach(p => {
          const pos = getFantasyPosition(p.position);
          if (pos !== 'UTIL') playersByPos[pos].push(p);
        });

        // Assign C, LW, RW to first 2 slots
        ['C', 'LW', 'RW'].forEach(pos => {
          playersByPos[pos].slice(0, 2).forEach((p, i) => {
            assignments[String(p.id)] = `slot-${pos}-${i + 1}`;
          });
        });

        // Assign D to first 4 slots
        playersByPos['D'].slice(0, 4).forEach((p, i) => {
          assignments[String(p.id)] = `slot-D-${i + 1}`;
        });

        // Assign G to first 2 slots
        playersByPos['G'].slice(0, 2).forEach((p, i) => {
          assignments[String(p.id)] = `slot-G-${i + 1}`;
        });

        // Assign remaining non-goalie starters to UTIL if not already assigned
        const assignedIds = new Set(Object.keys(assignments));
        const unassigned = starters.filter(p => !assignedIds.has(String(p.id)));
        const utilPlayer = unassigned.find(p => getFantasyPosition(p.position) !== 'G');
        if (utilPlayer) {
          assignments[String(utilPlayer.id)] = 'slot-UTIL';
        }

        return assignments;
      };

      // Sort players consistently by ID for deterministic auto-assignment
      teamPlayers.sort((a, b) => {
        const idA = typeof a.id === 'string' ? parseInt(a.id) : a.id;
        const idB = typeof b.id === 'string' ? parseInt(b.id) : b.id;
        return idA - idB;
      });

      // Organize into slots
      const starters: Player[] = [];
      const bench: Player[] = [];
      const ir: Player[] = [];
      const irSlotAssignments: Record<string, string> = {};

      // Simple draft logic to fill slots
      const slotsNeeded = { 'C': 2, 'LW': 2, 'RW': 2, 'D': 4, 'G': 2, 'UTIL': 1 };
      const slotsFilled = { 'C': 0, 'LW': 0, 'RW': 0, 'D': 0, 'G': 0, 'UTIL': 0 };

      // Track IR slot assignments
      let irSlotIndex = 1;

      // Only use actual IR/SUSP status for IR placement (deterministic)
      teamPlayers.forEach(p => {
        if (p.status === 'injured' || p.status === 'suspended') {
          if (irSlotIndex <= 3) {
            ir.push(p);
            irSlotAssignments[String(p.id)] = `ir-slot-${irSlotIndex}`;
            irSlotIndex++;
          } else {
            bench.push(p);
          }
          return;
        }

        const pos = getFantasyPosition(p.position);

        if (pos !== 'UTIL' && slotsFilled[pos] < slotsNeeded[pos]) {
          starters.push(p);
          slotsFilled[pos]++;
        } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
          starters.push(p);
          slotsFilled['UTIL']++;
        } else {
          bench.push(p);
        }
      });

      const starterSlotAssignments = calculateInitialSlotAssignments(starters);
      // Merge IR slot assignments with starter assignments
      const allSlotAssignments = { ...starterSlotAssignments, ...irSlotAssignments };

      const lineup = {
        starters: starters.map(p => String(p.id)),
        bench: bench.map(p => String(p.id)),
        ir: ir.map(p => String(p.id)),
        slotAssignments: allSlotAssignments
      };

      // Save lineup to Supabase (with league_id for isolation)
      // CRITICAL: Pass allowPlayerRemoval=true because during draft initialization,
      // the team_lineups table may contain stale data from a previous draft session.
      // Without this flag, the ROSTER PROTECTION guard would block the save
      // (detecting that old players are being "removed"), preventing the new lineup from saving.
      await this.saveLineup(teamId, leagueId, lineup, undefined, { allowPlayerRemoval: true });

      return { lineup, error: null };
    } catch (error) {
      logger.error(`Error initializing lineup for team ${teamId}:`, error);
      return { lineup: null, error };
    }
  },
};
