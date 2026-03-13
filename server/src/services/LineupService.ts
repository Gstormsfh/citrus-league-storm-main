import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, logger, getTodayMST, getTodayMSTDate } from '@citrus/shared';

/**
 * LineupService — Server-side lineup management with DI Supabase client.
 *
 * Handles daily roster snapshots, backfill, game-lock checking,
 * and lineup initialization from roster assignments.
 */
export class LineupService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Save lineup with full validation, roster protection, and daily snapshots.
   */
  async saveLineup(
    teamId: string,
    leagueId: string,
    lineup: {
      starters: string[];
      bench: string[];
      ir: string[];
      slot_assignments: Record<string, string>;
    },
    targetDate?: string,
    allowPlayerRemoval = false,
  ) {
    // 1. Validate all player IDs are in roster_assignments
    const allLineupPlayerIds = [...lineup.starters, ...lineup.bench, ...lineup.ir];

    if (allLineupPlayerIds.length > 0) {
      const { data: currentRosterData, error: rosterError } = await this.supabase
        .from('roster_assignments')
        .select('player_id')
        .eq('team_id', teamId)
        .eq('league_id', leagueId);

      if (!rosterError && currentRosterData) {
        const validPlayerIds = new Set(currentRosterData.map((p: { player_id: string }) => String(p.player_id)));
        const invalidPlayerIds = allLineupPlayerIds.filter(id => !validPlayerIds.has(id));

        if (invalidPlayerIds.length > 0) {
          logger.warn('[LineupService.saveLineup] Filtering invalid player IDs:', invalidPlayerIds);
          lineup.starters = lineup.starters.filter(id => validPlayerIds.has(id));
          lineup.bench = lineup.bench.filter(id => validPlayerIds.has(id));
          lineup.ir = lineup.ir.filter(id => validPlayerIds.has(id));
          for (const playerId of Object.keys(lineup.slot_assignments)) {
            if (!validPlayerIds.has(playerId)) {
              delete lineup.slot_assignments[playerId];
            }
          }
        }
      }
    }

    // 2. Roster protection — check for accidentally lost players
    if (!allowPlayerRemoval) {
      const { data: existingLineup } = await this.supabase
        .from('team_lineups')
        .select('starters, bench, ir')
        .eq('team_id', teamId)
        .eq('league_id', leagueId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingLineup) {
        const currentPlayerIds = new Set([
          ...((existingLineup.starters as string[]) || []),
          ...((existingLineup.bench as string[]) || []),
          ...((existingLineup.ir as string[]) || []),
        ]);
        const newPlayerIds = new Set([...lineup.starters, ...lineup.bench, ...lineup.ir]);
        const removedPlayers = Array.from(currentPlayerIds).filter(id => !newPlayerIds.has(id));

        if (removedPlayers.length > 0) {
          logger.error('[ROSTER PROTECTION] Save blocked — players would be removed:', removedPlayers);
          return { success: false, error: 'Players would be removed without allowPlayerRemoval flag' };
        }
      }
    }

    // 3. Upsert lineup
    const { error, data } = await this.supabase
      .from('team_lineups')
      .upsert({
        league_id: leagueId,
        team_id: teamId,
        starters: lineup.starters,
        bench: lineup.bench,
        ir: lineup.ir,
        slot_assignments: lineup.slot_assignments,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'league_id,team_id' })
      .select(COLUMNS.TEAM_LINEUP)
      .single();

    if (error) {
      logger.error('[LineupService.saveLineup] Upsert failed:', error);
      return { success: false, error: error.message };
    }

    // 4. Create daily roster snapshots if targetDate is set
    if (targetDate) {
      await this.createDailyRosterSnapshots(teamId, leagueId, lineup, targetDate);
    }

    return { success: true, data };
  }

  /**
   * Get daily roster entries for a team/matchup/date.
   */
  async getDailyRoster(teamId: string, matchupId: string, rosterDate: string) {
    const { data, error } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('player_id, slot_type, slot_id')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId)
      .eq('roster_date', rosterDate);

    if (error) {
      logger.error('[LineupService.getDailyRoster] Error:', error);
      return { data: null, error: error.message };
    }

    return { data: data || [], error: null };
  }

  /**
   * Check if roster can be updated for a specific date.
   * Returns false if any player's game has started.
   */
  async canUpdateRosterForDate(date: string, playerIds: number[]): Promise<boolean> {
    if (playerIds.length === 0) return true;

    const { data: players } = await this.supabase
      .from('player_directory')
      .select('player_id, team_abbrev')
      .in('player_id', playerIds);

    if (!players || players.length === 0) return true;

    const teamAbbrevs = [...new Set(
      players.map((p: { team_abbrev: string | null }) => p.team_abbrev).filter(Boolean),
    )] as string[];
    if (teamAbbrevs.length === 0) return true;

    const { data: games } = await this.supabase
      .from('nhl_games')
      .select('game_time, home_team, away_team')
      .eq('game_date', date)
      .or(`home_team.in.(${teamAbbrevs.join(',')}),away_team.in.(${teamAbbrevs.join(',')})`);

    if (!games || games.length === 0) return true;

    const now = new Date();
    for (const game of games) {
      if (game.game_time) {
        const gameStart = new Date(game.game_time);
        if (gameStart < now) return false;
      }
    }
    return true;
  }

  /**
   * Backfill missing daily roster records for a single matchup.
   */
  async backfillMissingDailyRosters(teamId: string, leagueId: string, matchupId: string) {
    const { data: matchup, error: matchupError } = await this.supabase
      .from('matchups')
      .select('id, week_start_date, week_end_date')
      .eq('id', matchupId)
      .single();

    if (matchupError || !matchup) {
      return { backfilledCount: 0, error: matchupError?.message || 'Matchup not found' };
    }

    // Get current lineup
    const { data: savedLineup } = await this.supabase
      .from('team_lineups')
      .select('starters, bench, ir, slot_assignments')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!savedLineup?.starters) {
      return { backfilledCount: 0, error: null };
    }

    const starters = (savedLineup.starters || []) as string[];
    const bench = (savedLineup.bench || []) as string[];
    const ir = (savedLineup.ir || []) as string[];
    const slotAssignments = (savedLineup.slot_assignments || {}) as Record<string, string>;

    // Generate all dates in the matchup week
    const weekStart = new Date(matchup.week_start_date + 'T00:00:00');
    const weekEnd = new Date(matchup.week_end_date + 'T00:00:00');
    const weekDates: string[] = [];
    const d = new Date(weekStart);
    while (d <= weekEnd) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      weekDates.push(`${year}-${month}-${day}`);
      d.setDate(d.getDate() + 1);
    }

    // Check which dates already have records
    const { data: existingRecords } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('roster_date, player_id')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId);

    const existingKeys = new Set(
      (existingRecords || []).map((r: { player_id: number; roster_date: string }) => `${r.player_id}_${r.roster_date}`),
    );

    const recordsToInsert: Array<Record<string, unknown>> = [];

    for (const dateStr of weekDates) {
      const addRecords = (playerIds: string[], slotType: string) => {
        for (const playerId of playerIds) {
          const key = `${playerId}_${dateStr}`;
          if (!existingKeys.has(key)) {
            recordsToInsert.push({
              league_id: leagueId,
              team_id: teamId,
              matchup_id: matchupId,
              player_id: parseInt(playerId),
              roster_date: dateStr,
              slot_type: slotType,
              slot_id: slotType !== 'bench' ? (slotAssignments[playerId] || null) : null,
              is_locked: true,
              locked_at: new Date().toISOString(),
            });
          }
        }
      };
      addRecords(starters, 'active');
      addRecords(bench, 'bench');
      addRecords(ir, 'ir');
    }

    if (recordsToInsert.length > 0) {
      const { error: insertError } = await this.supabase
        .from('fantasy_daily_rosters')
        .upsert(recordsToInsert, {
          onConflict: 'team_id,matchup_id,player_id,roster_date',
          ignoreDuplicates: true,
        });

      if (insertError) {
        return { backfilledCount: 0, error: insertError.message };
      }
    }

    return { backfilledCount: recordsToInsert.length, error: null };
  }

  /**
   * Backfill daily rosters for ALL matchups in a league.
   */
  async backfillAllMatchups(leagueId: string) {
    const { data: matchups, error: matchupsError } = await this.supabase
      .from('matchups')
      .select('id, team1_id, team2_id')
      .eq('league_id', leagueId);

    if (matchupsError || !matchups) {
      return { totalBackfilled: 0, matchupsProcessed: 0, errors: [{ error: matchupsError?.message }] };
    }

    let totalBackfilled = 0;
    const errors: Array<{ matchup?: string; team?: string; error: unknown }> = [];

    for (const matchup of matchups) {
      for (const teamKey of ['team1_id', 'team2_id'] as const) {
        const tid = matchup[teamKey];
        if (!tid) continue;
        const result = await this.backfillMissingDailyRosters(String(tid), leagueId, matchup.id);
        totalBackfilled += result.backfilledCount;
        if (result.error) {
          errors.push({ matchup: matchup.id, team: teamKey, error: result.error });
        }
      }
    }

    return { totalBackfilled, matchupsProcessed: matchups.length, errors };
  }

  /**
   * Initialize lineup from roster assignments.
   * Queries player data server-side to determine positions and auto-assign slots.
   */
  async initializeLineup(teamId: string, leagueId: string) {
    // Get roster assignments
    const { data: rosterAssignments, error: rosterError } = await this.supabase
      .from('roster_assignments')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('team_id', teamId);

    if (rosterError) {
      return { lineup: null, error: rosterError.message };
    }

    if (!rosterAssignments || rosterAssignments.length === 0) {
      return { lineup: null, error: null };
    }

    const playerIds = rosterAssignments.map((r: { player_id: string }) => r.player_id);

    // Get player positions from player_directory
    const { data: players } = await this.supabase
      .from('player_directory')
      .select('player_id, position, roster_status')
      .in('player_id', playerIds.map((id: string) => parseInt(String(id))));

    if (!players || players.length === 0) {
      return { lineup: null, error: null };
    }

    // Build position map
    const positionMap = new Map<string, string>();
    const statusMap = new Map<string, string>();
    for (const p of players) {
      positionMap.set(String(p.player_id), p.position || 'UTIL');
      if (p.roster_status) statusMap.set(String(p.player_id), p.roster_status);
    }

    const getFantasyPosition = (position: string): string => {
      const pos = position?.toUpperCase() || '';
      if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
      if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
      if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
      if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
      if (['G', 'GOALIE'].includes(pos)) return 'G';
      return 'UTIL';
    };

    // Sort players by ID for deterministic assignment
    const sortedIds = playerIds.map(String).sort((a: string, b: string) => parseInt(a) - parseInt(b));

    const starters: string[] = [];
    const bench: string[] = [];
    const ir: string[] = [];
    const slotAssignments: Record<string, string> = {};

    const slotsNeeded: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 };
    const slotsFilled: Record<string, number> = { C: 0, LW: 0, RW: 0, D: 0, G: 0, UTIL: 0 };
    let irSlotIndex = 1;

    for (const pid of sortedIds) {
      const status = statusMap.get(pid);
      if (status === 'IR' || status === 'SUSP') {
        if (irSlotIndex <= 3) {
          ir.push(pid);
          slotAssignments[pid] = `ir-slot-${irSlotIndex}`;
          irSlotIndex++;
        } else {
          bench.push(pid);
        }
        continue;
      }

      const pos = getFantasyPosition(positionMap.get(pid) || 'UTIL');

      if (pos !== 'UTIL' && slotsFilled[pos] < slotsNeeded[pos]) {
        starters.push(pid);
        slotsFilled[pos]++;
      } else if (pos !== 'G' && slotsFilled.UTIL < slotsNeeded.UTIL) {
        starters.push(pid);
        slotsFilled.UTIL++;
      } else {
        bench.push(pid);
      }
    }

    // Assign position slots to starters
    const startersByPos: Record<string, string[]> = { C: [], LW: [], RW: [], D: [], G: [] };
    for (const pid of starters) {
      const pos = getFantasyPosition(positionMap.get(pid) || 'UTIL');
      if (pos !== 'UTIL' && startersByPos[pos]) {
        startersByPos[pos].push(pid);
      }
    }
    for (const pos of ['C', 'LW', 'RW']) {
      startersByPos[pos].slice(0, 2).forEach((pid, i) => {
        slotAssignments[pid] = `slot-${pos}-${i + 1}`;
      });
    }
    startersByPos.D.slice(0, 4).forEach((pid, i) => {
      slotAssignments[pid] = `slot-D-${i + 1}`;
    });
    startersByPos.G.slice(0, 2).forEach((pid, i) => {
      slotAssignments[pid] = `slot-G-${i + 1}`;
    });
    // UTIL slot
    const assignedIds = new Set(Object.keys(slotAssignments));
    const utilPlayer = starters.find(pid => {
      const pos = getFantasyPosition(positionMap.get(pid) || 'UTIL');
      return !assignedIds.has(pid) && pos !== 'G';
    });
    if (utilPlayer) {
      slotAssignments[utilPlayer] = 'slot-UTIL';
    }

    const lineup = { starters, bench, ir, slot_assignments: slotAssignments };

    // Save with allowPlayerRemoval=true (draft initialization may replace stale data)
    const result = await this.saveLineup(teamId, leagueId, lineup, undefined, true);
    if (!result.success) {
      return { lineup: null, error: result.error };
    }

    return { lineup, error: null };
  }

  /**
   * Create daily roster snapshots for current matchup week.
   * Respects game locks — never overwrites locked records.
   */
  private async createDailyRosterSnapshots(
    teamId: string,
    leagueId: string,
    lineup: { starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> },
    targetDate: string,
  ) {
    // Get current matchup for this team
    const todayStr = getTodayMST();
    const { data: matchups } = await this.supabase
      .from('matchups')
      .select('id, week_start_date, week_end_date, team1_id, team2_id')
      .eq('league_id', leagueId)
      .or(`team1_id.eq.${teamId},team2_id.eq.${teamId}`)
      .gte('week_end_date', todayStr)
      .order('week_start_date', { ascending: true })
      .limit(1);

    if (!matchups || matchups.length === 0) return;

    const matchup = matchups[0];
    const weekStart = new Date(matchup.week_start_date + 'T00:00:00');
    const weekEnd = new Date(matchup.week_end_date + 'T00:00:00');
    const todayDate = getTodayMSTDate();
    todayDate.setHours(0, 0, 0, 0);

    // Generate week dates
    const weekDates: Date[] = [];
    const cur = new Date(weekStart);
    while (cur <= weekEnd) {
      weekDates.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }

    // Filter to today and future, then to targetDate only
    let futureDates = weekDates.filter(date => {
      const dateOnly = new Date(date);
      dateOnly.setHours(0, 0, 0, 0);
      return dateOnly >= todayDate;
    });

    futureDates = futureDates.filter(date => date.toISOString().split('T')[0] === targetDate);
    if (futureDates.length === 0) return;

    // Get player teams for lock checking
    const allPlayerIds = [...lineup.starters, ...lineup.bench, ...lineup.ir].map(id => parseInt(id));
    const playerTeamMap = new Map<number, string>();
    if (allPlayerIds.length > 0) {
      const { data: players } = await this.supabase
        .from('player_directory')
        .select('player_id, team_abbrev')
        .in('player_id', allPlayerIds);
      if (players) {
        for (const p of players) {
          if (p.team_abbrev) playerTeamMap.set(p.player_id, p.team_abbrev);
        }
      }
    }

    const rosterRecords: Array<Record<string, unknown>> = [];

    for (const date of futureDates) {
      const dateStr = date.toISOString().split('T')[0];
      const isToday = dateStr === todayStr;

      // Get games for lock checking
      let teamGameMap = new Map<string, { gameTime?: string; status: string }>();
      if (isToday) {
        const { data: games } = await this.supabase
          .from('nhl_games')
          .select('game_time, status, home_team, away_team')
          .eq('game_date', dateStr)
          .in('status', ['scheduled', 'live', 'final']);

        if (games) {
          for (const game of games) {
            if (game.home_team) teamGameMap.set(game.home_team, { gameTime: game.game_time, status: game.status });
            if (game.away_team) teamGameMap.set(game.away_team, { gameTime: game.game_time, status: game.status });
          }
        }
      }

      const isPlayerLocked = (playerId: number): boolean => {
        if (!isToday) return false;
        const now = new Date();
        const team = playerTeamMap.get(playerId);
        if (!team) return false;
        const gameInfo = teamGameMap.get(team);
        if (!gameInfo) return false;
        if (gameInfo.status === 'final' || gameInfo.status === 'live') return true;
        if (gameInfo.status === 'scheduled' && gameInfo.gameTime) {
          return new Date(gameInfo.gameTime) < now;
        }
        return false;
      };

      const addRecords = (playerIds: string[], slotType: string) => {
        for (const playerId of playerIds) {
          const pid = parseInt(playerId);
          const locked = isPlayerLocked(pid);
          rosterRecords.push({
            league_id: leagueId,
            team_id: teamId,
            matchup_id: matchup.id,
            player_id: pid,
            roster_date: dateStr,
            slot_type: slotType,
            slot_id: slotType !== 'bench' ? (lineup.slot_assignments[playerId] || null) : null,
            is_locked: locked,
            locked_at: locked ? new Date().toISOString() : null,
          });
        }
      };

      addRecords(lineup.starters, 'active');
      addRecords(lineup.bench, 'bench');
      addRecords(lineup.ir, 'ir');
    }

    if (rosterRecords.length === 0) return;

    // Query locked records to avoid overwriting
    const { data: existingLocked } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('player_id, roster_date')
      .eq('team_id', teamId)
      .eq('matchup_id', matchup.id)
      .eq('is_locked', true);

    const lockedSet = new Set(
      (existingLocked || []).map((r: { player_id: number; roster_date: string }) => `${r.player_id}_${r.roster_date}`),
    );

    const recordsToUpsert = rosterRecords.filter(record =>
      !lockedSet.has(`${record.player_id}_${record.roster_date}`),
    );

    if (recordsToUpsert.length > 0) {
      const { error } = await this.supabase
        .from('fantasy_daily_rosters')
        .upsert(recordsToUpsert, {
          onConflict: 'team_id,matchup_id,player_id,roster_date',
          ignoreDuplicates: false,
        });
      if (error) {
        logger.error('[LineupService.createDailyRosterSnapshots] Upsert error:', error);
      }
    }
  }
}
