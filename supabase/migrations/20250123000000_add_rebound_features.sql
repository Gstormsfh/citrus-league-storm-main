-- Migration: Add Expected Rebounds Features
-- Date: 2025-01-23
-- Description: Add columns for expected rebound probability and expected goals of expected rebounds

-- Add expected_rebound_probability column
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS expected_rebound_probability NUMERIC DEFAULT 0.0;

-- Add expected_goals_of_expected_rebounds column
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS expected_goals_of_expected_rebounds NUMERIC DEFAULT 0.0;

-- Add comments for documentation
COMMENT ON COLUMN raw_shots.expected_rebound_probability IS 'Probability (0-1) that this shot will generate a rebound, predicted by rebound model';
COMMENT ON COLUMN raw_shots.expected_goals_of_expected_rebounds IS 'Expected goals value of potential rebound shot = rebound_probability × estimated_rebound_shot_xG';

