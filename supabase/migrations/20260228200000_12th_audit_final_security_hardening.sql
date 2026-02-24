-- ============================================================================
-- 12TH AUDIT: FINAL SECURITY HARDENING
-- ============================================================================
-- Closes ALL remaining issues found during 12th comprehensive re-audit:
--   1. raw_shots table missing RLS
--   2. handle_new_user() missing SET search_path
--   3. handle_roster_transaction() missing SET search_path + auth check
--   4. nhl_games overly-permissive INSERT/UPDATE policies
--   5. nhl_teams overly-permissive INSERT/UPDATE policies
--   6. update_updated_at_column() missing search_path
-- ============================================================================


-- ============================================================================
-- 1. FIX: raw_shots table - enable RLS and add policies
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE IF EXISTS raw_shots ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Authenticated users can read raw shots"
    ON raw_shots FOR SELECT
    USING (auth.role() = 'authenticated');

  CREATE POLICY "Service role can manage raw shots"
    ON raw_shots FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 2. FIX: handle_new_user() - add SET search_path = public
--    This is a trigger function on auth.users, so no auth.uid() check needed
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (new.id, 'user_' || substr(new.id::text, 1, 8));
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;


-- ============================================================================
-- 3. FIX: handle_roster_transaction() - add SET search_path + auth.uid() check
--    p_user_id parameter kept for backward compat but MUST match auth.uid()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_roster_transaction(
  p_league_id uuid,
  p_user_id uuid,
  p_drop_player_id text,
  p_add_player_id text,
  p_transaction_source text DEFAULT 'Roster Tab'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id uuid;
  v_team_id uuid;
  v_drop_pick_id uuid;
  v_add_pick_id uuid;
  v_existing_lineup jsonb;
  v_starters jsonb;
  v_bench jsonb;
  v_ir jsonb;
  v_slot_assignments jsonb;
  v_result jsonb;
  v_draft_session_id uuid;
  v_max_pick_number integer;
BEGIN
  -- SECURITY: Validate caller identity
  v_auth_user_id := auth.uid();
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- SECURITY: p_user_id must match the authenticated user
  IF p_user_id IS NOT NULL AND p_user_id != v_auth_user_id THEN
    RAISE EXCEPTION 'Cannot perform roster transactions for another user';
  END IF;

  -- Get user's team_id for this league (always use authenticated user)
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE league_id = p_league_id
    AND owner_id = v_auth_user_id
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'User does not have a team in this league';
  END IF;

  -- Validate: At least one operation must be specified
  IF p_drop_player_id IS NULL AND p_add_player_id IS NULL THEN
    RAISE EXCEPTION 'Must specify at least one player to add or drop';
  END IF;

  -- DROP LOGIC
  IF p_drop_player_id IS NOT NULL THEN
    -- Check ownership: Verify player is owned by this team
    SELECT id INTO v_drop_pick_id
    FROM public.draft_picks
    WHERE league_id = p_league_id
      AND team_id = v_team_id
      AND player_id = p_drop_player_id
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_drop_pick_id IS NULL THEN
      RAISE EXCEPTION 'Player % is not owned by your team', p_drop_player_id;
    END IF;

    -- Soft delete the draft_pick
    UPDATE public.draft_picks
    SET deleted_at = now()
    WHERE id = v_drop_pick_id;

    -- Remove player from team_lineups
    SELECT starters, bench, ir, slot_assignments
    INTO v_starters, v_bench, v_ir, v_slot_assignments
    FROM public.team_lineups
    WHERE team_id = v_team_id
      AND league_id = p_league_id;

    IF v_starters IS NOT NULL OR v_bench IS NOT NULL OR v_ir IS NOT NULL THEN
      IF v_starters IS NULL THEN v_starters := '[]'::jsonb; END IF;
      IF v_bench IS NULL THEN v_bench := '[]'::jsonb; END IF;
      IF v_ir IS NULL THEN v_ir := '[]'::jsonb; END IF;

      v_starters := COALESCE((
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements_text(v_starters) elem
        WHERE elem <> p_drop_player_id
      ), '[]'::jsonb);

      v_bench := COALESCE((
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements_text(v_bench) elem
        WHERE elem <> p_drop_player_id
      ), '[]'::jsonb);

      v_ir := COALESCE((
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements_text(v_ir) elem
        WHERE elem <> p_drop_player_id
      ), '[]'::jsonb);

      IF v_slot_assignments IS NOT NULL THEN
        v_slot_assignments := v_slot_assignments - p_drop_player_id;
      ELSE
        v_slot_assignments := '{}'::jsonb;
      END IF;

      UPDATE public.team_lineups
      SET starters = v_starters,
          bench = v_bench,
          ir = v_ir,
          slot_assignments = v_slot_assignments,
          updated_at = now()
      WHERE team_id = v_team_id
        AND league_id = p_league_id;
    END IF;

    -- Log the drop transaction (use authenticated user, not parameter)
    INSERT INTO public.roster_transactions (
      league_id, user_id, team_id, type, player_id, source
    ) VALUES (
      p_league_id, v_auth_user_id, v_team_id, 'DROP', p_drop_player_id, p_transaction_source
    );
  END IF;

  -- ADD LOGIC
  IF p_add_player_id IS NOT NULL THEN
    -- Check availability: Verify player is not already owned in this league
    SELECT id INTO v_add_pick_id
    FROM public.draft_picks
    WHERE league_id = p_league_id
      AND player_id = p_add_player_id
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_add_pick_id IS NOT NULL THEN
      RAISE EXCEPTION 'Player % is already owned by another team in this league', p_add_player_id;
    END IF;

    -- Check if there's a soft-deleted pick we can reactivate
    SELECT id INTO v_add_pick_id
    FROM public.draft_picks
    WHERE league_id = p_league_id
      AND team_id = v_team_id
      AND player_id = p_add_player_id
      AND deleted_at IS NOT NULL
    LIMIT 1;

    IF v_add_pick_id IS NOT NULL THEN
      UPDATE public.draft_picks
      SET deleted_at = NULL,
          picked_at = now()
      WHERE id = v_add_pick_id;
    ELSE
      SELECT draft_session_id INTO v_draft_session_id
      FROM public.draft_picks
      WHERE league_id = p_league_id
        AND deleted_at IS NULL
      LIMIT 1;

      IF v_draft_session_id IS NULL THEN
        v_draft_session_id := gen_random_uuid();
      END IF;

      SELECT COALESCE(MAX(pick_number), 0) + 1 INTO v_max_pick_number
      FROM public.draft_picks
      WHERE league_id = p_league_id;

      INSERT INTO public.draft_picks (
        league_id, team_id, player_id, round_number, pick_number, draft_session_id
      ) VALUES (
        p_league_id, v_team_id, p_add_player_id, 999, v_max_pick_number, v_draft_session_id
      )
      RETURNING id INTO v_add_pick_id;
    END IF;

    -- Add player to team_lineups bench
    SELECT starters, bench, ir, slot_assignments
    INTO v_starters, v_bench, v_ir, v_slot_assignments
    FROM public.team_lineups
    WHERE team_id = v_team_id
      AND league_id = p_league_id;

    IF v_starters IS NULL AND v_bench IS NULL AND v_ir IS NULL THEN
      INSERT INTO public.team_lineups (
        league_id, team_id, starters, bench, ir, slot_assignments
      ) VALUES (
        p_league_id, v_team_id, '[]'::jsonb, jsonb_build_array(p_add_player_id), '[]'::jsonb, '{}'::jsonb
      );
    ELSE
      IF v_starters IS NULL THEN v_starters := '[]'::jsonb; END IF;
      IF v_bench IS NULL THEN v_bench := '[]'::jsonb; END IF;
      IF v_ir IS NULL THEN v_ir := '[]'::jsonb; END IF;
      IF v_slot_assignments IS NULL THEN v_slot_assignments := '{}'::jsonb; END IF;

      IF NOT (v_starters ? p_add_player_id)
         AND NOT (v_bench ? p_add_player_id)
         AND NOT (v_ir ? p_add_player_id) THEN
        v_bench := v_bench || jsonb_build_array(p_add_player_id);
      END IF;

      INSERT INTO public.team_lineups (
        league_id, team_id, starters, bench, ir, slot_assignments
      ) VALUES (
        p_league_id, v_team_id,
        COALESCE(v_starters, '[]'::jsonb),
        v_bench,
        COALESCE(v_ir, '[]'::jsonb),
        COALESCE(v_slot_assignments, '{}'::jsonb)
      )
      ON CONFLICT (league_id, team_id) DO UPDATE
      SET starters = COALESCE(v_starters, '[]'::jsonb),
          bench = v_bench,
          ir = COALESCE(v_ir, '[]'::jsonb),
          slot_assignments = COALESCE(v_slot_assignments, '{}'::jsonb),
          updated_at = now();
    END IF;

    -- Log the add transaction (use authenticated user, not parameter)
    INSERT INTO public.roster_transactions (
      league_id, user_id, team_id, type, player_id, source
    ) VALUES (
      p_league_id, v_auth_user_id, v_team_id, 'ADD', p_add_player_id, p_transaction_source
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'message', 'Transaction complete'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_roster_transaction(uuid, uuid, text, text, text) TO authenticated;


-- ============================================================================
-- 4. FIX: nhl_games - restrict INSERT/UPDATE to service_role
--    Schedule data should only be written by backend data pipelines
-- ============================================================================

DROP POLICY IF EXISTS "Public can insert NHL games" ON public.nhl_games;
DROP POLICY IF EXISTS "Public can update NHL games" ON public.nhl_games;

CREATE POLICY "Service role can insert NHL games"
  ON public.nhl_games FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update NHL games"
  ON public.nhl_games FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Also allow authenticated users to read (keep existing select policy)


-- ============================================================================
-- 5. FIX: nhl_teams - restrict INSERT/UPDATE to service_role
-- ============================================================================

DROP POLICY IF EXISTS "Public can insert NHL teams" ON public.nhl_teams;
DROP POLICY IF EXISTS "Public can update NHL teams" ON public.nhl_teams;

CREATE POLICY "Service role can insert NHL teams"
  ON public.nhl_teams FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update NHL teams"
  ON public.nhl_teams FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ============================================================================
-- 6. FIX: update_updated_at_column() - add SET search_path
--    This is a trigger function used across many tables
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;


-- ============================================================================
-- 7. FIX: players table - restrict write policies to service_role
--    Player data should only be written by backend data pipelines
-- ============================================================================

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public can update players" ON public.players;
  CREATE POLICY "Service role can update players"
    ON public.players FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public can insert players" ON public.players;
  CREATE POLICY "Service role can insert players"
    ON public.players FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  12TH AUDIT: FINAL SECURITY HARDENING APPLIED';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  1. raw_shots: RLS enabled + policies added';
  RAISE NOTICE '  2. handle_new_user(): SET search_path = public';
  RAISE NOTICE '  3. handle_roster_transaction(): search_path + auth.uid() check';
  RAISE NOTICE '  4. nhl_games: INSERT/UPDATE restricted to service_role';
  RAISE NOTICE '  5. nhl_teams: INSERT/UPDATE restricted to service_role';
  RAISE NOTICE '  6. update_updated_at_column(): SET search_path = public';
  RAISE NOTICE '  7. players: write policies restricted to service_role';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
END $$;
