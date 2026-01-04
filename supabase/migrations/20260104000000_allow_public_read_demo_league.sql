-- ============================================================================
-- ALLOW PUBLIC READ ACCESS TO DEMO LEAGUE
-- ============================================================================
-- Allows anonymous users (guests) to read the demo league and related data
-- for demonstration purposes. This enables guests to see a real league
-- as a read-only demo.
-- ============================================================================

-- Allow anonymous users to read the demo league
CREATE POLICY "Public can view demo league"
ON public.leagues
FOR SELECT
USING (id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Allow anonymous users to read teams in the demo league
CREATE POLICY "Public can view demo league teams"
ON public.teams
FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Allow anonymous users to read matchups in the demo league
CREATE POLICY "Public can view demo league matchups"
ON public.matchups
FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Allow anonymous users to read draft picks in the demo league (for rosters)
CREATE POLICY "Public can view demo league draft picks"
ON public.draft_picks
FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9' AND deleted_at IS NULL);

-- Allow anonymous users to read lineups in the demo league
CREATE POLICY "Public can view demo league lineups"
ON public.team_lineups
FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Allow anonymous users to read daily rosters in the demo league
CREATE POLICY "Public can view demo league daily rosters"
ON public.fantasy_daily_rosters
FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Add comments
COMMENT ON POLICY "Public can view demo league" ON public.leagues IS 'Allows anonymous users to read the demo league for demonstration purposes';
COMMENT ON POLICY "Public can view demo league teams" ON public.teams IS 'Allows anonymous users to read teams in the demo league';
COMMENT ON POLICY "Public can view demo league matchups" ON public.matchups IS 'Allows anonymous users to read matchups in the demo league';
COMMENT ON POLICY "Public can view demo league draft picks" ON public.draft_picks IS 'Allows anonymous users to read rosters (draft picks) in the demo league';
COMMENT ON POLICY "Public can view demo league lineups" ON public.team_lineups IS 'Allows anonymous users to read lineups in the demo league';
COMMENT ON POLICY "Public can view demo league daily rosters" ON public.fantasy_daily_rosters IS 'Allows anonymous users to read daily rosters in the demo league';