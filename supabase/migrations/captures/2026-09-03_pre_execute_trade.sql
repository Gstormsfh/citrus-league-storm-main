CREATE OR REPLACE FUNCTION public.execute_trade(p_trade_id uuid, p_league_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_offered_player_ids text[], p_requested_player_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pid TEXT; v_now TIMESTAMPTZ := NOW();
  v_offered_moved INT := 0; v_requested_moved INT := 0;
  v_caller_uid UUID; v_from_team_size INT; v_to_team_size INT; v_max_roster_size INT;
  v_from_user UUID; v_to_user UUID; v_commissioner UUID;
  v_n_offered INT := COALESCE(array_length(p_offered_player_ids, 1), 0);
  v_n_requested INT := COALESCE(array_length(p_requested_player_ids, 1), 0);
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM teams WHERE id IN (p_from_team_id, p_to_team_id)
                     AND league_id = p_league_id AND owner_id = v_caller_uid) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: you are not an owner of either team');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_from_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'From-team does not exist in this league';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_to_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'To-team does not exist in this league';
  END IF;
  IF p_from_team_id = p_to_team_id THEN
    RAISE EXCEPTION 'A team cannot trade with itself';
  END IF;
  IF v_n_offered = 0 AND v_n_requested = 0 THEN
    RAISE EXCEPTION 'Trade moves no players';
  END IF;

  SELECT l.commissioner_id, COALESCE(NULLIF(l.roster_size, 0), 22)
    INTO v_commissioner, v_max_roster_size
  FROM leagues l WHERE l.id = p_league_id;

  SELECT COALESCE(owner_id, v_commissioner) INTO v_from_user FROM teams WHERE id = p_from_team_id;
  SELECT COALESCE(owner_id, v_commissioner) INTO v_to_user   FROM teams WHERE id = p_to_team_id;

  SELECT COUNT(*) INTO v_from_team_size FROM roster_assignments
   WHERE team_id = p_from_team_id AND league_id = p_league_id;
  SELECT COUNT(*) INTO v_to_team_size FROM roster_assignments
   WHERE team_id = p_to_team_id AND league_id = p_league_id;

  IF (v_from_team_size - v_n_offered + v_n_requested) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for proposing team (% players)', v_max_roster_size;
  END IF;
  IF (v_to_team_size - v_n_requested + v_n_offered) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for accepting team (% players)', v_max_roster_size;
  END IF;

  FOREACH v_pid IN ARRAY COALESCE(p_offered_player_ids, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM roster_assignments
                    WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid) THEN
      RAISE EXCEPTION 'Offered player % is not on from-team roster', v_pid;
    END IF;
    UPDATE roster_assignments SET team_id = p_to_team_id, updated_at = v_now
     WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid;
    PERFORM public.trade_move_player_lineup(p_league_id, p_from_team_id, p_to_team_id, v_pid, v_now);
    v_offered_moved := v_offered_moved + 1;
  END LOOP;

  FOREACH v_pid IN ARRAY COALESCE(p_requested_player_ids, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM roster_assignments
                    WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid) THEN
      RAISE EXCEPTION 'Requested player % is not on to-team roster', v_pid;
    END IF;
    UPDATE roster_assignments SET team_id = p_from_team_id, updated_at = v_now
     WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid;
    PERFORM public.trade_move_player_lineup(p_league_id, p_to_team_id, p_from_team_id, v_pid, v_now);
    v_requested_moved := v_requested_moved + 1;
  END LOOP;

  INSERT INTO transaction_ledger (league_id, user_id, team_id, player_id, type, source, created_at)
  SELECT p_league_id, v_from_user, p_from_team_id, x, 'TRADE', 'Trade out', v_now
    FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_to_user, p_to_team_id, x, 'TRADE', 'Trade in', v_now
    FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_to_user, p_to_team_id, x, 'TRADE', 'Trade out', v_now
    FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_from_user, p_from_team_id, x, 'TRADE', 'Trade in', v_now
    FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x;

  INSERT INTO trade_history (league_id, trade_offer_id, team1_id, team2_id, team1_players, team2_players)
  VALUES (p_league_id, p_trade_id, p_from_team_id, p_to_team_id,
          ARRAY(SELECT x::int FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x),
          ARRAY(SELECT x::int FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x));

  RETURN jsonb_build_object('success', true,
    'offered_moved', v_offered_moved, 'requested_moved', v_requested_moved);

EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM public.log_function_error('execute_trade', SQLSTATE, SQLERRM, 'trade rolled back whole', jsonb_build_object('trade_id', p_trade_id, 'league_id', p_league_id, 'from_team_id', p_from_team_id, 'to_team_id', p_to_team_id)); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$
