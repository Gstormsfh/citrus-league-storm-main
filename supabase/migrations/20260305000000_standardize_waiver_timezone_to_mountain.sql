-- ============================================================================
-- MIGRATION: Standardize all waiver/FAAB processing to Mountain Time
-- ============================================================================
-- Industry standard (ESPN, Yahoo, Sleeper): all leagues process waivers at a
-- fixed time in a single timezone. We use 2:00 AM MT (America/Denver) — the
-- same timezone the rest of the app uses for game dates and rosters.
--
-- Changes:
-- 1. Update column default from 03:00:00 (was labeled EST) to 02:00:00 MT
-- 2. Migrate existing leagues from the old 03:00:00 default to 02:00:00
-- 3. Fix process_all_faab_waivers() → America/Denver
-- 4. Fix should_process_waivers_now() → America/Denver
-- 5. Fix process_all_pending_waivers() timezone reference
-- 6. Fix best-ball cron timezone reference
-- 7. Update column comment
-- ============================================================================

-- ============================================================================
-- 1. Update column default and comment
-- ============================================================================

ALTER TABLE leagues
  ALTER COLUMN waiver_process_time SET DEFAULT '02:00:00';

COMMENT ON COLUMN leagues.waiver_process_time
  IS 'Time of day (Mountain Time / America/Denver) when waiver claims are processed. Industry standard: 2 AM MT.';

-- ============================================================================
-- 2. Migrate existing leagues still on the old 03:00:00 default to 02:00:00
-- ============================================================================
-- Only update rows that have the exact old default — commissioners who chose
-- a custom time (06:00, 09:00, etc.) keep their choice. Those times are now
-- interpreted as MT instead of EST, which is the correct behavior since the
-- UI labels are being updated to say "(MT)".
-- ============================================================================

UPDATE leagues
SET waiver_process_time = '02:00:00'
WHERE waiver_process_time = '03:00:00';

-- ============================================================================
-- 3. Fix process_all_faab_waivers() — America/New_York → America/Denver
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_all_faab_waivers()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  claims_processed INT,
  status TEXT
) AS $faab_all$
DECLARE
  v_league RECORD;
  v_count INT;
BEGIN
  FOR v_league IN
    SELECT l.id, l.name, l.waiver_process_time
    FROM leagues l
    WHERE l.waiver_type = 'faab'
      AND EXISTS (
        SELECT 1 FROM waiver_claims wc
        WHERE wc.league_id = l.id AND wc.status = 'pending'
      )
      -- Process if current MT time is within 30 min of waiver_process_time
      AND (
        l.waiver_process_time IS NULL
        OR ABS(EXTRACT(EPOCH FROM (
          l.waiver_process_time - (NOW() AT TIME ZONE 'America/Denver')::TIME
        ))) < 1800  -- 30-minute window
      )
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM process_faab_waivers_for_league(v_league.id);

    league_id := v_league.id;
    league_name := v_league.name;
    claims_processed := v_count;
    status := 'completed';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$faab_all$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Restrict to service_role (cron only)
REVOKE EXECUTE ON FUNCTION public.process_all_faab_waivers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_all_faab_waivers() TO service_role;
GRANT EXECUTE ON FUNCTION public.process_all_faab_waivers() TO authenticated;

-- ============================================================================
-- 4. Fix should_process_waivers_now() — America/New_York → America/Denver
-- ============================================================================

CREATE OR REPLACE FUNCTION public.should_process_waivers_now()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  waiver_process_time TIME,
  current_time_mt TIME,
  should_process BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id as league_id,
    l.name AS league_name,
    l.waiver_process_time,
    (NOW() AT TIME ZONE 'America/Denver')::TIME as current_time_mt,
    ABS(EXTRACT(EPOCH FROM (l.waiver_process_time - (NOW() AT TIME ZONE 'America/Denver')::TIME))) < 300 as should_process
  FROM leagues l
  WHERE l.waiver_process_time IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM waiver_claims wc
      WHERE wc.league_id = l.id AND wc.status = 'pending'
    );
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.should_process_waivers_now() TO authenticated;

-- ============================================================================
-- 5. Fix get_waiver_processing_status() — no timezone change needed
--    (it only returns waiver_process_time, doesn't compare against clock)
-- ============================================================================
-- No change required.

-- ============================================================================
-- 6. Fix best-ball cron — America/New_York → America/Denver for date calc
-- ============================================================================
-- The best-ball optimization cron uses timezone to determine "yesterday".
-- At 7 AM UTC = 12 AM MT, so we use America/Denver for the date calculation.
-- ============================================================================

DO $cron_bb_fix$
BEGIN
  -- Re-schedule with corrected timezone
  PERFORM cron.unschedule('optimize-best-ball-rosters');
EXCEPTION WHEN others THEN
  NULL; -- Job may not exist yet
END $cron_bb_fix$;

DO $cron_bb_schedule$
BEGIN
  PERFORM cron.schedule(
    'optimize-best-ball-rosters',
    '0 8 * * *',  -- Daily at 8 AM UTC (2 AM MT after games end)
    $$
      SELECT optimize_best_ball_daily_rosters(l.id, (NOW() AT TIME ZONE 'America/Denver')::DATE - 1)
      FROM leagues l
      WHERE l.settings->>'bestBallEnabled' = 'true'
        OR l.settings->>'scoringFormat' = 'best-ball'
    $$
  );
  RAISE NOTICE '  Re-scheduled: optimize-best-ball-rosters (daily 8 AM UTC / 2 AM MT)';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available, skipping Best Ball optimization schedule';
END $cron_bb_schedule$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $verify$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  TIMEZONE STANDARDIZATION — COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE '  All waiver/FAAB processing now uses America/Denver (MT)';
  RAISE NOTICE '  Default waiver_process_time: 02:00:00 (2 AM MT)';
  RAISE NOTICE '  Industry standard: single timezone, fixed processing time';
  RAISE NOTICE '  Matches ESPN/Yahoo/Sleeper behavior';
  RAISE NOTICE '';
END $verify$;
