-- Create goalie_gsax table to store Goals Saved Above Expected (GSAx) metrics
-- This table stores both raw and regressed GSAx values for all goalies

CREATE TABLE IF NOT EXISTS goalie_gsax (
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

-- Create indexes for efficient lookups and sorting
CREATE INDEX IF NOT EXISTS idx_goalie_gsax_goalie_id ON goalie_gsax(goalie_id);
CREATE INDEX IF NOT EXISTS idx_goalie_gsax_regressed_gsax ON goalie_gsax(regressed_gsax);

-- Add comments to explain the table and columns
COMMENT ON TABLE goalie_gsax IS 'Goals Saved Above Expected (GSAx) metrics for goaltenders. Includes both raw and Bayesian regressed values.';
COMMENT ON COLUMN goalie_gsax.goalie_id IS 'NHL goalie ID (opposing goalie who faced the shots)';
COMMENT ON COLUMN goalie_gsax.total_shots_faced IS 'Total number of shots faced (excluding empty-net shots)';
COMMENT ON COLUMN goalie_gsax.total_xGA IS 'Total expected goals against (sum of shooting_talent_adjusted_xg)';
COMMENT ON COLUMN goalie_gsax.total_GA IS 'Total actual goals allowed';
COMMENT ON COLUMN goalie_gsax.raw_gsax IS 'Raw GSAx = total_xGA - total_GA (unadjusted for sample size)';
COMMENT ON COLUMN goalie_gsax.regressed_gsax IS 'Bayesian regressed GSAx (adjusted for sample size, shrinks low-sample goalies toward league average)';
COMMENT ON COLUMN goalie_gsax.league_sv_pct IS 'League average save percentage at time of calculation';

-- Enable RLS (Row Level Security)
ALTER TABLE goalie_gsax ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Public can view goalie GSAx" ON goalie_gsax;
DROP POLICY IF EXISTS "Authenticated users can manage goalie GSAx" ON goalie_gsax;

-- Public read access for goalie GSAx (needed for projections)
CREATE POLICY "Public can view goalie GSAx"
ON goalie_gsax
FOR SELECT
USING (true);

-- Authenticated users can insert/update goalie GSAx (for calculation scripts)
CREATE POLICY "Authenticated users can manage goalie GSAx"
ON goalie_gsax
FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- Add trigger to update updated_at timestamp
DROP TRIGGER IF EXISTS update_goalie_gsax_updated_at ON goalie_gsax;
CREATE TRIGGER update_goalie_gsax_updated_at
  BEFORE UPDATE ON goalie_gsax
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

