-- Add comprehensive MoneyPuck-inspired features to raw_shots table
-- This migration adds 53+ new columns covering TOI, team composition, defender proximity, and advanced shot quality
-- Based on MoneyPuck data dictionary analysis

-- ============================================================================
-- PHASE 0: ARENA ADJUSTED COORDINATES (Schuckers/Curro Method)
-- ============================================================================
-- Note: arena_adjusted_x, arena_adjusted_y, arena_adjusted_shot_distance already exist
-- from previous migrations. This is for reference.

-- ============================================================================
-- MONEYPUCK METHODOLOGY ALIGNMENT: Core 15 Variables
-- ============================================================================

-- MoneyPuck Variable 6: East-West Location on Ice of Last Event
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS east_west_location_of_last_event NUMERIC;

-- MoneyPuck Variable 9: Other team's # of skaters on ice (defending team)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS defending_team_skaters_on_ice INTEGER;

-- MoneyPuck Variable 10: East-West Location on Ice of Shot
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS east_west_location_of_shot NUMERIC;

-- MoneyPuck Variable 12: Time since current Powerplay started
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS time_since_powerplay_started NUMERIC;

-- MoneyPuck Variable 14: North-South Location on Ice of Shot
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS north_south_location_of_shot NUMERIC;

-- Flurry Adjusted Expected Goals (post-processing)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS flurry_adjusted_xg NUMERIC;

-- ============================================================================
-- PHASE 1: COMPREHENSIVE TIME-ON-ICE (TOI) FEATURES (36 features)
-- ============================================================================

-- Shooter TOI Metrics (2 features)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shooter_time_on_ice NUMERIC,
ADD COLUMN IF NOT EXISTS shooter_time_on_ice_since_faceoff NUMERIC;

-- Shooting Team TOI Metrics (18 features)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shooting_team_average_time_on_ice NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_max_time_on_ice NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_min_time_on_ice NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_average_time_on_ice_of_forwards NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_max_time_on_ice_of_forwards NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_min_time_on_ice_of_forwards NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_average_time_on_ice_of_defencemen NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_max_time_on_ice_of_defencemen NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_min_time_on_ice_of_defencemen NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_average_time_on_ice_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_max_time_on_ice_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_min_time_on_ice_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_average_time_on_ice_of_forwards_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_max_time_on_ice_of_forwards_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_min_time_on_ice_of_forwards_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_average_time_on_ice_of_defencemen_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_max_time_on_ice_of_defencemen_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS shooting_team_min_time_on_ice_of_defencemen_since_faceoff NUMERIC;

-- Defending Team TOI Metrics (18 features)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS defending_team_average_time_on_ice NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_max_time_on_ice NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_min_time_on_ice NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_average_time_on_ice_of_forwards NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_max_time_on_ice_of_forwards NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_min_time_on_ice_of_forwards NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_average_time_on_ice_of_defencemen NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_max_time_on_ice_of_defencemen NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_min_time_on_ice_of_defencemen NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_average_time_on_ice_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_max_time_on_ice_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_min_time_on_ice_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_average_time_on_ice_of_forwards_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_max_time_on_ice_of_forwards_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_min_time_on_ice_of_forwards_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_average_time_on_ice_of_defencemen_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_max_time_on_ice_of_defencemen_since_faceoff NUMERIC,
ADD COLUMN IF NOT EXISTS defending_team_min_time_on_ice_of_defencemen_since_faceoff NUMERIC;

-- Rest/Fatigue Difference Features (2 features)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS time_difference_since_change NUMERIC,
ADD COLUMN IF NOT EXISTS average_rest_difference NUMERIC;

-- ============================================================================
-- PHASE 2: TEAM COMPOSITION FEATURES (4 features)
-- ============================================================================
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shooting_team_forwards_on_ice INTEGER,
ADD COLUMN IF NOT EXISTS shooting_team_defencemen_on_ice INTEGER,
ADD COLUMN IF NOT EXISTS defending_team_forwards_on_ice INTEGER,
ADD COLUMN IF NOT EXISTS defending_team_defencemen_on_ice INTEGER;

-- ============================================================================
-- PHASE 3: DEFENDER PROXIMITY FEATURES (3 features)
-- ============================================================================
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS distance_to_nearest_defender NUMERIC,
ADD COLUMN IF NOT EXISTS skaters_in_screening_box INTEGER,
ADD COLUMN IF NOT EXISTS nearest_defender_to_net_distance NUMERIC;

-- ============================================================================
-- PHASE 4: ADVANCED SHOT QUALITY FEATURES (7 features)
-- ============================================================================

-- Angle and Distance Change (3 features)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS angle_change_from_last_event NUMERIC,
ADD COLUMN IF NOT EXISTS angle_change_squared NUMERIC,
ADD COLUMN IF NOT EXISTS distance_change_from_last_event NUMERIC;

-- Advanced Rebound Features (2 features)
-- Note: shot_angle_plus_rebound and shot_angle_plus_rebound_speed already exist
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shot_angle_rebound_royal_road INTEGER DEFAULT 0;

-- Player Position (1 feature)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS player_position VARCHAR(1);  -- 'L', 'R', 'D', 'C'

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN raw_shots.shooter_time_on_ice IS 'Time on ice in seconds for shooter since shift start (MoneyPuck: shooterTimeOnIce)';
COMMENT ON COLUMN raw_shots.shooter_time_on_ice_since_faceoff IS 'Time on ice since last faceoff for shooter (MoneyPuck: shooterTimeOnIceSinceFaceoff)';
COMMENT ON COLUMN raw_shots.shooting_team_average_time_on_ice IS 'Average TOI for all shooting team skaters (MoneyPuck: shootingTeamAverageTimeOnIce)';
COMMENT ON COLUMN raw_shots.shooting_team_min_time_on_ice IS 'Minimum TOI for shooting team (999 if missing, MoneyPuck standard)';
COMMENT ON COLUMN raw_shots.shooting_team_max_time_on_ice IS 'Maximum TOI for shooting team (0 if missing, MoneyPuck standard)';
COMMENT ON COLUMN raw_shots.time_difference_since_change IS 'Shooting team min TOI - defending team min TOI (MoneyPuck: timeDifferenceSinceChange)';
COMMENT ON COLUMN raw_shots.average_rest_difference IS 'Shooting team avg TOI since faceoff - defending team avg TOI since faceoff (MoneyPuck: averageRestDifference)';
COMMENT ON COLUMN raw_shots.shooting_team_forwards_on_ice IS 'Number of forwards on ice for shooting team (MoneyPuck: shootingTeamForwardsOnIce)';
COMMENT ON COLUMN raw_shots.shooting_team_defencemen_on_ice IS 'Number of defencemen on ice for shooting team (MoneyPuck: shootingTeamDefencemenOnIce)';
COMMENT ON COLUMN raw_shots.distance_to_nearest_defender IS 'Distance in feet to nearest defending skater (MoneyPuck feature)';
COMMENT ON COLUMN raw_shots.skaters_in_screening_box IS 'Number of skaters in 8ft×8ft screening box (4ft from goal line)';
COMMENT ON COLUMN raw_shots.angle_change_from_last_event IS 'Change in shot angle from last event (degrees)';
COMMENT ON COLUMN raw_shots.shot_angle_rebound_royal_road IS '1 if rebound and puck crossed middle (y changed sign), else 0 (MoneyPuck: shotAngleReboundRoyalRoad)';
COMMENT ON COLUMN raw_shots.player_position IS 'Player position: L=Left Wing, R=Right Wing, D=Defenceman, C=Centre (MoneyPuck: playerPositionThatDidEvent)';
COMMENT ON COLUMN raw_shots.east_west_location_of_last_event IS 'East-West (Y) coordinate of last event before shot (MoneyPuck Variable 6)';
COMMENT ON COLUMN raw_shots.east_west_location_of_shot IS 'East-West (Y) coordinate of shot location (MoneyPuck Variable 10)';
COMMENT ON COLUMN raw_shots.north_south_location_of_shot IS 'North-South (X) coordinate of shot location (MoneyPuck Variable 14)';
COMMENT ON COLUMN raw_shots.defending_team_skaters_on_ice IS 'Number of skaters on ice for defending team (MoneyPuck Variable 9: Other team''s # of skaters)';
COMMENT ON COLUMN raw_shots.time_since_powerplay_started IS 'Time in seconds since current powerplay started (MoneyPuck Variable 12)';
COMMENT ON COLUMN raw_shots.flurry_adjusted_xg IS 'Flurry adjusted expected goals (post-processing adjustment for shot sequences)';

