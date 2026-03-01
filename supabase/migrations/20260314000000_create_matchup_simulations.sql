-- Monte Carlo Matchup Simulation Results
-- Stores win probability distributions from the simulation engine
-- Part of Citrus Quant Simulation Stack (Phase 1)

-- ============================================================================
-- TABLE: matchup_simulations
-- Stores Monte Carlo simulation results for each matchup
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.matchup_simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matchup_id UUID NOT NULL REFERENCES public.matchups(id) ON DELETE CASCADE,
    league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
    team1_id UUID NOT NULL,
    team2_id UUID NOT NULL,
    week_number INTEGER NOT NULL,

    -- Core simulation results
    win_probability NUMERIC(6, 4) NOT NULL,      -- P(team1 wins), 0.0000-1.0000
    loss_probability NUMERIC(6, 4) NOT NULL,     -- P(team1 loses)
    tie_probability NUMERIC(6, 4) NOT NULL,      -- P(tie)

    -- Point projections with uncertainty
    team1_projected NUMERIC(8, 2) NOT NULL,      -- Mean projected points
    team2_projected NUMERIC(8, 2) NOT NULL,
    team1_std NUMERIC(8, 2) NOT NULL,            -- Standard deviation
    team2_std NUMERIC(8, 2) NOT NULL,

    -- Margin analysis
    margin_mean NUMERIC(8, 2) NOT NULL,          -- Expected margin (+ = team1 favored)
    margin_std NUMERIC(8, 2) NOT NULL,

    -- Tail risk
    p_blowout_win NUMERIC(6, 4) DEFAULT 0,      -- P(team1 wins by 20+)
    p_blowout_loss NUMERIC(6, 4) DEFAULT 0,     -- P(team1 loses by 20+)

    -- Simulation metadata
    n_sims INTEGER NOT NULL DEFAULT 10000,
    simulation_details JSONB DEFAULT '{}'::jsonb, -- ci_95, percentiles, player details
    simulated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT win_prob_range CHECK (win_probability >= 0 AND win_probability <= 1),
    CONSTRAINT loss_prob_range CHECK (loss_probability >= 0 AND loss_probability <= 1),
    CONSTRAINT tie_prob_range CHECK (tie_probability >= 0 AND tie_probability <= 1),
    CONSTRAINT prob_sum CHECK (
        ABS(win_probability + loss_probability + tie_probability - 1.0) < 0.01
    )
);

-- Unique constraint: one simulation per matchup (upsert pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_matchup_simulations_matchup_id
    ON public.matchup_simulations(matchup_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_matchup_simulations_league_week
    ON public.matchup_simulations(league_id, week_number);
CREATE INDEX IF NOT EXISTS idx_matchup_simulations_simulated_at
    ON public.matchup_simulations(simulated_at DESC);

-- ============================================================================
-- TABLE: simulation_brier_scores
-- Tracks calibration quality over time (Brier score per league per week)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.simulation_brier_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    week_number INTEGER NOT NULL,

    -- Brier score for this week's predictions
    brier_score NUMERIC(6, 4),                   -- 0.00 = perfect, 0.25 = coin flip
    n_matchups INTEGER NOT NULL DEFAULT 0,

    -- Calibration details
    calibration_data JSONB DEFAULT '{}'::jsonb,   -- Bucket-level calibration

    -- Rating derived from Brier score
    rating TEXT DEFAULT 'pending',                -- excellent/good/adequate/poor/no_skill

    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT brier_range CHECK (brier_score IS NULL OR (brier_score >= 0 AND brier_score <= 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brier_scores_league_season_week
    ON public.simulation_brier_scores(league_id, season, week_number);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================
ALTER TABLE public.matchup_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_brier_scores ENABLE ROW LEVEL SECURITY;

-- Simulation results: readable by anyone in the league
CREATE POLICY "matchup_simulations_select" ON public.matchup_simulations
    FOR SELECT
    USING (
        league_id IN (
            SELECT league_id FROM public.teams WHERE owner_id = auth.uid()
        )
    );

-- Brier scores: readable by anyone in the league
CREATE POLICY "brier_scores_select" ON public.simulation_brier_scores
    FOR SELECT
    USING (
        league_id IN (
            SELECT league_id FROM public.teams WHERE owner_id = auth.uid()
        )
    );

-- Service role can insert/update (Python pipeline uses service role)
CREATE POLICY "matchup_simulations_service_insert" ON public.matchup_simulations
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "matchup_simulations_service_update" ON public.matchup_simulations
    FOR UPDATE
    USING (true);

CREATE POLICY "brier_scores_service_insert" ON public.simulation_brier_scores
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "brier_scores_service_update" ON public.simulation_brier_scores
    FOR UPDATE
    USING (true);

-- ============================================================================
-- RPC: Get simulation results for a matchup
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_matchup_simulation(
    p_matchup_id UUID
)
RETURNS TABLE (
    win_probability NUMERIC,
    loss_probability NUMERIC,
    tie_probability NUMERIC,
    team1_projected NUMERIC,
    team2_projected NUMERIC,
    team1_std NUMERIC,
    team2_std NUMERIC,
    margin_mean NUMERIC,
    margin_std NUMERIC,
    p_blowout_win NUMERIC,
    p_blowout_loss NUMERIC,
    n_sims INTEGER,
    simulation_details JSONB,
    simulated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ms.win_probability,
        ms.loss_probability,
        ms.tie_probability,
        ms.team1_projected,
        ms.team2_projected,
        ms.team1_std,
        ms.team2_std,
        ms.margin_mean,
        ms.margin_std,
        ms.p_blowout_win,
        ms.p_blowout_loss,
        ms.n_sims,
        ms.simulation_details,
        ms.simulated_at
    FROM matchup_simulations ms
    WHERE ms.matchup_id = p_matchup_id
    LIMIT 1;
END;
$$;

-- ============================================================================
-- RPC: Get Brier score for a league's season
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_league_brier_score(
    p_league_id UUID,
    p_season INTEGER DEFAULT 2025
)
RETURNS TABLE (
    overall_brier NUMERIC,
    total_predictions INTEGER,
    rating TEXT,
    weekly_scores JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_overall NUMERIC;
    v_total INTEGER;
    v_rating TEXT;
    v_weekly JSONB;
BEGIN
    -- Calculate overall Brier score across all weeks
    SELECT
        CASE WHEN SUM(n_matchups) > 0
            THEN SUM(brier_score * n_matchups) / SUM(n_matchups)
            ELSE NULL
        END,
        COALESCE(SUM(n_matchups), 0)
    INTO v_overall, v_total
    FROM simulation_brier_scores
    WHERE league_id = p_league_id AND season = p_season;

    -- Determine rating
    v_rating := CASE
        WHEN v_overall IS NULL THEN 'pending'
        WHEN v_overall < 0.10 THEN 'excellent'
        WHEN v_overall < 0.15 THEN 'good'
        WHEN v_overall < 0.20 THEN 'adequate'
        WHEN v_overall < 0.25 THEN 'poor'
        ELSE 'no_skill'
    END;

    -- Build weekly breakdown
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'week', week_number,
            'brier_score', brier_score,
            'n_matchups', n_matchups,
            'rating', sbs.rating
        ) ORDER BY week_number
    ), '[]'::jsonb)
    INTO v_weekly
    FROM simulation_brier_scores sbs
    WHERE league_id = p_league_id AND season = p_season;

    RETURN QUERY SELECT v_overall, v_total, v_rating, v_weekly;
END;
$$;
