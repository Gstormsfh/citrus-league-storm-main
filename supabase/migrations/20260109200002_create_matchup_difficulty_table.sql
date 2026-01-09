-- World-Class Projection System - Team Matchup Difficulty Ratings
-- Pre-computed difficulty ratings for position-specific matchup analysis

-- ============================================================================
-- CREATE MATCHUP DIFFICULTY TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.team_matchup_difficulty (
    team_id INTEGER NOT NULL,
    opponent_team_id INTEGER NOT NULL,
    position VARCHAR(5) NOT NULL,  -- C, LW, RW, D, G
    
    -- Difficulty rating (1.0 = average)
    -- 0.8 = easy matchup (favorable for fantasy)
    -- 1.2 = hard matchup (unfavorable for fantasy)
    difficulty_rating NUMERIC(3,2) DEFAULT 1.00 NOT NULL,
    
    -- Supporting stats
    goals_against_avg NUMERIC(4,2) DEFAULT 0,
    shots_against_avg NUMERIC(5,2) DEFAULT 0,
    xg_against_avg NUMERIC(4,2) DEFAULT 0,
    
    -- Position-specific metrics
    position_goals_against NUMERIC(4,2) DEFAULT 0,  -- Goals allowed to this position
    position_points_against NUMERIC(4,2) DEFAULT 0, -- Points allowed to this position
    position_shots_against NUMERIC(5,2) DEFAULT 0,  -- Shots allowed to this position
    
    -- Sample size for confidence
    games_analyzed INTEGER DEFAULT 0,
    
    -- Timestamps
    season INTEGER NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    PRIMARY KEY (team_id, opponent_team_id, position, season)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Primary lookup: team vs opponent by position
CREATE INDEX IF NOT EXISTS idx_matchup_team_opp 
ON public.team_matchup_difficulty(team_id, opponent_team_id);

-- Position-based queries
CREATE INDEX IF NOT EXISTS idx_matchup_position 
ON public.team_matchup_difficulty(position, difficulty_rating);

-- Season filtering
CREATE INDEX IF NOT EXISTS idx_matchup_season 
ON public.team_matchup_difficulty(season);

-- Find easiest/hardest matchups
CREATE INDEX IF NOT EXISTS idx_matchup_difficulty 
ON public.team_matchup_difficulty(difficulty_rating);

-- ============================================================================
-- TEAM DEFENSIVE RANKINGS VIEW (for quick lookups)
-- ============================================================================

CREATE OR REPLACE VIEW public.team_defensive_rankings AS
SELECT 
    team_id,
    season,
    AVG(difficulty_rating) as overall_difficulty,
    AVG(CASE WHEN position = 'C' THEN difficulty_rating END) as center_difficulty,
    AVG(CASE WHEN position IN ('LW', 'RW') THEN difficulty_rating END) as wing_difficulty,
    AVG(CASE WHEN position = 'D' THEN difficulty_rating END) as defense_difficulty,
    AVG(CASE WHEN position = 'G' THEN difficulty_rating END) as goalie_difficulty,
    AVG(goals_against_avg) as avg_goals_against,
    AVG(shots_against_avg) as avg_shots_against
FROM public.team_matchup_difficulty
GROUP BY team_id, season;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE public.team_matchup_difficulty ENABLE ROW LEVEL SECURITY;

-- Public can view matchup difficulty
CREATE POLICY "Public can view matchup difficulty"
ON public.team_matchup_difficulty
FOR SELECT
USING (true);

-- Service role can manage matchup difficulty
CREATE POLICY "Service role can manage matchup difficulty"
ON public.team_matchup_difficulty
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Authenticated users can also manage (for development)
CREATE POLICY "Authenticated users can manage matchup difficulty"
ON public.team_matchup_difficulty
FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.team_matchup_difficulty IS 'Position-specific matchup difficulty ratings between teams. Used for matchup indicators in UI.';
COMMENT ON COLUMN public.team_matchup_difficulty.difficulty_rating IS 'Matchup difficulty (0.8 = easy/green, 1.0 = average/yellow, 1.2 = hard/red)';
COMMENT ON COLUMN public.team_matchup_difficulty.position IS 'Position this rating applies to: C, LW, RW, D, or G';
COMMENT ON VIEW public.team_defensive_rankings IS 'Aggregated defensive rankings by team for quick lookups';

