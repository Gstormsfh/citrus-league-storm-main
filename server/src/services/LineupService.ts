import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, logger, getTodayMST, getTodayMSTDate, getTodayNhlScheduleDate, getCurrentSeason } from '@citrus/shared';
import { resolveSlotConfig, validateSlotAssignments } from '../lib/leagueRules';

/** The spot a player holds in a lineup: which list, and which slot if it has one. */
type LineupSpot = { type: 'active' | 'bench' | 'ir'; slot: string | null };

type LineupShape = { starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> };

/** A locked player whose spot a lineup save would change. */
export interface LockedLineupChange {
  playerId: string;
  playerName: string;
  from: string;
  to: string;
}

const describeSpot = (s: LineupSpot): string =>
  s.type === 'bench' ? 'bench' : s.type === 'ir' ? 'IR' : s.slot ?? 'starter';

/** slot id -> spot map for a requested lineup. */
function spotsOf(lineup: LineupShape): Map<string, LineupSpot> {
  const spots = new Map<string, LineupSpot>();
  const slots = lineup.slot_assignments ?? {};
  for (const id of lineup.ir ?? []) spots.set(String(id), { type: 'ir', slot: slots[String(id)] ?? null });
  for (const id of lineup.bench ?? []) spots.set(String(id), { type: 'bench', slot: null });
  for (const id of lineup.starters ?? []) spots.set(String(id), { type: 'active', slot: slots[String(id)] ?? null });
  return spots;
}

/**
 * The plain sentence a 409 carries. Names the player(s); says what to expect.
 */
export function lockedMoveMessage(changes: LockedLineupChange[]): string {
  const names = changes.map((c) => c.playerName || `Player ${c.playerId}`);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return names.length === 1
    ? `${list}'s game has started — locked players can't be moved until tomorrow.`
    : `${list}'s games have started — locked players can't be moved until tomorrow.`;
}

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
   * Filter a lineup to only contain players currently in roster_assignments.
   * Prevents stale/dropped/traded players from propagating to daily snapshots.
   */
  private async filterLineupAgainstRoster(
    teamId: string,
    leagueId: string,
    lineup: { starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> },
  ): Promise<{ starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> }> {
    const { data: rosterData } = await this.supabase
      .from('roster_assignments')
      .select('player_id')
      .eq('team_id', teamId)
      .eq('league_id', leagueId);

    if (!rosterData || rosterData.length === 0) {
      return { starters: [], bench: [], ir: [], slot_assignments: {} };
    }

    const validIds = new Set(rosterData.map((r: { player_id: string }) => String(r.player_id)));

    const filteredStarters = lineup.starters.filter(id => validIds.has(id));
    const filteredBench = lineup.bench.filter(id => validIds.has(id));
    const filteredIr = lineup.ir.filter(id => validIds.has(id));

    // slot_assignments: keep only keys for valid players in starters or ir
    const starterSet = new Set(filteredStarters);
    const irSet = new Set(filteredIr);
    const filteredSlots: Record<string, string> = {};
    for (const [playerId, slotId] of Object.entries(lineup.slot_assignments)) {
      if (validIds.has(playerId) && (starterSet.has(playerId) || slotId.startsWith('ir-slot-'))) {
        filteredSlots[playerId] = slotId;
      }
    }

    return { starters: filteredStarters, bench: filteredBench, ir: filteredIr, slot_assignments: filteredSlots };
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

    // 1b. Validate slot_assignments against the LEAGUE'S configuration.
    //
    // SETTINGS-ENFORCEMENT (2026-08-16). The old check was a hardcoded
    // regex (`slot-(C|LW|RW|D|G|F)-[1-8]|slot-UTIL`) that never read the
    // league's roster_slots: any API client could start 8 centers in a
    // 2-C league, and the app's own default UTIL:2 config emitted
    // `slot-UTIL-2`, which the regex SILENTLY STRIPPED on every save.
    // Now: malformed ids are still stripped (legacy tolerance), but
    // exceeding the commissioner's per-position counts REJECTS the save
    // with a plain-language error. Pure logic + tests: lib/leagueRules.ts.
    const { data: slotLeague } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();
    const slotConfig = resolveSlotConfig(slotLeague?.settings as Record<string, unknown>);

    // POSITION-MATCH FIX (2026-08-23, found live on prod during launch QA):
    // fetch each assigned player's eligible positions so the validator can
    // reject a goalie parked in slot-C-1 (previously a 200). Dedupe by
    // player_id — player_directory is a per-SEASON index (the same trap
    // that half-disabled the autopick roster guard). Any read failure
    // leaves the map empty and the validator fails OPEN on eligibility.
    const eligibleById: Record<string, string[]> = {};
    try {
      const assignedIds = Object.keys(lineup.slot_assignments ?? {})
        .map((id) => Number(id))
        .filter((n) => Number.isFinite(n));
      if (assignedIds.length > 0) {
        const { data: posRows } = await this.supabase
          .from('player_directory')
          .select('player_id, position_code, eligible_positions')
          .order('season', { ascending: false })
          .in('player_id', assignedIds);
        const seen = new Set<number>();
        for (const row of (posRows ?? []) as Array<{
          player_id: number;
          position_code: string | null;
          eligible_positions: string[] | null;
        }>) {
          if (seen.has(row.player_id)) continue;
          seen.add(row.player_id);
          const elig = (row.eligible_positions && row.eligible_positions.length > 0)
            ? row.eligible_positions
            : (row.position_code ? [row.position_code] : []);
          if (elig.length > 0) eligibleById[String(row.player_id)] = elig.map((e) => String(e).toUpperCase());
        }
      }
    } catch (posErr) {
      logger.warn('[LineupService.saveLineup] position lookup for slot validation failed open:', posErr);
    }

    const verdict = validateSlotAssignments(lineup.slot_assignments, slotConfig, eligibleById);
    if (!verdict.ok) {
      return { success: false, error: verdict.error };
    }
    for (const pid of verdict.strip) {
      logger.warn('[LineupService.saveLineup] Stripping invalid slot for player:', pid, lineup.slot_assignments[pid]);
      delete lineup.slot_assignments[pid];
    }

    const starterSet = new Set(lineup.starters);
    const irSet = new Set(lineup.ir);
    const seenSlots = new Set<string>();
    for (const playerId of Object.keys(lineup.slot_assignments)) {
      const slotId = lineup.slot_assignments[playerId];
      // Keys must be in starters (for starter slots) or ir (for IR slots)
      const isStarter = starterSet.has(playerId);
      const isIr = irSet.has(playerId);
      if (!isStarter && !(isIr && slotId.startsWith('ir-slot-'))) {
        delete lineup.slot_assignments[playerId];
        continue;
      }
      // No duplicate slot_ids
      if (seenSlots.has(slotId)) {
        logger.warn('[LineupService.saveLineup] Duplicate slot_id:', slotId, 'removing from player:', playerId);
        delete lineup.slot_assignments[playerId];
        continue;
      }
      seenSlots.add(slotId);
    }

    // 2. Roster protection — check for accidentally lost players
    //    Normalize all IDs to strings to prevent type mismatch (DB may store numbers)
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
          ...((existingLineup.starters as unknown[]) || []).map(String),
          ...((existingLineup.bench as unknown[]) || []).map(String),
          ...((existingLineup.ir as unknown[]) || []).map(String),
        ]);
        const newPlayerIds = new Set([
          ...lineup.starters.map(String),
          ...lineup.bench.map(String),
          ...lineup.ir.map(String),
        ]);
        const removedPlayers = Array.from(currentPlayerIds).filter(id => !newPlayerIds.has(id));

        if (removedPlayers.length > 0) {
          logger.error('[ROSTER PROTECTION] Save blocked — players would be removed:', removedPlayers,
            'current:', currentPlayerIds.size, 'new:', newPlayerIds.size);
          return { success: false, error: 'Players would be removed without allowPlayerRemoval flag' };
        }
      }
    }

    // 3. Per-day isolation: when targetDate is provided, only write to
    //    fantasy_daily_rosters. Do NOT update team_lineups — it must remain
    //    as the "base" lineup that other dates inherit from.
    //    The client-side recovery logic (Roster.tsx line ~743) handles any
    //    players in roster_assignments that are missing from snapshots.
    if (targetDate) {
      // Per-day isolation: ONLY write to the target date's fantasy_daily_rosters.
      // Do NOT touch any other date. Each day is independent.
      const wroteDaily = await this.createDailyRosterSnapshots(teamId, leagueId, lineup, targetDate);
      if (wroteDaily) {
        return { success: true, data: { ...lineup, league_id: leagueId, team_id: teamId } };
      }
      // SILENT-NO-OP FIX (2026-08-21, found live on prod during launch QA).
      //
      // The client ALWAYS sends target_date (Roster.tsx: selectedDate ||
      // getTodayMST()), so this branch is the only path UI saves take. The
      // daily-snapshot writer quietly wrote NOTHING whenever the league had
      // no matchup for the team (schedule not generated yet) or the target
      // date fell outside the current matchup week — which is EVERY save in
      // EVERY league during the pre-season window. This method then returned
      // success anyway: the user saw "Lineup Updated", the client cleared its
      // caches and localStorage fallback, and the change evaporated on
      // reload. Measured live: two 200 PUTs, zero rows written.
      //
      // When the per-day path has nowhere to write, the user's intent is
      // unambiguous - update the BASE lineup - so fall through to the
      // team_lineups upsert below instead of returning a lying success.
      // In-season daily edits are unaffected: wroteDaily is true whenever a
      // matchup-week day row was actually written, and we return above.
      logger.warn(
        '[LineupService.saveLineup] daily-roster path wrote nothing (no matchup, or target_date outside matchup week); falling back to base team_lineups',
        { teamId, leagueId, targetDate },
      );
    }

    // No targetDate — update the base lineup in team_lineups
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

    // Task B: propagate the base-lineup change to TODAY's unlocked
    // fantasy_daily_rosters rows. Prior state: base-lineup saves wrote
    // only team_lineups; the 08:00 UTC scheduled_snapshot run had already
    // fixed today's roster rows, and `ignoreDuplicates` in that upsert
    // prevented any subsequent same-day edit from taking effect — so a
    // user who fixed their lineup at noon before puck drop was scored
    // on the 08:00 version while the UI happily showed the new one.
    //
    // Narrow fix: refresh today ONLY, unlocked rows ONLY. The
    // createDailyRosterSnapshots path already DELETES-non-locked-and-
    // INSERTs, preserving is_locked=true rows verbatim. We do NOT
    // propagate to any other date — that is precisely the behavior that
    // produced the April 2026 fabricated-daily-rosters incident and got
    // the auto-sync triggers dropped.
    //
    // Task D-04: use getTodayNhlScheduleDate() (ET), not getTodayMST().
    // fantasy_daily_rosters.roster_date JOINs against
    // nhl_games.game_date, which is ET-based (NHL schedule convention).
    // MT diverges from ET for ~2 hours per day (10pm-midnight MT / 12am-
    // 2am ET); during that window a Task B write keyed on MT-today would
    // miss the nhl_games row keyed on ET-today, i.e. a late edit for
    // "tonight" would land on yesterday.
    //
    // source='scheduled_snapshot' per the standing convention: a base-
    // lineup save has no explicit user-supplied date and is functionally
    // the same shape as the 08:00 cron overwrite.
    try {
      await this.createDailyRosterSnapshots(
        teamId,
        leagueId,
        lineup,
        getTodayNhlScheduleDate(),
        'scheduled_snapshot',
      );
    } catch (propagateErr) {
      // Do NOT fail the base-lineup save on propagation error — the
      // authoritative write (team_lineups) already succeeded. Surface
      // loudly so ops sees it, but return success to the caller.
      logger.error('[LineupService.saveLineup] today-propagation failed (base-lineup save succeeded):',
        propagateErr, 'team:', teamId, 'league:', leagueId);
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
      .eq('season', getCurrentSeason())
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
   * Which of these players cannot be moved on `date`, evaluated NOW — the
   * rule `canUpdateRosterForDate` and the client's GameLockService share: a
   * game that is live or final, or scheduled with a start time already past.
   * Hands back the players' names too, so a refusal can say who.
   */
  async lockedPlayersOn(playerIds: string[], date: string): Promise<{ locked: Set<string>; nameOf: Map<string, string> }> {
    const locked = new Set<string>();
    const nameOf = new Map<string, string>();
    const ids = [...new Set(playerIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)))];
    if (ids.length === 0) return { locked, nameOf };

    const { data: players } = await this.supabase
      .from('player_directory')
      .select('player_id, full_name, team_abbrev')
      .eq('season', getCurrentSeason())
      .in('player_id', ids);
    if (!players || players.length === 0) return { locked, nameOf };

    const teamOf = new Map<string, string>();
    for (const p of players as Array<{ player_id: number; full_name: string | null; team_abbrev: string | null }>) {
      nameOf.set(String(p.player_id), p.full_name ?? '');
      if (p.team_abbrev) teamOf.set(String(p.player_id), p.team_abbrev);
    }
    const teams = [...new Set(teamOf.values())];
    if (teams.length === 0) return { locked, nameOf };

    const { data: games } = await this.supabase
      .from('nhl_games')
      .select('game_time, status, home_team, away_team')
      .eq('game_date', date)
      .or(`home_team.in.(${teams.join(',')}),away_team.in.(${teams.join(',')})`);

    const now = Date.now();
    const started = new Set<string>();
    for (const g of (games ?? []) as Array<{ game_time: string | null; status: string | null; home_team: string | null; away_team: string | null }>) {
      const status = String(g.status ?? '').toLowerCase();
      const underWay =
        status === 'live' || status === 'final' || status === 'intermission' ||
        (status === 'scheduled' && !!g.game_time && new Date(g.game_time).getTime() < now);
      if (!underWay) continue;
      if (g.home_team) started.add(g.home_team);
      if (g.away_team) started.add(g.away_team);
    }
    for (const [pid, team] of teamOf) if (started.has(team)) locked.add(pid);
    return { locked, nameOf };
  }

  /**
   * The spot each player holds on `date` according to the record that day
   * is scored from: the day's fantasy_daily_rosters rows, else the base
   * team_lineups lineup the day inherits. Null when there is no record.
   */
  private async lineupOnRecord(teamId: string, leagueId: string, date: string): Promise<Map<string, LineupSpot> | null> {
    const { data: rows } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('player_id, slot_type, slot_id')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .eq('roster_date', date);
    if (rows && rows.length > 0) {
      const spots = new Map<string, LineupSpot>();
      for (const r of rows as Array<{ player_id: number | string; slot_type: string; slot_id: string | null }>) {
        const type = r.slot_type === 'active' ? 'active' : r.slot_type === 'ir' ? 'ir' : 'bench';
        spots.set(String(r.player_id), { type, slot: type === 'bench' ? null : r.slot_id ?? null });
      }
      return spots;
    }

    const { data: base } = await this.supabase
      .from('team_lineups')
      .select('starters, bench, ir, slot_assignments')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!base) return null;
    return spotsOf({
      starters: ((base.starters as unknown[]) ?? []).map(String),
      bench: ((base.bench as unknown[]) ?? []).map(String),
      ir: ((base.ir as unknown[]) ?? []).map(String),
      slot_assignments: (base.slot_assignments as Record<string, string>) ?? {},
    });
  }

  /**
   * GAME-LOCK ENFORCEMENT (2026-09-01, Sleeper parity audit R6).
   *
   * Until now the PUT lineup route guarded season-complete only; the
   * client's GameLockService was the whole gate, and Auto Lineup did not
   * even consult it. Any client could save a lineup that benched a starter
   * whose game had begun, and the snapshot writer's upsert would overwrite
   * the locked row with it.
   *
   * Compares the requested lineup with the lineup on record for today and
   * returns every LOCKED player whose spot would change — list (active /
   * bench / IR) or, when both sides know it, slot. A locked player absent
   * from the request is not a move (drops are governed by the roster
   * protection check, and a dropped locked player keeps scoring anyway).
   *
   * Only a save that can touch today's rows can move a locked player: a
   * save for today, a base save (no date), or a past date (which falls back
   * to the base lineup and propagates to today). A strictly future day has
   * no locks to break and is not checked.
   */
  async findLockedLineupChanges(
    teamId: string,
    leagueId: string,
    lineup: LineupShape,
    targetDate?: string,
  ): Promise<LockedLineupChange[]> {
    const today = getTodayMST();
    if (targetDate && targetDate > today) return [];

    const record = await this.lineupOnRecord(teamId, leagueId, today);
    if (!record || record.size === 0) return [];

    const requested = spotsOf(lineup);
    const candidates = [...record.keys()].filter((pid) => {
      const before = record.get(pid)!;
      const after = requested.get(pid);
      if (!after) return false;
      if (before.type !== after.type) return true;
      return !!before.slot && !!after.slot && before.slot !== after.slot;
    });
    if (candidates.length === 0) return [];

    const { locked, nameOf } = await this.lockedPlayersOn(candidates, today);
    return candidates
      .filter((pid) => locked.has(pid))
      .map((pid) => ({
        playerId: pid,
        playerName: nameOf.get(pid) ?? '',
        from: describeSpot(record.get(pid)!),
        to: describeSpot(requested.get(pid)!),
      }));
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

    // Filter against roster_assignments to prevent stale/dropped players from backfilling
    const filtered = await this.filterLineupAgainstRoster(teamId, leagueId, {
      starters: ((savedLineup.starters || []) as unknown[]).map(String),
      bench: ((savedLineup.bench || []) as unknown[]).map(String),
      ir: ((savedLineup.ir || []) as unknown[]).map(String),
      slot_assignments: (savedLineup.slot_assignments || {}) as Record<string, string>,
    });
    const starters = filtered.starters;
    const bench = filtered.bench;
    const ir = filtered.ir;
    const slotAssignments = filtered.slot_assignments;

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

    // Check which dates already have ANY records — skip those entirely.
    // Each day's lineup is independent; backfill only fills truly empty dates.
    const { data: existingRecords } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('roster_date')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId);

    const datesWithData = new Set(
      (existingRecords || []).map((r: { roster_date: string }) => r.roster_date),
    );

    // Task 1B: refuse to fabricate roster rows for past dates. We do not
    // know what the lineup was on a past date — writing anything here is
    // guessing, and it silently locks the guess. Only backfill today and
    // future dates that have zero records; past dates that lack rows must
    // remain missing so scoring can treat them honestly.
    const todayStr = getTodayMST();
    const skippedPastDates: string[] = [];
    const datesToFill = weekDates.filter(d => {
      if (datesWithData.has(d)) return false;
      if (d < todayStr) {
        skippedPastDates.push(d);
        return false;
      }
      return true;
    });
    if (skippedPastDates.length > 0) {
      logger.warn('[backfillMissingDailyRosters] refused past dates:', skippedPastDates,
        'team:', teamId, 'matchup:', matchupId);
    }

    const recordsToInsert: Array<Record<string, unknown>> = [];

    for (const dateStr of datesToFill) {
      const addRecords = (playerIds: string[], slotType: string) => {
        for (const playerId of playerIds) {
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
            // Task 1B: label the provenance. This writer is inferring
            // today/future rows from the current base team_lineups; that
            // is the definition of 'reconstructed'.
            source: 'reconstructed',
          });
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
    // Get league settings for position type
    const { data: leagueData } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();
    const positionType: string = (leagueData?.settings as Record<string, unknown>)?.positionType === 'forward' ? 'forward' : 'individual';

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
      .select('player_id, position_code')
      .eq('season', getCurrentSeason())
      .in('player_id', playerIds.map((id: string) => parseInt(String(id))));

    // Get roster status from player_talent_metrics (roster_status lives here, not in player_directory)
    const { data: talentMetrics } = await this.supabase
      .from('player_talent_metrics')
      .select('player_id, roster_status')
      .eq('season', getCurrentSeason())
      .in('player_id', playerIds.map((id: string) => parseInt(String(id))));

    if (!players || players.length === 0) {
      return { lineup: null, error: null };
    }

    // Build position map
    const positionMap = new Map<string, string>();
    const statusMap = new Map<string, string>();
    for (const p of players) {
      positionMap.set(String(p.player_id), p.position_code || 'UTIL');
    }
    // Build status map from talent metrics (roster_status is in player_talent_metrics, not player_directory)
    for (const t of (talentMetrics || [])) {
      if (t.roster_status) statusMap.set(String(t.player_id), t.roster_status);
    }

    const getFantasyPosition = (position: string): string => {
      const pos = position?.toUpperCase() || '';
      let normalized: string;
      if (['C', 'CENTRE', 'CENTER'].includes(pos)) normalized = 'C';
      else if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) normalized = 'LW';
      else if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) normalized = 'RW';
      else if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) normalized = 'D';
      else if (['G', 'GOALIE'].includes(pos)) normalized = 'G';
      else return 'UTIL';

      // In F/D/G mode, merge C/LW/RW into F
      if (positionType === 'forward' && (normalized === 'C' || normalized === 'LW' || normalized === 'RW')) {
        return 'F';
      }
      return normalized;
    };

    // Sort players by ID for deterministic assignment
    const sortedIds = playerIds.map(String).sort((a: string, b: string) => parseInt(a) - parseInt(b));

    const starters: string[] = [];
    const bench: string[] = [];
    const ir: string[] = [];
    const slotAssignments: Record<string, string> = {};

    // SETTINGS-ENFORCEMENT (2026-08-16) — was hardcoded 2-2-2-4-2/6-4-2.
    // Custom-slot leagues got wrong-shaped default lineups.
    const initCfg = resolveSlotConfig(leagueData?.settings as Record<string, unknown>);
    const slotsNeeded: Record<string, number> = { ...initCfg.slots, UTIL: initCfg.utilCount };
    const slotsFilled: Record<string, number> = Object.fromEntries(
      Object.keys(slotsNeeded).map((k) => [k, 0]),
    );
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
    const posKeys = positionType === 'forward' ? ['F', 'D', 'G'] : ['C', 'LW', 'RW', 'D', 'G'];
    const startersByPos: Record<string, string[]> = {};
    for (const key of posKeys) startersByPos[key] = [];

    for (const pid of starters) {
      const pos = getFantasyPosition(positionMap.get(pid) || 'UTIL');
      if (pos !== 'UTIL' && startersByPos[pos]) {
        startersByPos[pos].push(pid);
      }
    }
    for (const pos of posKeys) {
      const limit = slotsNeeded[pos] || 0;
      startersByPos[pos].slice(0, limit).forEach((pid, i) => {
        slotAssignments[pid] = `slot-${pos}-${i + 1}`;
      });
    }
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
  // Note: `source` is defaulted to 'user_edit' because the only path that
  // reaches this without an explicit source override is a per-day user
  // lineup save (LineupService.saveLineup with target_date). Every other
  // caller (scheduled snapshot, reconstructed backfill) MUST pass its own
  // source label.
  public async createDailyRosterSnapshots(
    teamId: string,
    leagueId: string,
    lineup: { starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> },
    targetDate: string,
    source: 'scheduled_snapshot' | 'user_edit' | 'reconstructed' = 'user_edit',
  ): Promise<boolean> {
    // Returns true only when day rows were actually upserted. Callers use
    // this to detect the nothing-to-write cases (no matchup; target date
    // outside the matchup week; empty lineup) - see the silent-no-op fix
    // in saveLineup (2026-08-21).
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

    if (!matchups || matchups.length === 0) return false;

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
    if (futureDates.length === 0) return false;

    // Get player teams for lock checking
    const allPlayerIds = [...lineup.starters, ...lineup.bench, ...lineup.ir].map(id => parseInt(id));
    const playerTeamMap = new Map<number, string>();
    if (allPlayerIds.length > 0) {
      const { data: players } = await this.supabase
        .from('player_directory')
        .select('player_id, team_abbrev')
        .eq('season', getCurrentSeason())
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
            source,
          });
        }
      };

      addRecords(lineup.starters, 'active');
      addRecords(lineup.bench, 'bench');
      addRecords(lineup.ir, 'ir');
    }

    if (rosterRecords.length === 0) return false;

    // Delete existing non-locked rows for these dates first, then insert fresh.
    // This prevents stale player rows from accumulating when lineup composition changes.
    const datesToClear = [...new Set(rosterRecords.map(r => r.roster_date as string))];
    for (const dateStr of datesToClear) {
      const { error: deleteError } = await this.supabase
        .from('fantasy_daily_rosters')
        .delete()
        .eq('team_id', teamId)
        .eq('matchup_id', matchup.id)
        .eq('roster_date', dateStr)
        .eq('is_locked', false);

      if (deleteError) {
        logger.error('[LineupService.createDailyRosterSnapshots] Delete error for', dateStr, deleteError);
      }
    }

    // Insert all records fresh (locked rows were preserved by the delete filter above)
    const { error: insertError } = await this.supabase
      .from('fantasy_daily_rosters')
      .upsert(rosterRecords, {
        onConflict: 'team_id,matchup_id,player_id,roster_date',
        ignoreDuplicates: false,
      });
    if (insertError) {
      logger.error('[LineupService.createDailyRosterSnapshots] Upsert error:', insertError);
      return false;
    }
    return true;
  }
}
