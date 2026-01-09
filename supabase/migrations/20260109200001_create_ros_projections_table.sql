-- World-Class Projection System - Rest-of-Season Aggregates Table
-- Pre-computed ROS totals for instant trade analyzer and waiver decisions

-- ============================================================================
-- CREATE ROS PROJECTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.player_ros_projections (
    player_id INTEGER PRIMARY KEY,
    season INTEGER NOT NULL,
    
    -- Game counts
    games_remaining INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    
    -- Aggregate projections (rest of season totals)
    total_projected_points NUMERIC(8,2) DEFAULT 0,
    projected_goals NUMERIC(6,2) DEFAULT 0,
    projected_assists NUMERIC(6,2) DEFAULT 0,
    projected_sog NUMERIC(6,2) DEFAULT 0,
    projected_blocks NUMERIC(6,2) DEFAULT 0,
    projected_ppp NUMERIC(6,2) DEFAULT 0,
    projected_shp NUMERIC(6,2) DEFAULT 0,
    projected_hits NUMERIC(6,2) DEFAULT 0,
    projected_pim NUMERIC(6,2) DEFAULT 0,
    
    -- Per-game averages
    avg_points_per_game NUMERIC(4,2) DEFAULT 0,
    avg_goals_per_game NUMERIC(4,3) DEFAULT 0,
    avg_assists_per_game NUMERIC(4,3) DEFAULT 0,
    
    -- Playoff projections (typically weeks 21-23)
    playoff_games INTEGER DEFAULT 0,
    playoff_week_projection NUMERIC(6,2) DEFAULT 0,
    
    -- Goalie-specific ROS
    projected_wins_ros NUMERIC(5,2) DEFAULT 0,
    projected_saves_ros NUMERIC(7,2) DEFAULT 0,
    projected_shutouts_ros NUMERIC(4,2) DEFAULT 0,
    
    -- Player metadata for quick lookups
    player_name VARCHAR(100),
    team_abbrev VARCHAR(3),
    position VARCHAR(5),
    is_goalie BOOLEAN DEFAULT false,
    
    -- Timestamps
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Primary lookup by player
CREATE INDEX IF NOT EXISTS idx_ros_player ON public.player_ros_projections(player_id);

-- Season filtering
CREATE INDEX IF NOT EXISTS idx_ros_season ON public.player_ros_projections(season);

-- Leaderboard queries (sort by total points)
CREATE INDEX IF NOT EXISTS idx_ros_total_points ON public.player_ros_projections(total_projected_points DESC);

-- Position filtering for positional rankings
CREATE INDEX IF NOT EXISTS idx_ros_position ON public.player_ros_projections(position, total_projected_points DESC);

-- Team filtering
CREATE INDEX IF NOT EXISTS idx_ros_team ON public.player_ros_projections(team_abbrev);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE public.player_ros_projections ENABLE ROW LEVEL SECURITY;

-- Public can view ROS projections
CREATE POLICY "Public can view ROS projections"
ON public.player_ros_projections
FOR SELECT
USING (true);

-- Service role can manage ROS projections
CREATE POLICY "Service role can manage ROS projections"
ON public.player_ros_projections
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Authenticated users can also manage (for development)
CREATE POLICY "Authenticated users can manage ROS projections"
ON public.player_ros_projections
FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- ============================================================================
-- TRIGGER FOR UPDATED_AT
-- ============================================================================

CREATE TRIGGER update_player_ros_projections_updated_at
    BEFORE UPDATE ON public.player_ros_projections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.player_ros_projections IS 'Pre-computed rest-of-season projection aggregates for instant trade analyzer and waiver decisions. Updated nightly.';
COMMENT ON COLUMN public.player_ros_projections.games_remaining IS 'Number of games remaining in the regular season for this player';
COMMENT ON COLUMN public.player_ros_projections.total_projected_points IS 'Total projected fantasy points for remaining games';
COMMENT ON COLUMN public.player_ros_projections.avg_points_per_game IS 'Average projected points per game for remaining schedule';
COMMENT ON COLUMN public.player_ros_projections.playoff_week_projection IS 'Total projected points during fantasy playoff weeks (typically weeks 21-23)';

