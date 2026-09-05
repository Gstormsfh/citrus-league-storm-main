-- 2026-09-05: a head-to-head CATEGORIES league is decided by categories.
--
-- update_all_matchup_scores wrote fantasy points into matchups.team1_score /
-- team2_score for every league, whatever settings.scoringFormat said, and
-- everything downstream (standings by score comparison, playoff seeding in
-- generate_playoff_bracket / get_playoff_picture, advance_playoff_round,
-- auto_complete_matchups) read those two numbers. In an h2h-categories
-- league the weekly result was therefore decided by points nobody agreed to
-- play for.
--
-- Now, for a league whose settings.scoringFormat is 'h2h-categories', the
-- two scores are the CATEGORIES WON that week (a tied category is worth 0.5
-- to each side, so 5-5-2 is 6.0 to 6.0 and a tie), computed by the existing
-- calculate_h2h_category_matchup over settings.categories. Points leagues
-- are untouched: the points branch is the previous body, verbatim.
--
-- auto_complete_matchups completed a week only when BOTH scores were above
-- zero, which was a guard against completing an unscored week; it also kept
-- a 10-0 category sweep (and a real shutout week) open forever. The guard is
-- now "some score was computed" (the two together above zero).
--
-- Regular season only: calculate_h2h_category_matchup already filters
-- nhl_games.game_type = 'regular'.

begin;

CREATE OR REPLACE FUNCTION public.update_all_matchup_scores(p_league_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(matchup_id uuid, team1_id uuid, team2_id uuid, team1_score numeric, team2_score numeric, updated boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_matchup RECORD;
  v_team1_score NUMERIC(10, 3);
  v_team2_score NUMERIC(10, 3);
  v_error_count INTEGER := 0;
  v_cats TEXT[];
BEGIN
  IF p_league_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id) THEN
    RAISE EXCEPTION 'League % does not exist', p_league_id;
  END IF;

  -- Every matchup whose week has started (completed + in progress), with
  -- the league's format and category list alongside.
  FOR v_matchup IN
    SELECT m.id, m.league_id, m.team1_id, m.team2_id, m.week_start_date, m.week_end_date,
           l.settings->>'scoringFormat' AS scoring_format,
           l.settings->'categories'    AS categories
    FROM matchups m
    JOIN leagues l ON l.id = m.league_id
    WHERE (p_league_id IS NULL OR m.league_id = p_league_id)
      AND m.week_start_date <= CURRENT_DATE
    ORDER BY m.week_end_date DESC, m.id
  LOOP
    BEGIN
      IF v_matchup.scoring_format = 'h2h-categories' THEN
        -- CATEGORIES: the score is categories won, ties half each.
        v_cats := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_matchup.categories, '[]'::jsonb)));
        IF v_matchup.team2_id IS NULL OR v_cats IS NULL OR array_length(v_cats, 1) IS NULL THEN
          -- A bye week, or a league with no categories configured: nothing to
          -- compare. Zero, never a points total pretending to be a category.
          v_team1_score := 0;
          v_team2_score := 0;
        ELSE
          SELECT
            COALESCE(SUM(CASE r.winner WHEN 'team1' THEN 1 WHEN 'tie' THEN 0.5 ELSE 0 END), 0),
            COALESCE(SUM(CASE r.winner WHEN 'team2' THEN 1 WHEN 'tie' THEN 0.5 ELSE 0 END), 0)
          INTO v_team1_score, v_team2_score
          FROM calculate_h2h_category_matchup(
            v_matchup.league_id, v_matchup.id, v_matchup.team1_id, v_matchup.team2_id,
            v_matchup.week_start_date, v_matchup.week_end_date, v_cats
          ) r;
        END IF;
      ELSE
        -- POINTS (the previous body, verbatim).
        SELECT calculate_matchup_total_score(
          v_matchup.id, v_matchup.team1_id, v_matchup.week_start_date, v_matchup.week_end_date
        ) INTO v_team1_score;
        IF v_team1_score IS NULL THEN
          v_team1_score := 0;
        END IF;

        IF v_matchup.team2_id IS NOT NULL THEN
          SELECT calculate_matchup_total_score(
            v_matchup.id, v_matchup.team2_id, v_matchup.week_start_date, v_matchup.week_end_date
          ) INTO v_team2_score;
          IF v_team2_score IS NULL THEN
            v_team2_score := 0;
          END IF;
        ELSE
          v_team2_score := 0;
        END IF;
      END IF;

      UPDATE matchups
      SET team1_score = v_team1_score,
          team2_score = v_team2_score,
          updated_at = NOW()
      WHERE id = v_matchup.id;

      RETURN QUERY SELECT v_matchup.id, v_matchup.team1_id, v_matchup.team2_id, v_team1_score, v_team2_score, true;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      RAISE WARNING 'Error updating matchup %: %', v_matchup.id, SQLERRM;
      RETURN QUERY SELECT v_matchup.id, v_matchup.team1_id, v_matchup.team2_id, 0::NUMERIC(10, 3), 0::NUMERIC(10, 3), false;
    END;
  END LOOP;

  IF v_error_count > 0 THEN
    RAISE WARNING 'update_all_matchup_scores completed with % errors', v_error_count;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_complete_matchups()
 RETURNS TABLE(updated_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated_count INTEGER := 0;
  v_league_ids UUID[];
  league_id UUID;
  v_error_count INTEGER := 0;
BEGIN
  -- Weeks that have ended and carry a computed score (the two sides together
  -- above zero: a shutout week or a category sweep still completes).
  SELECT ARRAY_AGG(DISTINCT m.league_id) INTO v_league_ids
  FROM public.matchups m
  WHERE m.status IN ('scheduled', 'in_progress')
    AND m.week_end_date < CURRENT_DATE
    AND (COALESCE(m.team1_score, 0) + COALESCE(m.team2_score, 0)) > 0
    AND m.league_id IS NOT NULL;

  UPDATE public.matchups
  SET status = 'completed',
      updated_at = NOW()
  WHERE status IN ('scheduled', 'in_progress')
    AND week_end_date < CURRENT_DATE
    AND (COALESCE(team1_score, 0) + COALESCE(team2_score, 0)) > 0;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_league_ids IS NOT NULL AND array_length(v_league_ids, 1) > 0 THEN
    FOREACH league_id IN ARRAY v_league_ids
    LOOP
      BEGIN
        IF EXISTS (SELECT 1 FROM leagues WHERE id = league_id) THEN
          PERFORM update_all_matchup_scores(league_id);
        ELSE
          RAISE WARNING 'League % does not exist, skipping score update', league_id;
          v_error_count := v_error_count + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_error_count := v_error_count + 1;
        RAISE WARNING 'Error updating scores for league %: %', league_id, SQLERRM;
      END;
    END LOOP;
  END IF;

  IF v_error_count > 0 THEN
    RAISE WARNING 'auto_complete_matchups completed with % score update errors', v_error_count;
  END IF;

  RETURN QUERY SELECT v_updated_count;
END;
$function$;

commit;
