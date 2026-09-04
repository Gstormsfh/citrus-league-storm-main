CREATE OR REPLACE FUNCTION public.advance_playoff_round(p_bracket_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket RECORD;
  v_series RECORD;
  v_winner_id UUID;
  v_loser_id UUID;
  v_advanced_count INT := 0;
  v_league_id UUID;
BEGIN
  -- Get bracket
  SELECT * INTO v_bracket
  FROM public.playoff_brackets
  WHERE id = p_bracket_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Bracket not found');
  END IF;

  v_league_id := v_bracket.league_id;

  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can advance rounds');
  END IF;

  IF v_bracket.status = 'completed' THEN
    RETURN json_build_object('error', 'Bracket is already completed');
  END IF;

  -- Process each active series in the current round
  FOR v_series IN
    SELECT ps.*
    FROM public.playoff_series ps
    WHERE ps.bracket_id = p_bracket_id
    AND ps.round_number = v_bracket.current_round
    AND ps.status = 'active'
    AND ps.home_team_id IS NOT NULL
    AND ps.away_team_id IS NOT NULL
  LOOP
    -- Get scores from matchups table (aggregate if two-week)
    SELECT
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.home_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.home_team_id THEN m.team2_score ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.away_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.away_team_id THEN m.team2_score ELSE 0 END), 0)
    INTO v_series.home_score, v_series.away_score
    FROM public.matchups m
    WHERE m.league_id = v_league_id
    AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
    AND (
      (m.team1_id = v_series.home_team_id AND m.team2_id = v_series.away_team_id) OR
      (m.team1_id = v_series.away_team_id AND m.team2_id = v_series.home_team_id)
    );

    -- Determine winner (higher seed wins tiebreaker)
    IF v_series.home_score > v_series.away_score THEN
      v_winner_id := v_series.home_team_id;
      v_loser_id := v_series.away_team_id;
    ELSIF v_series.away_score > v_series.home_score THEN
      v_winner_id := v_series.away_team_id;
      v_loser_id := v_series.home_team_id;
    ELSE
      -- Tiebreaker: higher seed wins
      IF v_series.home_seed IS NOT NULL AND v_series.away_seed IS NOT NULL AND v_series.home_seed < v_series.away_seed THEN
        v_winner_id := v_series.home_team_id;
        v_loser_id := v_series.away_team_id;
      ELSE
        v_winner_id := v_series.away_team_id;
        v_loser_id := v_series.home_team_id;
      END IF;
    END IF;

    -- Update series with results
    UPDATE public.playoff_series
    SET
      home_score = v_series.home_score,
      away_score = v_series.away_score,
      winner_team_id = v_winner_id,
      loser_team_id = v_loser_id,
      status = 'completed'
    WHERE id = v_series.id;

    -- Advance winner to next series
    IF v_series.winner_advances_to IS NOT NULL THEN
      IF v_series.winner_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_winner_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_winner_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      END IF;

      -- Create matchup rows for the newly activated series
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.winner_advances_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    -- Drop loser to consolation/third-place if configured
    IF v_series.loser_drops_to IS NOT NULL THEN
      IF v_series.loser_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_loser_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_loser_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      END IF;

      -- Create matchup rows for consolation
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.loser_drops_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    v_advanced_count := v_advanced_count + 1;
  END LOOP;

  -- Check if the finals are now completed -> bracket complete
  IF EXISTS (
    SELECT 1 FROM public.playoff_series
    WHERE bracket_id = p_bracket_id
    AND bracket_position = 'winners'
    AND round_number = v_bracket.total_rounds
    AND status = 'completed'
  ) THEN
    -- Get champion and runner-up from finals
    UPDATE public.playoff_brackets
    SET
      status = 'completed',
      current_round = v_bracket.total_rounds,
      champion_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      runner_up_team_id = (
        SELECT loser_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      third_place_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'third_place'
        AND status = 'completed' LIMIT 1
      ),
      completed_at = NOW()
    WHERE id = p_bracket_id;
  ELSE
    -- Advance to next round
    UPDATE public.playoff_brackets
    SET current_round = v_bracket.current_round + 1
    WHERE id = p_bracket_id;
  END IF;

  RETURN json_build_object(
    'advanced_count', v_advanced_count,
    'current_round', v_bracket.current_round,
    'success', true
  );
END;
$function$
