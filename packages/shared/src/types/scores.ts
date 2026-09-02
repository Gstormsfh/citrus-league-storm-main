/**
 * THE SCORES WIRE CONTRACT — one shape for `GET /api/scores`, shared by the
 * Hono server that produces it and the React screen that renders it.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RESEARCH: WHAT THE LAYOUT IS COPIED FROM, AND WHY
 *
 * The founder named theScore-style apps as the reference. What was taken is
 * the INFORMATION ARCHITECTURE, not assets and not copy. Each borrowed idea,
 * and the reason it is worth borrowing:
 *
 * 1. A HORIZONTAL DATE STRIP pinned above the list, today anchored.
 *    Confirmed on the CBS Sports NHL scoreboard, which renders a horizontal
 *    date picker spanning the season; theScore and ESPN use the swipeable
 *    equivalent. Worth copying because a scores screen is one query over one
 *    day: the day is the primary axis, so it earns persistent chrome rather
 *    than a dropdown the user has to open to find out where they are.
 *
 * 2. AWAY ON TOP, HOME BELOW. CBS renders "visiting team first, then home
 *    team". Universal in North American scoreboards because it is the order
 *    the matchup is spoken in: "Florida at Carolina".
 *
 * 3. TWO TEAM LINES PER ROW, score right-aligned and set in the largest type
 *    in the row, with the leading side emphasised. The score is the reason
 *    the screen was opened; nothing else in the row may out-weigh it.
 *
 * 4. ONE RIGHT-HAND STATUS COLUMN doing triple duty: start time when
 *    scheduled, clock plus period when live, "Final" or "Final/OT" when
 *    over. `gameStateLabel()` in `utils/gameState.ts` already emits exactly
 *    this vocabulary, so the server sends state and the client formats.
 *
 * 5. LIVE GAMES STAY INLINE, marked with colour and a pulse, rather than
 *    being hoisted into a separate "live" section. Apple Sports and theScore
 *    both keep the day's list stable, so rows do not reorder under the thumb
 *    as games start and end.
 *
 * 6. TAP TO EXPAND IN PLACE. **This is the deliberate divergence.**
 *    theScore and ESPN push to a full game page with tabs (box score, plays,
 *    lineups). Citrus holds no play-by-play, no shot chart and no live box
 *    score, so that page would be mostly empty. An accordion keeps the day's
 *    context, costs no navigation, and is honest about how much detail we
 *    actually have.
 *
 * 7. THE ODDS SLOT BECOMES THE PROJECTION SLOT. theScore and ESPN fill the
 *    space under a game row with betting lines. We cannot: `moneyline_home`
 *    and `implied_win_probability_home` are NULL on every one of the 2,738
 *    rows in `nhl_games` (audited 2026-09-02). That space goes to the thing
 *    we have and they do not — our per-game projections.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT THE DATABASE ACTUALLY HOLDS (audited 2026-09-02, production)
 *
 * These findings are the reason several fields below are nullable, and the
 * reason several obvious fields are ABSENT.
 *
 *   nhl_games
 *     · 2,738 rows: 1,394 final (season 2025) and 1,344 scheduled (2026).
 *       No live row has ever existed.
 *     · home_score / away_score are **0, not NULL, on all 1,344 scheduled
 *       rows.** A scheduled game therefore CANNOT render its score columns:
 *       printing them shows a fabricated 0-0. `homeScore`/`awayScore` below
 *       are nulled by the server for any game that has not started.
 *     · venue is NULL on every 2026 row (populated only on 2025).
 *     · moneyline_* and implied_win_probability_* are NULL everywhere.
 *
 *   player_projected_stats (season 2026)
 *     · 66,024 rows, all 1,344 games, 786 players, ~50 per game.
 *     · total_projected_points and confidence_label populated on all rows.
 *     · dynamic_confidence / likely_low / likely_high are NULL on all rows,
 *       so there is no projection RANGE to draw for the coming season. No
 *       range field exists below.
 *     · starter_confirmed is FALSE on all 66,024 rows and injury_status is
 *       'healthy' on all 66,024. Neither is surfaced: a "confirmed starter"
 *       badge that is never true is dead weight, and an injury chip implies
 *       we track injuries here when we do not. Both CAR goalies project
 *       within 0.12 points of each other on opening night, which is exactly
 *       what "no starter is known" looks like — the UI must not pick one.
 *
 *   player_game_stats
 *     · Seasons 2017 through 2025 only. **There is no 2026 row.** Actuals
 *       therefore do not exist for any game the app can currently show, and
 *       every `actual*` field below will be null until games are played.
 *       The UI says so rather than printing a zero.
 */

import type { GameState } from '../utils/gameState';

/** One side of a game, as far as `nhl_games` plus `nhl_teams` can describe it. */
export interface ScoreboardTeam {
  /** `nhl_games.home_team` / `away_team`. Always present, always an abbrev. */
  abbrev: string;
  /** `nhl_games.*_team_id`. Populated on every audited row, still nullable. */
  teamId: number | null;
  /** `nhl_teams.city`, null when the abbrev is not in `nhl_teams`. */
  city: string | null;
  /** `nhl_teams.name`, null when the abbrev is not in `nhl_teams`. */
  name: string | null;
}

/**
 * One player line in a game's Citrus panel.
 *
 * `projectedPoints` is the pipeline's `total_projected_points`, which is
 * computed under the DEFAULT scoring settings, not the league's. The UI
 * labels it "Citrus projection" for that reason and never calls it "your
 * league points".
 */
export interface ScoresPlayerLine {
  playerId: number;
  name: string;
  /** `player_directory.team_abbrev`; which side of the game they are on. */
  teamAbbrev: string | null;
  position: string | null;
  isGoalie: boolean;
  headshotUrl: string | null;
  /** `total_projected_points`. Null only if the projection row is missing. */
  projectedPoints: number | null;
  /** 'High' | 'Medium' | 'Low' as the pipeline writes it, or null. */
  confidenceLabel: string | null;
  /**
   * Fantasy points actually scored in this game, from `player_game_stats`
   * run through `ScoringCalculator`. **Null when no stat row exists**, which
   * is every 2026 game today. Never zero-filled: a zero is a claim that the
   * player played and did nothing.
   */
  actualPoints: number | null;
  /** Raw actuals behind `actualPoints`, for the expanded line. Null together. */
  actuals: ScoresPlayerActuals | null;
  /** Set only when a leagueId was supplied and this player is rostered. */
  roster: ScoresRosterRef | null;
}

/** The counting stats behind `actualPoints`, straight off `player_game_stats`. */
export interface ScoresPlayerActuals {
  goals: number;
  assists: number;
  points: number;
  shotsOnGoal: number;
  blocks: number;
  hits: number;
  ppp: number;
  toiSeconds: number;
  /** Goalie-only. Null on skaters. */
  saves: number | null;
  goalsAgainst: number | null;
  wins: number | null;
  shutouts: number | null;
}

/** Where a player sits in the requested league. */
export interface ScoresRosterRef {
  teamId: string;
  teamName: string | null;
  /** True when the roster row belongs to the requesting user's team. */
  isMine: boolean;
}

/** The Citrus panel attached to one game row. */
export interface ScoresGameCitrus {
  /** Projection rows found for this game. 0 means we project nobody in it. */
  projectedPlayers: number;
  /**
   * The lines the row surfaces. Rostered players first (when a league was
   * given), then the highest projections in the game.
   */
  players: ScoresPlayerLine[];
  /** Rostered in the requested league. Null when no league was requested. */
  rosteredCount: number | null;
  /** How many of the requesting user's own players are in this game. */
  myCount: number | null;
  /** Confidence mix across every projection in the game, not just the shown ones. */
  confidence: { high: number; medium: number; low: number; unlabeled: number };
  /** True once at least one player in this game has a real stat row. */
  hasActuals: boolean;
}

/** One game row. */
export interface ScoreboardGame {
  gameId: number;
  gameDate: string;
  /** `nhl_games.game_time` as ISO, or null. */
  startsAt: string | null;
  state: GameState;
  /** The raw `status` string, so the client can show it when state is unknown. */
  statusRaw: string | null;
  period: string | null;
  periodTime: string | null;
  /** NULL on every 2026 row. The UI omits the element rather than guessing. */
  venue: string | null;
  gameType: string | null;
  season: number;
  away: ScoreboardTeam;
  home: ScoreboardTeam;
  /**
   * **Null unless the game has started.** `nhl_games` stores 0 for both
   * sides of a scheduled game; the server nulls those so no scheduled row
   * can render a 0-0 that never happened.
   */
  awayScore: number | null;
  homeScore: number | null;
  citrus: ScoresGameCitrus | null;
}

/** `GET /api/scores?date=&leagueId=` */
export interface ScoresDayResponse {
  /** The date actually read, YYYY-MM-DD in Mountain Time. */
  date: string;
  games: ScoreboardGame[];
  /**
   * Nearest dates on either side that DO have games. Populated only when
   * `date` has none, so the empty state can offer a real jump rather than
   * leaving the user to guess where the season is.
   */
  nearestDateWithGames: { before: string | null; after: string | null };
  /** Echo of the league context the Citrus panels were built against. */
  league: { id: string | null; rostersResolved: boolean };
  /** True when a paged read hit its cap; the list on screen is incomplete. */
  truncated: boolean;
  generatedAt: string;
}

/** `GET /api/scores/game/:gameId?leagueId=` */
export interface ScoresGameDetailResponse {
  game: ScoreboardGame;
  /** Every projected player in the game, not just the row's top few. */
  players: ScoresPlayerLine[];
  league: { id: string | null; rostersResolved: boolean };
  truncated: boolean;
  generatedAt: string;
}
