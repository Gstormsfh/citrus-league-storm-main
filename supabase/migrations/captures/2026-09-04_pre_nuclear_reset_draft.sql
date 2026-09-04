CREATE OR REPLACE FUNCTION public.nuclear_reset_draft(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id UUID;
BEGIN
  SELECT commissioner_id INTO v_commissioner_id
  FROM public.leagues
  WHERE id = p_league_id;

  IF v_commissioner_id IS NULL OR v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can reset the draft';
  END IF;

  DELETE FROM public.draft_picks WHERE league_id = p_league_id;
  DELETE FROM public.draft_order WHERE league_id = p_league_id;
  DELETE FROM public.team_lineups
    WHERE team_id IN (SELECT id FROM public.teams WHERE league_id = p_league_id);
  DELETE FROM public.roster_assignments WHERE league_id = p_league_id;

  UPDATE public.leagues
  SET draft_status = 'not_started',
      scheduled_draft_time = NULL,
      settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{timerStartedAt}', 'null'::jsonb)
  WHERE id = p_league_id;
END;
$function$
