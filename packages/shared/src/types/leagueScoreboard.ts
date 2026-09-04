/**
 * THE LEAGUE SCOREBOARD WIRE CONTRACT (2026-09-03, Sleeper parity audit M7).
 *
 * One shape for `GET /api/matchups/league/:leagueId?week=N`, produced by
 * `server/src/services/MatchupService.getLeagueScoreboard` and read by
 * `apps/web/src/components/matchup/scoreboard.ts`.
 *
 * WHAT THE PROJECTED TOTAL IS. For each side of a matchup that is still
 * open:
 *
 *     projected_total = points banked (the stored teamN_score)
 *                     + sum over every remaining day of the week
 *                       of every starter's projected points for that day,
 *                       scaled by the share of the game still unplayed
 *
 * It is the same number the matchup page prints as "proj" in the sticky
 * bar and the ScoreCard, built from the same three tables the page reads:
 *
 *   starters     fantasy_daily_rosters (slot_type = 'active') for the day,
 *                else the team's current team_lineups.starters, which is
 *                the page's own precedence for a day with no frozen row;
 *   projections  player_projected_stats.total_projected_points on that
 *                projection_date (the rows get_daily_projections serves);
 *   game clock   nhl_games (status, period, period_time, scores) for the
 *                projection's game, read through the same fraction rule
 *                as apps/web/src/utils/winProbability.ts.
 *
 * WHEN IT IS NULL, and null means "nothing to say", never zero:
 *   - the matchup is completed, or the week has ended on the calendar;
 *   - the side is a bye;
 *   - either side has no starters on any remaining day (the page says
 *     nothing until both lineups are in hand, and so does this);
 *   - no projection row exists for anyone in the league this week (the
 *     nightly batch has not projected the window, so a "projection" would
 *     just restate the live score);
 *   - a read failed. The live scores still ship; the projection does not.
 *
 * The week-less form of the endpoint (`?week` omitted, the season-wide list
 * standings and the timeline read) does not compute it: the two fields are
 * simply absent from those rows.
 */

/** The `teams!team1_id(id, team_name)` join as the endpoint embeds it. */
export interface LeagueScoreboardTeamRef {
  id: string;
  team_name: string | null;
}

/**
 * One matchup row of the league scoreboard: `MATCHUP_COLUMNS` plus the two
 * team joins, plus the projected totals described above.
 */
export interface LeagueScoreboardMatchup {
  id: string;
  league_id: string;
  week_number: number;
  team1_id: string;
  /** null for a bye. */
  team2_id: string | null;
  /** PostgREST hands numerics back as strings on some paths. */
  team1_score: number | string | null;
  team2_score: number | string | null;
  status: string | null;
  /** YYYY-MM-DD */
  week_start_date: string;
  /** YYYY-MM-DD */
  week_end_date: string;
  created_at?: string | null;
  updated_at?: string | null;
  team1?: LeagueScoreboardTeamRef | null;
  team2?: LeagueScoreboardTeamRef | null;
  /** Projected final for team1, or null when it cannot honestly be said (both sides are null for a bye). */
  team1_projected_total: number | null;
  /** Projected final for team2, or null on the same terms. */
  team2_projected_total: number | null;
}
