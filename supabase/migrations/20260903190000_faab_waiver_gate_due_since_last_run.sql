-- ============================================================================
-- process_all_faab_waivers(): a time gate that can actually match
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- ca07ae202f5bfeb799b81cdb64ca465d against live prod):
--   supabase/migrations/captures/2026-09-03_pre_faab_waiver_gate_due_since_last_run.sql
--
-- (a) WHAT CHANGED
--   Two small helpers are created:
--     public.waiver_processing_timezone()  -> text, the single place the
--       league-processing timezone is named.
--     public.waiver_last_due_at(time)      -> timestamptz, the most recent
--       moment at which a configured waiver_process_time occurred in that
--       timezone. NULL time in, NULL out.
--
--   public.process_all_faab_waivers() is replaced. Signature, return shape,
--   SECURITY DEFINER, search_path and grants are unchanged. Only the WHERE
--   clause that decides which leagues are due changes:
--
--     before:  AND ( l.waiver_process_time IS NULL
--                    OR ABS(EXTRACT(EPOCH FROM (
--                         l.waiver_process_time
--                         - (NOW() AT TIME ZONE 'America/New_York')::TIME
--                       ))) < 1800 )
--
--     after:   a league is due when it holds a claim that was already
--              pending at its last due moment, and nothing in that league
--              has been processed since that moment:
--
--                EXISTS (pending claim with created_at <= due_at)
--                AND NOT EXISTS (any claim with processed_at >= due_at)
--
--   pg_cron job 16 (process-faab-waivers) is rescheduled from
--   '15 3 * * *' to '15 * * * *'. The command string is unchanged, and
--   cron.schedule() upserts by job name, so jobid 16 is preserved.
--
-- (b) WHY NOW
--   The old gate could not match any league in production, for two
--   independent reasons, both measured read-only on prod 2026-09-03:
--
--   1. It is evaluated at exactly one instant per day. cron.job for
--      jobid 16 reads:
--        jobname  process-faab-waivers
--        schedule 15 3 * * *
--        command  SELECT public.process_all_faab_waivers()
--      pg_cron evaluates that in the database timezone, which is UTC
--      (current_setting('TimeZone') = 'UTC'). So the gate is only ever
--      asked the question at 03:15 UTC, which is 23:15 in
--      America/New_York.
--
--   2. No configured value is anywhere near 23:15. Distribution of
--      public.leagues (55 rows):
--        waiver_type         waiver_process_time   leagues
--        rolling             03:00:00                   37
--        rolling             02:00:00                   17
--        reverse_standings   03:00:00                    1
--        faab                (none)                      0
--
--      Evaluating the old predicate at the real fire instant
--      (2026-09-03 03:15:00+00):
--        waiver_process_time  ABS(EPOCH(...)) seconds   < 1800 ?
--        02:00:00                          76500          false
--        03:00:00                          72900          false
--        01:00:00                          80100          false
--        04:00:00                          69300          false
--        12:00:00                          40500          false
--      Only a value near 23:00 would have passed. None exists.
--
--   cron.job_run_details, last 10 runs of jobid 16, all ten identical:
--     2026-09-03 03:15:00.117+00  succeeded  "0 rows"
--     2026-09-02 03:15:00.077+00  succeeded  "0 rows"
--     2026-09-01 03:15:00.098+00  succeeded  "0 rows"
--     2026-08-31 03:15:00.172+00  succeeded  "0 rows"
--     2026-08-30 03:15:00.169+00  succeeded  "0 rows"
--     2026-08-29 03:15:00.128+00  succeeded  "0 rows"
--     2026-08-28 03:15:00.167+00  succeeded  "0 rows"
--     2026-08-27 03:15:00.096+00  succeeded  "0 rows"
--     2026-08-26 03:15:00.145+00  succeeded  "0 rows"
--     2026-08-25 03:15:00.131+00  succeeded  "0 rows"
--
--   HONESTY NOTE about that evidence: "0 rows" ten times over is
--   consistent with the broken gate but does not by itself prove it,
--   because production currently has ZERO leagues with waiver_type =
--   'faab' and ZERO waiver_claims in status 'pending'. The loop would
--   return 0 rows today even with a correct gate. The proof of the
--   defect is the arithmetic above, evaluated against the real fire
--   instant and the real configured values; the run history is
--   corroborating, not load-bearing. The consequence is a launch
--   blocker rather than a live outage: the first commissioner to pick
--   FAAB after the iOS build ships would have had bids sit pending
--   forever.
--
--   The gate's own comment says "This allows the hourly cron to catch
--   all leagues". That premise was true when the function was written.
--   supabase/migrations/20260224000000_faab_processing_rpc_and_cron.sql
--   created the job as:
--        cron.schedule('process-faab-waivers', '0 * * * *', ...)
--   Something later moved the live job to '15 3 * * *' outside the
--   repo; no migration in supabase/migrations/ contains that string.
--   This migration restores the cadence the predicate was written for,
--   and replaces the predicate with one that does not depend on a
--   cron fire instant landing inside a 30-minute window at all.
--
--   Second, smaller defect fixed in the same expression: TIME minus TIME
--   yields a signed interval that does not wrap at midnight. Even at the
--   right cadence and the right timezone, a league configured at 00:00
--   was unreachable from 23:45 (ABS gives 85500, not 900). The
--   replacement never subtracts two TIME values.
--
--   Why "due since last run" and not a wider window: a window is a guess
--   about cron jitter, and it silently breaks again the next time the
--   schedule is edited. "Has this league been processed since its last
--   due moment?" is a statement about the league, not about the clock
--   the job happened to fire on. It also self-heals: if the cron is down
--   from 02:00 to 05:00, the 02:00 league processes at 05:15 instead of
--   being skipped until the following day. The last-processed signal is
--   MAX(waiver_claims.processed_at), the same signal
--   get_waiver_processing_status() already reports as last_processed,
--   and process_faab_waivers_for_league() stamps processed_at on every
--   claim it resolves, successful or failed.
--
--   DST behaviour, both directions, in America/New_York:
--     spring forward - 02:00 local does not exist that day. Postgres
--       still resolves the AT TIME ZONE cast to a real instant, and the
--       "due since" test fires on the next run after it, so a 02:00
--       league is processed that day rather than skipped. An
--       hour-equality gate would have skipped it; 17 production leagues
--       are configured at 02:00.
--     fall back - 01:00 local occurs twice. waiver_last_due_at resolves
--       to the first occurrence, and the NOT EXISTS guard means the
--       second pass is a no-op.
--
--   TIMEZONE, and what is deliberately NOT changed here: the stored
--   times keep being read as America/New_York. That is what the applied
--   schema says - the live comment on leagues.waiver_process_time is
--   'Time of day (EST) when waiver claims are processed', the live
--   column default is '03:00:00', and the live function named its output
--   column current_time_est. The repo also holds
--   20260305000000_standardize_waiver_timezone_to_mountain.sql and
--   20260312000000_faab_industry_standard_fixes.sql, which move all of
--   this to America/Denver and the default to 02:00. NEITHER IS APPLIED:
--   supabase_migrations.schema_migrations (450 rows, earliest
--   20260215234217, so both fall inside the ledger's range) contains
--   neither version, and prod still reads America/New_York. Moving 55
--   leagues' processing by two hours is a product decision, not a bug
--   fix, so this migration does not make it. It does hoist the timezone
--   into waiver_processing_timezone() so that decision becomes a
--   one-line change instead of a grep. See the OWNER DECISIONS note at
--   the bottom of this file for the per-league timezone option.
--
--   PROD_CHANGE_LEDGER Rule 2 (history read before authoring):
--     20260224000000 faab_processing_rpc_and_cron - introduced this body
--       and the hourly job. Its own NOTICE text says "30-min window for
--       hourly cron pickup", confirming the hourly premise.
--     20260228000000 11th_audit_comprehensive_fixes - set search_path on
--       this function and locked it to service_role. Grants below are
--       copied from the live ACL and match that intent.
--     20260801064252 lock_waiver_orchestrators_to_service_role_and_drop_
--       dead_roster_functions - the applied migration that produced the
--       live ACL (postgres=X, service_role=X). Preserved exactly.
--
--   Blast radius: process_all_faab_waivers() is referenced only by cron
--   job 16. It touches no league that is not waiver_type = 'faab', and
--   there are zero such leagues today, so the first runs after apply are
--   guaranteed no-ops. The two new helper functions are new names; no
--   existing object references them until this migration and its sibling
--   20260903191000 do.
--
--   Reversibility: CREATE OR REPLACE with the capture file above
--   restores the old body byte-for-byte, and
--     SELECT cron.schedule('process-faab-waivers','15 3 * * *',
--                          'SELECT public.process_all_faab_waivers()');
--   restores the old schedule. The helpers can be left in place or
--   dropped with DROP FUNCTION IF EXISTS; nothing else depends on them
--   once 20260903191000 is also rolled back.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, waiver-scheduling sweep ahead of the iOS
--   TestFlight build. Apply order: this file, then
--   20260903191000_should_process_waivers_now_per_league_boolean.sql,
--   which depends on waiver_last_due_at() created here.
--
-- Idempotent: CREATE OR REPLACE throughout, and cron.schedule() upserts
-- by job name. A second apply is a no-op. The post-conditions below
-- refuse to commit if the live body still contains the old predicate.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- The one place the league-processing timezone is named.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.waiver_processing_timezone()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  -- Matches the applied schema: the comment on leagues.waiver_process_time
  -- reads 'Time of day (EST) ...'. Changing waivers to another zone is a
  -- product decision; make it here and every waiver gate follows.
  SELECT 'America/New_York'::text;
$function$;

COMMENT ON FUNCTION public.waiver_processing_timezone() IS
  'Single source of truth for the timezone leagues.waiver_process_time is expressed in. Changed only by product decision.';

REVOKE ALL ON FUNCTION public.waiver_processing_timezone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiver_processing_timezone() TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The most recent moment p_process_time occurred, as a real instant.
-- Never subtracts two TIME values, so it cannot mis-handle midnight.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.waiver_last_due_at(p_process_time time without time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN p_process_time IS NULL THEN NULL
           WHEN (date_trunc('day', s.local_now) + p_process_time) > s.local_now
             THEN (date_trunc('day', s.local_now) + p_process_time - INTERVAL '1 day')
                    AT TIME ZONE public.waiver_processing_timezone()
           ELSE (date_trunc('day', s.local_now) + p_process_time)
                    AT TIME ZONE public.waiver_processing_timezone()
         END
  FROM (SELECT now() AT TIME ZONE public.waiver_processing_timezone() AS local_now) s;
$function$;

COMMENT ON FUNCTION public.waiver_last_due_at(time without time zone) IS
  'Most recent instant at which the given league-local waiver_process_time occurred, in waiver_processing_timezone(). NULL in, NULL out (no configured time = due at every run).';

REVOKE ALL ON FUNCTION public.waiver_last_due_at(time without time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiver_last_due_at(time without time zone) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The orchestrator, with a gate that can match.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_all_faab_waivers()
 RETURNS TABLE(league_id uuid, league_name text, claims_processed integer, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_league RECORD;
  v_count INT;
BEGIN
  FOR v_league IN
    SELECT l.id, l.name, l.waiver_process_time, d.due_at
    FROM leagues l
    CROSS JOIN LATERAL (
      SELECT public.waiver_last_due_at(l.waiver_process_time) AS due_at
    ) d
    WHERE l.waiver_type = 'faab'
      -- A claim that was already pending when the league last came due.
      -- A bid submitted AFTER that moment waits for the next one, which
      -- is the same semantics the 30-minute window intended.
      AND EXISTS (
        SELECT 1 FROM waiver_claims wc
        WHERE wc.league_id = l.id
          AND wc.status = 'pending'
          AND (d.due_at IS NULL OR wc.created_at <= d.due_at)
      )
      -- ... and this league has not already been processed for that
      -- moment. Guards against re-running every hour, including the
      -- duplicated local hour when clocks fall back.
      AND (
        d.due_at IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM waiver_claims wc2
          WHERE wc2.league_id = l.id
            AND wc2.processed_at >= d.due_at
        )
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
$function$;

-- Grants copied from the live ACL (postgres=X/postgres | service_role=X/postgres).
REVOKE ALL ON FUNCTION public.process_all_faab_waivers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_all_faab_waivers() TO service_role;

-- ----------------------------------------------------------------------------
-- Restore the hourly cadence the predicate was written for.
-- cron.schedule() upserts by job name, so jobid 16 is preserved.
-- ----------------------------------------------------------------------------
DO $cron_faab$
BEGIN
  PERFORM cron.schedule(
    'process-faab-waivers',
    '15 * * * *',
    'SELECT public.process_all_faab_waivers()'
  );
  RAISE NOTICE 'process-faab-waivers rescheduled to 15 * * * * (was 15 3 * * *)';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron not available here; schedule process-faab-waivers at 15 * * * * manually';
END $cron_faab$;

-- ----------------------------------------------------------------------------
-- Post-conditions.
-- ----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_body text;
  v_due  timestamptz;
  v_age  interval;
BEGIN
  v_body := pg_get_functiondef('public.process_all_faab_waivers()'::regprocedure);

  IF v_body LIKE '%1800%' THEN
    RAISE EXCEPTION 'process_all_faab_waivers still contains the 30-minute window';
  END IF;
  IF v_body NOT LIKE '%waiver_last_due_at%' THEN
    RAISE EXCEPTION 'process_all_faab_waivers is not using waiver_last_due_at';
  END IF;

  -- The gate must now be satisfiable: the last due moment for the two
  -- times production actually uses has to be in the past, and inside the
  -- last 24 hours, at whatever instant this migration is applied.
  FOR v_due IN SELECT public.waiver_last_due_at(t)
                 FROM (VALUES ('02:00:00'::time), ('03:00:00'::time)) v(t)
  LOOP
    v_age := now() - v_due;
    IF v_age < INTERVAL '0' OR v_age >= INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'waiver_last_due_at returned % (age %), expected a moment inside the last 24 hours', v_due, v_age;
    END IF;
  END LOOP;

  -- Midnight must not wrap. 00:00 is always inside the last 24 hours too.
  v_age := now() - public.waiver_last_due_at('00:00:00'::time);
  IF v_age < INTERVAL '0' OR v_age >= INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'waiver_last_due_at mis-handles midnight (age %)', v_age;
  END IF;

  RAISE NOTICE 'process_all_faab_waivers replaced; body md5 = %', md5(v_body);
END $verify$;

COMMIT;

-- ============================================================================
-- OWNER DECISIONS THIS MIGRATION DELIBERATELY DOES NOT MAKE
-- ============================================================================
-- 1. PER-LEAGUE TIMEZONE. public.leagues has no timezone column, and no
--    settings JSONB key resembles one: keys matching zone/tz/time/local
--    across all 55 rows are pickTimeLimit (20), waiver_game_lock (15),
--    waiver_period_hours (15), waiver_type (15), waiver_process_time
--    (15), timerStartedAt (5), auctionNominationTime (4). Every league
--    is therefore processed on one shared clock. If Citrus wants a
--    commissioner in Vancouver to get 02:00 Pacific, the smallest
--    correct change is:
--
--      ALTER TABLE public.leagues
--        ADD COLUMN waiver_timezone text NOT NULL DEFAULT 'America/New_York';
--      ALTER TABLE public.leagues
--        ADD CONSTRAINT leagues_waiver_timezone_valid
--        CHECK (now() AT TIME ZONE waiver_timezone IS NOT NULL) NOT VALID;
--      -- Backfill is the DEFAULT: every existing row keeps today's
--      -- behaviour exactly, so no league silently moves.
--      UPDATE public.leagues SET waiver_timezone = 'America/New_York'
--       WHERE waiver_timezone IS NULL;
--      COMMENT ON COLUMN public.leagues.waiver_process_time IS
--        'Time of day, in the league''s waiver_timezone, when waiver claims are processed.';
--
--    then waiver_last_due_at gains a second argument and
--    waiver_processing_timezone() becomes the default for it. NOT DONE
--    HERE: it is a schema change plus a UI change (the settings screen
--    would have to collect the zone), and it needs Garrett's approval.
--
-- 2. THE MOUNTAIN-TIME MOVE. 20260305000000 and 20260312000000 sit
--    unapplied in supabase/migrations/. They are not merely stale: they
--    also carry the same broken 30-minute-window predicate, just against
--    America/Denver, so applying them as written would NOT fix this
--    defect. If the product decision is Mountain Time, the change is one
--    line in waiver_processing_timezone() plus the column comment and
--    default, and those two files should be marked superseded rather
--    than applied.
--
-- 3. process_all_pending_waivers() HAS NO TIME GATE AT ALL. It is cron
--    job 2, '0 3 * * *', and it processes every non-faab league that has
--    a pending claim, which is 54 of the 55 production leagues. Their
--    configured waiver_process_time (02:00 or 03:00) is ignored
--    entirely; they all process at 03:00 UTC, which is 23:00 Eastern.
--    That is a separate defect from the one this file fixes, it changes
--    behaviour for real leagues rather than for zero of them, and it is
--    not in this workstream's brief. Filed here so it is not lost. The
--    server-side hourly path is corrected in the sibling migration and
--    in server/src/routes/scheduled.ts.
-- ============================================================================
