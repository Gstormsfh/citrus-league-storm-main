-- RPC: aggregate_player_playoff_stats
-- Rebuilds player_playoff_stats from player_game_stats + nhl_games for
-- games where game_type='playoff'. Called by the live scraper after each
-- game completes, and by the nightly cron for reconciliation.
-- Self-healing: DELETEs stale rows before inserting fresh ones.

CREATE OR REPLACE FUNCTION public.aggregate_player_playoff_stats(p_season INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  -- Wipe existing rows for this season (self-healing)
  DELETE FROM player_playoff_stats WHERE season = p_season;

  -- Rebuild from player_game_stats joined with playoff games only
  INSERT INTO player_playoff_stats (
    player_id, season, games_played, goals, assists, points,
    ppp, shp, shots, hits, blocks, pim, plus_minus,
    wins, saves, shutouts, goals_against, is_goalie,
    team_abbrev, last_game_id, updated_at
  )
  SELECT
    pgs.player_id,
    p_season,
    COUNT(DISTINCT pgs.game_id)::SMALLINT,
    COALESCE(SUM(pgs.goals), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.primary_assists, 0) + COALESCE(pgs.secondary_assists, 0)), 0)::SMALLINT,
    COALESCE(SUM(pgs.points), 0)::SMALLINT,
    COALESCE(SUM(pgs.ppp), 0)::SMALLINT,
    COALESCE(SUM(pgs.shp), 0)::SMALLINT,
    COALESCE(SUM(pgs.shots), 0)::SMALLINT,
    COALESCE(SUM(pgs.hits), 0)::SMALLINT,
    COALESCE(SUM(pgs.blocks), 0)::SMALLINT,
    COALESCE(SUM(pgs.pim), 0)::SMALLINT,
    COALESCE(SUM(pgs.plus_minus), 0)::SMALLINT,
    COALESCE(SUM(pgs.wins), 0)::SMALLINT,
    COALESCE(SUM(pgs.saves), 0)::INTEGER,
    COALESCE(SUM(pgs.shutouts), 0)::SMALLINT,
    COALESCE(SUM(pgs.goals_against), 0)::SMALLINT,
    BOOL_OR(COALESCE(pgs.is_goalie, false)),
    MAX(pd.team_abbrev),
    MAX(pgs.game_id),
    NOW()
  FROM player_game_stats pgs
  JOIN nhl_games g ON pgs.game_id = g.game_id
  LEFT JOIN player_directory pd ON pgs.player_id = pd.player_id
  WHERE g.game_type = 'playoff'
    AND g.season = p_season
    AND g.status = 'final'
  GROUP BY pgs.player_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Update freshness timestamp
  INSERT INTO nhl_pipeline_meta (key, last_refresh)
  VALUES ('player_playoff_stats', NOW())
  ON CONFLICT (key) DO UPDATE SET last_refresh = NOW();

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.aggregate_player_playoff_stats IS
  'Rebuilds player_playoff_stats from per-game stats for playoff games only. Idempotent / self-healing.';

GRANT EXECUTE ON FUNCTION public.aggregate_player_playoff_stats TO service_role;
