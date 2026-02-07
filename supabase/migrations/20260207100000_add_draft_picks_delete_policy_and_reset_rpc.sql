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
