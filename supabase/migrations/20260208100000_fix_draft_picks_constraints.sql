-- =============================================================================
-- Fix: draft_picks unique constraints block new picks after draft reset
--
-- The original migration created:
--   unique(league_id, round_number, pick_number)
--   unique(league_id, player_id)
--
-- A later migration tried to DROP these but they may still exist.
-- These constraints don't account for draft_session_id or deleted_at,
-- so old picks (even soft-deleted ones) block new inserts.
--
-- Fix: Drop old constraints, create partial unique indexes that only
-- apply to active (non-deleted) picks within a session.
-- =============================================================================

-- Step 1: Drop the old unique constraints (they may or may not exist)
ALTER TABLE public.draft_picks
DROP CONSTRAINT IF EXISTS draft_picks_league_id_round_number_pick_number_key;

ALTER TABLE public.draft_picks
DROP CONSTRAINT IF EXISTS draft_picks_league_id_player_id_key;

-- Also drop any indexes with the same name pattern
DROP INDEX IF EXISTS draft_picks_league_id_round_number_pick_number_key;
DROP INDEX IF EXISTS draft_picks_league_id_player_id_key;

-- Step 2: Create proper partial unique indexes that account for deleted_at
-- Only enforce uniqueness for active (non-deleted) picks
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_picks_unique_pick_per_session
ON public.draft_picks (league_id, draft_session_id, round_number, pick_number)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_picks_unique_player_per_league
ON public.draft_picks (league_id, player_id)
WHERE deleted_at IS NULL;

-- Step 3: Update make_draft_pick to clean up stale data before inserting
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

  -- Check if player already drafted (in active picks only)
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
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

  -- Clean up any stale soft-deleted picks that might conflict
  -- (Belt and suspenders - shouldn't be needed but prevents constraint violations)
  DELETE FROM public.draft_picks
  WHERE league_id = p_league_id
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
$$;

-- Step 4: Update nuclear_reset_draft to be extra thorough
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

  -- Hard delete ALL draft picks (including soft-deleted ones)
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
