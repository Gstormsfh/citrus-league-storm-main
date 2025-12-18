-- Migration: Ensure All New Features Are Added
-- Date: 2025-01-23
-- Description: Combined migration to ensure all new feature columns exist
-- This is a safety migration that can be run even if previous migrations were partially applied

-- Rebound Features
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS expected_rebound_probability NUMERIC DEFAULT 0.0;

ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS expected_goals_of_expected_rebounds NUMERIC DEFAULT 0.0;

-- Shooting Talent Features
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shooting_talent_adjusted_xg NUMERIC;

ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS shooting_talent_multiplier NUMERIC DEFAULT 1.0;

-- Created Expected Goals
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS created_expected_goals NUMERIC DEFAULT 0.0;

-- Add/Update comments for documentation
COMMENT ON COLUMN raw_shots.expected_rebound_probability IS 'Probability (0-1) that this shot will generate a rebound, predicted by rebound model';
COMMENT ON COLUMN raw_shots.expected_goals_of_expected_rebounds IS 'Expected goals value of potential rebound shot = rebound_probability × estimated_rebound_shot_xG';
COMMENT ON COLUMN raw_shots.shooting_talent_adjusted_xg IS 'xG value adjusted for player shooting talent (Bayesian estimation)';
COMMENT ON COLUMN raw_shots.shooting_talent_multiplier IS 'Multiplier applied to base xG based on player historical shooting performance (1.0 = average, >1.0 = above average, <1.0 = below average)';
COMMENT ON COLUMN raw_shots.created_expected_goals IS 'Created Expected Goals = xG from non-rebound shots + xGoals of xRebounds (credits players for generating rebound opportunities)';

