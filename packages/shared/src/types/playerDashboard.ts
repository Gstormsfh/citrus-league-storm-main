/**
 * THE PLAYER DASHBOARD WIRE CONTRACTS, shared by the Hono server that
 * produces them and the React surfaces that render them.
 *
 * Two reads live here:
 *
 *   GET /api/players/dashboard-index         DashboardIndexEntry[]
 *   GET /api/players/:playerId/xg-history    PlayerXgHistoryPayload
 *
 * Until 2026-09-03 the index row shape lived in
 * `server/src/services/PlayerDashboardService.ts` and was HAND-MIRRORED in
 * `apps/web/src/hooks/usePlayerDashboardIndex.ts` ("if you add a column
 * there, add it here"). That mirror is how three columns the service already
 * SELECTed (`toi_total_minutes`, then `vopa_score` and `avg_toi_per_game` on
 * the next read) stayed off the wire for a month: every field had to be
 * added in two places by hand, and the second place was the one that got
 * forgotten. One definition, imported by both workspaces, ends that. The
 * web app already imports from `@citrus/shared` in fifty-odd files, so
 * nothing new is being wired up to make that possible.
 *
 * NUMBERS ARE NUMBERS ON THE WIRE. Several of the source columns are
 * Postgres `numeric` (`xg_per_60`, `vopa_score`, `raw_gsax`, ...). The
 * service coerces those once, server-side, so a client never has to call
 * `.toFixed()` on a string. Null means "no row for this player", never a
 * coalesced zero, for every modelled column below.
 */

/**
 * One row of `GET /api/players/dashboard-index`: a directory player for the
 * current season with his season actuals, GAR split, xG talent row, goalie
 * GSAx and rolled-forward projection merged in. Season-scoped by the
 * server; the client never sees a season column because every row is the
 * same season.
 */
export interface DashboardIndexEntry {
  id: number;
  name: string;
  team: string;
  position: string;
  jersey: number | null;
  headshot_url: string | null;
  is_goalie: boolean;
  roster_status: string | null;
  // season actuals
  gp: number;
  goals: number;
  assists: number;
  points: number;
  sog: number;
  hits: number;
  blocks: number;
  ppp: number;
  plus_minus: number;
  x_goals: number;
  /**
   * PIM, SHP and ice time (2026-09-05). The service SELECTed nhl_pim and
   * nhl_toi_seconds from the day the index shipped and dropped both in the
   * mapper; nhl_shp was never read. The player card's Detailed grid printed
   * PIM 0, SHP 0 and TOI/G "-" for every skater in the league while
   * player_season_stats held all three for 877, 229 and 1,038 of the 1,063
   * rows of season 2025. `toi_seconds` is the season total; per game is
   * toi_seconds / gp, which the card formats.
   */
  pim: number;
  shp: number;
  toi_seconds: number;
  // goalie actuals
  wins: number;
  losses: number;
  ot_losses: number;
  saves: number;
  save_pct: number;
  gaa: number;
  shutouts: number;
  goals_against: number;
  // advanced
  xg_per_60: number | null;
  xg_rating: string | null;
  gar_per_60: number | null;
  gar_evo: number | null;
  gar_evd: number | null;
  gar_ppo: number | null;
  gar_ppd: number | null;
  gar_pen: number | null;
  /**
   * THE SAMPLE BEHIND THE RATES (2026-09-03).
   *
   * `toi_total_minutes` is `player_gar_components.toi_total_minutes`, the
   * ice time every GAR/60 row above is divided by. The service SELECTed it
   * from the day the index shipped and dropped it in the mapper;
   * `utils/playerPercentiles.ts` had to fall back to games played as the
   * only sample field on the payload, and said so. Null for a player with
   * no GAR row (every goalie, and the skaters below the GAR model's floor).
   *
   * `avg_toi_per_game` and `vopa_score` are `player_talent_metrics` columns
   * the service never read. VOPA is Value Over Positional Average:
   * `(player_points - replacement_level) / std_dev`, per the column's own
   * COMMENT in migration 20260103151929. Both are carried as the table
   * holds them. On 2026-09-03 every 2025 row in production had NULL in
   * both (940 rows, 0 non-null), so a client must render their absence,
   * not a zero.
   */
  toi_total_minutes: number | null;
  avg_toi_per_game: number | null;
  vopa_score: number | null;
  /**
   * GOALIE GSAx (2026-09-03), from `goalie_gsax_primary`: goals saved above
   * expected over PRIMARY shots (rebounds excluded), our own xG model's
   * expected goals against minus the goals actually allowed. Keyed on the
   * same NHL id as the directory (`goalie_id`), season-filtered like every
   * other table in the index. Null for every skater and for a goalie the
   * table does not hold.
   *
   * `gsax_regressed` is the Bayesian-regressed value, which is what the
   * projection system consumes and what every other "GSAx" on a Citrus
   * surface already prints (`PlayerService` maps `regressed_gsax` to the
   * player card's `gsax`). `gsax_raw` is the unshrunk total, carried so a
   * reader can check the arithmetic: raw = xga - ga.
   */
  gsax_raw: number | null;
  gsax_regressed: number | null;
  gsax_shots_faced: number | null;
  gsax_xga: number | null;
  gsax_ga: number | null;
  // rolled-forward projection
  proj_gp: number | null;
  proj_fantasy_points: number | null;
  proj_fantasy_ppg: number | null;
  proj_goals: number | null;
  proj_assists: number | null;
  proj_sog: number | null;
  proj_ppp: number | null;
  /**
   * Projected blocks and hits (2026-09-02). `player_ros_projections` has
   * carried both since the table shipped and the service has always SELECTed
   * them; they were simply dropped on the way out of the mapper.
   *
   * They are not cosmetic. Blocks are worth 1 point in `DEFAULT_SCORING`, so
   * a consumer scoring the rest-of-season projection through the league's own
   * categories was short every skater's blocks, roughly fifty points a
   * player under default scoring. The draft room is the first such consumer
   * (`apps/web/src/components/draft/draftDecision.ts`).
   */
  proj_blocks: number | null;
  proj_hits: number | null;
  /** Optional for older cached index responses; current API carries these raw totals. */
  proj_pim?: number | null;
  proj_shp?: number | null;
  proj_goals_against?: number | null;
  proj_wins: number | null;
  proj_saves: number | null;
  proj_shutouts: number | null;
  /**
   * FRESHNESS (2026-09-03). The newest `updated_at` among the rows that
   * were actually read for THIS player: `player_season_stats`,
   * `player_gar_components`, `player_talent_metrics`,
   * `player_ros_projections` and `goalie_gsax_primary`. ISO 8601, or null
   * when none of his rows carried a stamp.
   *
   * Every one of those tables is rewritten whole by the nightly pipeline
   * (on 2026-09-03 each table's min and max `updated_at` were the same
   * instant), so this is, in practice, "when the pipeline last wrote him".
   * That is the exact question `citrus2/StaleDataBadge` asks, and the
   * failure it exists to expose is a pipeline that silently stopped. It is
   * NOT a claim that the underlying stat line changed: in the offseason the
   * rows are rewritten nightly with the same numbers.
   *
   * Null must HIDE the badge. Passing null to `StaleDataBadge` renders
   * "Very outdated / Update timestamp unavailable", which is itself a
   * freshness claim nobody can support.
   */
  as_of: string | null;
}

/**
 * One season of `player_xg_season` for one player, SUMMED ACROSS TEAMS.
 *
 * That table's primary key is `(season, game_type, player_id, team_id)`:
 * a player traded mid-season has one row per sweater, and on 2026-09-03
 * production held 687 such multi-row player-seasons, up to four rows deep.
 * A sparkline fed the raw rows draws two points for one season, which is a
 * fabricated axis. The server merges them before they reach the wire, and
 * `teams` says how many rows went into the point so nothing is hidden.
 */
export interface XgHistoryPoint {
  season: number;
  game_type: 'regular' | 'playoff';
  shots: number;
  sog: number;
  goals: number;
  /** Our model's expected goals, summed over the merged rows. */
  xg: number;
  /** goals - xg over the merged rows. */
  finishing: number;
  /** Team rows merged into this point. 1 unless he was traded that season. */
  teams: number;
}

/** `GET /api/players/:playerId/xg-history`. */
export interface PlayerXgHistoryPayload {
  player_id: number;
  /** Ascending by season, regular season before playoffs within a season. */
  points: XgHistoryPoint[];
  /** Newest `player_xg_season.updated_at` read, or null. Same contract as `as_of` above. */
  as_of: string | null;
}
