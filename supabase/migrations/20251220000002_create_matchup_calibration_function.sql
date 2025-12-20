-- Calibration check function for matchup scores
-- Verifies that sum of fantasy_matchup_lines equals matchups.team_score
-- Critical for ensuring data integrity in the pre-calculation engine

CREATE OR REPLACE FUNCTION public.verify_matchup_scores(p_matchup_id UUID)
RETURNS TABLE (
    team1_calculated NUMERIC,
    team1_stored NUMERIC,
    team2_calculated NUMERIC,
    team2_stored NUMERIC,
    is_calibrated BOOLEAN,
    discrepancy_team1 NUMERIC,
    discrepancy_team2 NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH team_totals AS (
        SELECT 
            fml.team_id,
            SUM(fml.total_points) as calculated_total
        FROM public.fantasy_matchup_lines fml
        WHERE fml.matchup_id = p_matchup_id
        GROUP BY fml.team_id
    ),
    matchup_data AS (
        SELECT team1_id, team2_id, team1_score, team2_score
        FROM public.matchups
        WHERE id = p_matchup_id
    )
    SELECT 
        COALESCE(tt1.calculated_total, 0)::NUMERIC as team1_calculated,
        md.team1_score as team1_stored,
        COALESCE(tt2.calculated_total, 0)::NUMERIC as team2_calculated,
        md.team2_score as team2_stored,
        (ABS(COALESCE(tt1.calculated_total, 0) - md.team1_score) < 0.01 
         AND ABS(COALESCE(tt2.calculated_total, 0) - md.team2_score) < 0.01) as is_calibrated,
        (COALESCE(tt1.calculated_total, 0) - md.team1_score)::NUMERIC as discrepancy_team1,
        (COALESCE(tt2.calculated_total, 0) - md.team2_score)::NUMERIC as discrepancy_team2
    FROM matchup_data md
    LEFT JOIN team_totals tt1 ON tt1.team_id = md.team1_id
    LEFT JOIN team_totals tt2 ON tt2.team_id = md.team2_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.verify_matchup_scores(UUID) TO authenticated, anon;

-- Add comment
COMMENT ON FUNCTION public.verify_matchup_scores IS 'Verifies that sum of fantasy_matchup_lines.total_points equals matchups.team_score. Returns calibration status and any discrepancies.';
