/**
 * ScoresService — the day's NHL scoreboard, with Citrus projections attached.
 *
 * Every read here goes through `pagedSelect` with an explicit column list.
 * PostgREST silently clamps an unbounded `.select()` to 1,000 rows and answers
 * 200 with a truncated body; that has already shipped two production bugs in
 * this repo. A full slate is ~16 games x ~50 projections = ~800 rows, which is
 * close enough to the cap that an unpaged read would start losing players the
 * first time the league expands or the pipeline adds a row per player.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS SERVICE REFUSES TO DO, AND WHY (schema audited 2026-09-02, prod)
 *
 *   · A SCHEDULED GAME HAS NO SCORE. `nhl_games` stores 0, not NULL, in
 *     home_score/away_score on all 1,344 scheduled rows. Passing those
 *     through would render "0 - 0" for a game that has not been played.
 *     `scoreOrNull()` nulls both sides for any state that is not live or
 *     final, and the client renders the start time in that space instead.
 *
 *   · AN ABSENT STAT LINE IS NOT A ZERO. `player_game_stats` holds seasons
 *     2017 through 2025 and has no 2026 row at all, so every game the app
 *     can show today has no actuals. `actualPoints` stays null in that case
 *     rather than being zero-filled, because a zero asserts the player
 *     dressed and did nothing.
 *
 *   · NO ODDS. moneyline_* and implied_win_probability_* are NULL on all
 *     2,738 rows. They are not selected and not sent.
 *
 *   · NO STARTER, NO INJURY. starter_confirmed is false and injury_status is
 *     'healthy' on all 66,024 season-2026 projection rows. Neither is
 *     surfaced as a badge. The service instead reports goalie counts per team
 *     so the UI can say "starter not confirmed" where two goalies from one
 *     club project within noise of each other, which is what the data
 *     actually means.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ScoringCalculator,
  DEFAULT_SCORING,
  normalizeGameState,
  type ScoringSettings,
  type GameState,
  type ScoreboardGame,
  type ScoreboardTeam,
  type ScoresDayResponse,
  type ScoresGameCitrus,
  type ScoresGameDetailResponse,
  type ScoresPlayerActuals,
  type ScoresPlayerLine,
} from '@citrus/shared';
import { pagedSelect } from '../lib/pagedSelect';

// ── Column lists. Explicit, never `*`. ──────────────────────────────────

const GAME_COLUMNS =
  'game_id, game_date, game_time, home_team, away_team, home_score, away_score, ' +
  'status, period, period_time, venue, season, game_type, home_team_id, away_team_id';

const TEAM_COLUMNS = 'team_id, abbreviation, city, name';

const PROJECTION_COLUMNS =
  'player_id, game_id, season, is_goalie, total_projected_points, confidence_label, updated_at';

const DIRECTORY_COLUMNS =
  'player_id, full_name, team_abbrev, position_code, is_goalie, headshot_url';

const ACTUAL_COLUMNS =
  'game_id, player_id, is_goalie, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, ' +
  'nhl_blocks, nhl_hits, nhl_ppp, nhl_shp, nhl_pim, nhl_plus_minus, nhl_toi_seconds, ' +
  'nhl_saves, nhl_goals_against, nhl_wins, nhl_shutouts';

const ROSTER_COLUMNS = 'id, league_id, team_id, player_id';

const FANTASY_TEAM_COLUMNS = 'id, league_id, owner_id, team_name';

const LEAGUE_SCORING_COLUMNS = 'id, scoring_settings';

/**
 * How many player lines ride along in a collapsed row. Three fits the 393px
 * phone width beside the score block without wrapping; the rest are one tap
 * away in the expanded panel.
 */
const ROW_PLAYER_LIMIT = 3;

/** Hard ceilings so one pathological day cannot page forever. */
const MAX_GAMES_PER_DAY = 40;
const MAX_PROJECTION_ROWS = 5000;

/** How far the empty state looks for the nearest day that has games. */
const NEAREST_LOOKUP_DAYS = 400;

// ── Row shapes as they come off PostgREST ───────────────────────────────

interface GameRow {
  game_id: number;
  game_date: string;
  game_time: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  period: string | null;
  period_time: string | null;
  venue: string | null;
  season: number;
  game_type: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
}

interface TeamRow {
  team_id: number;
  abbreviation: string;
  city: string | null;
  name: string | null;
}

interface ProjectionRow {
  player_id: number;
  game_id: number;
  season: number;
  is_goalie: boolean;
  total_projected_points: number | string | null;
  confidence_label: string | null;
  updated_at: string | null;
}

interface DirectoryRow {
  player_id: number;
  full_name: string;
  team_abbrev: string | null;
  position_code: string | null;
  is_goalie: boolean;
  headshot_url: string | null;
}

interface ActualRow {
  game_id: number;
  player_id: number;
  is_goalie: boolean;
  nhl_goals: number;
  nhl_assists: number;
  nhl_points: number;
  nhl_shots_on_goal: number;
  nhl_blocks: number;
  nhl_hits: number;
  nhl_ppp: number;
  nhl_shp: number;
  nhl_pim: number;
  nhl_plus_minus: number;
  nhl_toi_seconds: number;
  nhl_saves: number;
  nhl_goals_against: number;
  nhl_wins: number;
  nhl_shutouts: number;
}

interface RosterRow {
  id: string;
  league_id: string;
  team_id: string;
  /** TEXT in the database, integer everywhere else. Coerced, never trusted. */
  player_id: string;
}

interface FantasyTeamRow {
  id: string;
  league_id: string;
  owner_id: string | null;
  team_name: string | null;
}

export interface ScoresQueryOptions {
  /** When set, roster context is attached and the caller has verified membership. */
  leagueId?: string | null;
  /** The requesting user, used only to mark which rostered players are theirs. */
  userId?: string | null;
}

// ── Pure helpers, exported for the tests ────────────────────────────────

/**
 * A score is only real once the game has started.
 *
 * `nhl_games` writes 0/0 on scheduled rows, so this is the single gate that
 * stops a fabricated 0-0 reaching the screen. 'postponed' and 'unknown' get
 * nulls for the same reason: we have no basis for a number.
 */
export function scoreOrNull(state: GameState, value: number | null | undefined): number | null {
  if (state !== 'live' && state !== 'final') return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Numeric coercion that answers null for anything that is not a real number. */
export function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Shift a YYYY-MM-DD date string by whole days without touching a timezone. */
export function shiftIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, (m || 1) - 1, d || 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Reject anything that is not exactly YYYY-MM-DD before it reaches a query. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
}

/**
 * Ordering for the player lines a row surfaces.
 *
 * Your own players first, then anyone rostered in the league, then the
 * highest projection in the game. When no league is in play only the last
 * key does any work, which is the right answer for a signed-in user with no
 * league selected: show the best players on the ice.
 */
export function comparePlayerLines(a: ScoresPlayerLine, b: ScoresPlayerLine): number {
  const mine = Number(Boolean(b.roster?.isMine)) - Number(Boolean(a.roster?.isMine));
  if (mine !== 0) return mine;
  const rostered = Number(Boolean(b.roster)) - Number(Boolean(a.roster));
  if (rostered !== 0) return rostered;
  const bp = b.projectedPoints ?? -Infinity;
  const ap = a.projectedPoints ?? -Infinity;
  if (bp !== ap) return bp - ap;
  return a.playerId - b.playerId;
}

/** Bucket the confidence labels the pipeline writes. Anything else is unlabeled. */
export function tallyConfidence(labels: Array<string | null>): ScoresGameCitrus['confidence'] {
  const out = { high: 0, medium: 0, low: 0, unlabeled: 0 };
  for (const raw of labels) {
    switch ((raw ?? '').trim().toLowerCase()) {
      case 'high':
        out.high++;
        break;
      case 'medium':
        out.medium++;
        break;
      case 'low':
        out.low++;
        break;
      default:
        out.unlabeled++;
    }
  }
  return out;
}

/** Map a `player_game_stats` row onto the shape `ScoringCalculator` reads. */
export function actualsToStatBag(row: ActualRow): Record<string, number> {
  if (row.is_goalie) {
    return {
      wins: row.nhl_wins ?? 0,
      saves: row.nhl_saves ?? 0,
      shutouts: row.nhl_shutouts ?? 0,
      goals_against: row.nhl_goals_against ?? 0,
    };
  }
  return {
    goals: row.nhl_goals ?? 0,
    assists: row.nhl_assists ?? 0,
    ppp: row.nhl_ppp ?? 0,
    shp: row.nhl_shp ?? 0,
    shots_on_goal: row.nhl_shots_on_goal ?? 0,
    blocks: row.nhl_blocks ?? 0,
    hits: row.nhl_hits ?? 0,
    pim: row.nhl_pim ?? 0,
    plus_minus: row.nhl_plus_minus ?? 0,
  };
}

function toActuals(row: ActualRow): ScoresPlayerActuals {
  return {
    goals: row.nhl_goals ?? 0,
    assists: row.nhl_assists ?? 0,
    points: row.nhl_points ?? 0,
    shotsOnGoal: row.nhl_shots_on_goal ?? 0,
    blocks: row.nhl_blocks ?? 0,
    hits: row.nhl_hits ?? 0,
    ppp: row.nhl_ppp ?? 0,
    toiSeconds: row.nhl_toi_seconds ?? 0,
    saves: row.is_goalie ? (row.nhl_saves ?? 0) : null,
    goalsAgainst: row.is_goalie ? (row.nhl_goals_against ?? 0) : null,
    wins: row.is_goalie ? (row.nhl_wins ?? 0) : null,
    shutouts: row.is_goalie ? (row.nhl_shutouts ?? 0) : null,
  };
}

// ── The service ─────────────────────────────────────────────────────────

export class ScoresService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** The full scoreboard for one Mountain-Time date. */
  async getDay(
    date: string,
    options: ScoresQueryOptions = {},
  ): Promise<{ result: ScoresDayResponse | null; error: { message: string } | null }> {
    if (!isIsoDate(date)) {
      return { result: null, error: { message: 'date must be YYYY-MM-DD' } };
    }

    const gamesRead = await pagedSelect<GameRow>(this.supabase, {
      table: 'nhl_games',
      columns: GAME_COLUMNS,
      filters: [['game_date', date]],
      orderBy: ['game_id'],
      maxRows: MAX_GAMES_PER_DAY,
    });
    if (gamesRead.error) return { result: null, error: gamesRead.error };

    const rows = gamesRead.data;

    if (rows.length === 0) {
      const nearest = await this.findNearestDates(date);
      return {
        result: {
          date,
          games: [],
          nearestDateWithGames: nearest,
          league: { id: options.leagueId ?? null, rostersResolved: false },
          truncated: false,
          generatedAt: new Date().toISOString(),
        },
        error: null,
      };
    }

    const built = await this.buildGames(rows, options, ROW_PLAYER_LIMIT);
    if (built.error) return { result: null, error: built.error };

    return {
      result: {
        date,
        games: built.games,
        nearestDateWithGames: { before: null, after: null },
        league: { id: options.leagueId ?? null, rostersResolved: built.rostersResolved },
        truncated: gamesRead.truncated || built.truncated,
        generatedAt: new Date().toISOString(),
      },
      error: null,
    };
  }

  /** One game, with every projected player in it rather than the row's top few. */
  async getGameDetail(
    gameId: number,
    options: ScoresQueryOptions = {},
  ): Promise<{ result: ScoresGameDetailResponse | null; error: { message: string } | null }> {
    if (!Number.isInteger(gameId)) {
      return { result: null, error: { message: 'gameId must be an integer' } };
    }

    const gamesRead = await pagedSelect<GameRow>(this.supabase, {
      table: 'nhl_games',
      columns: GAME_COLUMNS,
      filters: [['game_id', gameId]],
      orderBy: ['game_id'],
      maxRows: 1,
    });
    if (gamesRead.error) return { result: null, error: gamesRead.error };
    if (gamesRead.data.length === 0) return { result: null, error: null };

    const built = await this.buildGames(gamesRead.data, options, Infinity);
    if (built.error) return { result: null, error: built.error };

    const game = built.games[0];
    return {
      result: {
        game,
        players: game.citrus?.players ?? [],
        league: { id: options.leagueId ?? null, rostersResolved: built.rostersResolved },
        truncated: built.truncated,
        generatedAt: new Date().toISOString(),
      },
      error: null,
    };
  }

  /**
   * Nearest dates on either side of an empty day that DO have games.
   *
   * Two bounded single-row lookups rather than `pagedSelect`: the failure
   * mode that helper exists to prevent is an UNBOUNDED select being clamped
   * to 1,000 rows without saying so, and `.limit(1)` cannot be clamped to
   * anything smaller than what it asked for.
   */
  private async findNearestDates(date: string): Promise<{ before: string | null; after: string | null }> {
    const floor = shiftIsoDate(date, -NEAREST_LOOKUP_DAYS);
    const ceil = shiftIsoDate(date, NEAREST_LOOKUP_DAYS);

    const [beforeRes, afterRes] = await Promise.all([
      this.supabase
        .from('nhl_games')
        .select('game_date')
        .gte('game_date', floor)
        .lt('game_date', date)
        .order('game_date', { ascending: false })
        .limit(1),
      this.supabase
        .from('nhl_games')
        .select('game_date')
        .gt('game_date', date)
        .lte('game_date', ceil)
        .order('game_date', { ascending: true })
        .limit(1),
    ]);

    const pick = (res: { data: unknown }): string | null => {
      const list = (res.data ?? []) as Array<{ game_date?: string }>;
      return list.length > 0 && typeof list[0].game_date === 'string' ? list[0].game_date : null;
    };

    return { before: pick(beforeRes), after: pick(afterRes) };
  }

  /**
   * Assemble game rows plus their Citrus panels.
   *
   * Six reads, all paged, all keyed off the game list: teams, projections,
   * the directory for the players those projections name, actuals, and (only
   * when a league is in play) that league's rosters, fantasy teams and
   * scoring settings.
   */
  private async buildGames(
    rows: GameRow[],
    options: ScoresQueryOptions,
    perGameLimit: number,
  ): Promise<{
    games: ScoreboardGame[];
    rostersResolved: boolean;
    truncated: boolean;
    error: { message: string } | null;
  }> {
    const empty = { games: [], rostersResolved: false, truncated: false };
    const gameIds = rows.map((r) => r.game_id);
    const seasons = Array.from(new Set(rows.map((r) => r.season)));

    const [teamsRead, projectionsRead, actualsRead] = await Promise.all([
      pagedSelect<TeamRow>(this.supabase, {
        table: 'nhl_teams',
        columns: TEAM_COLUMNS,
        orderBy: ['team_id'],
      }),
      pagedSelect<ProjectionRow>(this.supabase, {
        table: 'player_projected_stats',
        columns: PROJECTION_COLUMNS,
        inFilters: [['game_id', gameIds]],
        orderBy: ['game_id', 'player_id'],
        maxRows: MAX_PROJECTION_ROWS,
      }),
      pagedSelect<ActualRow>(this.supabase, {
        table: 'player_game_stats',
        columns: ACTUAL_COLUMNS,
        inFilters: [['game_id', gameIds]],
        orderBy: ['game_id', 'player_id'],
        maxRows: MAX_PROJECTION_ROWS,
      }),
    ]);

    if (teamsRead.error) return { ...empty, error: teamsRead.error };
    if (projectionsRead.error) return { ...empty, error: projectionsRead.error };
    if (actualsRead.error) return { ...empty, error: actualsRead.error };

    // One projection per (player, game). The audited table holds exactly one
    // already; the newest-wins tiebreak is defence against a backfill that
    // leaves two, which would otherwise double-count a player in the panel.
    const projByGame = new Map<number, Map<number, ProjectionRow>>();
    for (const p of projectionsRead.data) {
      let forGame = projByGame.get(p.game_id);
      if (!forGame) {
        forGame = new Map();
        projByGame.set(p.game_id, forGame);
      }
      const prev = forGame.get(p.player_id);
      if (!prev || String(p.updated_at ?? '') > String(prev.updated_at ?? '')) {
        forGame.set(p.player_id, p);
      }
    }

    /**
     * The directory is read BY SEASON, not by the ~800 player ids a full
     * slate names. A 16-game night projects roughly 800 distinct players, and
     * an `IN` list of that many ids puts about 7KB of query string on a GET,
     * which is close enough to the usual 8KB proxy limit that the first
     * expanded slate would start answering 414. The whole season directory is
     * 820 rows (season 2026), so reading it and matching in memory is both
     * smaller on the wire and one less way for the panel to go blank.
     */
    const directoryRead = projectionsRead.data.length
      ? await pagedSelect<DirectoryRow>(this.supabase, {
          table: 'player_directory',
          columns: DIRECTORY_COLUMNS,
          inFilters: [['season', seasons]],
          orderBy: ['season', 'player_id'],
          maxRows: MAX_PROJECTION_ROWS,
        })
      : { data: [] as DirectoryRow[], error: null, truncated: false };
    if (directoryRead.error) return { ...empty, error: directoryRead.error };

    const roster = await this.loadRosterContext(options);
    if (roster.error) return { ...empty, error: roster.error };

    const teamByAbbrev = new Map(teamsRead.data.map((t) => [t.abbreviation, t]));
    const directory = new Map(directoryRead.data.map((d) => [d.player_id, d]));
    const actualsByGame = new Map<number, Map<number, ActualRow>>();
    for (const a of actualsRead.data) {
      let forGame = actualsByGame.get(a.game_id);
      if (!forGame) {
        forGame = new Map();
        actualsByGame.set(a.game_id, forGame);
      }
      forGame.set(a.player_id, a);
    }

    const scorer = new ScoringCalculator(roster.scoring);

    const games = rows.map((row) =>
      this.assembleGame(row, {
        teamByAbbrev,
        projections: projByGame.get(row.game_id) ?? new Map(),
        actuals: actualsByGame.get(row.game_id) ?? new Map(),
        directory,
        roster,
        scorer,
        perGameLimit,
      }),
    );

    return {
      games,
      rostersResolved: roster.resolved,
      truncated:
        teamsRead.truncated ||
        projectionsRead.truncated ||
        actualsRead.truncated ||
        directoryRead.truncated,
      error: null,
    };
  }

  /**
   * The requested league's rosters, team names and scoring settings.
   *
   * Returns an inert context when no league was requested, so every caller
   * below can stay branch-free. `roster_assignments.player_id` is TEXT while
   * every other player id in the system is an integer; it is coerced here
   * once and any row that will not coerce is dropped rather than matched
   * against a NaN.
   */
  private async loadRosterContext(options: ScoresQueryOptions): Promise<{
    resolved: boolean;
    byPlayer: Map<number, { teamId: string; teamName: string | null; isMine: boolean }>;
    scoring: ScoringSettings;
    error: { message: string } | null;
  }> {
    const inert = {
      resolved: false,
      byPlayer: new Map<number, { teamId: string; teamName: string | null; isMine: boolean }>(),
      scoring: DEFAULT_SCORING,
      error: null,
    };
    const leagueId = options.leagueId;
    if (!leagueId) return inert;

    const [rosterRead, teamRead, leagueRead] = await Promise.all([
      pagedSelect<RosterRow>(this.supabase, {
        table: 'roster_assignments',
        columns: ROSTER_COLUMNS,
        filters: [['league_id', leagueId]],
        orderBy: ['id'],
      }),
      pagedSelect<FantasyTeamRow>(this.supabase, {
        table: 'teams',
        columns: FANTASY_TEAM_COLUMNS,
        filters: [['league_id', leagueId]],
        orderBy: ['id'],
      }),
      pagedSelect<{ id: string; scoring_settings: ScoringSettings | null }>(this.supabase, {
        table: 'leagues',
        columns: LEAGUE_SCORING_COLUMNS,
        filters: [['id', leagueId]],
        orderBy: ['id'],
        maxRows: 1,
      }),
    ]);

    if (rosterRead.error) return { ...inert, error: rosterRead.error };
    if (teamRead.error) return { ...inert, error: teamRead.error };
    if (leagueRead.error) return { ...inert, error: leagueRead.error };

    const teamById = new Map(teamRead.data.map((t) => [t.id, t]));
    const byPlayer = new Map<number, { teamId: string; teamName: string | null; isMine: boolean }>();
    for (const r of rosterRead.data) {
      const pid = Number(r.player_id);
      if (!Number.isInteger(pid)) continue;
      const team = teamById.get(r.team_id);
      byPlayer.set(pid, {
        teamId: r.team_id,
        teamName: team?.team_name ?? null,
        isMine: Boolean(options.userId && team?.owner_id === options.userId),
      });
    }

    const scoring = leagueRead.data[0]?.scoring_settings ?? DEFAULT_SCORING;

    return { resolved: rosterRead.data.length > 0, byPlayer, scoring, error: null };
  }

  /** One `nhl_games` row plus its projections, actuals and roster context. */
  private assembleGame(
    row: GameRow,
    ctx: {
      teamByAbbrev: Map<string, TeamRow>;
      projections: Map<number, ProjectionRow>;
      actuals: Map<number, ActualRow>;
      directory: Map<number, DirectoryRow>;
      roster: { byPlayer: Map<number, { teamId: string; teamName: string | null; isMine: boolean }> };
      scorer: ScoringCalculator;
      perGameLimit: number;
    },
  ): ScoreboardGame {
    const state = normalizeGameState(row.status);

    const side = (abbrev: string, teamId: number | null): ScoreboardTeam => {
      const t = ctx.teamByAbbrev.get(abbrev);
      return {
        abbrev,
        teamId: teamId ?? t?.team_id ?? null,
        city: t?.city ?? null,
        name: t?.name ?? null,
      };
    };

    const lines: ScoresPlayerLine[] = [];
    for (const proj of ctx.projections.values()) {
      const dir = ctx.directory.get(proj.player_id);
      const actual = ctx.actuals.get(proj.player_id) ?? null;
      const rosterRef = ctx.roster.byPlayer.get(proj.player_id) ?? null;

      lines.push({
        playerId: proj.player_id,
        // A projection for a player the directory does not carry still counts
        // toward the game's totals, but it cannot be named, so it is not
        // given a made-up one.
        name: dir?.full_name ?? `Player ${proj.player_id}`,
        teamAbbrev: dir?.team_abbrev ?? null,
        position: dir?.position_code ?? null,
        isGoalie: Boolean(proj.is_goalie ?? dir?.is_goalie),
        headshotUrl: dir?.headshot_url ?? null,
        projectedPoints: toNumberOrNull(proj.total_projected_points),
        confidenceLabel: proj.confidence_label ?? null,
        actualPoints: actual
          ? ctx.scorer.calculatePoints(actualsToStatBag(actual), Boolean(actual.is_goalie))
          : null,
        actuals: actual ? toActuals(actual) : null,
        roster: rosterRef,
      });
    }

    lines.sort(comparePlayerLines);

    const rosteredCount = ctx.roster.byPlayer.size > 0
      ? lines.filter((l) => l.roster !== null).length
      : null;
    const myCount = ctx.roster.byPlayer.size > 0
      ? lines.filter((l) => l.roster?.isMine).length
      : null;

    const citrus: ScoresGameCitrus | null = lines.length
      ? {
          projectedPlayers: lines.length,
          players: Number.isFinite(ctx.perGameLimit)
            ? lines.slice(0, ctx.perGameLimit)
            : lines,
          rosteredCount,
          myCount,
          confidence: tallyConfidence(lines.map((l) => l.confidenceLabel)),
          hasActuals: lines.some((l) => l.actualPoints !== null),
        }
      : null;

    return {
      gameId: row.game_id,
      gameDate: row.game_date,
      startsAt: row.game_time ?? null,
      state,
      statusRaw: row.status ?? null,
      period: row.period ?? null,
      periodTime: row.period_time ?? null,
      venue: row.venue ?? null,
      gameType: row.game_type ?? null,
      season: row.season,
      away: side(row.away_team, row.away_team_id),
      home: side(row.home_team, row.home_team_id),
      awayScore: scoreOrNull(state, row.away_score),
      homeScore: scoreOrNull(state, row.home_score),
      citrus,
    };
  }
}
