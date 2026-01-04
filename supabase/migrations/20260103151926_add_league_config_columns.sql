-- ============================================================================
-- ADD LEAGUE CONFIGURATION COLUMNS
-- ============================================================================
-- Adds league_size and roster_slots columns to leagues table for dynamic
-- replacement level calculations in VOPA scoring.
--
-- league_size: Number of teams in the league (e.g., 12)
-- roster_slots: JSONB object with position-specific roster slots
--   Example: {"C": 2, "LW": 2, "RW": 2, "D": 4, "G": 2}
-- ============================================================================

-- Add league_size column (integer for high-frequency baseline calculations)
ALTER TABLE public.leagues
ADD COLUMN IF NOT EXISTS league_size INTEGER;

-- Add roster_slots column (JSONB for flexible position configuration)
ALTER TABLE public.leagues
ADD COLUMN IF NOT EXISTS roster_slots JSONB DEFAULT '{"C": 2, "LW": 2, "RW": 2, "D": 4, "G": 2}'::jsonb;

-- Create index on league_size for fast lookups during VOPA calculations
CREATE INDEX IF NOT EXISTS idx_leagues_league_size ON public.leagues(league_size) WHERE league_size IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.leagues.league_size IS 'Number of teams in the league. Used for dynamic replacement level calculation: replacement_index = (league_size × roster_slots[position]) + 1';
COMMENT ON COLUMN public.leagues.roster_slots IS 'JSONB object mapping positions to roster slot counts. Example: {"C": 2, "LW": 2, "RW": 2, "D": 4, "G": 2}. Used with league_size to calculate dynamic replacement levels for VOPA.';


