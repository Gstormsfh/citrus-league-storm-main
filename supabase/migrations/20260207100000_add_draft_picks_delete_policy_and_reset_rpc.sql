-- =============================================================================
-- Fix: draft_picks has RLS enabled but NO DELETE policy
-- This means all .delete() calls on draft_picks silently fail (0 rows deleted)
-- which is why nuclear draft reset never actually removes old picks.
-- =============================================================================

-- Add DELETE policy for commissioners on draft_picks
CREATE POLICY "Commissioners can delete picks in their leagues"
  ON public.draft_picks
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.leagues
      WHERE leagues.id = draft_picks.league_id
      AND leagues.commissioner_id = auth.uid()
    )
  );

-- Add UPDATE policy for commissioners on draft_picks (for soft-delete/undo)
-- Check if it already exists first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'draft_picks'
    AND policyname = 'Commissioners can update picks in their leagues'
  ) THEN
    CREATE POLICY "Commissioners can update picks in their leagues"
      ON public.draft_picks
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.leagues
          WHERE leagues.id = draft_picks.league_id
          AND leagues.commissioner_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- RPC function for making a draft pick that bypasses RLS
-- This is more reliable than going through INSERT policies
CREATE OR REPLACE FUNCTION public.make_draft_pick(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id TEXT,
  p_round_number INT,
  p_pick_number INT,
  p_draft_session_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Check if player already drafted
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Player already drafted in this session';
  END IF;

  -- Check for duplicate pick number
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
$$;

-- Also create an RPC function for nuclear draft reset that bypasses RLS
-- This is the most reliable approach since it runs as SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.nuclear_reset_draft(p_league_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner_id UUID;
BEGIN
  -- Verify the caller is the commissioner
  SELECT commissioner_id INTO v_commissioner_id
  FROM public.leagues
  WHERE id = p_league_id;

  IF v_commissioner_id IS NULL OR v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can reset the draft';
  END IF;

  -- Hard delete all draft picks
  DELETE FROM public.draft_picks WHERE league_id = p_league_id;

  -- Hard delete all draft orders
  DELETE FROM public.draft_order WHERE league_id = p_league_id;

  -- Delete team lineups for all teams in this league
  DELETE FROM public.team_lineups
  WHERE team_id IN (SELECT id FROM public.teams WHERE league_id = p_league_id);

  -- Delete roster assignments
  DELETE FROM public.roster_assignments WHERE league_id = p_league_id;

  -- Reset league status
  UPDATE public.leagues
  SET
    draft_status = 'not_started',
    scheduled_draft_time = NULL,
    settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      '{timerStartedAt}',
      'null'::jsonb
    )
  WHERE id = p_league_id;
END;
$$;
