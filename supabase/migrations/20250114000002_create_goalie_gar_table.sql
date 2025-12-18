-- Migration: Create goalie_gar table
-- Date: 2025-01-14
-- Description: Store combined G-GAR (Goals Above Replacement) metric for goalies

CREATE TABLE IF NOT EXISTS goalie_gar (
    goalie_id INTEGER PRIMARY KEY,
    rebound_control_score NUMERIC,
    primary_gsax_score NUMERIC,
    total_gar NUMERIC NOT NULL,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_goalie_gar_total_gar ON goalie_gar(total_gar);
CREATE INDEX IF NOT EXISTS idx_goalie_gar_calculated_at ON goalie_gar(calculated_at);

-- Add comments
COMMENT ON TABLE goalie_gar IS 'Combined G-GAR (Goals Above Replacement) metric for goalies. Combines Rebound Control and Primary Shots GSAx components.';
COMMENT ON COLUMN goalie_gar.goalie_id IS 'NHL player ID of goalie';
COMMENT ON COLUMN goalie_gar.rebound_control_score IS 'Standardized rebound control score (inverted z-score of AdjRP, higher is better)';
COMMENT ON COLUMN goalie_gar.primary_gsax_score IS 'Primary shots GSAx score (regressed GSAx for non-rebound shots)';
COMMENT ON COLUMN goalie_gar.total_gar IS 'Combined G-GAR = 0.3 × rebound_control_score + 0.7 × primary_gsax_score';

-- Enable RLS
ALTER TABLE goalie_gar ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users (read-only for now)
CREATE POLICY "Allow authenticated users to read goalie_gar"
    ON goalie_gar
    FOR SELECT
    TO authenticated
    USING (true);

