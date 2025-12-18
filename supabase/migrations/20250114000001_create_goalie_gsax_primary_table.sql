-- Create goalie_gsax_primary table to store GSAx metrics for PRIMARY SHOTS ONLY
-- Primary shots exclude rebounds (is_rebound == False OR time_since_last_event >= 3.0)
-- This is Component 2 of the G-GAR model

CREATE TABLE IF NOT EXISTS goalie_gsax_primary (
    goalie_id INTEGER PRIMARY KEY,
    total_shots_faced INTEGER NOT NULL,
    total_xGA NUMERIC NOT NULL,
    total_GA INTEGER NOT NULL,
    raw_gsax NUMERIC NOT NULL,
    regressed_gsax NUMERIC NOT NULL,
    league_sv_pct NUMERIC,
    calculated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_goalie_gsax_primary_goalie_id ON goalie_gsax_primary(goalie_id);
CREATE INDEX IF NOT EXISTS idx_goalie_gsax_primary_regressed_gsax ON goalie_gsax_primary(regressed_gsax);

-- Add comments
COMMENT ON TABLE goalie_gsax_primary IS 'GSAx metrics for PRIMARY SHOTS ONLY (excludes rebounds). Component 2 of G-GAR model.';
COMMENT ON COLUMN goalie_gsax_primary.goalie_id IS 'NHL goalie ID';
COMMENT ON COLUMN goalie_gsax_primary.total_shots_faced IS 'Total primary shots faced (non-rebounds, excluding empty-net)';
COMMENT ON COLUMN goalie_gsax_primary.total_xGA IS 'Total expected goals against (primary shots only)';
COMMENT ON COLUMN goalie_gsax_primary.total_GA IS 'Total actual goals allowed (primary shots only)';
COMMENT ON COLUMN goalie_gsax_primary.raw_gsax IS 'Raw GSAx for primary shots = total_xGA - total_GA';
COMMENT ON COLUMN goalie_gsax_primary.regressed_gsax IS 'Bayesian regressed GSAx for primary shots (C=500)';
COMMENT ON COLUMN goalie_gsax_primary.league_sv_pct IS 'League average save percentage (primary shots only)';

-- Enable RLS
ALTER TABLE goalie_gsax_primary ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public can view goalie primary shots GSAx"
ON goalie_gsax_primary
FOR SELECT
USING (true);

-- Authenticated users can manage
CREATE POLICY "Authenticated users can manage goalie primary shots GSAx"
ON goalie_gsax_primary
FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- Add trigger to update updated_at timestamp
DROP TRIGGER IF EXISTS update_goalie_gsax_primary_updated_at ON goalie_gsax_primary;
CREATE TRIGGER update_goalie_gsax_primary_updated_at
  BEFORE UPDATE ON goalie_gsax_primary
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

