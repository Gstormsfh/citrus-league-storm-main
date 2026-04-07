-- Tighten auto_generate_playoff_bracket:
-- 1. Treat both 'completed' and 'final' matchup statuses as done (MatchupService
--    persists either, depending on code path).
-- 2. Skip cleanly if playoffTeams = 0 (commissioner opted out of playoffs)
--    instead of falling through to generate_playoff_bracket and erroring.

CREATE OR REPLACE FUNCTION public.auto_generate_playoff_bracket(
  p_league_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_league RECORD;
  v_series_season INT;
  v_regular_weeks INT;
  v_incomplete_count INT;
  v_matchups_exist BOOLEAN;
  v_playoff_teams INT;
  v_result JSON;
BEGIN
  IF EXTRACT(MONTH FROM NOW()) >= 10 THEN
    v_series_season := EXTRACT(YEAR FROM NOW())::INT;
  ELSE
    v_series_season := (EXTRACT(YEAR FROM NOW()) - 1)::INT;
  END IF;

  SELECT l.*,
    COALESCE(l.settings->>'leagueType', 'fantasy') AS cfg_league_type,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks,
    COALESCE((l.settings->>'autoPlayoffs')::BOOLEAN, TRUE) AS cfg_auto_playoffs,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN RETURN json_build_object('skipped', 'league_not_found'); END IF;
  IF v_league.cfg_league_type != 'fantasy' THEN RETURN json_build_object('skipped', 'not_fantasy'); END IF;
  IF NOT v_league.cfg_auto_playoffs THEN RETURN json_build_object('skipped', 'auto_disabled'); END IF;
  IF v_league.cfg_playoff_teams < 4 THEN RETURN json_build_object('skipped', 'playoffs_disabled'); END IF;
  IF v_league.draft_status != 'completed' THEN RETURN json_build_object('skipped', 'draft_not_completed'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id AND pb.season = v_series_season
  ) THEN
    RETURN json_build_object('skipped', 'bracket_already_exists');
  END IF;

  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_weeks
    FROM public.matchups WHERE league_id = p_league_id;
  END IF;

  IF v_regular_weeks = 0 THEN RETURN json_build_object('skipped', 'no_matchups'); END IF;

  SELECT EXISTS (SELECT 1 FROM public.matchups WHERE league_id = p_league_id AND week_number <= v_regular_weeks)
  INTO v_matchups_exist;
  IF NOT v_matchups_exist THEN RETURN json_build_object('skipped', 'no_regular_season_matchups'); END IF;

  -- Treat both 'completed' and 'final' as done — MatchupService writes either.
  SELECT COUNT(*) INTO v_incomplete_count
  FROM public.matchups
  WHERE league_id = p_league_id
    AND week_number <= v_regular_weeks
    AND LOWER(status) NOT IN ('completed', 'final');

  IF v_incomplete_count > 0 THEN
    RETURN json_build_object('skipped', 'regular_season_in_progress', 'remaining', v_incomplete_count);
  END IF;

  SELECT public.generate_playoff_bracket(
    p_league_id,
    COALESCE((v_league.settings->>'consolationBracket')::BOOLEAN, FALSE),
    COALESCE((v_league.settings->>'twoWeekMatchups')::BOOLEAN, FALSE),
    COALESCE((v_league.settings->>'reseedEachRound')::BOOLEAN, FALSE),
    COALESCE(v_league.settings->>'seedingMethod', 'standings')
  ) INTO v_result;

  RETURN json_build_object('generated', true, 'result', v_result);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.auto_generate_playoff_bracket(UUID) TO authenticated, service_role;
