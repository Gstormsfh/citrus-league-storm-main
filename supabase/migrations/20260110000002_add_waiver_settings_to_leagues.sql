-- Add waiver system settings to leagues table
-- These are commissioner-controlled settings that match Yahoo/Sleeper functionality

ALTER TABLE leagues
ADD COLUMN IF NOT EXISTS waiver_process_time TIME DEFAULT '03:00:00',
ADD COLUMN IF NOT EXISTS waiver_period_hours INT DEFAULT 48,
ADD COLUMN IF NOT EXISTS waiver_game_lock BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS waiver_type TEXT DEFAULT 'rolling' CHECK (waiver_type IN ('rolling', 'faab', 'reverse_standings')),
ADD COLUMN IF NOT EXISTS allow_trades_during_games BOOLEAN DEFAULT true;

-- Add comments for documentation
COMMENT ON COLUMN leagues.waiver_process_time IS 'Time of day (EST) when waiver claims are processed';
COMMENT ON COLUMN leagues.waiver_period_hours IS 'Hours a dropped player remains on waivers (default 48 = 2 days)';
COMMENT ON COLUMN leagues.waiver_game_lock IS 'If true, players cannot be picked up while their game is in progress or just finished';
COMMENT ON COLUMN leagues.waiver_type IS 'Type of waiver system: rolling (priority-based), faab (bidding), or reverse_standings';
COMMENT ON COLUMN leagues.allow_trades_during_games IS 'If true, trades can involve locked players (default: trades bypass game lock)';
