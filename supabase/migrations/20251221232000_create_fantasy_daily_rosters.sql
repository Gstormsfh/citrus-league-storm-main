-- Create fantasy_daily_rosters table
-- Tracks daily roster snapshots for each team in each matchup
-- This is the "record of truth" for scoring - tracks who was active vs bench each day

CREATE TABLE IF NOT EXISTS public.fantasy_daily_rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  matchup_id UUID REFERENCES public.matchups(id) ON DELETE CASCADE NOT NULL,
  player_id INTEGER NOT NULL, -- References player_directory.id
  roster_date DATE NOT NULL, -- e.g., '2025-12-15' (Monday of matchup week)
  slot_type TEXT NOT NULL CHECK (slot_type IN ('active', 'bench', 'ir')), -- Where player was on this date
  slot_id TEXT, -- e.g., 'slot-C-1', 'slot-G-2', 'ir-slot-1' (for active/IR only)
  is_locked BOOLEAN DEFAULT false NOT NULL, -- True once player's game starts
  locked_at TIMESTAMPTZ, -- When the lock was applied
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure one record per player per day per team
  UNIQUE(team_id, matchup_id, player_id, roster_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_matchup_date 
  ON public.fantasy_daily_rosters(matchup_id, roster_date);
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_team_date 
  ON public.fantasy_daily_rosters(team_id, roster_date);
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_player_date 
  ON public.fantasy_daily_rosters(player_id, roster_date);
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_locked 
  ON public.fantasy_daily_rosters(is_locked, roster_date);
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_active 
  ON public.fantasy_daily_rosters(matchup_id, roster_date, slot_type) 
  WHERE slot_type = 'active';

-- Enable RLS
ALTER TABLE public.fantasy_daily_rosters ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read daily rosters (all users can see all teams' rosters)
CREATE POLICY "Enable read access for all users"
ON public.fantasy_daily_rosters
FOR SELECT
USING (true);

-- Allow authenticated users to update daily rosters
CREATE POLICY "Enable update access for authenticated users"
ON public.fantasy_daily_rosters
FOR ALL
USING (true)
WITH CHECK (true);

-- Add trigger to update updated_at timestamp
CREATE TRIGGER update_fantasy_daily_rosters_updated_at
  BEFORE UPDATE ON public.fantasy_daily_rosters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.fantasy_daily_rosters IS 'Daily roster snapshots - tracks which players were active/bench/IR each day of matchup week. Used for daily scoring calculations.';
COMMENT ON COLUMN public.fantasy_daily_rosters.roster_date IS 'Date of the roster snapshot (Monday-Sunday of matchup week)';
COMMENT ON COLUMN public.fantasy_daily_rosters.slot_type IS 'Where player was on this date: active (in starting lineup), bench, or ir';
COMMENT ON COLUMN public.fantasy_daily_rosters.is_locked IS 'True once player''s game has started - prevents roster changes for that day';
COMMENT ON COLUMN public.fantasy_daily_rosters.locked_at IS 'Timestamp when the lock was applied (when game started)';
