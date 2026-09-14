-- ============================================================================
-- fantasy_daily_rosters: make the league-scoped SELECT policy the recorded
-- state of the repo, and remove the USING (true) read policy wherever it was
-- ever applied.
--
-- History. 20260113200001 created "Users can view rosters in their leagues"
-- (team owner in the same league, or the demo league). 20260313000000 then
-- dropped it and created "Authenticated users can view all daily rosters"
-- with USING (true) "for matchup display". Production and staging both carry
-- the league-scoped policy today (verified against pg_policies on
-- 2026-09-14), so the 2026-03 widening is not live; but the migration file
-- that widens it is still in this directory, so any environment rebuilt from
-- the migration list ends up with every authenticated user able to read
-- every league's daily rosters.
--
-- Matchup display does not need the wide policy: the matchup/roster routes
-- that must see AI-team rows read through the service-role client behind
-- assertMatchupVisible (server/src/lib/matchupVisibility.ts), and the
-- caller-client reads are all for leagues the caller belongs to.
--
-- Idempotent: safe on an environment that already carries the scoped policy.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fantasy_daily_rosters'
  ) THEN
    RAISE NOTICE 'fantasy_daily_rosters does not exist, skipping';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.fantasy_daily_rosters ENABLE ROW LEVEL SECURITY';

  -- The wide policy, under either name it has carried.
  DROP POLICY IF EXISTS "Authenticated users can view all daily rosters" ON public.fantasy_daily_rosters;
  DROP POLICY IF EXISTS "Authenticated users can view daily rosters" ON public.fantasy_daily_rosters;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fantasy_daily_rosters'
      AND policyname = 'Users can view rosters in their leagues'
  ) THEN
    CREATE POLICY "Users can view rosters in their leagues"
      ON public.fantasy_daily_rosters FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.teams
          WHERE teams.league_id = fantasy_daily_rosters.league_id
            AND teams.owner_id = (SELECT auth.uid())
        )
        OR league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::uuid  -- demo league, guest-readable
      );
  END IF;

  COMMENT ON POLICY "Users can view rosters in their leagues" ON public.fantasy_daily_rosters IS
    'Users can view roster snapshots for any team in leagues they belong to (including opponents). Demo league is guest-readable.';
END $$;
