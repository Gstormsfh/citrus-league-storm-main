-- ============================================================================
-- The matchup page's slowest query stops reading the whole league
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-04):
--   supabase/migrations/captures/2026-09-04_pre_get_matchup_stats.sql
--     db5f7c1da98dc3beea83a39b0ccb22aa
--
-- (a) WHAT CHANGED
--   Two WHERE clauses, and nothing else in the entire function.
--     week_rows   gains  WHERE pgs.player_id = ANY(p_player_ids)
--     week_shots  gains  WHERE s.shooter_id = ANY(p_player_ids)
--   The signature, the return table, LANGUAGE sql, STABLE, SECURITY DEFINER,
--   search_path, all seventeen SUM(CASE ...) aggregates, the xg rollup and the
--   final LEFT JOIN are byte-identical to the capture. This migration file was
--   GENERATED from that capture by string substitution rather than retyped,
--   which is the only way to be certain of that.
--
-- (b) WHY NOW
--
--   This is the slowest thing on the matchup page's critical path, and the
--   function was reading the whole league to answer a question about forty
--   players.
--
--   Measured on production 2026-09-04, pg_stat_statements, PostgREST-served:
--     get_matchup_stats            13 calls   mean  961.7 ms   max 6446.6 ms
--     update_all_matchup_scores   956 calls   mean   17.0 ms   max 1349.3 ms
--     get_daily_projections       355 calls   mean    2.2 ms
--
--   It is awaited inside the four-way Promise.all in
--   apps/web/src/services/MatchupService.ts fetchMatchupStatsForPlayers, so it
--   is the long pole: no player row can paint its week totals until it
--   returns.
--
--   The cause is not a missing index. Both MATERIALIZED CTEs ignored
--   p_player_ids entirely and aggregated every row in the date window for
--   every player in the NHL; only the final LEFT JOIN against player_list
--   narrowed the result. So the answer was always right and the work was
--   always ~20x too large.
--
--   EXPLAIN (ANALYZE, BUFFERS) on production, 40 real roster player ids, one
--   week (2026-03-29..04-04):
--     as shipped, warm     week_rows 2200 rows, week_shots 4699 rows
--                          7653 buffers hit                 29.1 ms
--     with the filters     week_rows  115 rows, week_shots  284 rows
--                          4717 buffers hit                  7.0 ms
--   19x fewer stat rows and 16x fewer shot rows materialized.
--
--   week_rows also selects pgs.* - all 68 columns of player_game_stats, a
--   459 MB table - while window_stats reads 27 of them. Narrowing that would
--   shrink the materialized tuple further and is deliberately NOT done here:
--   naming 27 columns by hand is a chance to drop one silently, and with the
--   row count down 19x the remaining win is small. Left as a note, not a
--   change.
--
-- (c) WHY THIS IS SAFE
--
--   The two filters are provably output-preserving, not merely tested to be.
--   Every consumer of week_rows is window_stats, which GROUPs BY
--   wr.player_id; every consumer of week_shots is xg, which GROUPs BY
--   shooter_id. Both aggregates are then joined to player_list - the unnest
--   of p_player_ids - by a LEFT JOIN on that same id. A group whose id is not
--   in p_player_ids therefore has no row in player_list to join to and was
--   already discarded. Removing those rows earlier cannot change a single
--   output cell; it only stops computing sums nobody reads.
--
--   Checked empirically as well as argued: the proof script compares the OLD
--   and NEW functions cell for cell over the same fixture, including the
--   awkward inputs (empty array, ids with no rows at all, ids whose rows are
--   entirely outside the date window, goalies and skaters mixed, NULL xg).
--
--   Production spot check, 40 players, goals/assists/saves/x_goals:
--   0 mismatches.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_matchup_stats(p_player_ids integer[], p_start_date date, p_end_date date)
 RETURNS TABLE(player_id integer, goals bigint, assists bigint, points bigint, shots_on_goal bigint, hits bigint, blocks bigint, pim bigint, ppp bigint, shp bigint, plus_minus bigint, goalie_gp bigint, wins bigint, saves bigint, goals_against bigint, shots_faced bigint, shutouts bigint, x_goals numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH player_list AS (SELECT unnest(p_player_ids) AS player_id),
  filtered_games AS MATERIALIZED (
    SELECT game_id FROM public.nhl_games
     WHERE game_date >= p_start_date AND game_date <= p_end_date AND game_type = 'regular'
  ),
  week_rows AS MATERIALIZED (
    SELECT pgs.* FROM public.player_game_stats pgs
    JOIN filtered_games ng ON pgs.game_id = ng.game_id
    WHERE pgs.player_id = ANY(p_player_ids)
  ),
  window_stats AS (
    SELECT wr.player_id,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_goals, 0) ELSE 0 END)::bigint AS goals,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_assists, 0) ELSE 0 END)::bigint AS assists,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_points, 0) ELSE 0 END)::bigint AS points,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_shots_on_goal, 0) ELSE 0 END)::bigint AS shots_on_goal,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_hits, 0) ELSE 0 END)::bigint AS hits,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_blocks, 0) ELSE 0 END)::bigint AS blocks,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_pim, 0) ELSE 0 END)::bigint AS pim,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(NULLIF(wr.nhl_ppp, 0), (COALESCE(wr.nhl_ppg, 0) + COALESCE(wr.nhl_ppa, 0))) ELSE 0 END)::bigint AS ppp,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(NULLIF(wr.nhl_shp, 0), (COALESCE(wr.nhl_shg, 0) + COALESCE(wr.nhl_sha, 0))) ELSE 0 END)::bigint AS shp,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_plus_minus, 0) ELSE 0 END)::bigint AS plus_minus,
      SUM(CASE WHEN wr.is_goalie = true THEN wr.goalie_gp ELSE 0 END)::bigint AS goalie_gp,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_wins, 0), wr.wins, 0) ELSE 0 END)::bigint AS wins,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_saves, 0), wr.saves, 0) ELSE 0 END)::bigint AS saves,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_goals_against, 0), wr.goals_against, 0) ELSE 0 END)::bigint AS goals_against,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_shots_faced, 0), wr.shots_faced, 0) ELSE 0 END)::bigint AS shots_faced,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_shutouts, 0), wr.shutouts, 0) ELSE 0 END)::bigint AS shutouts
    FROM week_rows wr
    GROUP BY wr.player_id
  ),
  week_shots AS MATERIALIZED (
    SELECT s.shooter_id, s.xg_sql FROM public.nhl_shots s
    JOIN filtered_games ng ON s.game_id = ng.game_id
    WHERE s.shooter_id = ANY(p_player_ids)
  ),
  xg AS (
    SELECT ws.shooter_id AS player_id, SUM(ws.xg_sql)::numeric AS x_goals
    FROM week_shots ws GROUP BY ws.shooter_id
  )
  SELECT pl.player_id,
    COALESCE(ws.goals, 0)::bigint, COALESCE(ws.assists, 0)::bigint, COALESCE(ws.points, 0)::bigint,
    COALESCE(ws.shots_on_goal, 0)::bigint, COALESCE(ws.hits, 0)::bigint, COALESCE(ws.blocks, 0)::bigint,
    COALESCE(ws.pim, 0)::bigint, COALESCE(ws.ppp, 0)::bigint, COALESCE(ws.shp, 0)::bigint,
    COALESCE(ws.plus_minus, 0)::bigint, COALESCE(ws.goalie_gp, 0)::bigint, COALESCE(ws.wins, 0)::bigint,
    COALESCE(ws.saves, 0)::bigint, COALESCE(ws.goals_against, 0)::bigint, COALESCE(ws.shots_faced, 0)::bigint,
    COALESCE(ws.shutouts, 0)::bigint, COALESCE(x.x_goals, 0)::numeric
  FROM player_list pl
  LEFT JOIN window_stats ws ON ws.player_id = pl.player_id
  LEFT JOIN xg x ON x.player_id = pl.player_id;
$function$;

-- Guard: the migration is only correct if all of this is true afterwards.
DO $$
DECLARE
  v_body text;
BEGIN
  v_body := pg_get_functiondef('public.get_matchup_stats(integer[],date,date)'::regprocedure);

  -- The two filters this migration exists to add.
  IF v_body NOT LIKE '%WHERE pgs.player_id = ANY(p_player_ids)%' THEN
    RAISE EXCEPTION 'get_matchup_stats still reads every player''s game rows';
  END IF;
  IF v_body NOT LIKE '%WHERE s.shooter_id = ANY(p_player_ids)%' THEN
    RAISE EXCEPTION 'get_matchup_stats still reads every player''s shots';
  END IF;

  -- Both must stay MATERIALIZED. Without the fence the planner may inline
  -- them, and the whole reason these are CTEs is that the aggregate is
  -- computed once rather than per output row.
  IF v_body NOT LIKE '%week_rows AS MATERIALIZED%'
     OR v_body NOT LIKE '%week_shots AS MATERIALIZED%' THEN
    RAISE EXCEPTION 'get_matchup_stats lost a MATERIALIZED fence';
  END IF;

  -- The properties the callers depend on.
  IF v_body NOT LIKE '%LANGUAGE sql%'
     OR v_body NOT LIKE '%STABLE SECURITY DEFINER%'
     OR v_body NOT LIKE '%SET search_path TO ''public''%' THEN
    RAISE EXCEPTION 'get_matchup_stats changed language, volatility or search_path';
  END IF;

  -- A sample of the arithmetic that must NOT have changed. These three are
  -- the awkward ones: two COALESCE(NULLIF(...)) fallbacks and the goalie
  -- games-played sum that deliberately does not COALESCE.
  IF v_body NOT LIKE '%COALESCE(NULLIF(wr.nhl_ppp, 0), (COALESCE(wr.nhl_ppg, 0) + COALESCE(wr.nhl_ppa, 0)))%' THEN
    RAISE EXCEPTION 'get_matchup_stats lost the powerplay-points fallback';
  END IF;
  IF v_body NOT LIKE '%COALESCE(NULLIF(wr.nhl_shp, 0), (COALESCE(wr.nhl_shg, 0) + COALESCE(wr.nhl_sha, 0)))%' THEN
    RAISE EXCEPTION 'get_matchup_stats lost the shorthanded-points fallback';
  END IF;
  IF v_body NOT LIKE '%SUM(CASE WHEN wr.is_goalie = true THEN wr.goalie_gp ELSE 0 END)%' THEN
    RAISE EXCEPTION 'get_matchup_stats lost the goalie games-played sum';
  END IF;

  -- The result is still assembled from player_list, which is what makes the
  -- new filters output-preserving in the first place.
  IF v_body NOT LIKE '%FROM player_list pl%'
     OR v_body NOT LIKE '%LEFT JOIN window_stats ws ON ws.player_id = pl.player_id%'
     OR v_body NOT LIKE '%LEFT JOIN xg x ON x.player_id = pl.player_id%' THEN
    RAISE EXCEPTION 'get_matchup_stats no longer projects through player_list';
  END IF;

  RAISE NOTICE 'get_matchup_stats md5 = %', md5(v_body);
END $$;

COMMIT;
