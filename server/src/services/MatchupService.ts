import { SupabaseClient } from '@supabase/supabase-js';
import { resolveSlotConfig } from '../lib/leagueRules';
import {
  COLUMNS,
  getCurrentSeason,
  logger,
  getTodayMST,
  isIntermission,
  normalizeGameState,
  periodOrdinal,
  secondsRemaining,
} from '@citrus/shared';
import type { LeagueScoreboardMatchup } from '@citrus/shared';
import { getSupabaseAdmin } from '../lib/supabase';
import { pagedSelect } from '../lib/pagedSelect';

// ============================================================================
// LEAGUE SCOREBOARD PROJECTIONS (2026-09-03, Sleeper parity audit M7)
// ============================================================================
//
// The league scoreboard strip used to show banked points only, because the
// league endpoint served `team1_score` / `team2_score` and nothing that
// could honestly project a stranger's matchup. This section computes, for
// every matchup of one league-week, the same "proj" the matchup page prints
// in its sticky bar: points banked + every remaining starter-game's
// projection, scaled by how much of the game is still unplayed.
//
// ONE SOURCE OF TRUTH. The page assembles that number in the browser from
// three reads it already makes -- the frozen daily rosters
// (`fantasy_daily_rosters`, slot_type = 'active', else the current
// `team_lineups.starters`), `get_daily_projections` (a straight read of
// `player_projected_stats` by player and projection_date), and the game's
// `nhl_games` row for the clock -- and sums them in
// `apps/web/src/utils/winProbability.ts` (`collectRemainingGames` +
// `projectTeam`). The functions below read the same three tables and apply
// the same fraction rule, so the strip's number for a matchup and the
// page's number for that matchup are two evaluations of one formula over
// one dataset. What they cannot share is a module: the page's copy lives
// under apps/web and the server cannot import it, so the fraction rule is
// restated here against `@citrus/shared`'s game-state vocabulary and pinned
// by the same fixtures (MatchupService.leagueScoreboard.test.ts).
//
// Pure functions first, so the arithmetic is testable without a database;
// the class method (`getLeagueScoreboard`) only fetches and hands them rows.

/** The slice of an `nhl_games` row the fraction rule reads. */
export interface ScoreboardGameRow {
  status?: string | null;
  period?: string | null;
  period_time?: string | null;
  home_score?: number | null;
  away_score?: number | null;
}

/** One `player_projected_stats` row with its `nhl_games` row embedded. */
export interface ScoreboardProjectionRow {
  player_id: number | string;
  /** YYYY-MM-DD */
  projection_date: string;
  total_projected_points: number | string | null;
  /** TIMESTAMPTZ of puck drop; the fallback clock when the game row is missing. */
  game_start_time?: string | null;
  /** PostgREST embeds a to-one relation as an object; tolerate an array too. */
  game?: ScoreboardGameRow | ScoreboardGameRow[] | null;
}

/** One frozen starter row of `fantasy_daily_rosters` (slot_type = 'active'). */
export interface ScoreboardRosterRow {
  matchup_id: string;
  team_id: string;
  /** YYYY-MM-DD */
  roster_date: string;
  player_id: number | string;
}

/** One `team_lineups` row: the current lineup, the fallback for a day with no frozen row. */
export interface ScoreboardLineupRow {
  team_id: string;
  /** JSONB array of player ids, numbers or numeric strings. */
  starters: unknown;
}

/** The slice of a `matchups` row the projection reads. */
export interface ScoreboardMatchupRow {
  id: string;
  team1_id: string;
  team2_id: string | null;
  team1_score: number | string | null;
  team2_score: number | string | null;
  status?: string | null;
  week_start_date: string;
  week_end_date: string;
}

export interface ScoreboardProjectionInput {
  matchups: ScoreboardMatchupRow[];
  rosters: ScoreboardRosterRow[];
  lineups: ScoreboardLineupRow[];
  projections: ScoreboardProjectionRow[];
  /** YYYY-MM-DD in Mountain Time. */
  today: string;
  /** Wall clock, for the no-schedule-row fallback. */
  nowMs: number;
}

export interface ScoreboardSideTotals {
  team1: number | null;
  team2: number | null;
}

const REGULATION_PERIODS = 3;
/** Overtime or a shootout: almost nothing left, but not nothing. */
const OVERTIME_FRACTION = 0.05;
/** Wall-clock length of an NHL game, for the no-schedule-row fallback. */
const GAME_DURATION_MS = 2.5 * 60 * 60 * 1000;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const toPoints = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toPlayerId = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Share of a game still unplayed, from its schedule row. The same rule as
 * `gameFractionRemaining` in apps/web/src/utils/winProbability.ts:
 *   final / postponed -> 0 . not started -> 1 . OT / SO -> 0.05 .
 *   period p with mm:ss on the clock -> ((3 - p) * 20 + mm:ss) / 60 .
 *   intermission after period p -> (3 - p) / 3 . period known, clock
 *   unknown -> mid-period . started but nothing parseable -> 0.5
 */
export function scoreboardGameFraction(game: ScoreboardGameRow): number {
  const state = normalizeGameState(game.status);
  if (state === 'final' || state === 'postponed') return 0;

  const scored = toPoints(game.home_score) + toPoints(game.away_score) > 0;
  const hasPeriod = typeof game.period === 'string' && game.period.trim() !== '';
  if (state !== 'live' && !scored && !hasPeriod) return 1;

  const ordinal = periodOrdinal(game.period);
  if (ordinal === null) return 0.5;
  if (ordinal > REGULATION_PERIODS) return OVERTIME_FRACTION;

  const fullPeriodsLeft = REGULATION_PERIODS - ordinal;
  if (isIntermission(game.period_time)) return clamp01(fullPeriodsLeft / REGULATION_PERIODS);
  const seconds = secondsRemaining(game.period_time);
  if (seconds !== null) return clamp01((fullPeriodsLeft * 20 + seconds / 60) / 60);
  return clamp01((fullPeriodsLeft + 0.5) / REGULATION_PERIODS);
}

/** No schedule row: fall back to wall-clock time since the listed puck drop. */
export function scoreboardFractionFromStartTime(startTime: string | null | undefined, nowMs: number): number {
  if (!startTime) return 1;
  const startMs = Date.parse(startTime);
  if (!Number.isFinite(startMs)) return 1;
  if (nowMs < startMs) return 1;
  return clamp01(1 - (nowMs - startMs) / GAME_DURATION_MS);
}

/** YYYY-MM-DD strings from `start` to `end` inclusive (date-only, DST-safe). */
export function scoreboardWeekDates(start: string, end: string, maxDays = 10): string[] {
  const dates: string[] = [];
  if (!start || !end) return dates;
  const cursor = new Date(`${start.slice(0, 10)}T12:00:00Z`);
  const last = new Date(`${end.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return dates;
  while (cursor <= last && dates.length < maxDays) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * A matchup still has something to project: not closed by the scorer, not a
 * bye, and its week has not ended on the calendar. The same reading as the
 * strip's `isFinal` (components/matchup/scoreboard.ts), so a chip that says
 * FINAL never carries a projection.
 */
export function isOpenScoreboardMatchup(row: ScoreboardMatchupRow, today: string): boolean {
  if (row.status === 'completed') return false;
  if (!row.team2_id) return false;
  const end = String(row.week_end_date ?? '').slice(0, 10);
  return end.length === 10 && end >= today;
}

/**
 * Projected finals for every open matchup of one league-week.
 *
 * For each side: points banked (the stored score) + for every remaining
 * day, for every starter that day, that starter's projected points scaled by
 * the share of the game still unplayed. Starters for a day are the frozen
 * `fantasy_daily_rosters` rows when any exist, else the current lineup --
 * the matchup page's own precedence. A starter with no projection row that
 * day is a day off and adds nothing, which is also what the page adds.
 *
 * null, never 0, when the number cannot honestly be said: a closed matchup
 * or a bye; a matchup where either side has no starters on any remaining
 * day (the page says nothing until both lineups are in hand); or a week
 * for which no projection row exists at all, when a "projection" would only
 * restate the live score.
 */
export function projectLeagueWeek(input: ScoreboardProjectionInput): Map<string, ScoreboardSideTotals> {
  const out = new Map<string, ScoreboardSideTotals>();
  const nothing: ScoreboardSideTotals = { team1: null, team2: null };
  const noProjections = input.projections.length === 0;

  const frozen = new Map<string, Set<number>>();
  for (const r of input.rosters) {
    const pid = toPlayerId(r.player_id);
    if (pid === null) continue;
    const key = `${r.matchup_id}|${r.team_id}|${String(r.roster_date).slice(0, 10)}`;
    let set = frozen.get(key);
    if (!set) {
      set = new Set<number>();
      frozen.set(key, set);
    }
    set.add(pid);
  }

  const current = new Map<string, Set<number>>();
  for (const l of input.lineups) {
    const ids = Array.isArray(l.starters) ? l.starters : [];
    const set = new Set<number>();
    for (const raw of ids) {
      const pid = toPlayerId(raw);
      if (pid !== null) set.add(pid);
    }
    if (set.size > 0) current.set(l.team_id, set);
  }

  const projections = new Map<string, ScoreboardProjectionRow>();
  for (const p of input.projections) {
    const pid = toPlayerId(p.player_id);
    if (pid === null) continue;
    projections.set(`${pid}|${String(p.projection_date).slice(0, 10)}`, p);
  }

  const gameOf = (p: ScoreboardProjectionRow): ScoreboardGameRow | null => {
    const g = p.game;
    if (!g) return null;
    return Array.isArray(g) ? (g[0] ?? null) : g;
  };

  for (const m of input.matchups) {
    if (!isOpenScoreboardMatchup(m, input.today) || noProjections) {
      out.set(m.id, nothing);
      continue;
    }
    const remainingDates = scoreboardWeekDates(m.week_start_date, m.week_end_date).filter((d) => d >= input.today);

    const side = (teamId: string): { hasLineup: boolean; remaining: number } => {
      let hasLineup = false;
      let remaining = 0;
      for (const date of remainingDates) {
        const saved = frozen.get(`${m.id}|${teamId}|${date}`);
        const starters = saved && saved.size > 0 ? saved : current.get(teamId);
        if (!starters || starters.size === 0) continue;
        hasLineup = true;
        for (const pid of starters) {
          const projection = projections.get(`${pid}|${date}`);
          if (!projection) continue;
          const game = gameOf(projection);
          const fraction = game
            ? scoreboardGameFraction(game)
            : scoreboardFractionFromStartTime(projection.game_start_time, input.nowMs);
          if (fraction <= 0) continue;
          remaining += fraction * toPoints(projection.total_projected_points);
        }
      }
      return { hasLineup, remaining };
    };

    const one = side(m.team1_id);
    const two = side(m.team2_id as string);
    if (!one.hasLineup || !two.hasLineup) {
      out.set(m.id, nothing);
      continue;
    }
    out.set(m.id, {
      team1: toPoints(m.team1_score) + one.remaining,
      team2: toPoints(m.team2_score) + two.remaining,
    });
  }
  return out;
}

/**
 * MatchupService — Server-side matchup management with DI Supabase client.
 *
 * Extracted from apps/web/src/services/MatchupService.ts.
 * Complex roster building and score calculation stays here;
 * pure transform functions stay in the web app.
 */
export class MatchupService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Get all matchups for a league (optionally filtered by week) */
  async getLeagueMatchups(leagueId: string, weekNumber?: number) {
    // Join team names so the matchup dropdown can show "Team A vs Team B"
    // instead of "Unknown vs Unknown"
    let query = this.supabase
      .from('matchups')
      .select(`${COLUMNS.MATCHUP}, team1:teams!team1_id(id, team_name), team2:teams!team2_id(id, team_name)`)
      .eq('league_id', leagueId)
      .order('week_number', { ascending: true });

    if (weekNumber !== undefined) {
      query = query.eq('week_number', weekNumber);
    }

    const { data, error } = await query;
    return { matchups: data || [], error };
  }

  /**
   * The league scoreboard for one week: `getLeagueMatchups(leagueId, week)`
   * plus a projected final per side (see the section above the class).
   *
   * Query shape, one league at a time and never per team or per player:
   *   1. matchups for the league-week (the read the endpoint already made);
   *   2. in parallel, the frozen active rosters for those matchups over the
   *      remaining days (idx_fantasy_daily_rosters_active) and the league's
   *      current lineups (team_lineups by league_id);
   *   3. the projections for every starter named by 1-2 over the remaining
   *      days, with each game's clock embedded through the
   *      player_projected_stats.game_id -> nhl_games FK
   *      (idx_proj_player_date_fast + idx_nhl_games_game_id).
   * Measured on production for a 4-matchup week (2026-09-03): 2.3ms for
   * step 2's roster read and 1.2ms for step 3, both index scans. Reads 2 and
   * 3 page at PostgREST's 1000-row clamp so a fully backfilled 12-team week
   * (~1,200 roster rows) is not silently cut.
   *
   * Every read goes through the caller's user-scoped client: matchups,
   * fantasy_daily_rosters and team_lineups are all league-visible under RLS
   * to a member of the league (AI teams included, since those policies key
   * on league membership, not team ownership), and the projection tables are
   * public reads. A read that fails ships the live scores with null
   * projections and a warning; it never fails the scoreboard.
   */
  async getLeagueScoreboard(
    leagueId: string,
    weekNumber: number,
    today: string = getTodayMST(),
    nowMs: number = Date.now(),
  ): Promise<{ matchups: LeagueScoreboardMatchup[]; error: unknown }> {
    const { matchups, error } = await this.getLeagueMatchups(leagueId, weekNumber);
    if (error) return { matchups: [], error };

    // getLeagueMatchups selects through a template string, so supabase-js
    // types its rows as a ParserError; the shape is pinned by
    // MatchupService.leagueScoreboard.test.ts, not by the select's type.
    const rows = (matchups || []) as unknown as Array<ScoreboardMatchupRow & Record<string, unknown>>;
    const withProjections = (totals: Map<string, ScoreboardSideTotals>): LeagueScoreboardMatchup[] =>
      rows.map((row) => ({
        ...(row as unknown as LeagueScoreboardMatchup),
        team1_projected_total: totals.get(row.id)?.team1 ?? null,
        team2_projected_total: totals.get(row.id)?.team2 ?? null,
      }));
    const none = new Map<string, ScoreboardSideTotals>();

    const open = rows.filter((row) => isOpenScoreboardMatchup(row, today));
    if (open.length === 0) return { matchups: withProjections(none), error: null };

    const weekStart = open.map((r) => String(r.week_start_date).slice(0, 10)).sort()[0];
    const weekEnd = open.map((r) => String(r.week_end_date).slice(0, 10)).sort().slice(-1)[0];
    const firstDay = weekStart > today ? weekStart : today;
    const matchupIds = open.map((r) => r.id);
    const teamIds = Array.from(new Set(open.flatMap((r) => [r.team1_id, r.team2_id]).filter((id): id is string => !!id)));

    const [rostersRead, lineupsRead] = await Promise.all([
      pagedSelect<ScoreboardRosterRow>(this.supabase, {
        table: 'fantasy_daily_rosters',
        columns: 'matchup_id, team_id, roster_date, player_id',
        filters: [['slot_type', 'active']],
        inFilters: [['matchup_id', matchupIds]],
        rangeFilters: [['roster_date', 'gte', firstDay], ['roster_date', 'lte', weekEnd]],
        orderBy: ['team_id', 'matchup_id', 'player_id', 'roster_date'],
      }),
      this.supabase
        .from('team_lineups')
        .select('team_id, starters')
        .eq('league_id', leagueId)
        .in('team_id', teamIds),
    ]);

    if (rostersRead.error || lineupsRead.error) {
      logger.warn('[getLeagueScoreboard] roster read failed; shipping live scores without projections', {
        leagueId,
        weekNumber,
        rosters: rostersRead.error?.message,
        lineups: lineupsRead.error?.message,
      });
      return { matchups: withProjections(none), error: null };
    }

    const rosters = rostersRead.data;
    const lineups = (lineupsRead.data || []) as ScoreboardLineupRow[];
    const playerIds = new Set<number>();
    for (const r of rosters) {
      const pid = toPlayerId(r.player_id);
      if (pid !== null) playerIds.add(pid);
    }
    for (const l of lineups) {
      for (const raw of Array.isArray(l.starters) ? l.starters : []) {
        const pid = toPlayerId(raw);
        if (pid !== null) playerIds.add(pid);
      }
    }
    if (playerIds.size === 0) return { matchups: withProjections(none), error: null };

    const projectionsRead = await pagedSelect<ScoreboardProjectionRow>(this.supabase, {
      table: 'player_projected_stats',
      columns:
        'player_id, projection_date, game_id, total_projected_points, game_start_time, ' +
        'game:nhl_games!game_id(status, period, period_time, home_score, away_score)',
      inFilters: [['player_id', Array.from(playerIds)]],
      rangeFilters: [['projection_date', 'gte', firstDay], ['projection_date', 'lte', weekEnd]],
      orderBy: ['player_id', 'projection_date', 'game_id'],
    });

    if (projectionsRead.error) {
      logger.warn('[getLeagueScoreboard] projection read failed; shipping live scores without projections', {
        leagueId,
        weekNumber,
        error: projectionsRead.error.message,
      });
      return { matchups: withProjections(none), error: null };
    }

    const totals = projectLeagueWeek({
      matchups: open,
      rosters,
      lineups,
      projections: projectionsRead.data,
      today,
      nowMs,
    });
    return { matchups: withProjections(totals), error: null };
  }

  /** Get a single matchup by ID */
  async getMatchup(matchupId: string) {
    const { data, error } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('id', matchupId)
      .single();

    return { matchup: data, error };
  }

  /** Get matchup with lines (pre-calculated player stats) */
  async getMatchupWithLines(matchupId: string) {
    const [matchupResult, linesResult] = await Promise.all([
      this.supabase
        .from('matchups')
        .select(COLUMNS.MATCHUP)
        .eq('id', matchupId)
        .single(),
      this.supabase
        .from('fantasy_matchup_lines')
        .select(COLUMNS.MATCHUP_LINES)
        .eq('matchup_id', matchupId),
    ]);

    if (matchupResult.error) {
      return { matchup: null, lines: [], error: matchupResult.error };
    }

    return {
      matchup: matchupResult.data,
      lines: linesResult.data || [],
      error: null,
    };
  }

  /** Get matchup scores (lines sorted by points) */
  async getMatchupScores(matchupId: string) {
    const { data, error } = await this.supabase
      .from('fantasy_matchup_lines')
      .select(COLUMNS.MATCHUP_LINES)
      .eq('matchup_id', matchupId)
      .order('total_points', { ascending: false });

    return { scores: data || [], error };
  }

  /** Get user's matchup for a specific week */
  async getUserMatchup(leagueId: string, userId: string, weekNumber: number) {
    // Find user's team
    const { data: team } = await this.supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId)
      .eq('owner_id', userId)
      .maybeSingle();

    if (!team) {
      return { matchup: null, error: 'Team not found' };
    }

    const { data, error } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .eq('week_number', weekNumber)
      .or(`team1_id.eq.${team.id},team2_id.eq.${team.id}`)
      .maybeSingle();

    return { matchup: data, error };
  }

  /** Get roster player IDs for a team (source of truth: roster_assignments) */
  async getRosterPlayerIds(teamId: string, leagueId: string) {
    // Use admin client to bypass RLS — critical for AI teams (owner_id = NULL)
    // whose roster_assignments are not visible through user-scoped clients.
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('roster_assignments')
      .select('player_id')
      .eq('team_id', teamId)
      .eq('league_id', leagueId);

    const ids = (data || []).map((r: { player_id: number }) => String(r.player_id));
    logger.info(`[getRosterPlayerIds] team=${teamId.slice(0,8)} count=${ids.length}${error ? ' ERROR: ' + error.message : ''}`);
    return ids;
  }

  /** Get matchup history between two teams */
  async getMatchupHistory(leagueId: string, team1Id: string, team2Id: string | null) {
    if (!team2Id) return { matchups: [], error: null };

    const { data: forward } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .eq('team1_id', team1Id)
      .eq('team2_id', team2Id)
      .in('status', ['completed', 'final']);

    const { data: reverse } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .eq('team1_id', team2Id)
      .eq('team2_id', team1Id)
      .in('status', ['completed', 'final']);

    const all = [...(forward || []), ...(reverse || [])];
    all.sort((a, b) => (a as unknown as { week_number: number }).week_number - (b as unknown as { week_number: number }).week_number);

    return { matchups: all, error: null };
  }

  /** Generate round-robin matchups for a league */
  async generateMatchupsForLeague(
    leagueId: string,
    teams: Array<{ id: string }>,
    fantasyWeeks: Array<{ week_number: number; start_date: string; end_date: string }>,
    forceRegenerate = false,
  ) {
    if (forceRegenerate) {
      await this.supabase.from('matchups').delete().eq('league_id', leagueId);
    }

    const numTeams = teams.length;
    const numRounds = numTeams % 2 === 0 ? numTeams - 1 : numTeams;
    const matchups: Array<{
      league_id: string;
      week_number: number;
      team1_id: string;
      team2_id: string;
      week_start_date: string;
      week_end_date: string;
      status: string;
    }> = [];

    for (const week of fantasyWeeks) {
      const pairings = this.getRoundRobinPairings(week.week_number, teams, numRounds);
      for (const pair of pairings) {
        if (!pair.team2) continue; // Skip bye weeks
        matchups.push({
          league_id: leagueId,
          week_number: week.week_number,
          team1_id: pair.team1.id,
          team2_id: pair.team2.id,
          week_start_date: week.start_date,
          week_end_date: week.end_date,
          status: 'scheduled',
        });
      }
    }

    if (matchups.length === 0) {
      return { error: null };
    }

    // Check which weeks already have matchups to avoid duplicate key violations
    // (two unique constraints: league_id+week_number+team1_id AND league_id+week_number+team2_id)
    const { data: existing } = await this.supabase
      .from('matchups')
      .select('week_number, team1_id, team2_id')
      .eq('league_id', leagueId);

    const existingKeys = new Set(
      (existing || []).map(m => `${m.week_number}:${m.team1_id}:${m.team2_id}`)
    );

    const newMatchups = matchups.filter(
      m => !existingKeys.has(`${m.week_number}:${m.team1_id}:${m.team2_id}`)
    );

    if (newMatchups.length === 0) {
      return { error: null };
    }

    const { error } = await this.supabase.from('matchups').insert(newMatchups);
    return { error };
  }

  /** Circle Method round-robin scheduling */
  private getRoundRobinPairings(
    weekNumber: number,
    teams: Array<{ id: string }>,
    numRounds: number,
  ) {
    const n = teams.length;
    const adjustedWeek = ((weekNumber - 1) % numRounds);

    // Create rotating array (first team is fixed)
    const rotatingTeams = teams.slice(1);
    const rotated = [
      ...rotatingTeams.slice(adjustedWeek % rotatingTeams.length),
      ...rotatingTeams.slice(0, adjustedWeek % rotatingTeams.length),
    ];

    const allTeams = [teams[0], ...rotated];
    const pairings: Array<{ team1: { id: string }; team2: { id: string } | null }> = [];
    const halfCount = Math.floor(n / 2);

    for (let i = 0; i < halfCount; i++) {
      pairings.push({
        team1: allTeams[i],
        team2: allTeams[n - 1 - i] || null,
      });
    }

    // Handle odd number of teams (bye week)
    if (n % 2 !== 0) {
      pairings.push({ team1: allTeams[halfCount], team2: null });
    }

    return pairings;
  }

  /** Delete all matchups for a league */
  async deleteAllMatchupsForLeague(leagueId: string) {
    const { error } = await this.supabase
      .from('matchups')
      .delete()
      .eq('league_id', leagueId);

    return { error };
  }

  /** Update all matchup scores via RPC */
  async updateMatchupScores(leagueId?: string) {
    const { data, error } = await this.supabase.rpc('update_all_matchup_scores', {
      p_league_id: leagueId || null,
    });

    return { data, error };
  }

  /** Get playoff bracket */
  async getPlayoffBracket(leagueId: string) {
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const playoffSettings = league?.settings?.playoffs || {};

    const { data: teams } = await this.supabase
      .from('teams')
      .select(COLUMNS.TEAM_SLIM)
      .eq('league_id', leagueId);

    const { data: matchups } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .gte('week_number', playoffSettings.startWeek || 999)
      .order('week_number', { ascending: true });

    return {
      teams: teams || [],
      matchups: matchups || [],
      settings: playoffSettings,
      error: null,
    };
  }

  /**
   * Build a default lineup from roster_assignments + player_directory and
   * persist it to team_lineups so the INSERT trigger fires.
   * Returns true if a lineup was created, false if no roster players found.
   */
  private async buildAndSaveDefaultLineup(
    admin: ReturnType<typeof getSupabaseAdmin>,
    teamId: string,
    leagueId: string,
  ): Promise<boolean> {
    // Get all players assigned to this team
    const { data: assignments, error: assignErr } = await admin
      .from('roster_assignments')
      .select('player_id')
      .eq('team_id', teamId)
      .eq('league_id', leagueId);

    if (assignErr) {
      logger.error('[buildDefaultLineup] roster_assignments query error:', assignErr);
      return false;
    }

    // Ownership lives in ONE of two tables depending on the league, and this
    // builder only ever read one of them.
    //
    // Measured on prod 2026-08-11: 46 teams have draft_picks, only 12 have
    // roster_assignments, and of the 24 drafted teams with no team_lineups row,
    // the number holding roster_assignments is ZERO. So the roster_assignments
    // read repairs none of the teams that actually need repairing — it returns
    // false, the caller logs "nothing to snapshot", and the team goes into
    // opening night with no daily roster and scores nothing.
    //
    // draft_picks is also what check_data_integrity CHECK 1 treats as the
    // ownership source of truth when it reconciles against team_lineups.
    let playerIds: Array<string | number> =
      (assignments || []).map((a: { player_id: string | number }) => a.player_id);

    if (playerIds.length === 0) {
      const { data: picks, error: picksErr } = await admin
        .from('draft_picks')
        .select('player_id')
        .eq('team_id', teamId)
        .eq('league_id', leagueId)
        .is('deleted_at', null);

      if (picksErr) {
        logger.error('[buildDefaultLineup] draft_picks query error:', picksErr);
        return false;
      }
      playerIds = (picks || []).map((d: { player_id: string | number }) => d.player_id);
      if (playerIds.length > 0) {
        logger.info('[buildDefaultLineup] team', teamId,
          'has no roster_assignments; built from', playerIds.length, 'draft_picks');
      }
    }

    if (playerIds.length === 0) {
      logger.error('[buildDefaultLineup] No roster_assignments and no draft_picks for team', teamId);
      return false;
    }
    logger.info('[buildDefaultLineup] Found', playerIds.length, 'roster players for team', teamId);

    // Get position info from player_directory — MUST filter by current season
    // to avoid duplicate rows (one per season per player).
    //
    // getCurrentSeason() per call, NOT the CURRENT_SEASON constant: that
    // constant is evaluated once at module load (see the LIFECYCLE CAVEAT in
    // constants/season.ts), and this function runs on the two nights of the
    // year when the value changes. A Cloud Run instance warm across the
    // 2026-09-28 -> 09-29 boundary would otherwise ask for the 2025 universe
    // of 1,076 players instead of the 2026 universe of 805 — silently, because
    // a season filter that matches nothing looks identical to a player who
    // simply is not in the directory.
    const season = getCurrentSeason();
    const { data: players, error: pdErr } = await admin
      .from('player_directory')
      .select('player_id, position_code, is_goalie')
      .in('player_id', playerIds)
      .eq('season', season);

    if (pdErr) {
      logger.error('[buildDefaultLineup] player_directory query error:', pdErr);
      return false;
    }
    if (!players || players.length === 0) {
      logger.error('[buildDefaultLineup] No player_directory rows for season', season, '— trying without season filter');
      // Fallback: get latest row per player without season filter
      const { data: fallbackPlayers } = await admin
        .from('player_directory')
        .select('player_id, position_code, is_goalie')
        .in('player_id', playerIds)
        .order('season', { ascending: false });

      if (!fallbackPlayers || fallbackPlayers.length === 0) {
        logger.error('[buildDefaultLineup] No player_directory rows at all');
        return false;
      }
      // Deduplicate — keep first row per player_id (latest season)
      const seen = new Set<number>();
      const dedupedPlayers = fallbackPlayers.filter((p: { player_id: number }) => {
        if (seen.has(p.player_id)) return false;
        seen.add(p.player_id);
        return true;
      });
      return this.buildLineupFromPlayers(admin, teamId, leagueId, dedupedPlayers);
    }

    return this.buildLineupFromPlayers(admin, teamId, leagueId, players);
  }

  /**
   * Helper: Given a list of unique players, build starters/bench and save to team_lineups.
   */
  private async buildLineupFromPlayers(
    admin: ReturnType<typeof getSupabaseAdmin>,
    teamId: string,
    leagueId: string,
    players: Array<{ player_id: number; position_code: string; is_goalie: boolean }>,
  ): Promise<boolean> {
    // Fetch league position type
    const { data: leagueData } = await admin
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();
    // SETTINGS-ENFORCEMENT (2026-08-16) — config-driven, was hardcoded.
    const posType = (leagueData?.settings as Record<string, unknown>)?.positionType === 'forward' ? 'forward' : 'individual';
    const initCfg = resolveSlotConfig(leagueData?.settings as Record<string, unknown>);
    const slotsNeeded: Record<string, number> = { ...initCfg.slots, UTIL: initCfg.utilCount };
    const slotsFilled: Record<string, number> = Object.fromEntries(
      Object.keys(slotsNeeded).map((k) => [k, 0]),
    );
    const starters: number[] = [];
    const bench: number[] = [];
    const slotAssignments: Record<string, string> = {};

    const getPos = (p: { position_code: string; is_goalie: boolean }): string => {
      if (p.is_goalie || p.position_code === 'G') return 'G';
      const code = (p.position_code || '').toUpperCase();
      let normalized: string;
      if (code === 'C') normalized = 'C';
      else if (code === 'LW' || code === 'L') normalized = 'LW';
      else if (code === 'RW' || code === 'R') normalized = 'RW';
      else if (code === 'D') normalized = 'D';
      else return 'UTIL';

      // In F/D/G mode, merge C/LW/RW into F
      if (posType === 'forward' && (normalized === 'C' || normalized === 'LW' || normalized === 'RW')) {
        return 'F';
      }
      return normalized;
    };

    for (const player of players) {
      const pos = getPos(player);
      let assigned = false;

      if (pos !== 'UTIL' && slotsFilled[pos] < (slotsNeeded[pos] || 0)) {
        slotsFilled[pos]++;
        assigned = true;
        slotAssignments[String(player.player_id)] = `slot-${pos}-${slotsFilled[pos]}`;
      } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
        slotsFilled['UTIL']++;
        assigned = true;
        slotAssignments[String(player.player_id)] = 'slot-UTIL';
      }

      if (assigned) {
        starters.push(player.player_id);
      } else {
        bench.push(player.player_id);
      }
    }

    if (starters.length === 0) {
      logger.error('[buildLineupFromPlayers] No starters generated for team', teamId);
      return false;
    }

    logger.info('[buildLineupFromPlayers] Built lineup:', starters.length, 'starters,', bench.length, 'bench for team', teamId);

    // Save to team_lineups via admin (bypasses RLS for AI teams)
    const { error: upsertErr } = await admin
      .from('team_lineups')
      .upsert(
        {
          team_id: teamId,
          league_id: leagueId,
          starters,
          bench,
          ir: [],
          slot_assignments: slotAssignments,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'league_id,team_id' },
      );

    if (upsertErr) {
      logger.error('[buildLineupFromPlayers] team_lineups upsert error:', upsertErr);
      return false;
    }

    logger.info('[buildLineupFromPlayers] Saved team_lineups for team', teamId);
    return true;
  }

  /**
   * Backfill fantasy_daily_rosters for a team if any dates are missing.
   * This handles AI teams (or any team) whose lineup was INSERTed but the
   * auto-sync trigger only populated today+future dates, leaving past dates empty.
   *
   * If no team_lineups entry exists (common for AI teams), falls back to
   * roster_assignments + player_directory to build a default lineup, then
   * persists it to team_lineups so the INSERT trigger can fire for future matchups.
   *
   * Uses admin client to bypass RLS (AI teams have owner_id = NULL).
   */
  private async backfillDailyRostersIfMissing(
    teamId: string,
    matchupId: string,
    leagueId: string,
    weekStart: string,
    weekEnd: string,
    /**
     * PERF (2026-09-01): caller-provided lineup, when the caller has
     * already read team_lineups for this team (ensureMatchupRosters
     * does). Saves a duplicate read per team per request.
     */
    preloadedLineup?: {
      starters?: Array<number | string> | null;
      bench?: Array<number | string> | null;
      ir?: Array<number | string> | null;
      slot_assignments?: Record<string, string> | null;
    } | null,
  ) {
    const admin = getSupabaseAdmin();

    // Task 1B: refuse to fabricate rows for past dates. Historically this
    // path was called from ensureMatchupRosters on every Matchup-page view
    // and it happily materialised weeks of past dates from the CURRENT
    // team_lineups — the exact defect the 9,353-row 2026-04-04 burst
    // proved. Only today+future are eligible for backfill.
    //
    // PERF (2026-09-01): computed FIRST, because it is pure date math —
    // when the week is entirely in the past there is nothing this method
    // may ever write, and it used to spend three team_lineups reads and a
    // fantasy_daily_rosters read discovering that on every call.
    const today = getTodayMST();
    const dates: string[] = [];
    const start = new Date(weekStart + 'T00:00:00');
    const end = new Date(weekEnd + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().split('T')[0];
      if (iso < today) continue;
      dates.push(iso);
    }
    if (dates.length === 0) return;

    // One lineup read in the common case (zero when the caller already
    // has it); a second only when a missing lineup was just built.
    let finalLineup = preloadedLineup;
    if (!finalLineup) {
      const { data: lineup } = await admin
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments')
        .eq('team_id', teamId)
        .eq('league_id', leagueId)
        .maybeSingle();
      finalLineup = lineup;
    }

    // If no team_lineups entry, build one from roster_assignments, then
    // re-read what the build produced.
    if (!finalLineup?.starters || finalLineup.starters.length === 0) {
      const built = await this.buildAndSaveDefaultLineup(admin, teamId, leagueId);
      if (!built) return;
      const { data: rebuilt } = await admin
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments')
        .eq('team_id', teamId)
        .eq('league_id', leagueId)
        .maybeSingle();
      finalLineup = rebuilt;
    }

    if (!finalLineup?.starters || finalLineup.starters.length === 0) return;

    // Check which (player_id, roster_date) combos already exist
    const { data: existingRecords } = await admin
      .from('fantasy_daily_rosters')
      .select('roster_date, player_id')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId);

    const existingKeys = new Set(
      (existingRecords || []).map((r: { player_id: number; roster_date: string }) =>
        `${r.player_id}_${r.roster_date}`
      ),
    );

    // Build rows only for missing (player, date) combos
    const rows: Array<{
      league_id: string;
      team_id: string;
      matchup_id: string;
      player_id: number;
      roster_date: string;
      slot_type: string;
      slot_id: string | null;
      is_locked: boolean;
      source: string;
    }> = [];
    const slotAssignments = finalLineup.slot_assignments || {};

    const addRows = (playerIds: Array<number | string>, slotType: string, useSlot: boolean) => {
      for (const pid of playerIds || []) {
        const playerId = typeof pid === 'string' ? parseInt(pid, 10) : pid;
        for (const date of dates) {
          if (existingKeys.has(`${playerId}_${date}`)) continue;
          rows.push({
            league_id: leagueId,
            team_id: teamId,
            matchup_id: matchupId,
            player_id: playerId,
            roster_date: date,
            slot_type: slotType,
            slot_id: useSlot ? (slotAssignments[String(playerId)] || null) : null,
            is_locked: date < today, // Lock past dates
            // Task 1B: label provenance. Every write from this path is
            // reconstructed from the CURRENT team_lineups snapshot, not a
            // point-in-time record of what the user actually had rostered
            // on that date.
            source: 'reconstructed',
          });
        }
      }
    };

    addRows(finalLineup.starters, 'active', true);
    addRows(finalLineup.bench || [], 'bench', false);
    addRows(finalLineup.ir || [], 'ir', true);

    if (rows.length > 0) {
      const { error: upsertErr } = await admin
        .from('fantasy_daily_rosters')
        .upsert(rows, {
          onConflict: 'team_id,matchup_id,player_id,roster_date',
          ignoreDuplicates: true,
        });
      if (upsertErr) {
        logger.error('[backfillDailyRosters] upsert error:', upsertErr);
      }
    } else {
    }
  }

  /**
   * Ensure both teams in a matchup have team_lineups and fantasy_daily_rosters.
   * Called from the Matchup page BEFORE loading any roster data.
   * Handles AI teams that never had a lineup saved (RLS-blocked on frontend).
   */
  async ensureMatchupRosters(matchupId: string) {
    logger.info('[ensureMatchupRosters] START for matchup:', matchupId);
    const admin = getSupabaseAdmin();

    const { data: matchup, error: matchupError } = await admin
      .from('matchups')
      .select('team1_id, team2_id, week_start_date, week_end_date, league_id')
      .eq('id', matchupId)
      .single();

    if (matchupError || !matchup) {
      logger.error('[ensureMatchupRosters] Matchup not found:', matchupId, matchupError);
      return { initialized: 0 };
    }

    const teamIds = [matchup.team1_id, matchup.team2_id].filter(Boolean);

    // PERF (2026-09-04): the two teams are independent — different team_id,
    // different rows, no shared state — and this loop awaited them one after
    // the other. Every Matchup page view blocks on this endpoint before it may
    // read any roster (see apps/web/src/api/matchups.ts `ensureRosters`, which
    // measured it at ~1s a call), so the serial loop doubled the wait for no
    // reason. Run both teams together.
    const perTeam = async (teamId: string): Promise<number> => {
      // PERF (2026-09-01): read the FULL lineup once and hand it to the
      // backfill — this method used to read `starters` here, then the
      // backfill read the full lineup again, then a third time after a
      // build. One read per team in the steady state.
      const { data: lineup } = await admin
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments')
        .eq('team_id', teamId)
        .eq('league_id', matchup.league_id)
        .maybeSingle();

      let created = 0;
      let effectiveLineup = lineup;
      if (!lineup?.starters || (Array.isArray(lineup.starters) && lineup.starters.length === 0)) {
        logger.info('[ensureMatchupRosters] No lineup for team', teamId, '— building from roster_assignments');
        const built = await this.buildAndSaveDefaultLineup(admin, teamId, matchup.league_id);
        if (built) {
          created = 1;
          logger.info('[ensureMatchupRosters] Created lineup for team', teamId);
          // Let the backfill re-read the freshly built lineup itself.
          effectiveLineup = null;
        } else {
          logger.error('[ensureMatchupRosters] Failed to create lineup for team', teamId, '— no roster_assignments?');
        }
      }

      // Backfill fantasy_daily_rosters for any missing dates
      await this.backfillDailyRostersIfMissing(
        teamId, matchupId, matchup.league_id,
        matchup.week_start_date, matchup.week_end_date,
        effectiveLineup,
      );

      return created;
    };

    const createdCounts = await Promise.all(teamIds.map((teamId) => perTeam(teamId as string)));
    const initialized = createdCounts.reduce((sum, n) => sum + n, 0);

    return { initialized };
  }

  /** Get daily matchup scores via RPC (calls once per team, returns combined results) */
  async calculateDailyMatchupScores(matchupId: string) {
    // Use admin client for RPC calls — ensures SECURITY DEFINER functions
    // work correctly regardless of user JWT context. Critical for AI teams
    // (owner_id = NULL) whose fantasy_daily_rosters may not be visible
    // through user-scoped PostgREST connections.
    const admin = getSupabaseAdmin();

    // The RPC requires team_id + week dates, so look up the matchup first
    const { data: matchup, error: matchupError } = await admin
      .from('matchups')
      .select('team1_id, team2_id, week_start_date, week_end_date, league_id')
      .eq('id', matchupId)
      .single();

    if (matchupError || !matchup) {
      return { data: null, error: matchupError || { message: 'Matchup not found' } };
    }

    // Backfill fantasy_daily_rosters for teams missing entries (e.g. AI teams)
    await Promise.all([
      this.backfillDailyRostersIfMissing(
        matchup.team1_id, matchupId, matchup.league_id,
        matchup.week_start_date, matchup.week_end_date,
      ),
      matchup.team2_id
        ? this.backfillDailyRostersIfMissing(
            matchup.team2_id, matchupId, matchup.league_id,
            matchup.week_start_date, matchup.week_end_date,
          )
        : Promise.resolve(),
    ]);

    // Call the RPC for each team in parallel using admin client.
    //
    // _v2 is the data-driven scorer: it reads league_scoring_rules via
    // get_effective_scoring_rules instead of the twelve categories that the
    // legacy function hardcodes in its body. It was proven identical to the
    // legacy function on 532 team-days with 0 mismatches and totals equal to
    // the cent, so this switch is a no-op for every league that has not
    // changed its scoring.
    //
    // It is NOT optional, because persist_matchup_lines below already scores
    // through the rules table. Leaving the legacy call here means the moment a
    // commissioner enables one of the 23 new categories, the stored score and
    // its own line items disagree - measured at 173.700 stored vs 203.700 in
    // the breakdown - so the scoreboard contradicts the box score and
    // check_matchup_score_calibration (pg_cron job 28) fails every night.
    const [team1Result, team2Result] = await Promise.all([
      admin.rpc('calculate_daily_matchup_scores_v2', {
        p_matchup_id: matchupId,
        p_team_id: matchup.team1_id,
        p_week_start: matchup.week_start_date,
        p_week_end: matchup.week_end_date,
      }),
      matchup.team2_id
        ? admin.rpc('calculate_daily_matchup_scores_v2', {
            p_matchup_id: matchupId,
            p_team_id: matchup.team2_id,
            p_week_start: matchup.week_start_date,
            p_week_end: matchup.week_end_date,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (team1Result.error) {
      logger.error('[calculateDailyMatchupScores] team1 RPC error:', team1Result.error);
      return { data: null, error: team1Result.error };
    }
    if (team2Result.error) {
      logger.error('[calculateDailyMatchupScores] team2 RPC error:', team2Result.error);
      return { data: null, error: team2Result.error };
    }

    // Persist the per-player audit trail behind this score.
    //
    // fantasy_matchup_lines is read by getMatchupScores() and by
    // verify_matchup_scores(), and until 2026-08-11 nothing anywhere wrote it —
    // so every matchup had a score with nothing behind it and the verifier could
    // never pass. persist_matchup_lines is idempotent (it deletes and rewrites
    // this matchup's lines) and is granted to service_role only, so it must go
    // through the admin client.
    //
    // A failure here does NOT fail scoring: the score is still correct, we just
    // lost the explanation. But it must be loud, because a silent miss is what
    // let the table sit empty in the first place.
    const { error: linesError } = await admin.rpc('persist_matchup_lines', {
      p_matchup_id: matchupId,
    });
    if (linesError) {
      logger.error(
        '[calculateDailyMatchupScores] persist_matchup_lines failed — score is correct but its line items are now stale:',
        linesError,
      );
    }

    // Log RPC results for debugging AI team scoring issues
    const team1Sum = (team1Result.data || []).reduce((s: number, r: { daily_score?: string | number }) => s + parseFloat(String(r.daily_score || 0)), 0);
    const team2Sum = (team2Result.data || []).reduce((s: number, r: { daily_score?: string | number }) => s + parseFloat(String(r.daily_score || 0)), 0);
    logger.info(`[calculateDailyMatchupScores] matchup=${matchupId} team1=${matchup.team1_id} sum=${team1Sum.toFixed(1)} team2=${matchup.team2_id} sum=${team2Sum.toFixed(1)}`);

    // Combine results with team_id attached (frontend filters by team_id)
    const combined = [
      ...(team1Result.data || []).map((row: Record<string, unknown>) => ({ ...row, team_id: matchup.team1_id })),
      ...(team2Result.data || []).map((row: Record<string, unknown>) => ({ ...row, team_id: matchup.team2_id })),
    ];

    return { data: combined, error: null };
  }

  /** Get matchup stats for players via RPC */
  async getMatchupStats(playerIds: number[], startDate: string, endDate: string) {
    const { data, error } = await this.supabase.rpc('get_matchup_stats', {
      p_player_ids: playerIds,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    const statsMap = new Map<number, Record<string, unknown>>();
    for (const row of data || []) {
      statsMap.set(row.player_id, row);
    }

    return { statsMap, error };
  }

  /** Get daily projections for players on a date */
  async getDailyProjections(playerIds: number[], targetDate: string) {
    const { data, error } = await this.supabase.rpc('get_daily_projections', {
      p_player_ids: playerIds,
      p_target_date: targetDate,
    });

    const projMap = new Map<number, Record<string, unknown>>();
    for (const row of data || []) {
      projMap.set(row.player_id, row);
    }

    return { projMap, error };
  }

  /** Get daily lineup via RPC */
  async getDailyLineup(teamId: string, matchupId: string, date: string) {
    // Use admin client to bypass RLS — ensures AI team lineups are visible
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc('get_daily_lineup', {
      p_team_id: teamId,
      p_matchup_id: matchupId,
      p_date: date,
    });

    return { lineup: data || [], error };
  }

  /** Auto-complete matchups and update scores */
  async autoCompleteMatchups() {
    const { error } = await this.supabase.rpc('auto_complete_matchups');
    return { success: !error, error: error?.message };
  }

  /** H2H Category results via RPC */
  async getH2HCategoryResults(
    leagueId: string,
    matchupId: string,
    team1Id: string,
    team2Id: string,
    weekStart: string,
    weekEnd: string,
    categories: string[],
  ) {
    const { data, error } = await this.supabase.rpc('calculate_h2h_category_matchup', {
      p_league_id: leagueId,
      p_matchup_id: matchupId,
      p_team1_id: team1Id,
      p_team2_id: team2Id,
      p_week_start: weekStart,
      p_week_end: weekEnd,
      p_categories: categories,
    });

    return { results: data || [], error };
  }

  /** Roto standings via RPC */
  async getRotoStandings(leagueId: string, categories: string[], throughWeek?: number) {
    const { data, error } = await this.supabase.rpc('calculate_roto_standings', {
      p_league_id: leagueId,
      p_categories: categories,
      p_through_week: throughWeek || null,
    });

    return { standings: data || [], error };
  }

  /** PPG standings via RPC */
  async getPPGStandings(leagueId: string, throughWeek?: number) {
    const { data, error } = await this.supabase.rpc('calculate_ppg_standings', {
      p_league_id: leagueId,
      p_through_week: throughWeek || null,
    });

    return { standings: data || [], error };
  }

  /** Get daily game stats for players on a specific date */
  async getDailyGameStats(playerIds: number[], gameDate: string) {
    const { data, error } = await this.supabase.rpc('get_daily_game_stats', {
      p_player_ids: playerIds,
      p_game_date: gameDate,
    });

    return { stats: data || [], error };
  }

  /**
   * One player's whole game log over a date range, in ONE query.
   *
   * The Player Stats modal used to build this client-side by calling
   * /daily-game-stats once PER GAME DATE — up to 82 requests for a full
   * season, issued in nine serial batches of ten. On the ~350ms round trip a
   * phone sees, that is most of a minute to open a modal, and it is why "Game
   * Log takes a long ass time to open".
   *
   * player_game_stats carries `game_date` directly, so no join is needed.
   * Measured against production: 82 rows for a full season in 12.9ms.
   *
   * Only nhl_* columns are selected, matching get_daily_game_stats — those are
   * the official NHL numbers, and the PBP-derived columns beside them are not
   * interchangeable.
   */
  async getPlayerGameLog(playerId: number, startDate: string, endDate: string) {
    const { data, error } = await this.supabase
      .from('player_game_stats')
      .select(
        'player_id, game_id, game_date, is_goalie, nhl_goals, nhl_assists, nhl_points, ' +
        'nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_plus_minus, nhl_toi_seconds, ' +
        'nhl_ppp, nhl_shp, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced, ' +
        'nhl_goals_against, nhl_shutouts, nhl_save_pct'
      )
      .eq('player_id', playerId)
      .gte('game_date', startDate)
      .lte('game_date', endDate)
      .order('game_date', { ascending: true });

    /*
     * Return the SAME field names get_daily_game_stats returns.
     *
     * That RPC maps nhl_goals -> goals and so on, and everything downstream —
     * ScoringCalculator included — is written against those names. Handing back
     * raw columns here would mean every consumer either translating or silently
     * scoring zero, which is the quieter and worse of the two.
     */
    type RawGameRow = Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    const games = ((data || []) as unknown as RawGameRow[]).map((r) => ({
      player_id: r.player_id,
      game_id: r.game_id,
      game_date: r.game_date,
      is_goalie: Boolean(r.is_goalie),
      goals: n(r.nhl_goals),
      assists: n(r.nhl_assists),
      points: n(r.nhl_points),
      shots_on_goal: n(r.nhl_shots_on_goal),
      hits: n(r.nhl_hits),
      blocks: n(r.nhl_blocks),
      pim: n(r.nhl_pim),
      plus_minus: n(r.nhl_plus_minus),
      toi_seconds: n(r.nhl_toi_seconds),
      ppp: n(r.nhl_ppp),
      shp: n(r.nhl_shp),
      wins: n(r.nhl_wins),
      losses: n(r.nhl_losses),
      ot_losses: n(r.nhl_ot_losses),
      saves: n(r.nhl_saves),
      shots_faced: n(r.nhl_shots_faced),
      goals_against: n(r.nhl_goals_against),
      shutouts: n(r.nhl_shutouts),
      save_pct: typeof r.nhl_save_pct === 'number' ? r.nhl_save_pct : 0,
    }));

    return { games, error };
  }

  /**
   * One player's projections over a date range, in ONE query.
   *
   * Same shape of fix as getPlayerGameLog: the modal called
   * /daily-projections once per FUTURE game date.
   */
  async getPlayerProjectionLog(playerId: number, startDate: string, endDate: string) {
    const { data, error } = await this.supabase
      .from('player_projected_stats')
      .select(
        'player_id, projection_date, total_projected_points, projected_goals, projected_assists, ' +
        'projected_sog, projected_blocks, projected_hits, projected_pim, projected_ppp, projected_shp, ' +
        'projected_wins, projected_saves, projected_shutouts, projected_gaa, projected_save_pct, ' +
        'is_goalie, opponent_abbrev, is_home_game'
      )
      .eq('player_id', playerId)
      .gte('projection_date', startDate)
      .lte('projection_date', endDate)
      .order('projection_date', { ascending: true });

    return { projections: data || [], error };
  }

  /** Get frozen daily roster entries for a team/matchup/date */
  async getFrozenRoster(teamId: string, matchupId: string, date: string) {
    // Use admin client to bypass RLS — ensures AI team rosters are visible
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('fantasy_daily_rosters')
      .select('player_id, slot_type, slot_id')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId)
      .eq('roster_date', date);

    return { roster: data || [], error };
  }

  /** Get all frozen roster entries for a matchup (multiple dates) */
  async getFrozenRosterBatch(matchupId: string, dates: string[]) {
    const admin = getSupabaseAdmin();

    // First, try to backfill any teams missing entries (e.g. AI teams)
    const { data: matchup } = await admin
      .from('matchups')
      .select('team1_id, team2_id, week_start_date, week_end_date, league_id')
      .eq('id', matchupId)
      .single();

    if (matchup) {
      await Promise.all([
        this.backfillDailyRostersIfMissing(
          matchup.team1_id, matchupId, matchup.league_id,
          matchup.week_start_date, matchup.week_end_date,
        ),
        matchup.team2_id
          ? this.backfillDailyRostersIfMissing(
              matchup.team2_id, matchupId, matchup.league_id,
              matchup.week_start_date, matchup.week_end_date,
            )
          : Promise.resolve(),
      ]);
    }

    // Fetch frozen roster entries
    const { data: entries, error } = await admin
      .from('fantasy_daily_rosters')
      .select('player_id, team_id, roster_date, slot_type, slot_id')
      .eq('matchup_id', matchupId)
      .in('roster_date', dates);

    if (error || !entries || entries.length === 0) {
      return { entries: entries || [], error };
    }

    // Join with player_directory to return player details.
    // This eliminates the need for frontend enrichment, which fails for
    // AI teams whose roster_assignments are blocked by RLS.
    const uniquePlayerIds = [...new Set(entries.map((e: { player_id: number }) => Number(e.player_id)))];

    const { data: players } = await admin
      .from('player_directory')
      .select('player_id, full_name, position_code, is_goalie, team_abbrev, headshot_url')
      .eq('season', getCurrentSeason())
      .in('player_id', uniquePlayerIds);

    interface PlayerDirectoryRow {
      player_id: number;
      full_name: string;
      position_code: string;
      is_goalie: boolean;
      team_abbrev: string;
      headshot_url: string;
    }
    const playerMap = new Map<number, PlayerDirectoryRow>();
    (players || []).forEach((p: PlayerDirectoryRow) => {
      playerMap.set(Number(p.player_id), p);
    });

    // Enrich entries with player details
    const enrichedEntries = entries.map((entry: { player_id: number; team_id: string; roster_date: string; slot_type: string; slot_id: string | null }) => {
      const player = playerMap.get(Number(entry.player_id));
      return {
        ...entry,
        // Player details (used by frontend to render without enrichment)
        player_name: player?.full_name || '',
        player_position: player?.position_code || '',
        player_team: player?.team_abbrev || '',
        player_team_abbreviation: player?.team_abbrev || '',
        player_headshot_url: player?.headshot_url || '',
        player_is_goalie: player?.is_goalie || false,
      };
    });

    const withNames = enrichedEntries.filter((e: { player_name: string }) => e.player_name);
    logger.info(`[getFrozenRosterBatch] entries=${entries.length} playerDir=${players?.length || 0} enriched=${withNames.length}`);
    return { entries: enrichedEntries, error };
  }

  /** Lock completed days in fantasy_daily_rosters */
  async lockCompletedDays() {
    // Find all games that are 'final' (completed)
    const { data: finalGames, error: gamesError } = await this.supabase
      .from('nhl_games')
      .select('game_date')
      .eq('status', 'final');

    if (gamesError || !finalGames?.length) {
      return { lockedCount: 0, error: gamesError };
    }

    const gameDates = [...new Set(finalGames.map((g: { game_date: string }) => g.game_date))];

    const { data: updated, error: updateError } = await this.supabase
      .from('fantasy_daily_rosters')
      .update({
        is_locked: true,
        locked_at: new Date().toISOString(),
      })
      .in('roster_date', gameDates)
      .eq('is_locked', false)
      .select('player_id');

    return { lockedCount: updated?.length || 0, error: updateError };
  }

  /** Get matchup score job status */
  async getJobStatus() {
    const [matchupResult, lockedResult, recentResult] = await Promise.all([
      this.supabase
        .from('matchups')
        .select(COLUMNS.COUNT, { count: 'exact', head: true })
        .in('status', ['scheduled', 'in_progress']),
      this.supabase
        .from('fantasy_daily_rosters')
        .select(COLUMNS.COUNT, { count: 'exact', head: true })
        .eq('is_locked', true),
      this.supabase
        .from('matchups')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      lastRun: recentResult.data?.updated_at || null,
      totalMatchups: matchupResult.count || 0,
      lockedDays: lockedResult.count || 0,
    };
  }

  /**
   * Task 1A: scheduled daily-roster snapshot for TODAY only.
   *
   * Walks every active matchup that spans today (week_start_date <= today
   * <= week_end_date), enumerates each team, and materialises one
   * fantasy_daily_rosters row per player from the CURRENT team_lineups —
   * labelled source='scheduled_snapshot'. Idempotent: an existing row for
   * (team, matchup, player, roster_date) with source='user_edit' or
   * source='reconstructed' is left untouched by the ON CONFLICT clause;
   * existing scheduled_snapshot rows for the same key that are still
   * unlocked get their slot/lock state refreshed from the current lineup.
   *
   * Coverage assertion: the return value carries expected_team_matchups
   * (from the active-matchup enumeration) and actual_team_matchups_written
   * (from the actual UPSERT loop). The caller (route handler) must
   * compare these and RAISE if they disagree — silent partial writes here
   * are the exact defect this task exists to eliminate.
   *
   * Uses the admin client throughout because the cron entry point has no
   * user JWT (bearer secret only).
   */
  async snapshotTodayForAllLeagues(): Promise<{
    date: string;
    expected_team_matchups: number;
    actual_team_matchups_written: number;
    leagues_touched: number;
    rows_written: number;
    errors: Array<{ team_id?: string; matchup_id?: string; league_id?: string; error: string }>;
  }> {
    const admin = getSupabaseAdmin();
    const today = getTodayMST();

    // 1. Enumerate every matchup that spans today, joining team ids +
    //    league id in one round-trip.
    const { data: matchups, error: mErr } = await admin
      .from('matchups')
      .select('id, league_id, team1_id, team2_id, week_start_date, week_end_date')
      .lte('week_start_date', today)
      .gte('week_end_date', today);
    if (mErr) {
      throw new Error(`[snapshotTodayForAllLeagues] enumerate matchups: ${mErr.message}`);
    }
    if (!matchups || matchups.length === 0) {
      return {
        date: today, expected_team_matchups: 0, actual_team_matchups_written: 0,
        leagues_touched: 0, rows_written: 0, errors: [],
      };
    }

    // Deduplicated set of (team, matchup) pairs we should touch
    const pairs: Array<{ team_id: string; matchup_id: string; league_id: string }> = [];
    for (const m of matchups as Array<{
      id: string; league_id: string; team1_id: string | null; team2_id: string | null;
    }>) {
      for (const tid of [m.team1_id, m.team2_id]) {
        if (!tid) continue;
        pairs.push({ team_id: tid, matchup_id: m.id, league_id: m.league_id });
      }
    }
    const expected_team_matchups = pairs.length;
    const league_ids = new Set(pairs.map(p => p.league_id));

    // 2. Prefetch current base lineups for every unique team in the set.
    const uniqueTeamIds = [...new Set(pairs.map(p => p.team_id))];
    const { data: lineups, error: lErr } = await admin
      .from('team_lineups')
      .select('team_id, league_id, starters, bench, ir, slot_assignments')
      .in('team_id', uniqueTeamIds);
    if (lErr) {
      throw new Error(`[snapshotTodayForAllLeagues] read team_lineups: ${lErr.message}`);
    }
    const lineupByTeam = new Map<string, { starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> }>();
    for (const l of (lineups || []) as Array<{
      team_id: string; starters: unknown; bench: unknown; ir: unknown; slot_assignments: unknown;
    }>) {
      lineupByTeam.set(l.team_id, {
        starters: ((l.starters as unknown[]) || []).map(String),
        bench: ((l.bench as unknown[]) || []).map(String),
        ir: ((l.ir as unknown[]) || []).map(String),
        slot_assignments: (l.slot_assignments as Record<string, string>) || {},
      });
    }

    // 3. For each (team, matchup) build a single UPSERT batch for today's
    //    date and write with source='scheduled_snapshot'. Idempotency is
    //    handled by ON CONFLICT — we do NOT DELETE first (unlike the
    //    per-day user-edit path), because we must not overwrite a locked
    //    row or a user_edit row that was already written today.
    const rowsToWrite: Array<Record<string, unknown>> = [];
    const errors: Array<{ team_id?: string; matchup_id?: string; league_id?: string; error: string }> = [];
    let actual_team_matchups_written = 0;

    for (const p of pairs) {
      let lineup = lineupByTeam.get(p.team_id);

      // No base lineup: BUILD one, rather than skipping the team.
      //
      // The interactive path (backfillDailyRostersIfMissing) has always done
      // this. The scheduled path did not — it recorded an error and continued,
      // which drops actual_team_matchups_written below expected and makes
      // /api/scheduled/roster-snapshot-today return 500. So one condition
      // self-healed whenever somebody opened the Matchup page, and paged at
      // 02:00 MT when nobody was awake to open anything. On opening night the
      // difference is whether a team has a roster or silently scores zero.
      if (!lineup || (lineup.starters.length + lineup.bench.length + lineup.ir.length === 0)) {
        const built = await this.buildAndSaveDefaultLineup(admin, p.team_id, p.league_id);
        if (built) {
          const { data: fresh } = await admin
            .from('team_lineups')
            .select('starters, bench, ir, slot_assignments')
            .eq('team_id', p.team_id)
            .eq('league_id', p.league_id)
            .maybeSingle();
          if (fresh) {
            lineup = {
              starters: ((fresh.starters as unknown[]) || []).map(String),
              bench: ((fresh.bench as unknown[]) || []).map(String),
              ir: ((fresh.ir as unknown[]) || []).map(String),
              slot_assignments: (fresh.slot_assignments as Record<string, string>) || {},
            };
            lineupByTeam.set(p.team_id, lineup);
            logger.info('[snapshotTodayForAllLeagues] built default lineup for team', p.team_id);
          }
        }
      }

      // Still nothing to snapshot. A team with neither a lineup nor any roster
      // assignment is a real finding, not a transient, so it must still break
      // the coverage assertion loudly rather than pass quietly.
      if (!lineup || (lineup.starters.length + lineup.bench.length + lineup.ir.length === 0)) {
        errors.push({ ...p, error: 'no team_lineups entry, and no roster_assignments to build one from' });
        continue;
      }
      const addRows = (playerIds: string[], slotType: string) => {
        for (const pid of playerIds) {
          const playerId = parseInt(pid, 10);
          if (isNaN(playerId)) continue;
          rowsToWrite.push({
            league_id: p.league_id,
            team_id: p.team_id,
            matchup_id: p.matchup_id,
            player_id: playerId,
            roster_date: today,
            slot_type: slotType,
            slot_id: slotType !== 'bench' ? (lineup.slot_assignments[pid] || null) : null,
            is_locked: false,
            locked_at: null,
            source: 'scheduled_snapshot',
          });
        }
      };
      addRows(lineup.starters, 'active');
      addRows(lineup.bench, 'bench');
      addRows(lineup.ir, 'ir');
      actual_team_matchups_written += 1;
    }

    // Single-batch UPSERT. ignoreDuplicates:true means a row that already
    // exists for (team, matchup, player, roster_date) is left as-is —
    // this preserves both is_locked=true rows AND user_edit / reconstructed
    // rows that were written earlier for the same key.
    let rows_written = 0;
    if (rowsToWrite.length > 0) {
      const { error: wErr } = await admin
        .from('fantasy_daily_rosters')
        .upsert(rowsToWrite, {
          onConflict: 'team_id,matchup_id,player_id,roster_date',
          ignoreDuplicates: true,
        });
      if (wErr) {
        throw new Error(`[snapshotTodayForAllLeagues] upsert: ${wErr.message}`);
      }
      rows_written = rowsToWrite.length;
    }

    return {
      date: today,
      expected_team_matchups,
      actual_team_matchups_written,
      leagues_touched: league_ids.size,
      rows_written,
      errors,
    };
  }
}
