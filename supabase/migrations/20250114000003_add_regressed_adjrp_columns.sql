-- Migration: Add regressed AdjRP columns to goalie_rebound_control table
-- Date: 2025-01-14
-- Description: Add Bayesian regressed AdjRP values with strong priors (C=5,000 and C=10,000)

-- Add regressed AdjRP columns
ALTER TABLE goalie_rebound_control
ADD COLUMN IF NOT EXISTS regressed_adjrp_c5000 NUMERIC,
ADD COLUMN IF NOT EXISTS regressed_adjrp_c10000 NUMERIC,
ADD COLUMN IF NOT EXISTS league_mean_adjrp NUMERIC;

-- Add comments
COMMENT ON COLUMN goalie_rebound_control.regressed_adjrp_c5000 IS 'Bayesian regressed AdjRP with C=5,000 saves (strong prior, shrinks low-sample goalies toward league mean)';
COMMENT ON COLUMN goalie_rebound_control.regressed_adjrp_c10000 IS 'Bayesian regressed AdjRP with C=10,000 saves (extreme prior, only high-sample goalies retain raw AdjRP)';
COMMENT ON COLUMN goalie_rebound_control.league_mean_adjrp IS 'League average AdjRP used as regression target';

-- Create index for regressed values
CREATE INDEX IF NOT EXISTS idx_goalie_rebound_control_regressed_c5000 ON goalie_rebound_control(regressed_adjrp_c5000);
CREATE INDEX IF NOT EXISTS idx_goalie_rebound_control_regressed_c10000 ON goalie_rebound_control(regressed_adjrp_c10000);

