-- RPC: score_playoff_series_picks
-- Called by sync_playoff_results.py when a series becomes 'final'.
-- Awards points to all bracket/confidence picks in every league, updates
-- playoff_pool_standings. Idempotent — safe to run multiple times per series.

CREATE OR REPLACE FUNCTION public.score_playoff_series_picks(p_series_id UUID)
RETURNS TABLE (
  picks_scored INTEGER,
  standings_updated INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_series RECORD;
  v_picks_scored INTEGER := 0;
  v_standings_updated INTEGER := 0;
  v_round_points NUMERIC;
  v_rowcount INTEGER;
BEGIN
  -- 1. Load the series + verify it's final
  SELECT * INTO v_series
  FROM nhl_playoff_series
  WHERE series_id = p_series_id
    AND series_status = 'final'
    AND winner_team_id IS NOT NULL;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- 2. BRACKET PICKEM scoring
  -- Default per-round points: R1=2, R2=4, R3=8, SCF=16 (Yahoo-standard).
  -- Commissioner can override via leagues.settings.playoffBracketPointsPerRound.
  -- +1 bonus if predicted_games matches actual games_played.
  UPDATE playoff_bracket_picks bp
  SET
    is_correct = (bp.picked_team_id = v_series.winner_team_id),
    points_earned = CASE
      WHEN bp.picked_team_id = v_series.winner_team_id THEN
        COALESCE(
          (l.settings->'playoffBracketPointsPerRound'->>(
            CASE v_series.round
              WHEN 1 THEN 'r1'
              WHEN 2 THEN 'r2'
              WHEN 3 THEN 'r3'
              WHEN 4 THEN 'scf'
            END
          ))::NUMERIC,
          CASE v_series.round WHEN 1 THEN 2 WHEN 2 THEN 4 WHEN 3 THEN 8 WHEN 4 THEN 16 ELSE 0 END
        )
        + CASE WHEN bp.predicted_games = v_series.games_played
               THEN COALESCE((l.settings->>'playoffGamesPickBonus')::NUMERIC, 1)
               ELSE 0 END
      ELSE 0
    END,
    locked_at = COALESCE(bp.locked_at, NOW()),
    updated_at = NOW()
  FROM leagues l
  WHERE bp.league_id = l.id
    AND bp.series_slot = v_series.bracket_slot
    AND (l.settings->>'leagueType') = 'playoff-bracket-pickem';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  v_picks_scored := v_picks_scored + v_rowcount;

  -- 3. CONFIDENCE POOL scoring
  -- Points awarded = confidence_value IF correct, 0 otherwise.
  UPDATE playoff_confidence_picks cp
  SET
    is_correct = (cp.picked_team_id = v_series.winner_team_id),
    points_earned = CASE
      WHEN cp.picked_team_id = v_series.winner_team_id THEN cp.confidence_value::NUMERIC
      ELSE 0
    END,
    locked_at = COALESCE(cp.locked_at, NOW()),
    updated_at = NOW()
  FROM leagues l
  WHERE cp.league_id = l.id
    AND cp.series_slot = v_series.bracket_slot
    AND (l.settings->>'leagueType') = 'playoff-confidence-pool';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  v_picks_scored := v_picks_scored + v_rowcount;

  -- 4. Recompute standings for every league that had picks on this series
  WITH league_totals AS (
    SELECT
      league_id,
      user_id,
      SUM(points_earned) AS total,
      COUNT(*) FILTER (WHERE is_correct) AS correct_count
    FROM (
      SELECT league_id, user_id, points_earned, is_correct FROM playoff_bracket_picks
      UNION ALL
      SELECT league_id, user_id, points_earned, is_correct FROM playoff_confidence_picks
    ) all_picks
    WHERE points_earned IS NOT NULL
    GROUP BY league_id, user_id
  ),
  ranked AS (
    SELECT
      league_id, user_id, total, correct_count,
      RANK() OVER (PARTITION BY league_id ORDER BY total DESC) AS rnk
    FROM league_totals
  )
  INSERT INTO playoff_pool_standings (league_id, user_id, total_points, correct_picks, current_rank, last_updated)
  SELECT league_id, user_id, total, correct_count, rnk, NOW() FROM ranked
  ON CONFLICT (league_id, user_id) DO UPDATE
    SET total_points = EXCLUDED.total_points,
        correct_picks = EXCLUDED.correct_picks,
        current_rank = EXCLUDED.current_rank,
        last_updated = NOW();

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  v_standings_updated := v_rowcount;

  RETURN QUERY SELECT v_picks_scored, v_standings_updated;
END;
$$;

COMMENT ON FUNCTION public.score_playoff_series_picks IS
  'Awards points to all bracket/confidence picks for a finalized series and recomputes league standings. Idempotent.';

-- Grant execute to authenticated users (service role calls it directly)
GRANT EXECUTE ON FUNCTION public.score_playoff_series_picks TO service_role;
