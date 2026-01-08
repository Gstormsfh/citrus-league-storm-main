-- ============================================================================
-- Server-Side Daily Lineup RPC (Yahoo/Sleeper Architecture)
-- ============================================================================
-- Returns complete daily lineup with player data for a specific team and date.
-- The UI simply displays what the server returns - zero client-side logic.
-- 
-- Scalability: 
-- - Single query returns all player data needed for display
-- - Cached on client for 15+ minutes (past lineups never change)
-- - 10,000 users each make ~1 query per session
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_daily_lineup(
  p_team_id UUID,
  p_matchup_id UUID,
  p_date DATE
)
RETURNS TABLE (
  player_id INTEGER,
  player_name TEXT,
  player_position TEXT,
  nhl_team TEXT,
  headshot_url TEXT,
  slot_type TEXT,
  slot_id TEXT,
  is_locked BOOLEAN,
  -- Daily stats
  daily_points NUMERIC(10, 3),
  goals INTEGER,
  assists INTEGER,
  shots_on_goal INTEGER,
  blocks INTEGER,
  hits INTEGER,
  pim INTEGER,
  ppp INTEGER,
  shp INTEGER,
  -- Goalie stats
  wins INTEGER,
  saves INTEGER,
  goals_against INTEGER,
  shutouts INTEGER,
  is_goalie BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID;
  -- Scoring weights
  v_goalie_wins_weight NUMERIC(10, 3) := 4.0;
  v_goalie_saves_weight NUMERIC(10, 3) := 0.2;
  v_goalie_shutouts_weight NUMERIC(10, 3) := 3.0;
  v_goalie_ga_weight NUMERIC(10, 3) := -1.0;
  v_skater_goals_weight NUMERIC(10, 3) := 3.0;
  v_skater_assists_weight NUMERIC(10, 3) := 2.0;
  v_skater_ppp_weight NUMERIC(10, 3) := 1.0;
  v_skater_shp_weight NUMERIC(10, 3) := 2.0;
  v_skater_sog_weight NUMERIC(10, 3) := 0.4;
  v_skater_blocks_weight NUMERIC(10, 3) := 0.5;
  v_skater_hits_weight NUMERIC(10, 3) := 0.2;
  v_skater_pim_weight NUMERIC(10, 3) := 0.5;
  v_scoring_settings JSONB;
BEGIN
  -- Get league scoring settings
  SELECT m.league_id, l.scoring_settings
  INTO v_league_id, v_scoring_settings
  FROM matchups m
  LEFT JOIN leagues l ON m.league_id = l.id
  WHERE m.id = p_matchup_id;
  
  -- Extract scoring weights from league settings (with defaults)
  IF v_scoring_settings IS NOT NULL THEN
    IF v_scoring_settings->'goalie' IS NOT NULL THEN
      v_goalie_wins_weight := COALESCE((v_scoring_settings->'goalie'->>'wins')::numeric, 4.0);
      v_goalie_saves_weight := COALESCE((v_scoring_settings->'goalie'->>'saves')::numeric, 0.2);
      v_goalie_shutouts_weight := COALESCE((v_scoring_settings->'goalie'->>'shutouts')::numeric, 3.0);
      v_goalie_ga_weight := COALESCE((v_scoring_settings->'goalie'->>'goals_against')::numeric, -1.0);
    END IF;
    
    IF v_scoring_settings->'skater' IS NOT NULL THEN
      v_skater_goals_weight := COALESCE((v_scoring_settings->'skater'->>'goals')::numeric, 3.0);
      v_skater_assists_weight := COALESCE((v_scoring_settings->'skater'->>'assists')::numeric, 2.0);
      v_skater_ppp_weight := COALESCE((v_scoring_settings->'skater'->>'power_play_points')::numeric, 1.0);
      v_skater_shp_weight := COALESCE((v_scoring_settings->'skater'->>'short_handed_points')::numeric, 2.0);
      v_skater_sog_weight := COALESCE((v_scoring_settings->'skater'->>'shots_on_goal')::numeric, 0.4);
      v_skater_blocks_weight := COALESCE((v_scoring_settings->'skater'->>'blocks')::numeric, 0.5);
      v_skater_hits_weight := COALESCE((v_scoring_settings->'skater'->>'hits')::numeric, 0.2);
      v_skater_pim_weight := COALESCE((v_scoring_settings->'skater'->>'penalty_minutes')::numeric, 0.5);
    END IF;
  END IF;

  RETURN QUERY
  SELECT 
    fdr.player_id,
    pd.full_name AS player_name,
    pd.position_code AS player_position,
    pd.team_abbrev AS nhl_team,
    pd.headshot_url,
    fdr.slot_type,
    fdr.slot_id,
    fdr.is_locked,
    -- Calculate daily fantasy points
    COALESCE(
      CASE 
        WHEN pd.position_code = 'G' OR pd.is_goalie = true THEN
          (COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) * v_goalie_wins_weight) + 
          (COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) * v_goalie_saves_weight) + 
          (COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) * v_goalie_shutouts_weight) + 
          (COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) * v_goalie_ga_weight)
        ELSE
          (COALESCE(pgs.nhl_goals, pgs.goals, 0) * v_skater_goals_weight) + 
          (COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0) * v_skater_assists_weight) + 
          (COALESCE(pgs.nhl_ppp, pgs.ppp, 0) * v_skater_ppp_weight) +
          (COALESCE(pgs.nhl_shp, pgs.shp, 0) * v_skater_shp_weight) +
          (COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0) * v_skater_sog_weight) + 
          (COALESCE(pgs.nhl_blocks, pgs.blocks, 0) * v_skater_blocks_weight) +
          (COALESCE(pgs.nhl_hits, pgs.hits, 0) * v_skater_hits_weight) +
          (COALESCE(pgs.nhl_pim, pgs.pim, 0) * v_skater_pim_weight)
      END
    , 0)::NUMERIC(10, 3) AS daily_points,
    -- Skater stats
    COALESCE(pgs.nhl_goals, pgs.goals, 0)::INTEGER AS goals,
    COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0)::INTEGER AS assists,
    COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0)::INTEGER AS shots_on_goal,
    COALESCE(pgs.nhl_blocks, pgs.blocks, 0)::INTEGER AS blocks,
    COALESCE(pgs.nhl_hits, pgs.hits, 0)::INTEGER AS hits,
    COALESCE(pgs.nhl_pim, pgs.pim, 0)::INTEGER AS pim,
    COALESCE(pgs.nhl_ppp, pgs.ppp, 0)::INTEGER AS ppp,
    COALESCE(pgs.nhl_shp, pgs.shp, 0)::INTEGER AS shp,
    -- Goalie stats
    COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0)::INTEGER AS wins,
    COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0)::INTEGER AS saves,
    COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0)::INTEGER AS goals_against,
    COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0)::INTEGER AS shutouts,
    COALESCE(pd.is_goalie, pd.position_code = 'G') AS is_goalie
  FROM fantasy_daily_rosters fdr
  INNER JOIN player_directory pd ON fdr.player_id = pd.player_id 
    AND pd.season = EXTRACT(YEAR FROM p_date)
  LEFT JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    AND pgs.game_date = p_date
  WHERE fdr.team_id = p_team_id
    AND fdr.matchup_id = p_matchup_id
    AND fdr.roster_date = p_date
  ORDER BY 
    CASE fdr.slot_type 
      WHEN 'active' THEN 1 
      WHEN 'bench' THEN 2 
      WHEN 'ir' THEN 3 
    END,
    fdr.slot_id;
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.get_daily_lineup(UUID, UUID, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.get_daily_lineup(UUID, UUID, DATE) TO anon, authenticated;

-- Add comment
COMMENT ON FUNCTION public.get_daily_lineup IS 
'Returns complete daily lineup with player data for display. Server returns ready-to-render data - zero client-side logic needed. Used for viewing historical frozen lineups.';

-- Create index for better performance on this query pattern
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_team_matchup_date
  ON public.fantasy_daily_rosters(team_id, matchup_id, roster_date);

