CREATE OR REPLACE FUNCTION public.score_playoff_roster_pool(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings JSONB; v_league_floor DATE; v_updated INTEGER; v_season INT;
BEGIN
  v_season := public.get_current_season();

  SELECT scoring_settings INTO v_settings FROM leagues WHERE id = p_league_id;
  IF v_settings IS NULL THEN v_settings := '{}'::jsonb; END IF;

  SELECT COALESCE((settings->>'playoffScoringStartDate')::DATE, '1900-01-01'::DATE)
    INTO v_league_floor FROM leagues WHERE id = p_league_id;

  WITH playoff_games AS (
    SELECT pgs.player_id, pgs.is_goalie,
           pgs.nhl_goals, pgs.goals, pgs.nhl_assists, pgs.primary_assists, pgs.secondary_assists,
           pgs.nhl_ppp, pgs.ppp, pgs.nhl_shp, pgs.shp,
           pgs.nhl_shots_on_goal, pgs.shots_on_goal, pgs.nhl_blocks, pgs.blocks,
           pgs.nhl_hits, pgs.hits, pgs.nhl_pim, pgs.pim, pgs.nhl_plus_minus, pgs.plus_minus,
           pgs.nhl_wins, pgs.wins, pgs.nhl_saves, pgs.saves,
           pgs.nhl_shutouts, pgs.shutouts, pgs.nhl_goals_against, pgs.goals_against,
           g.game_date AS pg_date
    FROM player_game_stats pgs
    JOIN nhl_games g ON g.game_id = pgs.game_id
    WHERE g.game_type = 'playoff'
      AND g.season = v_season
      AND g.status IN ('live', 'in_progress', 'final')
  ),
  user_totals AS (
    SELECT rp.user_id,
      COALESCE(SUM(
        CASE WHEN COALESCE(pg.is_goalie, false) THEN
          COALESCE(COALESCE(pg.nhl_wins, pg.wins), 0) * COALESCE((v_settings->'goalie'->>'wins')::NUMERIC, 4) +
          COALESCE(COALESCE(pg.nhl_saves, pg.saves), 0) * COALESCE((v_settings->'goalie'->>'saves')::NUMERIC, 0.2) +
          COALESCE(COALESCE(pg.nhl_shutouts, pg.shutouts), 0) * COALESCE((v_settings->'goalie'->>'shutouts')::NUMERIC, 3) +
          COALESCE(COALESCE(pg.nhl_goals_against, pg.goals_against), 0) * COALESCE((v_settings->'goalie'->>'goals_against')::NUMERIC, -1)
        ELSE
          COALESCE(COALESCE(pg.nhl_goals, pg.goals), 0) * COALESCE((v_settings->'skater'->>'goals')::NUMERIC, 3) +
          COALESCE(COALESCE(pg.nhl_assists, COALESCE(pg.primary_assists,0)+COALESCE(pg.secondary_assists,0)), 0)
            * COALESCE((v_settings->'skater'->>'assists')::NUMERIC, 2) +
          COALESCE(COALESCE(pg.nhl_ppp, pg.ppp), 0) * COALESCE((v_settings->'skater'->>'power_play_points')::NUMERIC, 1) +
          COALESCE(COALESCE(pg.nhl_shp, pg.shp), 0) * COALESCE((v_settings->'skater'->>'short_handed_points')::NUMERIC, 2) +
          COALESCE(COALESCE(pg.nhl_shots_on_goal, pg.shots_on_goal), 0) * COALESCE((v_settings->'skater'->>'shots_on_goal')::NUMERIC, 0.4) +
          COALESCE(COALESCE(pg.nhl_blocks, pg.blocks), 0) * COALESCE((v_settings->'skater'->>'blocks')::NUMERIC, 0.5) +
          COALESCE(COALESCE(pg.nhl_hits, pg.hits), 0) * COALESCE((v_settings->'skater'->>'hits')::NUMERIC, 0.2) +
          COALESCE(COALESCE(pg.nhl_pim, pg.pim), 0) * COALESCE((v_settings->'skater'->>'penalty_minutes')::NUMERIC, 0.5) +
          COALESCE(COALESCE(pg.nhl_plus_minus, pg.plus_minus), 0) * COALESCE((v_settings->'skater'->>'plus_minus')::NUMERIC, 0)
        END), 0) AS total_points
    FROM playoff_roster_picks rp
    LEFT JOIN playoff_games pg
      ON pg.player_id = rp.player_id
     AND pg.pg_date >= GREATEST(rp.created_at::date, v_league_floor)
    WHERE rp.league_id = p_league_id
    GROUP BY rp.user_id
  ),
  ranked AS (
    SELECT user_id, total_points, RANK() OVER (ORDER BY total_points DESC) AS rnk FROM user_totals
  )
  INSERT INTO playoff_pool_standings (league_id, user_id, total_points, correct_picks, current_rank, last_updated)
  SELECT p_league_id, user_id, total_points, 0, rnk, NOW() FROM ranked
  ON CONFLICT (league_id, user_id) DO UPDATE
    SET total_points = EXCLUDED.total_points,
        current_rank = EXCLUDED.current_rank,
        last_updated = NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END $function$
