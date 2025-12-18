-- Create tables for GAR (Goals Above Replacement) framework
-- This migration creates tables for TOI tracking and GAR component storage

-- Table 1: player_toi_by_situation
-- Stores Time On Ice (TOI) for each player by game situation (5v5, PP, PK)
CREATE TABLE IF NOT EXISTS player_toi_by_situation (
    id BIGSERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    situation VARCHAR(10) NOT NULL, -- '5v5', 'PP', 'PK'
    toi_seconds NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(player_id, game_id, situation)
);

-- Indexes for player_toi_by_situation
CREATE INDEX IF NOT EXISTS idx_toi_player_game ON player_toi_by_situation(player_id, game_id);
CREATE INDEX IF NOT EXISTS idx_toi_situation ON player_toi_by_situation(situation);
CREATE INDEX IF NOT EXISTS idx_toi_player_situation ON player_toi_by_situation(player_id, situation);

-- Table 2: player_shifts
-- Stores individual shift data for tracking which players were on ice at any given time
CREATE TABLE IF NOT EXISTS player_shifts (
    id BIGSERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    period INTEGER NOT NULL,
    shift_start_time_seconds NUMERIC NOT NULL,
    shift_end_time_seconds NUMERIC,
    situation VARCHAR(10) NOT NULL, -- '5v5', 'PP', 'PK'
    team_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for player_shifts
CREATE INDEX IF NOT EXISTS idx_shifts_player_game ON player_shifts(player_id, game_id);
CREATE INDEX IF NOT EXISTS idx_shifts_game_period ON player_shifts(game_id, period);
CREATE INDEX IF NOT EXISTS idx_shifts_time_range ON player_shifts(game_id, period, shift_start_time_seconds, shift_end_time_seconds);

-- Table 3: player_gar_components
-- Stores all GAR component rates and final GAR values
CREATE TABLE IF NOT EXISTS player_gar_components (
    player_id INTEGER NOT NULL,
    season INTEGER,
    -- Raw rates (per 60 minutes)
    evo_rate_raw NUMERIC,
    evd_rate_raw NUMERIC,
    ppo_rate_raw NUMERIC,
    ppd_rate_raw NUMERIC,
    penalty_component_raw NUMERIC,
    -- Regressed rates (per 60 minutes)
    evo_rate_regressed NUMERIC,
    evd_rate_regressed NUMERIC,
    ppo_rate_regressed NUMERIC,
    ppd_rate_regressed NUMERIC,
    penalty_component_regressed NUMERIC,
    -- Replacement level rates (per 60 minutes)
    rp_evo_rate NUMERIC,
    rp_evd_rate NUMERIC,
    rp_ppo_rate NUMERIC,
    rp_ppd_rate NUMERIC,
    rp_penalty_rate NUMERIC,
    -- TOI data (in minutes)
    toi_5v5_minutes NUMERIC,
    toi_pp_minutes NUMERIC,
    toi_pk_minutes NUMERIC,
    toi_total_minutes NUMERIC,
    -- Final GAR values (per 60 minutes)
    evo_gar_per_60 NUMERIC,
    evd_gar_per_60 NUMERIC,
    ppo_gar_per_60 NUMERIC,
    ppd_gar_per_60 NUMERIC,
    penalty_gar_per_60 NUMERIC,
    total_gar_per_60 NUMERIC,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (player_id, season)
);

-- Indexes for player_gar_components
CREATE INDEX IF NOT EXISTS idx_gar_player_season ON player_gar_components(player_id, season);
CREATE INDEX IF NOT EXISTS idx_gar_total ON player_gar_components(total_gar_per_60);
CREATE INDEX IF NOT EXISTS idx_gar_evo ON player_gar_components(evo_rate_regressed);
CREATE INDEX IF NOT EXISTS idx_gar_evd ON player_gar_components(evd_rate_regressed);
CREATE INDEX IF NOT EXISTS idx_gar_ppo ON player_gar_components(ppo_rate_regressed);
CREATE INDEX IF NOT EXISTS idx_gar_ppd ON player_gar_components(ppd_rate_regressed);

-- Comments for documentation
COMMENT ON TABLE player_toi_by_situation IS 'Time On Ice (TOI) for each player by game situation (5v5, PP, PK)';
COMMENT ON TABLE player_shifts IS 'Individual shift data tracking which players were on ice at any given time';
COMMENT ON TABLE player_gar_components IS 'Goals Above Replacement (GAR) component rates and final GAR values for all skaters';

-- RLS Policies (if needed - adjust based on your security requirements)
-- ALTER TABLE player_toi_by_situation ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE player_shifts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE player_gar_components ENABLE ROW LEVEL SECURITY;

