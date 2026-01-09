-- World-Class Projection System - Simplified RPC
-- Replace complex calculation RPC with simple SELECT from pre-computed table

-- ============================================================================
-- SIMPLIFIED get_daily_projections RPC
-- ============================================================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.get_daily_projections(INTEGER[], DATE);
DROP FUNCTION IF EXISTS public.get_daily_projections(INTEGER[], TEXT);

-- Create simplified RPC that just SELECTs from pre-computed table
CREATE OR REPLACE FUNCTION public.get_daily_projections(
    p_player_ids INTEGER[],
    p_target_date DATE
)
RETURNS TABLE (
    player_id INTEGER,
    game_id INTEGER,
    projection_date DATE,
    season INTEGER,
    -- Core projections (8 skater stats)
    projected_goals NUMERIC,
    projected_assists NUMERIC,
    projected_sog NUMERIC,
    projected_blocks NUMERIC,
    projected_ppp NUMERIC,
    projected_shp NUMERIC,
    projected_hits NUMERIC,
    projected_pim NUMERIC,
    projected_xg NUMERIC,
    total_projected_points NUMERIC,
    -- Model components (for transparency)
    base_ppg NUMERIC,
    shrinkage_weight NUMERIC,
    finishing_multiplier NUMERIC,
    opponent_adjustment NUMERIC,
    b2b_penalty NUMERIC,
    home_away_adjustment NUMERIC,
    confidence_score NUMERIC,
    calculation_method TEXT,
    -- Matchup context
    opponent_team_id INTEGER,
    opponent_abbrev VARCHAR(3),
    is_home_game BOOLEAN,
    matchup_difficulty NUMERIC,
    injury_status VARCHAR(20),
    game_start_time TIMESTAMPTZ,
    -- Goalie fields
    projected_wins NUMERIC,
    projected_saves NUMERIC,
    projected_shutouts NUMERIC,
    projected_goals_against NUMERIC,
    projected_gaa NUMERIC,
    projected_save_pct NUMERIC,
    projected_gp NUMERIC,
    starter_confirmed BOOLEAN,
    is_goalie BOOLEAN
) AS $$
BEGIN
    -- Simple SELECT from pre-computed table
    -- This is O(1) lookup with proper indexes
    RETURN QUERY
    SELECT 
        pps.player_id,
        pps.game_id,
        pps.projection_date,
        pps.season,
        -- Core projections
        pps.projected_goals,
        pps.projected_assists,
        pps.projected_sog,
        pps.projected_blocks,
        COALESCE(pps.projected_ppp, 0::NUMERIC) as projected_ppp,
        COALESCE(pps.projected_shp, 0::NUMERIC) as projected_shp,
        COALESCE(pps.projected_hits, 0::NUMERIC) as projected_hits,
        COALESCE(pps.projected_pim, 0::NUMERIC) as projected_pim,
        pps.projected_xg,
        pps.total_projected_points,
        -- Model components
        pps.base_ppg,
        pps.shrinkage_weight,
        pps.finishing_multiplier,
        pps.opponent_adjustment,
        pps.b2b_penalty,
        pps.home_away_adjustment,
        pps.confidence_score,
        pps.calculation_method,
        -- Matchup context
        pps.opponent_team_id,
        pps.opponent_abbrev,
        pps.is_home_game,
        COALESCE(pps.matchup_difficulty, 1.0::NUMERIC) as matchup_difficulty,
        COALESCE(pps.injury_status, 'healthy'::VARCHAR(20)) as injury_status,
        pps.game_start_time,
        -- Goalie fields
        COALESCE(pps.projected_wins, 0::NUMERIC) as projected_wins,
        COALESCE(pps.projected_saves, 0::NUMERIC) as projected_saves,
        COALESCE(pps.projected_shutouts, 0::NUMERIC) as projected_shutouts,
        COALESCE(pps.projected_goals_against, 0::NUMERIC) as projected_goals_against,
        COALESCE(pps.projected_gaa, 0::NUMERIC) as projected_gaa,
        COALESCE(pps.projected_save_pct, 0::NUMERIC) as projected_save_pct,
        COALESCE(pps.projected_gp, 0::NUMERIC) as projected_gp,
        COALESCE(pps.starter_confirmed, false) as starter_confirmed,
        COALESCE(pps.is_goalie, false) as is_goalie
    FROM public.player_projected_stats pps
    WHERE pps.player_id = ANY(p_player_ids)
    AND pps.projection_date = p_target_date;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_daily_projections(INTEGER[], DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_projections(INTEGER[], DATE) TO anon;

-- ============================================================================
-- TEXT OVERLOAD (for frontend compatibility)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_daily_projections(
    p_player_ids INTEGER[],
    p_target_date TEXT
)
RETURNS TABLE (
    player_id INTEGER,
    game_id INTEGER,
    projection_date DATE,
    season INTEGER,
    projected_goals NUMERIC,
    projected_assists NUMERIC,
    projected_sog NUMERIC,
    projected_blocks NUMERIC,
    projected_ppp NUMERIC,
    projected_shp NUMERIC,
    projected_hits NUMERIC,
    projected_pim NUMERIC,
    projected_xg NUMERIC,
    total_projected_points NUMERIC,
    base_ppg NUMERIC,
    shrinkage_weight NUMERIC,
    finishing_multiplier NUMERIC,
    opponent_adjustment NUMERIC,
    b2b_penalty NUMERIC,
    home_away_adjustment NUMERIC,
    confidence_score NUMERIC,
    calculation_method TEXT,
    opponent_team_id INTEGER,
    opponent_abbrev VARCHAR(3),
    is_home_game BOOLEAN,
    matchup_difficulty NUMERIC,
    injury_status VARCHAR(20),
    game_start_time TIMESTAMPTZ,
    projected_wins NUMERIC,
    projected_saves NUMERIC,
    projected_shutouts NUMERIC,
    projected_goals_against NUMERIC,
    projected_gaa NUMERIC,
    projected_save_pct NUMERIC,
    projected_gp NUMERIC,
    starter_confirmed BOOLEAN,
    is_goalie BOOLEAN
) AS $$
BEGIN
    -- Convert text to date and call the main function
    RETURN QUERY
    SELECT * FROM public.get_daily_projections(p_player_ids, p_target_date::DATE);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.get_daily_projections(INTEGER[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_projections(INTEGER[], TEXT) TO anon;

-- ============================================================================
-- ROS PROJECTIONS RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ros_projections(
    p_player_ids INTEGER[]
)
RETURNS TABLE (
    player_id INTEGER,
    season INTEGER,
    games_remaining INTEGER,
    total_projected_points NUMERIC,
    projected_goals NUMERIC,
    projected_assists NUMERIC,
    projected_sog NUMERIC,
    projected_blocks NUMERIC,
    avg_points_per_game NUMERIC,
    player_name VARCHAR(100),
    team_abbrev VARCHAR(3),
    position VARCHAR(5),
    is_goalie BOOLEAN,
    projected_wins_ros NUMERIC,
    projected_saves_ros NUMERIC,
    projected_shutouts_ros NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ros.player_id,
        ros.season,
        ros.games_remaining,
        ros.total_projected_points,
        ros.projected_goals,
        ros.projected_assists,
        ros.projected_sog,
        ros.projected_blocks,
        ros.avg_points_per_game,
        ros.player_name,
        ros.team_abbrev,
        ros.position,
        ros.is_goalie,
        ros.projected_wins_ros,
        ros.projected_saves_ros,
        ros.projected_shutouts_ros
    FROM public.player_ros_projections ros
    WHERE ros.player_id = ANY(p_player_ids);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.get_ros_projections(INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ros_projections(INTEGER[]) TO anon;

-- ============================================================================
-- MATCHUP DIFFICULTY RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_matchup_difficulty(
    p_team_abbrev VARCHAR(3),
    p_opponent_abbrev VARCHAR(3),
    p_position VARCHAR(5) DEFAULT NULL
)
RETURNS TABLE (
    position VARCHAR(5),
    difficulty_rating NUMERIC,
    goals_against_avg NUMERIC,
    shots_against_avg NUMERIC
) AS $$
DECLARE
    v_team_id INTEGER;
    v_opponent_id INTEGER;
BEGIN
    -- Get team IDs from abbreviations
    SELECT team_id INTO v_team_id FROM (
        VALUES (1, 'NJD'), (2, 'NYI'), (3, 'NYR'), (4, 'PHI'), (5, 'PIT'),
               (6, 'BOS'), (7, 'BUF'), (8, 'MTL'), (9, 'OTT'), (10, 'TOR'),
               (12, 'CAR'), (13, 'FLA'), (14, 'TBL'), (15, 'WSH'), (16, 'CHI'),
               (17, 'DET'), (18, 'NSH'), (19, 'STL'), (20, 'CGY'), (21, 'COL'),
               (22, 'EDM'), (23, 'VAN'), (24, 'ANA'), (25, 'DAL'), (26, 'LAK'),
               (28, 'SJS'), (29, 'CBJ'), (30, 'MIN'), (52, 'WPG'), (53, 'ARI'),
               (54, 'VGK'), (55, 'SEA'), (59, 'UTA')
    ) AS t(team_id, abbrev) WHERE abbrev = p_team_abbrev;
    
    SELECT team_id INTO v_opponent_id FROM (
        VALUES (1, 'NJD'), (2, 'NYI'), (3, 'NYR'), (4, 'PHI'), (5, 'PIT'),
               (6, 'BOS'), (7, 'BUF'), (8, 'MTL'), (9, 'OTT'), (10, 'TOR'),
               (12, 'CAR'), (13, 'FLA'), (14, 'TBL'), (15, 'WSH'), (16, 'CHI'),
               (17, 'DET'), (18, 'NSH'), (19, 'STL'), (20, 'CGY'), (21, 'COL'),
               (22, 'EDM'), (23, 'VAN'), (24, 'ANA'), (25, 'DAL'), (26, 'LAK'),
               (28, 'SJS'), (29, 'CBJ'), (30, 'MIN'), (52, 'WPG'), (53, 'ARI'),
               (54, 'VGK'), (55, 'SEA'), (59, 'UTA')
    ) AS t(team_id, abbrev) WHERE abbrev = p_opponent_abbrev;
    
    RETURN QUERY
    SELECT 
        tmd.position,
        tmd.difficulty_rating,
        tmd.goals_against_avg,
        tmd.shots_against_avg
    FROM public.team_matchup_difficulty tmd
    WHERE tmd.team_id = v_team_id
    AND tmd.opponent_team_id = v_opponent_id
    AND (p_position IS NULL OR tmd.position = p_position);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.get_matchup_difficulty(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_matchup_difficulty(VARCHAR, VARCHAR, VARCHAR) TO anon;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION public.get_daily_projections(INTEGER[], DATE) IS 
'Lightning-fast projection lookup from pre-computed table. Returns all projection data for specified players on a given date.';

COMMENT ON FUNCTION public.get_ros_projections(INTEGER[]) IS 
'Get rest-of-season aggregate projections for specified players.';

COMMENT ON FUNCTION public.get_matchup_difficulty(VARCHAR, VARCHAR, VARCHAR) IS 
'Get matchup difficulty rating between two teams, optionally filtered by position.';

