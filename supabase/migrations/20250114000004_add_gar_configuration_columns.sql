-- Migration: Add G-GAR configuration columns
-- Date: 2025-01-14
-- Description: Add columns for all G-GAR configurations (different regression constants and weights)

-- Add configuration columns
ALTER TABLE goalie_gar
ADD COLUMN IF NOT EXISTS total_gar_w30_raw NUMERIC,
ADD COLUMN IF NOT EXISTS total_gar_w30_c5000 NUMERIC,
ADD COLUMN IF NOT EXISTS total_gar_w30_c10000 NUMERIC,
ADD COLUMN IF NOT EXISTS total_gar_w10_c5000 NUMERIC,
ADD COLUMN IF NOT EXISTS total_gar_w10_c10000 NUMERIC,
ADD COLUMN IF NOT EXISTS total_gar_w5_c5000 NUMERIC,
ADD COLUMN IF NOT EXISTS total_gar_w5_c10000 NUMERIC;

-- Add comments
COMMENT ON COLUMN goalie_gar.total_gar_w30_raw IS 'G-GAR with raw AdjRP, weights w1=0.3, w2=0.7 (baseline)';
COMMENT ON COLUMN goalie_gar.total_gar_w30_c5000 IS 'G-GAR with regressed AdjRP (C=5,000), weights w1=0.3, w2=0.7';
COMMENT ON COLUMN goalie_gar.total_gar_w30_c10000 IS 'G-GAR with regressed AdjRP (C=10,000), weights w1=0.3, w2=0.7';
COMMENT ON COLUMN goalie_gar.total_gar_w10_c5000 IS 'G-GAR with regressed AdjRP (C=5,000), weights w1=0.10, w2=0.90';
COMMENT ON COLUMN goalie_gar.total_gar_w10_c10000 IS 'G-GAR with regressed AdjRP (C=10,000), weights w1=0.10, w2=0.90';
COMMENT ON COLUMN goalie_gar.total_gar_w5_c5000 IS 'G-GAR with regressed AdjRP (C=5,000), weights w1=0.05, w2=0.95';
COMMENT ON COLUMN goalie_gar.total_gar_w5_c10000 IS 'G-GAR with regressed AdjRP (C=10,000), weights w1=0.05, w2=0.95';

-- Create indexes for optimal configuration selection
CREATE INDEX IF NOT EXISTS idx_goalie_gar_w30_c5000 ON goalie_gar(total_gar_w30_c5000);
CREATE INDEX IF NOT EXISTS idx_goalie_gar_w10_c5000 ON goalie_gar(total_gar_w10_c5000);
CREATE INDEX IF NOT EXISTS idx_goalie_gar_w5_c5000 ON goalie_gar(total_gar_w5_c5000);

