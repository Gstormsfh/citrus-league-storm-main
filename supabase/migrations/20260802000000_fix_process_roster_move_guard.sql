-- 0D-SEC-2g: Correct the process_roster_move authorization guard.
--
-- STATUS: STAGED. Not applied. Not pushed. Not `supabase db push`ed.
--
-- WHY:
--   The prior guard was
--       IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
--         RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: user_id mismatch');
--       END IF;
--   which permits any caller whose auth.uid() is NULL — including any anon-key
--   client hitting the RPC without a Bearer token, and any pg_cron path (which
--   is intentional). The NULL branch is load-bearing for cron and MUST stay,
--   but relying on auth.uid()=NULL as the "trusted" indicator is fragile:
--   an anon-JWT caller also lands there and can pass any p_user_id.
--
--   New guard distinguishes trusted contexts explicitly:
--     1. request.jwt.claims is unset / empty  =>  pg_cron (no JWT in session)
--     2. claims->>role = 'service_role'      =>  service-role client
--   Only those two are trusted. Every other JWT (including anon) must have a
--   populated auth.uid() equal to p_user_id or the RPC returns Unauthorized.
--
-- LOAD-BEARING PROPERTY PRESERVED:
--   pg_cron runs as postgres with no `request.jwt.claims` GUC, so branch (1)
--   fires and the guard is bypassed — nightly waiver processing continues to
--   work. This is validated by the accompanying integration test
--   server/src/__tests__/processRosterMoveGuard.integration.test.ts.
--
-- RETURN (not RAISE) semantics preserved so process_waiver_claims' ELSE branch
-- continues to catch failures per-claim rather than aborting the batch.
--
-- Everything else in the function is byte-identical to the currently deployed
-- body — only the DECLARE (added v_claims text) and the first BEGIN block are
-- changed.

CREATE OR REPLACE FUNCTION public.process_roster_move(
  p_league_id uuid,
  p_user_id uuid,
  p_drop_player_id text DEFAULT NULL::text,
  p_add_player_id text DEFAULT NULL::text,
  p_transaction_source text DEFAULT 'Roster Tab'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_team_id UUID;
  v_current_roster_size INT;
  v_max_roster_size INT;
  v_dropped_assignment_id UUID;
  v_operation_start TIMESTAMPTZ := NOW();
  v_operation_duration INTERVAL;
  v_claims text;
BEGIN
  v_claims := current_setting('request.jwt.claims', true);
  IF v_claims IS NULL OR v_claims = '' OR (v_claims::jsonb->>'role') = 'service_role' THEN
    NULL;  -- trusted context: pg_cron (no JWT) or service_role
  ELSIF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  ELSIF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: user_id mismatch');
  END IF;

  SELECT COALESCE(l.roster_size, 22) INTO v_max_roster_size FROM public.leagues l WHERE l.id = p_league_id;
  IF v_max_roster_size IS NULL THEN v_max_roster_size := 22; END IF;

  SELECT id INTO v_team_id FROM public.teams WHERE league_id = p_league_id AND owner_id = p_user_id LIMIT 1;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'User does not have a team in this league'; END IF;

  IF p_drop_player_id IS NULL AND p_add_player_id IS NULL THEN
    RAISE EXCEPTION 'Must specify at least one player to add or drop';
  END IF;

  BEGIN
    IF p_drop_player_id IS NOT NULL THEN
      SELECT id INTO v_dropped_assignment_id FROM public.roster_assignments
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id LIMIT 1;
      IF v_dropped_assignment_id IS NULL THEN RAISE EXCEPTION 'Player % is not on your roster', p_drop_player_id; END IF;
      DELETE FROM public.roster_assignments WHERE id = v_dropped_assignment_id;
      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'DROP', p_drop_player_id, p_transaction_source, NOW());

      INSERT INTO public.player_waiver_status (league_id, player_id, dropped_at, dropped_by_team_id)
      VALUES (p_league_id, p_drop_player_id::INT, NOW(), v_team_id)
      ON CONFLICT (league_id, player_id, dropped_at) DO NOTHING;

      UPDATE public.team_lineups SET
        starters = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(starters, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        bench = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(bench, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        ir = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(ir, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        slot_assignments = COALESCE(slot_assignments, '{}'::jsonb) - p_drop_player_id,
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;
      UPDATE public.draft_picks SET deleted_at = NOW()
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id AND deleted_at IS NULL;
    END IF;

    IF p_add_player_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_roster_size FROM public.roster_assignments
      WHERE team_id = v_team_id AND league_id = p_league_id;
      IF p_drop_player_id IS NULL AND v_current_roster_size >= v_max_roster_size THEN
        RAISE EXCEPTION 'Roster is full (% / %)', v_current_roster_size, v_max_roster_size;
      END IF;

      DECLARE
        v_is_goalie BOOLEAN;
        v_goalie_limit INT;
        v_current_goalies INT;
        v_starting_g INT;
        v_league_settings JSONB;
      BEGIN
        SELECT bool_or(pd.is_goalie) INTO v_is_goalie
        FROM public.player_directory pd WHERE pd.player_id = p_add_player_id::INT;

        IF COALESCE(v_is_goalie, FALSE) THEN
          SELECT COALESCE(l.settings, '{}'::jsonb) INTO v_league_settings FROM public.leagues l WHERE l.id = p_league_id;
          v_starting_g := COALESCE((v_league_settings->'rosterSlots'->>'G')::INT, 2);
          v_goalie_limit := GREATEST(v_starting_g + 2, 4);

          SELECT COUNT(*) INTO v_current_goalies
          FROM public.roster_assignments ra
          WHERE ra.team_id = v_team_id AND ra.league_id = p_league_id
            AND EXISTS (SELECT 1 FROM public.player_directory pd WHERE pd.player_id = ra.player_id::INT AND pd.is_goalie = TRUE);

          IF v_current_goalies >= v_goalie_limit THEN
            RAISE EXCEPTION 'Goalie limit reached (% / %). Drop a goalie first.', v_current_goalies, v_goalie_limit;
          END IF;
        END IF;
      END;

      INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at, created_at)
      VALUES (p_league_id, v_team_id, p_add_player_id, NOW(), NOW());
      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'ADD', p_add_player_id, p_transaction_source, NOW());

      UPDATE public.player_waiver_status
      SET cleared_at = NOW()
      WHERE league_id = p_league_id AND player_id = p_add_player_id::INT AND cleared_at IS NULL;

      UPDATE public.team_lineups SET
        bench = COALESCE(bench, '[]'::jsonb) || jsonb_build_array(p_add_player_id),
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;
      INSERT INTO public.team_lineups (league_id, team_id, bench, starters, ir, slot_assignments, updated_at)
      VALUES (p_league_id, v_team_id, jsonb_build_array(p_add_player_id), '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW())
      ON CONFLICT (league_id, team_id) DO NOTHING;

      UPDATE public.draft_picks SET deleted_at = NULL, picked_at = NOW(), team_id = v_team_id
      WHERE league_id = p_league_id AND player_id = p_add_player_id AND deleted_at IS NOT NULL;

      IF NOT FOUND THEN
        INSERT INTO public.draft_picks (league_id, team_id, player_id, round_number, pick_number, picked_at, deleted_at)
        SELECT p_league_id, v_team_id, p_add_player_id, 999,
          (SELECT COALESCE(MAX(pick_number), 0) + 1 FROM public.draft_picks WHERE league_id = p_league_id),
          NOW(), NULL
        WHERE NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE league_id = p_league_id AND player_id = p_add_player_id AND deleted_at IS NULL);
      END IF;
    END IF;

    v_operation_duration := NOW() - v_operation_start;
    RETURN jsonb_build_object(
      'success', true, 'team_id', v_team_id, 'dropped', p_drop_player_id, 'added', p_add_player_id,
      'roster_size', (SELECT COUNT(*) FROM public.roster_assignments WHERE team_id = v_team_id AND league_id = p_league_id),
      'max_roster_size', v_max_roster_size,
      'duration_ms', EXTRACT(MILLISECOND FROM v_operation_duration)::int
    );
  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO public.failed_transactions (league_id, team_id, user_id, operation_type, player_id, error_message, error_detail)
      VALUES (p_league_id, v_team_id, p_user_id, 'ADD', p_add_player_id, 'DUPLICATE_PLAYER', SQLERRM);
      RETURN jsonb_build_object('success', false, 'error', 'Player is already on a team in this league', 'code', 'DUPLICATE_PLAYER');
    WHEN OTHERS THEN
      INSERT INTO public.failed_transactions (league_id, team_id, user_id, operation_type, player_id, error_message, error_detail)
      VALUES (p_league_id, v_team_id, p_user_id, CASE WHEN p_add_player_id IS NOT NULL THEN 'ADD' ELSE 'DROP' END,
        COALESCE(p_add_player_id, p_drop_player_id), SQLERRM, SQLSTATE);
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$function$;

COMMENT ON FUNCTION public.process_roster_move(uuid, uuid, text, text, text) IS
  'Atomic add/drop RPC for a user''s own team. Auth guard trusts pg_cron (no JWT) '
  'and service_role explicitly; every other caller must have auth.uid() = p_user_id.';
