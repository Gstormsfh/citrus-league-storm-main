-- Add boxscore_json column to raw_nhl_data table
-- This stores the boxscore JSON from NHL API alongside the play-by-play data
-- Boxscore properly structures players in ["forwards", "defense", "goalies"] groups
-- This ensures defencemen stats are captured correctly

ALTER TABLE public.raw_nhl_data
ADD COLUMN IF NOT EXISTS boxscore_json JSONB;

-- Add comment
COMMENT ON COLUMN public.raw_nhl_data.boxscore_json IS 'Full boxscore JSON response from NHL API boxscore endpoint. Contains player stats organized by position groups (forwards, defense, goalies) for proper defencemen handling.';

-- Create index for faster queries on boxscore data
CREATE INDEX IF NOT EXISTS idx_raw_nhl_data_boxscore_json ON public.raw_nhl_data USING gin (boxscore_json);



