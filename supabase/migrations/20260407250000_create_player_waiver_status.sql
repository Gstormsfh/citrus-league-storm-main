-- Create player_waiver_status + helper functions.
--
-- The original migration that defined this (20260112000000_fix_waiver_system_comprehensive.sql)
-- was never applied to the live database. As a result the entire waiver
-- system had no place to store dropped players, and is_player_on_waivers /
-- get_player_waiver_clear_time did not exist. This migration creates them
-- so the subsequent process_roster_move fix can write into the table.

CREATE TABLE IF NOT EXISTS public.player_waiver_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  player_id INT NOT NULL,
  dropped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ,
  dropped_by_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  UNIQUE(league_id, player_id, dropped_at)
);

CREATE INDEX IF NOT EXISTS idx_player_waiver_status_league_player
  ON public.player_waiver_status(league_id, player_id);
CREATE INDEX IF NOT EXISTS idx_player_waiver_status_cleared
  ON public.player_waiver_status(league_id, cleared_at) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_player_waiver_status_dropped_at
  ON public.player_waiver_status(dropped_at DESC);

ALTER TABLE public.player_waiver_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view waiver status in their leagues" ON public.player_waiver_status;
CREATE POLICY "Users can view waiver status in their leagues"
  ON public.player_waiver_status
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teams
      WHERE teams.league_id = player_waiver_status.league_id
        AND teams.owner_id = auth.uid()
    )
  );

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS waiver_period_hours INT;

CREATE OR REPLACE FUNCTION public.is_player_on_waivers(
  p_league_id UUID,
  p_player_id INT
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_waiver_period_hours INT;
  v_dropped_at TIMESTAMPTZ;
  v_cleared_at TIMESTAMPTZ;
BEGIN
  SELECT waiver_period_hours INTO v_waiver_period_hours
  FROM public.leagues WHERE id = p_league_id;
  IF v_waiver_period_hours IS NULL THEN v_waiver_period_hours := 48; END IF;

  SELECT dropped_at, cleared_at INTO v_dropped_at, v_cleared_at
  FROM public.player_waiver_status
  WHERE league_id = p_league_id AND player_id = p_player_id
  ORDER BY dropped_at DESC LIMIT 1;

  IF v_dropped_at IS NULL THEN RETURN FALSE; END IF;
  IF v_cleared_at IS NOT NULL THEN RETURN FALSE; END IF;
  IF v_dropped_at + (v_waiver_period_hours || ' hours')::INTERVAL < NOW() THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_player_waiver_clear_time(
  p_league_id UUID,
  p_player_id INT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_waiver_period_hours INT;
  v_dropped_at TIMESTAMPTZ;
  v_cleared_at TIMESTAMPTZ;
BEGIN
  SELECT waiver_period_hours INTO v_waiver_period_hours
  FROM public.leagues WHERE id = p_league_id;
  IF v_waiver_period_hours IS NULL THEN v_waiver_period_hours := 48; END IF;

  SELECT dropped_at, cleared_at INTO v_dropped_at, v_cleared_at
  FROM public.player_waiver_status
  WHERE league_id = p_league_id AND player_id = p_player_id
  ORDER BY dropped_at DESC LIMIT 1;

  IF v_dropped_at IS NULL OR v_cleared_at IS NOT NULL THEN RETURN NULL; END IF;
  RETURN v_dropped_at + (v_waiver_period_hours || ' hours')::INTERVAL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_player_on_waivers(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_waiver_clear_time(UUID, INT) TO authenticated;
