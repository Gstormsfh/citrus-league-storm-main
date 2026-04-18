-- Make join_league_with_code idempotent.
--
-- Previously: if the user already had a team in the league, the RPC
-- returned { success: false, error: 'You already have a team in this
-- league.' }. That made the client call non-retryable — a POST that
-- succeeded once and got retried (e.g. mobile network hiccup) would
-- surface a confusing error to a user who actually joined.
--
-- Now: if the user already has a team, the RPC returns the SAME
-- success payload as a fresh join (league_id, league_name, settings,
-- team_id, team_name). The client can safely retry, refresh, or
-- double-click the invite link without ever seeing "already joined"
-- as an error.

CREATE OR REPLACE FUNCTION public.join_league_with_code(
  p_join_code text,
  p_user_id   uuid DEFAULT NULL,
  p_team_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_league RECORD;
  v_existing_team RECORD;
  v_team_count INT;
  v_max_teams INT;
  v_final_team_name TEXT;
  v_new_team RECORD;
  v_is_pool BOOLEAN;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated.');
  END IF;

  SELECT l.* INTO v_league FROM public.leagues l WHERE l.join_code = p_join_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid join code. Please check and try again.');
  END IF;

  -- IDEMPOTENT PATH: if user already has a team here, return success
  -- with the existing team. This keeps retries / double-taps safe.
  SELECT t.* INTO v_existing_team FROM public.teams t
  WHERE t.league_id = v_league.id AND t.owner_id = v_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'league_id', v_league.id,
      'league_name', v_league.name,
      'settings', v_league.settings,
      'team_id', v_existing_team.id,
      'team_name', v_existing_team.team_name,
      'already_member', true
    );
  END IF;

  SELECT COUNT(*) INTO v_team_count FROM public.teams t WHERE t.league_id = v_league.id;
  v_max_teams := COALESCE(
    (v_league.settings->>'teamsCount')::INT,
    (v_league.settings->>'teamCount')::INT,
    (v_league.settings->>'numberOfTeams')::INT,
    12
  );
  IF v_team_count >= v_max_teams THEN
    RETURN jsonb_build_object('success', false, 'error', 'This league is full.');
  END IF;

  -- Pool leagues don't have drafts; skip the draft-status block.
  v_is_pool := (v_league.settings->>'leagueType') IS NOT NULL
               AND (v_league.settings->>'leagueType') <> 'fantasy';

  IF NOT v_is_pool THEN
    IF v_league.draft_status = 'in_progress' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot join — the draft is currently in progress.');
    END IF;
    IF v_league.draft_status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot join — the draft has already been completed.');
    END IF;
  END IF;

  IF p_team_name IS NOT NULL AND LENGTH(TRIM(p_team_name)) > 0 THEN
    v_final_team_name := TRIM(p_team_name);
  ELSE
    SELECT COALESCE(p.default_team_name, p.username, 'Team ' || (v_team_count + 1))
    INTO v_final_team_name
    FROM profiles p
    WHERE p.id = v_user_id;
    IF v_final_team_name IS NULL THEN
      v_final_team_name := 'Team ' || (v_team_count + 1);
    END IF;
  END IF;

  INSERT INTO public.teams (league_id, owner_id, team_name)
  VALUES (v_league.id, v_user_id, v_final_team_name)
  RETURNING * INTO v_new_team;

  RETURN jsonb_build_object(
    'success', true,
    'league_id', v_league.id,
    'league_name', v_league.name,
    'settings', v_league.settings,
    'team_id', v_new_team.id,
    'team_name', v_new_team.team_name,
    'already_member', false
  );
END;
$$;
