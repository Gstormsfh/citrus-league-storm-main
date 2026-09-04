CREATE OR REPLACE FUNCTION public.make_draft_pick(p_league_id uuid, p_team_id uuid, p_player_id text, p_round_number integer, p_pick_number integer, p_draft_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pick_id UUID;
  v_is_member BOOLEAN;
BEGIN
  -- Verify the caller is commissioner or team owner in this league
  SELECT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
    AND (
      commissioner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.teams
        WHERE teams.league_id = p_league_id
        AND teams.owner_id = auth.uid()
      )
    )
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Not authorized to make picks in this league';
  END IF;

  -- Check if player already drafted in THIS SESSION (active picks only)
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
    AND draft_session_id = p_draft_session_id
    AND player_id = p_player_id
    AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Player already drafted in this session';
  END IF;

  -- Check for duplicate pick number (within same session, active only)
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
    AND draft_session_id = p_draft_session_id
    AND round_number = p_round_number
    AND pick_number = p_pick_number
    AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This pick number is already taken in this session';
  END IF;

  -- Clean up stale soft-deleted picks from THIS SESSION ONLY
  -- (Don't delete picks from other sessions — they're historical data)
  DELETE FROM public.draft_picks
  WHERE league_id = p_league_id
  AND draft_session_id = p_draft_session_id
  AND deleted_at IS NOT NULL;

  -- Insert the pick
  INSERT INTO public.draft_picks (
    league_id, team_id, player_id, round_number, pick_number,
    draft_session_id, picked_at
  ) VALUES (
    p_league_id, p_team_id, p_player_id, p_round_number, p_pick_number,
    p_draft_session_id, NOW()
  )
  RETURNING id INTO v_pick_id;

  RETURN v_pick_id;
END;
$function$
