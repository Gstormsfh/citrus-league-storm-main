-- RPC: score_playoff_roster_pool
-- Computes each user's roster total using their league's scoring_settings
-- applied to player_playoff_stats (self-healing aggregation from player_game_stats).
-- Updates playoff_pool_standings with ranks. Idempotent / safe to re-run.
--
-- CRITICAL: this is where the "scoring is dynamic to commissioner settings"
-- promise is kept for roster pools. The weights come from league.scoring_settings
-- JSONB, so goals-only pools, hits-only pools, full-fantasy pools all work
-- without code changes — same engine the draft room uses via ScoringCalculator.

CREATE OR REPLACE FUNCTION public.score_playoff_roster_pool(p_league_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings JSONB;
  v_updated INTEGER;
BEGIN
  -- Load league scoring settings
  SELECT scoring_settings INTO v_settings FROM leagues WHERE id = p_league_id;
  IF v_settings IS NULL THEN v_settings := '{}'::jsonb; END IF;

  -- Compute per-user totals + ranks, then upsert standings
  WITH user_totals AS (
    SELECT
      rp.user_id,
      SUM(
        CASE WHEN COALESCE(pps.is_goalie, false) THEN
          -- Goalie scoring
          COALESCE(pps.wins, 0) * COALESCE((v_settings->'goalie'->>'wins')::NUMERIC, 4) +
          COALESCE(pps.saves, 0) * COALESCE((v_settings->'goalie'->>'saves')::NUMERIC, 0.2) +
          COALESCE(pps.shutouts, 0) * COALESCE((v_settings->'goalie'->>'shutouts')::NUMERIC, 3) +
          COALESCE(pps.goals_against, 0) * COALESCE((v_settings->'goalie'->>'goals_against')::NUMERIC, -1)
        ELSE
          -- Skater scoring — mirrors ScoringCalculator.calculatePoints
          COALESCE(pps.goals, 0) * COALESCE((v_settings->'skater'->>'goals')::NUMERIC, 3) +
          COALESCE(pps.assists, 0) * COALESCE((v_settings->'skater'->>'assists')::NUMERIC, 2) +
          COALESCE(pps.ppp, 0) * COALESCE((v_settings->'skater'->>'power_play_points')::NUMERIC, 1) +
          COALESCE(pps.shp, 0) * COALESCE((v_settings->'skater'->>'short_handed_points')::NUMERIC, 2) +
          COALESCE(pps.shots, 0) * COALESCE((v_settings->'skater'->>'shots_on_goal')::NUMERIC, 0.4) +
          COALESCE(pps.blocks, 0) * COALESCE((v_settings->'skater'->>'blocks')::NUMERIC, 0.5) +
          COALESCE(pps.hits, 0) * COALESCE((v_settings->'skater'->>'hits')::NUMERIC, 0.2) +
          COALESCE(pps.pim, 0) * COALESCE((v_settings->'skater'->>'penalty_minutes')::NUMERIC, 0.5) +
          COALESCE(pps.plus_minus, 0) * COALESCE((v_settings->'skater'->>'plus_minus')::NUMERIC, 0)
        END
      ) AS total_points
    FROM playoff_roster_picks rp
    LEFT JOIN player_playoff_stats pps
      ON pps.player_id = rp.player_id AND pps.season = 2025
    WHERE rp.league_id = p_league_id
    GROUP BY rp.user_id
  ),
  ranked AS (
    SELECT
      user_id,
      COALESCE(total_points, 0) AS total_points,
      RANK() OVER (ORDER BY COALESCE(total_points, 0) DESC) AS rnk
    FROM user_totals
  )
  INSERT INTO playoff_pool_standings (league_id, user_id, total_points, correct_picks, current_rank, last_updated)
  SELECT p_league_id, user_id, total_points, 0, rnk, NOW() FROM ranked
  ON CONFLICT (league_id, user_id) DO UPDATE
    SET total_points = EXCLUDED.total_points,
        current_rank = EXCLUDED.current_rank,
        last_updated = NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.score_playoff_roster_pool IS
  'Scores a playoff roster pool using the league custom scoring_settings. Idempotent.';

GRANT EXECUTE ON FUNCTION public.score_playoff_roster_pool TO service_role;

-- Convenience: rebuild standings for ALL playoff-roster-pool leagues.
-- Called by cron after aggregate_player_playoff_stats.
CREATE OR REPLACE FUNCTION public.score_all_playoff_roster_pools()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league RECORD;
  v_total INTEGER := 0;
BEGIN
  FOR v_league IN
    SELECT id FROM leagues
    WHERE (settings->>'leagueType') = 'playoff-roster-pool'
  LOOP
    PERFORM score_playoff_roster_pool(v_league.id);
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.score_all_playoff_roster_pools TO service_role;
