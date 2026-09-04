CREATE OR REPLACE FUNCTION public.reset_playoff_bracket(p_league_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket_id UUID;
BEGIN
  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = p_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can reset playoff brackets');
  END IF;

  -- Get current bracket
  SELECT id INTO v_bracket_id
  FROM public.playoff_brackets
  WHERE league_id = p_league_id
  AND season = EXTRACT(YEAR FROM NOW());

  IF v_bracket_id IS NULL THEN
    RETURN json_build_object('error', 'No bracket found for this season');
  END IF;

  -- Delete bracket and cascade (seeds and series auto-deleted via CASCADE)
  DELETE FROM public.playoff_brackets WHERE id = v_bracket_id;

  -- Clean up playoff matchups (week_number > regular season)
  DELETE FROM public.matchups
  WHERE league_id = p_league_id
  AND week_number > COALESCE(
    (SELECT (settings->>'regularSeasonWeeks')::INT FROM public.leagues WHERE id = p_league_id),
    (SELECT COALESCE(MAX(m2.week_number), 0) FROM public.matchups m2 WHERE m2.league_id = p_league_id)
  );

  RETURN json_build_object('success', true, 'bracket_id', v_bracket_id);
END;
$function$
