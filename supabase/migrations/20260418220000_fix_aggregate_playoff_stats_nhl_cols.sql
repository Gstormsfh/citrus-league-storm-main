-- Fix aggregate_player_playoff_stats to read from nhl_* columns first,
-- falling back to unprefixed. The live scraper (data_scraping_service.py)
-- writes NHL.com data to nhl_goals/nhl_plus_minus/nhl_hits/etc. and sets
-- the unprefixed columns to 0 (they're later filled in by the PBP
-- extractor job for historical accuracy). Previously this RPC summed
-- only the unprefixed columns, so live-game data appeared as 0 on
-- playoff pool leaderboards.

CREATE OR REPLACE FUNCTION public.aggregate_player_playoff_stats(p_season integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  DELETE FROM player_playoff_stats WHERE season = p_season;

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
    COALESCE(SUM(COALESCE(pgs.nhl_goals, pgs.goals)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.primary_assists, 0) + COALESCE(pgs.secondary_assists, 0)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_points, pgs.points)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_ppp, pgs.ppp)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_shp, pgs.shp)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_hits, pgs.hits)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_blocks, pgs.blocks)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_pim, pgs.pim)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_plus_minus, pgs.plus_minus)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_wins, pgs.wins)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_saves, pgs.saves)), 0)::INTEGER,
    COALESCE(SUM(COALESCE(pgs.nhl_shutouts, pgs.shutouts)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_goals_against, pgs.goals_against)), 0)::SMALLINT,
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

  INSERT INTO nhl_pipeline_meta (key, last_refresh)
  VALUES ('player_playoff_stats', NOW())
  ON CONFLICT (key) DO UPDATE SET last_refresh = NOW();

  RETURN v_rows;
END;
$$;

-- Also add a variant that runs for LIVE (non-final) games so scoring
-- updates intra-game. The default still only counts finalized games.
CREATE OR REPLACE FUNCTION public.aggregate_player_playoff_stats_live(p_season integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  DELETE FROM player_playoff_stats WHERE season = p_season;

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
    COALESCE(SUM(COALESCE(pgs.nhl_goals, pgs.goals)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.primary_assists, 0) + COALESCE(pgs.secondary_assists, 0)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_points, pgs.points)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_ppp, pgs.ppp)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_shp, pgs.shp)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_hits, pgs.hits)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_blocks, pgs.blocks)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_pim, pgs.pim)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_plus_minus, pgs.plus_minus)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_wins, pgs.wins)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_saves, pgs.saves)), 0)::INTEGER,
    COALESCE(SUM(COALESCE(pgs.nhl_shutouts, pgs.shutouts)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_goals_against, pgs.goals_against)), 0)::SMALLINT,
    BOOL_OR(COALESCE(pgs.is_goalie, false)),
    MAX(pd.team_abbrev),
    MAX(pgs.game_id),
    NOW()
  FROM player_game_stats pgs
  JOIN nhl_games g ON pgs.game_id = g.game_id
  LEFT JOIN player_directory pd ON pgs.player_id = pd.player_id
  WHERE g.game_type = 'playoff'
    AND g.season = p_season
    AND g.status IN ('live', 'in_progress', 'final')
  GROUP BY pgs.player_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO nhl_pipeline_meta (key, last_refresh)
  VALUES ('player_playoff_stats', NOW())
  ON CONFLICT (key) DO UPDATE SET last_refresh = NOW();

  RETURN v_rows;
END;
$$;
