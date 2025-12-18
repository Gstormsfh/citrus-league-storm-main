-- Create raw_shots table to store individual shot records with coordinates and all features
-- This table enables detailed visualization and analysis of shots and passes

CREATE TABLE IF NOT EXISTS raw_shots (
    id BIGSERIAL PRIMARY KEY,
    
    -- Game and player information
    game_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,  -- Shooter
    passer_id INTEGER,  -- Passer (NULL if no pass)
    
    -- Shot coordinates (NHL coordinate system, net at x=89, y=0)
    shot_x NUMERIC NOT NULL,
    shot_y NUMERIC NOT NULL,
    
    -- Pass coordinates (NULL if no pass detected)
    pass_x NUMERIC,
    pass_y NUMERIC,
    
    -- Shot event details
    shot_type_code INTEGER,  -- 505 = goal, 506 = shot on goal, 507 = missed shot
    shot_type VARCHAR(50),  -- 'wrist', 'snap', 'slap', etc.
    is_goal BOOLEAN DEFAULT FALSE,  -- True if shot resulted in goal
    
    -- Base features
    distance NUMERIC NOT NULL,  -- Distance from shot to net
    angle NUMERIC NOT NULL,  -- Angle from net center (0-90 degrees)
    is_rebound BOOLEAN DEFAULT FALSE,
    is_power_play BOOLEAN DEFAULT FALSE,
    score_differential INTEGER,
    
    -- Pass features
    has_pass_before_shot BOOLEAN DEFAULT FALSE,
    pass_lateral_distance NUMERIC,  -- Lateral distance of pass (NULL if no pass)
    pass_to_net_distance NUMERIC,  -- Distance from pass to net (NULL if no pass)
    pass_zone VARCHAR(50),  -- Zone classification (NULL if no pass)
    pass_immediacy_score NUMERIC,  -- 0-1 immediacy score (NULL if no pass)
    goalie_movement_score NUMERIC,  -- 0-1 movement score (NULL if no pass)
    pass_quality_score NUMERIC,  -- 0-1 quality score (NULL if no pass)
    time_before_shot NUMERIC,  -- Seconds between pass and shot (NULL if no pass)
    pass_angle NUMERIC,  -- Angle from net to pass location (NULL if no pass)
    normalized_lateral_distance NUMERIC,  -- Zone-adjusted lateral distance 0-1 (NULL if no pass)
    zone_relative_distance NUMERIC,  -- Position within zone 0-1 (NULL if no pass)
    
    -- Model predictions
    xg_value NUMERIC NOT NULL,  -- Calculated xG value for this shot
    xa_value NUMERIC,  -- Calculated xA value for pass (NULL if no pass)
    
    -- Encoded features (for model compatibility)
    shot_type_encoded INTEGER,
    pass_zone_encoded INTEGER,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
    
    -- Note: game_id is the NHL game ID (integer, e.g., 2025020453)
    -- It may or may not exist in nhl_games table, so no foreign key constraint
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_raw_shots_game_id ON raw_shots(game_id);
CREATE INDEX IF NOT EXISTS idx_raw_shots_player_id ON raw_shots(player_id);
CREATE INDEX IF NOT EXISTS idx_raw_shots_passer_id ON raw_shots(passer_id);
CREATE INDEX IF NOT EXISTS idx_raw_shots_is_goal ON raw_shots(is_goal);
CREATE INDEX IF NOT EXISTS idx_raw_shots_has_pass ON raw_shots(has_pass_before_shot);
CREATE INDEX IF NOT EXISTS idx_raw_shots_pass_zone ON raw_shots(pass_zone);
CREATE INDEX IF NOT EXISTS idx_raw_shots_created_at ON raw_shots(created_at);

-- Add comment to explain the table
COMMENT ON TABLE raw_shots IS 'Individual shot records with coordinates and all calculated features for visualization and analysis';
COMMENT ON COLUMN raw_shots.shot_x IS 'X coordinate of shot location (NHL coordinates, net at x=89)';
COMMENT ON COLUMN raw_shots.shot_y IS 'Y coordinate of shot location (NHL coordinates, net at y=0)';
COMMENT ON COLUMN raw_shots.pass_x IS 'X coordinate of pass location (NULL if no pass detected)';
COMMENT ON COLUMN raw_shots.pass_y IS 'Y coordinate of pass location (NULL if no pass detected)';
COMMENT ON COLUMN raw_shots.pass_zone IS 'Zone classification: crease, slot_low_angle, slot_high_angle, high_slot_low_angle, high_slot_high_angle, blue_line_low_angle, blue_line_high_angle, deep, no_pass';
COMMENT ON COLUMN raw_shots.normalized_lateral_distance IS 'Zone-adjusted lateral distance (0-1). Accounts for zone context: 5ft in crease is weighted more than 5ft from blue line.';
COMMENT ON COLUMN raw_shots.zone_relative_distance IS 'Position within zone (0-1). 0 = start of zone (closer to net), 1 = end of zone (farther from net).';

