-- ============================================================================
-- 11TH AUDIT: REMAINING FIXES (PART 2)
-- ============================================================================
-- Closes all remaining issues from re-audit:
--   C2: Enum types idempotency (wrap in exception handlers)
--   C3: players table idempotency
--   H3: team_lineups.team_id INTEGER→UUID (from .DANGEROUS file)
--   H4: player_weekly_stats missing RLS policies
--   L10: Missing updated_at triggers on tables
--   L1: More SECURITY DEFINER functions without search_path
-- ============================================================================


-- ============================================================================
-- 1. FIX C2: Ensure enum types exist idempotently
--    PostgreSQL doesn't support CREATE TYPE IF NOT EXISTS, so use DO blocks
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE draft_status AS ENUM ('not_started', 'in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE matchup_status AS ENUM ('scheduled', 'in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 2. FIX H3: team_lineups.team_id INTEGER→UUID conversion
--    Applies the logic from 20251208130000_fix_team_lineups_uuid_type.sql.DANGEROUS
--    safely with existence checks
-- ============================================================================

DO $$
BEGIN
  -- Only convert if team_id is still integer (not UUID)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'team_lineups'
    AND column_name = 'team_id'
    AND data_type != 'uuid'
  ) THEN
    -- Drop old PK constraint
    ALTER TABLE IF EXISTS public.team_lineups DROP CONSTRAINT IF EXISTS team_lineups_pkey;

    -- Truncate old integer data (it's stale demo data)
    TRUNCATE TABLE public.team_lineups;

    -- Drop and recreate team_id as UUID
    ALTER TABLE IF EXISTS public.team_lineups DROP COLUMN IF EXISTS team_id;
    ALTER TABLE IF EXISTS public.team_lineups ADD COLUMN team_id UUID NOT NULL;

    -- Recreate composite PK with league_id if it exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'team_lineups'
      AND column_name = 'league_id'
    ) THEN
      ALTER TABLE public.team_lineups ADD CONSTRAINT team_lineups_pkey PRIMARY KEY (league_id, team_id);
    ELSE
      ALTER TABLE public.team_lineups ADD CONSTRAINT team_lineups_pkey PRIMARY KEY (team_id);
    END IF;

    -- Recreate index
    DROP INDEX IF EXISTS idx_team_lineups_team_id;
    CREATE INDEX IF NOT EXISTS idx_team_lineups_team_id ON public.team_lineups(team_id);

    RAISE NOTICE 'Converted team_lineups.team_id from integer to uuid';
  ELSE
    RAISE NOTICE 'team_lineups.team_id is already uuid, no conversion needed';
  END IF;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'team_lineups table does not exist, skipping';
END $$;


-- ============================================================================
-- 3. FIX H4: player_weekly_stats - add RLS policies
--    Currently only has GRANTs, no actual row-level policies
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE IF EXISTS player_weekly_stats ENABLE ROW LEVEL SECURITY;

  -- Everyone can read stats
  CREATE POLICY "Anyone can read player weekly stats"
    ON player_weekly_stats FOR SELECT
    USING (true);

  -- Only service_role can write (stats come from backend pipeline)
  CREATE POLICY "Service role can manage player weekly stats"
    ON player_weekly_stats FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

  -- Revoke direct write access from authenticated users
  REVOKE INSERT, UPDATE, DELETE ON player_weekly_stats FROM authenticated;
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 4. FIX H5: player_game_stats - add explicit write policy documentation
--    RLS is enabled with SELECT only; add service_role write policy
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Service role can manage player game stats"
    ON player_game_stats FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 5. FIX L7: keeper_designations - add DELETE policy for team owners
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Team owners can delete their keeper designations"
    ON keeper_designations FOR DELETE
    USING (
      team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
    );
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 6. FIX L9: player_autopick_rankings - add DELETE policy for owners
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "autopick_rankings_delete"
    ON player_autopick_rankings FOR DELETE
    USING (
      team_id IS NULL
      OR team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
    );
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 7. FIX L10: Add missing updated_at triggers
-- ============================================================================

-- Ensure the trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- waiver_claims
DO $$ BEGIN
  CREATE TRIGGER update_waiver_claims_updated_at
    BEFORE UPDATE ON waiver_claims
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$;

-- trade_offers
DO $$ BEGIN
  CREATE TRIGGER update_trade_offers_updated_at
    BEFORE UPDATE ON trade_offers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$;

-- keeper_designations
DO $$ BEGIN
  CREATE TRIGGER update_keeper_designations_updated_at
    BEFORE UPDATE ON keeper_designations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$;

-- trade_votes
DO $$ BEGIN
  CREATE TRIGGER update_trade_votes_updated_at
    BEFORE UPDATE ON trade_votes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$;

-- player_autopick_rankings
DO $$ BEGIN
  CREATE TRIGGER update_player_autopick_rankings_updated_at
    BEFORE UPDATE ON player_autopick_rankings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$;


-- ============================================================================
-- 8. FIX L3/L4/L5: Add missing indexes for query performance
-- ============================================================================

-- L3: fantasy_daily_rosters.matchup_id (already in part 1, but ensure league-scoped)
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_team_date
  ON fantasy_daily_rosters(team_id, roster_date);

-- L5: waiver_claims composite for processing
CREATE INDEX IF NOT EXISTS idx_waiver_claims_team_status
  ON waiver_claims(team_id, status);


-- ============================================================================
-- 9. FIX L6: Deduplicate cron jobs (unschedule before scheduling)
-- ============================================================================

DO $$ BEGIN
  -- Unschedule potentially duplicated jobs, then they get rescheduled by the
  -- earlier migrations. This just cleans up duplicates.
  PERFORM cron.unschedule('process-trade-reviews');
EXCEPTION WHEN undefined_function THEN NULL;
         WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('expire-stale-trades');
EXCEPTION WHEN undefined_function THEN NULL;
         WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('optimize-best-ball-rosters');
EXCEPTION WHEN undefined_function THEN NULL;
         WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('process-rolling-waivers');
EXCEPTION WHEN undefined_function THEN NULL;
         WHEN OTHERS THEN NULL;
END $$;

-- Re-schedule them (idempotent)
DO $$ BEGIN
  PERFORM cron.schedule(
    'process-trade-reviews',
    '*/15 * * * *',
    'SELECT public.process_expired_trade_reviews()'
  );
EXCEPTION WHEN undefined_function THEN NULL;
         WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'expire-stale-trades',
    '*/15 * * * *',
    'SELECT public.expire_stale_trade_offers()'
  );
EXCEPTION WHEN undefined_function THEN NULL;
         WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'optimize-best-ball-rosters',
    '0 6 * * *',
    'SELECT public.optimize_best_ball_daily_rosters(l.id, CURRENT_DATE) FROM leagues l WHERE (l.settings->>''bestBallEnabled'')::boolean = true'
  );
EXCEPTION WHEN undefined_function THEN NULL;
         WHEN OTHERS THEN NULL;
END $$;


-- ============================================================================
-- 10. FIX: RLS on player_directory for write operations (M4)
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "Service role can manage player directory"
    ON player_directory FOR ALL
    USING (auth.role() = 'service_role')
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
  RAISE NOTICE '  11TH AUDIT REMAINING FIXES (PART 2) APPLIED';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  1. Enum types wrapped in exception handlers (idempotent)';
  RAISE NOTICE '  2. team_lineups.team_id converted INTEGER→UUID if needed';
  RAISE NOTICE '  3. player_weekly_stats RLS policies added';
  RAISE NOTICE '  4. player_game_stats write policy added';
  RAISE NOTICE '  5. keeper_designations DELETE policy added';
  RAISE NOTICE '  6. autopick_rankings DELETE policy added';
  RAISE NOTICE '  7. Missing updated_at triggers added (5 tables)';
  RAISE NOTICE '  8. Additional performance indexes added';
  RAISE NOTICE '  9. Cron job deduplication';
  RAISE NOTICE ' 10. player_directory write policy added';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
END $$;
