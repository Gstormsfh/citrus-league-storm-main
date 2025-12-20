-- Create fantasy_matchup_lines table
-- Stores pre-calculated fantasy points for each player in each matchup
-- Enables high-performance reads and detailed traceability

CREATE TABLE IF NOT EXISTS public.fantasy_matchup_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matchup_id UUID REFERENCES public.matchups(id) ON DELETE CASCADE NOT NULL,
    player_id INTEGER NOT NULL, -- References player_directory.id
    team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
    
    -- Calculated totals (NUMERIC(10,3) for fractional scoring support)
    total_points NUMERIC(10, 3) DEFAULT 0 NOT NULL,
    
    -- Detailed breakdown for traceability
    -- Example: {
    --   "goals": 2, "assists": 1,
    --   "points_from_goals": 6, "points_from_assists": 2,
    --   "points_from_blocks": 0.5, "fractional_adjustment": 0.15
    -- }
    stats_breakdown JSONB DEFAULT '{}'::jsonb NOT NULL,
    
    -- Enhanced games remaining tracking
    games_played INTEGER DEFAULT 0 NOT NULL,
    games_remaining_total INTEGER DEFAULT 0 NOT NULL,  -- All rostered games
    games_remaining_active INTEGER DEFAULT 0 NOT NULL,  -- Starting lineup games only
    
    -- Live game status tracking
    has_live_game BOOLEAN DEFAULT false NOT NULL,
    live_game_locked BOOLEAN DEFAULT false NOT NULL,  -- Prevents updates during live scoring
    
    -- Metadata
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Constraints
    UNIQUE(matchup_id, player_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_fantasy_matchup_lines_matchup_id ON public.fantasy_matchup_lines(matchup_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_matchup_lines_team_id ON public.fantasy_matchup_lines(team_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_matchup_lines_player_id ON public.fantasy_matchup_lines(player_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_matchup_lines_updated_at ON public.fantasy_matchup_lines(updated_at);
CREATE INDEX IF NOT EXISTS idx_fantasy_matchup_lines_live ON public.fantasy_matchup_lines(has_live_game, live_game_locked);

-- Enable RLS
ALTER TABLE public.fantasy_matchup_lines ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view matchup lines for their leagues
CREATE POLICY "Users can view matchup lines in their leagues"
ON public.fantasy_matchup_lines
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.matchups m
    JOIN public.leagues l ON l.id = m.league_id
    WHERE m.id = fantasy_matchup_lines.matchup_id
    AND (
      l.commissioner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.league_id = l.id
        AND t.owner_id = auth.uid()
      )
    )
  )
);

-- RLS Policy: System can insert/update (via service role)
-- Note: This will be handled by the Python script using service role key

-- Add trigger to update updated_at
CREATE TRIGGER update_fantasy_matchup_lines_updated_at
  BEFORE UPDATE ON public.fantasy_matchup_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE public.fantasy_matchup_lines IS 'Pre-calculated fantasy points for each player in each matchup. Enables high-performance reads and detailed traceability.';
COMMENT ON COLUMN public.fantasy_matchup_lines.total_points IS 'Total fantasy points (NUMERIC(10,3) supports fractional scoring)';
COMMENT ON COLUMN public.fantasy_matchup_lines.stats_breakdown IS 'Detailed JSONB breakdown showing how points were calculated for traceability';
COMMENT ON COLUMN public.fantasy_matchup_lines.games_remaining_total IS 'Total games remaining for all rostered players';
COMMENT ON COLUMN public.fantasy_matchup_lines.games_remaining_active IS 'Games remaining for players in starting lineup only';
COMMENT ON COLUMN public.fantasy_matchup_lines.live_game_locked IS 'Prevents updates during live games to avoid user confusion';
