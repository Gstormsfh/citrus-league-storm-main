-- Add goalie-specific projection columns to player_projected_stats
-- Enables probability-based goalie projections (saves, wins, shutouts, GAA, SV%)

ALTER TABLE public.player_projected_stats
ADD COLUMN IF NOT EXISTS is_goalie BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS projected_wins NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_saves NUMERIC(7,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_shutouts NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_goals_against NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_gaa NUMERIC(4,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_save_pct NUMERIC(4,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_gp NUMERIC(3,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS starter_confirmed BOOLEAN DEFAULT false;

-- Create index for goalie lookups
CREATE INDEX IF NOT EXISTS idx_projected_stats_is_goalie ON public.player_projected_stats(is_goalie, projection_date);
CREATE INDEX IF NOT EXISTS idx_projected_stats_starter_confirmed ON public.player_projected_stats(starter_confirmed, projection_date);

-- Add comments for documentation
COMMENT ON COLUMN public.player_projected_stats.is_goalie IS 'Flag to distinguish goalie projections from skater projections';
COMMENT ON COLUMN public.player_projected_stats.projected_wins IS 'Projected win probability (0.0 to 1.0) based on Vegas implied probability or team win rate';
COMMENT ON COLUMN public.player_projected_stats.projected_saves IS 'Projected saves based on opponent shots for/60 × goalie SV%';
COMMENT ON COLUMN public.player_projected_stats.projected_shutouts IS 'Projected shutout probability (0.0 to 1.0) based on GSAx and opponent offense';
COMMENT ON COLUMN public.player_projected_stats.projected_goals_against IS 'Projected goals against based on opponent shots × (1 - goalie SV%)';
COMMENT ON COLUMN public.player_projected_stats.projected_gaa IS 'Projected Goals Against Average (projected_goals_against / (projected_gp × 60))';
COMMENT ON COLUMN public.player_projected_stats.projected_save_pct IS 'Projected save percentage (with Bayesian shrinkage for low-sample goalies)';
COMMENT ON COLUMN public.player_projected_stats.projected_gp IS 'Projected games played (typically 1.0 for confirmed starter, 0.0 for backup)';
COMMENT ON COLUMN public.player_projected_stats.starter_confirmed IS 'True if goalie is confirmed starter, false if probable/unconfirmed (shows Probable badge in UI)';
