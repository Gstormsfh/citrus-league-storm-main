-- Fix aggregate_player_playoff_stats[_live] to read assists from
-- player_game_stats.nhl_assists (live-scraped from NHL.com), falling
-- back to primary_assists + secondary_assists (PBP-extractor output)
-- for historical games where the PBP run has completed but live data
-- was not captured.
--
-- Incident: 2026-05-12 — Playoff pool "Assists" column showed 0 for
-- every player during active R1 play. Goals/Points (NHL.com totals)
-- were correct because they read from nhl_goals/nhl_points; assists
-- alone was reading primary_assists + secondary_assists, both of
-- which the live scraper leaves at 0 (the PBP extractor populates
-- them later as a lagging job). DB invariant violation observed:
-- sum_goals=308, sum_assists=0, sum_points=827 — points still showed
-- correctly because nhl_points is the NHL.com pre-summed G+A total.
--
-- Caused by commit 76e5468 (2026-04-18) "fix: unblock live game polling
-- + count nhl_* cols in playoff aggregate" which switched every other
-- stat to COALESCE(nhl_*, unprefixed) but used primary+secondary for
-- assists because player_game_stats has no plain `assists` column.
-- The author missed that nhl_assists exists alongside nhl_goals/nhl_points.
--
-- This migration: CREATE OR REPLACE on both functions with the assists
-- line corrected to match the COALESCE(nhl_*, fallback) pattern of every
-- other stat. No table DDL. Idempotent.

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
    COALESCE(SUM(COALESCE(pgs.nhl_assists, COALESCE(pgs.primary_assists, 0) + COALESCE(pgs.secondary_assists, 0))), 0)::SMALLINT,
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
    COALESCE(SUM(COALESCE(pgs.nhl_assists, COALESCE(pgs.primary_assists, 0) + COALESCE(pgs.secondary_assists, 0))), 0)::SMALLINT,
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
