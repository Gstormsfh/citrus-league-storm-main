-- Migration: Create goalie_rebound_control table
-- Date: 2025-01-14
-- Description: Store Adjusted Rebound Percentage (AdjRP) component for goalie G-GAR model

CREATE TABLE IF NOT EXISTS goalie_rebound_control (
    goalie_id INTEGER PRIMARY KEY,
    total_saves INTEGER NOT NULL DEFAULT 0,
    puck_freezes INTEGER NOT NULL DEFAULT 0,
    rebound_shots_allowed INTEGER NOT NULL DEFAULT 0,
    effective_saves INTEGER NOT NULL DEFAULT 0,
    adj_rebound_pct NUMERIC,
    rebound_shots_per_60_saves NUMERIC,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_goalie_rebound_control_adj_rebound_pct ON goalie_rebound_control(adj_rebound_pct);
CREATE INDEX IF NOT EXISTS idx_goalie_rebound_control_calculated_at ON goalie_rebound_control(calculated_at);

-- Add comments
COMMENT ON TABLE goalie_rebound_control IS 'Goalie rebound control component (AdjRP) for G-GAR model. Lower AdjRP = better rebound control.';
COMMENT ON COLUMN goalie_rebound_control.goalie_id IS 'NHL player ID of goalie';
COMMENT ON COLUMN goalie_rebound_control.total_saves IS 'Total number of saves (shots on goal that did not score)';
COMMENT ON COLUMN goalie_rebound_control.puck_freezes IS 'Number of times goalie froze puck after save';
COMMENT ON COLUMN goalie_rebound_control.rebound_shots_allowed IS 'Number of rebound shots allowed within 2 seconds of a save';
COMMENT ON COLUMN goalie_rebound_control.effective_saves IS 'Total saves minus puck freezes (denominator for AdjRP)';
COMMENT ON COLUMN goalie_rebound_control.adj_rebound_pct IS 'Adjusted Rebound Percentage = rebound_shots_allowed / effective_saves. Lower is better.';
COMMENT ON COLUMN goalie_rebound_control.rebound_shots_per_60_saves IS 'Rebound shots allowed per 60 saves (normalized rate)';

-- Enable RLS
ALTER TABLE goalie_rebound_control ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users (read-only for now)
CREATE POLICY "Allow authenticated users to read goalie_rebound_control"
    ON goalie_rebound_control
    FOR SELECT
    TO authenticated
    USING (true);

