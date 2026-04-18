-- Extend update_playoff_series_from_games to ALSO count wins from
-- finalized games and transition series to 'final' when 4 wins reached.
-- Previously this RPC only flipped series to 'active' when any of their
-- games was live.
--
-- Why: sync_playoff_results.py uses the NHL /playoff-bracket/{season}
-- endpoint, but that endpoint returns the PRIOR season's playoffs during
-- the season handoff (verified 2026-04-18 evening — Game 1 CAR-OTT final
-- in nhl_games but bracket API still showing 2024-25 data). We can't
-- wait for NHL to update, so this RPC derives series state from our own
-- finalized nhl_games rows. Safe to call every scrape cycle — it's
-- idempotent (computes from game counts, doesn't increment).

CREATE OR REPLACE FUNCTION public.update_playoff_series_from_games(
  p_season integer DEFAULT 2025
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_series RECORD;
  v_high_wins INTEGER;
  v_low_wins INTEGER;
  v_new_status TEXT;
  v_winner INTEGER;
  v_was_final BOOLEAN;
  v_newly_finalized UUID[];
BEGIN
  v_newly_finalized := ARRAY[]::UUID[];

  -- Iterate each series; derive wins from nhl_games finalized between the two teams.
  FOR v_series IN
    SELECT series_id, bracket_slot, high_seed_team_id, low_seed_team_id,
           series_status AS old_status
    FROM nhl_playoff_series
    WHERE high_seed_team_id IS NOT NULL AND low_seed_team_id IS NOT NULL
  LOOP
    -- Count wins for each team across all finalized games between them this season
    SELECT
      COALESCE(SUM(CASE
        WHEN (g.home_team_id = v_series.high_seed_team_id AND g.home_score > g.away_score)
          OR (g.away_team_id = v_series.high_seed_team_id AND g.away_score > g.home_score)
        THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE
        WHEN (g.home_team_id = v_series.low_seed_team_id AND g.home_score > g.away_score)
          OR (g.away_team_id = v_series.low_seed_team_id AND g.away_score > g.home_score)
        THEN 1 ELSE 0 END), 0)
    INTO v_high_wins, v_low_wins
    FROM nhl_games g
    WHERE g.game_type = 'playoff'
      AND g.season = p_season
      AND g.status = 'final'
      AND (
        (g.home_team_id = v_series.high_seed_team_id AND g.away_team_id = v_series.low_seed_team_id)
        OR (g.home_team_id = v_series.low_seed_team_id AND g.away_team_id = v_series.high_seed_team_id)
      );

    -- Determine status
    IF v_high_wins >= 4 THEN
      v_new_status := 'final';
      v_winner := v_series.high_seed_team_id;
    ELSIF v_low_wins >= 4 THEN
      v_new_status := 'final';
      v_winner := v_series.low_seed_team_id;
    ELSIF v_high_wins + v_low_wins > 0 THEN
      v_new_status := 'active';
      v_winner := NULL;
    ELSE
      -- No finalized games yet — but check if any are live/in_progress
      IF EXISTS (
        SELECT 1 FROM nhl_games g
        WHERE g.game_type = 'playoff' AND g.season = p_season
          AND g.status IN ('live', 'in_progress')
          AND (
            (g.home_team_id = v_series.high_seed_team_id AND g.away_team_id = v_series.low_seed_team_id)
            OR (g.home_team_id = v_series.low_seed_team_id AND g.away_team_id = v_series.high_seed_team_id)
          )
      ) THEN
        v_new_status := 'active';
      ELSE
        v_new_status := 'pending';
      END IF;
      v_winner := NULL;
    END IF;

    v_was_final := v_series.old_status = 'final';

    UPDATE nhl_playoff_series
    SET high_seed_wins = v_high_wins,
        low_seed_wins = v_low_wins,
        games_played = v_high_wins + v_low_wins,
        series_status = v_new_status,
        winner_team_id = v_winner,
        updated_at = NOW()
    WHERE series_id = v_series.series_id;

    v_count := v_count + 1;

    -- Collect newly-finalized series IDs for downstream pick scoring
    IF v_new_status = 'final' AND NOT v_was_final THEN
      v_newly_finalized := array_append(v_newly_finalized, v_series.series_id);
    END IF;
  END LOOP;

  -- Score picks for any series that just finalized this run.
  -- score_playoff_series_picks handles both bracket_picks + confidence_picks.
  IF array_length(v_newly_finalized, 1) > 0 THEN
    DECLARE
      v_sid UUID;
    BEGIN
      FOREACH v_sid IN ARRAY v_newly_finalized LOOP
        BEGIN
          PERFORM score_playoff_series_picks(v_sid);
        EXCEPTION WHEN OTHERS THEN
          NULL;  -- next cycle will retry
        END;
      END LOOP;
    END;
  END IF;

  RETURN v_count;
END;
$$;
