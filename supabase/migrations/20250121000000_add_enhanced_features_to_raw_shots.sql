-- Add enhanced features to raw_shots table to match MoneyPuck's data richness
-- This migration adds ~30 new columns for situation, last event, goalie, time, team context, outcomes, and rush detection

-- Situation features
ALTER TABLE raw_shots 
ADD COLUMN IF NOT EXISTS home_skaters_on_ice INTEGER,
ADD COLUMN IF NOT EXISTS away_skaters_on_ice INTEGER,
ADD COLUMN IF NOT EXISTS is_empty_net BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS penalty_length INTEGER,
ADD COLUMN IF NOT EXISTS penalty_time_left INTEGER;

-- Last event features
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS last_event_category VARCHAR(50),
ADD COLUMN IF NOT EXISTS last_event_x NUMERIC,
ADD COLUMN IF NOT EXISTS last_event_y NUMERIC,
ADD COLUMN IF NOT EXISTS last_event_team VARCHAR(10),
ADD COLUMN IF NOT EXISTS distance_from_last_event NUMERIC,
ADD COLUMN IF NOT EXISTS time_since_last_event NUMERIC,
ADD COLUMN IF NOT EXISTS speed_from_last_event NUMERIC;

-- Goalie features
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS goalie_id INTEGER,
ADD COLUMN IF NOT EXISTS goalie_name VARCHAR(100);

-- Period/time features
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS period INTEGER,
ADD COLUMN IF NOT EXISTS time_in_period VARCHAR(10),
ADD COLUMN IF NOT EXISTS time_remaining_seconds INTEGER,
ADD COLUMN IF NOT EXISTS time_since_faceoff NUMERIC;

-- Team context features
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS team_code VARCHAR(10),
ADD COLUMN IF NOT EXISTS is_home_team BOOLEAN,
ADD COLUMN IF NOT EXISTS zone VARCHAR(20),
ADD COLUMN IF NOT EXISTS home_score INTEGER,
ADD COLUMN IF NOT EXISTS away_score INTEGER;

-- Shot outcome features
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shot_was_on_goal BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS shot_goalie_froze BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS shot_generated_rebound BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS shot_play_stopped BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS shot_play_continued_in_zone BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS shot_play_continued_outside_zone BOOLEAN DEFAULT FALSE;

-- Rush detection
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS is_rush BOOLEAN DEFAULT FALSE;

-- Additional raw data fields (maximize extraction from API)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS event_id INTEGER,
ADD COLUMN IF NOT EXISTS sort_order INTEGER,
ADD COLUMN IF NOT EXISTS type_desc VARCHAR(100),
ADD COLUMN IF NOT EXISTS period_type VARCHAR(20),
ADD COLUMN IF NOT EXISTS time_remaining VARCHAR(10),
ADD COLUMN IF NOT EXISTS situation_code VARCHAR(20),
ADD COLUMN IF NOT EXISTS home_team_defending_side VARCHAR(10),
ADD COLUMN IF NOT EXISTS zone_code VARCHAR(10),
ADD COLUMN IF NOT EXISTS shooting_player_id INTEGER,
ADD COLUMN IF NOT EXISTS scoring_player_id INTEGER,
ADD COLUMN IF NOT EXISTS assist1_player_id INTEGER,
ADD COLUMN IF NOT EXISTS assist2_player_id INTEGER,
ADD COLUMN IF NOT EXISTS goalie_in_net_id INTEGER,
ADD COLUMN IF NOT EXISTS event_owner_team_id INTEGER,
ADD COLUMN IF NOT EXISTS home_team_id INTEGER,
ADD COLUMN IF NOT EXISTS away_team_id INTEGER,
ADD COLUMN IF NOT EXISTS home_team_abbrev VARCHAR(10),
ADD COLUMN IF NOT EXISTS away_team_abbrev VARCHAR(10),
ADD COLUMN IF NOT EXISTS away_sog INTEGER,
ADD COLUMN IF NOT EXISTS home_sog INTEGER,
ADD COLUMN IF NOT EXISTS shot_type_raw VARCHAR(50),
ADD COLUMN IF NOT EXISTS miss_reason VARCHAR(100);

-- Additional calculated features (from feature_calculations.py)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS arena_adjusted_x NUMERIC,
ADD COLUMN IF NOT EXISTS arena_adjusted_y NUMERIC,
ADD COLUMN IF NOT EXISTS arena_adjusted_x_abs NUMERIC,
ADD COLUMN IF NOT EXISTS arena_adjusted_y_abs NUMERIC,
ADD COLUMN IF NOT EXISTS arena_adjusted_shot_distance NUMERIC,
ADD COLUMN IF NOT EXISTS shot_angle_plus_rebound NUMERIC,
ADD COLUMN IF NOT EXISTS shot_angle_plus_rebound_speed NUMERIC,
ADD COLUMN IF NOT EXISTS last_event_shot_angle NUMERIC,
ADD COLUMN IF NOT EXISTS last_event_shot_distance NUMERIC,
ADD COLUMN IF NOT EXISTS player_num_that_did_last_event INTEGER;

-- Create indexes for commonly queried new fields
CREATE INDEX IF NOT EXISTS idx_raw_shots_period ON raw_shots(period);
CREATE INDEX IF NOT EXISTS idx_raw_shots_zone ON raw_shots(zone);
CREATE INDEX IF NOT EXISTS idx_raw_shots_is_rush ON raw_shots(is_rush);
CREATE INDEX IF NOT EXISTS idx_raw_shots_goalie_id ON raw_shots(goalie_id);
CREATE INDEX IF NOT EXISTS idx_raw_shots_last_event_category ON raw_shots(last_event_category);

-- Add comments
COMMENT ON COLUMN raw_shots.home_skaters_on_ice IS 'Number of home team skaters on ice (typically 5, 6 for empty net)';
COMMENT ON COLUMN raw_shots.away_skaters_on_ice IS 'Number of away team skaters on ice (typically 5, 6 for empty net)';
COMMENT ON COLUMN raw_shots.is_empty_net IS 'True if goalie was pulled (empty net situation)';
COMMENT ON COLUMN raw_shots.last_event_category IS 'Category of previous event (FAC, SHOT, GOAL, etc.)';
COMMENT ON COLUMN raw_shots.distance_from_last_event IS 'Distance in feet from last event location to shot location';
COMMENT ON COLUMN raw_shots.time_since_last_event IS 'Seconds between last event and shot';
COMMENT ON COLUMN raw_shots.speed_from_last_event IS 'Speed in feet per second from last event to shot';
COMMENT ON COLUMN raw_shots.goalie_id IS 'NHL player ID of goalie in net for this shot';
COMMENT ON COLUMN raw_shots.period IS 'Period number (1, 2, 3, or 4+ for overtime)';
COMMENT ON COLUMN raw_shots.zone IS 'Zone where shot occurred: HOMEZONE, AWAYZONE, or NEUTRALZONE';
COMMENT ON COLUMN raw_shots.is_rush IS 'True if shot came from a rush (fast break from neutral/defensive zone)';
COMMENT ON COLUMN raw_shots.shot_goalie_froze IS 'True if goalie froze the puck after this shot';
COMMENT ON COLUMN raw_shots.shot_generated_rebound IS 'True if this shot created a rebound opportunity';

