-- Migration: Add Shooting Talent Adjusted Expected Goals Features
-- Date: 2025-01-23
-- Description: Add columns for shooting talent adjusted xG and talent multiplier

-- Add shooting_talent_adjusted_xg column
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shooting_talent_adjusted_xg NUMERIC;

-- Add shooting_talent_multiplier column
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shooting_talent_multiplier NUMERIC DEFAULT 1.0;

-- Add created_expected_goals column (Phase 3: Created Expected Goals)
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS created_expected_goals NUMERIC DEFAULT 0.0;

-- Add comments for documentation
COMMENT ON COLUMN raw_shots.shooting_talent_adjusted_xg IS 'xG value adjusted for player shooting talent (Bayesian estimation)';
COMMENT ON COLUMN raw_shots.shooting_talent_multiplier IS 'Multiplier applied to base xG based on player historical shooting performance (1.0 = average, >1.0 = above average, <1.0 = below average)';
COMMENT ON COLUMN raw_shots.created_expected_goals IS 'Created Expected Goals = xG from non-rebound shots + xGoals of xRebounds (credits players for generating rebound opportunities)';

