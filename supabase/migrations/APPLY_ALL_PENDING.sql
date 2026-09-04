-- ============================================================================
-- CITRUS — ALL PENDING MIGRATIONS, IN ORDER (generated 2026-09-04)
-- ============================================================================
-- Twelve migrations, concatenated in the order they must run. Each one keeps
-- its own BEGIN/COMMIT and its own guard block, so they apply independently:
-- if one fails it rolls back only itself and the editor stops there, leaving
-- everything before it applied and everything after it untouched.
--
-- Paste the whole thing into the Supabase SQL editor and press Run.
-- Then run the verification query at the very bottom of this file.
-- ============================================================================
SET client_encoding = 'UTF8';


-- ===========================================================================
-- [01/12] 20260903190000_faab_waiver_gate_due_since_last_run.sql
-- ===========================================================================
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
--     fall back - 01:00 local occurs twice. CORRECTED 2026-09-03 after
--       measurement in a PostgreSQL 16 scratch cluster; an earlier draft
--       of this block asserted the opposite of what Postgres does, and
--       both halves of it were wrong:
--         (i)  Postgres resolves an ambiguous local time to the
--              STANDARD-time reading, which here is the SECOND 01:00
--              (01:00 EST). waiver_last_due_at('01:00') evaluated at the
--              first 01:15 returns 2026-11-01 06:00:00+00, not
--              05:00:00+00. So due_at sits 45 minutes AHEAD of the first
--              01:15 run.
--         (ii) The league still fires on that first 01:15 run (its claim
--              was created before due_at and nothing has been processed
--              since), and the repeated 01:15 is a no-op - but what
--              makes it a no-op is the pending-claim EXISTS, because the
--              first pass resolved every pending claim. It is NOT the
--              NOT EXISTS processed_at guard: at the repeated 01:15 the
--              stamp left by the first pass (05:15) is still earlier
--              than due_at (06:00), so that guard is satisfied and does
--              not block. Hand the league a fresh claim between the two
--              passes and the second one processes it, which is the
--              wanted behaviour rather than a bug.
--       Net effect on production: none. The live configured values are
--       02:00 (17 leagues) and 03:00 (38); no league is configured at
--       01:00, and 02:00 is unambiguous on fall-back day. All three
--       facts are asserted mechanically in
--       scripts/proof/faab-waiver-due-gate.proof.sh step [10].
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
      -- moment. This is what stops an hourly cron from re-running a
      -- league whose claims were pending at due_at but are still pending
      -- after a partial or failed pass, which the EXISTS above cannot
      -- see. It is not what handles the duplicated local hour on
      -- fall-back day; see the DST note above for what actually does.
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

-- ===========================================================================
-- [02/12] 20260903191000_should_process_waivers_now_per_league_boolean.sql
-- ===========================================================================
-- ============================================================================
-- should_process_waivers_now(): a per-league boolean the caller can use
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- 8e2f537a5d96e274e8f2b2700d5a4b1f against live prod):
--   supabase/migrations/captures/2026-09-03_pre_should_process_waivers_now_per_league_boolean.sql
--
-- (a) WHAT CHANGED
--   1. NEW OVERLOAD public.should_process_waivers_now(p_league_id uuid)
--      RETURNS boolean. This is a create, not a replace; no function with
--      that signature exists in production today. It answers the question
--      the server actually asks: "is THIS league due right now?"
--
--   2. public.should_process_waivers_now() - the existing zero-argument
--      diagnostic - is replaced. Its signature, return shape, column
--      names (including current_time_est), STABLE marking, search_path
--      and grants are unchanged. Only the should_process expression
--      changes, from a 300-second clock window to the same predicate the
--      new overload and process_all_faab_waivers() use, so the diagnostic
--      and the processors can no longer disagree about what "due" means.
--
--   Both use public.waiver_last_due_at(time), created in
--   20260903190000_faab_waiver_gate_due_since_last_run.sql. This file
--   refuses to run without it.
--
-- (b) WHY NOW
--   VERIFIED ON PRODUCTION 2026-09-03, read-only:
--
--   Overload count. pg_proc joined to pg_namespace for nspname='public'
--   and proname='should_process_waivers_now' returns exactly ONE row:
--     should_process_waivers_now()  pronargs 0  provolatile s  plpgsql
--     RETURNS TABLE(league_id uuid, league_name text,
--                   waiver_process_time time without time zone,
--                   current_time_est time without time zone,
--                   should_process boolean)
--   There is no one-argument form. The only caller is
--   server/src/routes/scheduled.ts, the POST /api/scheduled/waiver-process
--   handler driven hourly by .github/workflows/daily-waiver-process.yml
--   (cron "10 * * * *"). It calls:
--
--     const { data: due, error: dueErr } = await admin.rpc(
--       'should_process_waivers_now', { p_league_id: leagueId });
--     if (!dueErr && due === false) { skip }
--
--   That gate is dead twice over, and either failure alone is sufficient:
--
--     i.  ARITY. The caller supplies a named argument p_league_id to a
--         function that takes none. PostgREST resolves an RPC by the set
--         of argument names in the body, finds no candidate, and returns
--         PGRST202. dueErr is therefore truthy, !dueErr is false, and the
--         skip branch is unreachable.
--     ii. SEMANTICS. Even if the argument were dropped, the function
--         returns SETOF a five-column row. supabase-js hands that back as
--         an ARRAY. `due === false` is never true for an array, so the
--         skip branch is still unreachable.
--
--   Net effect: every league that has at least one pending waiver claim
--   is processed on EVERY hourly run of that workflow, and
--   leagues.waiver_process_time is honoured nowhere in that path. The
--   handler's own doc comment claims it "Honors each league's
--   waiver_process_time to the hour via the existing
--   should_process_waivers_now DB function"; it does not.
--
--   This matters for essentially the whole customer base, not an edge
--   case. Production leagues by waiver_type, 55 rows total:
--     rolling            54   (37 at 03:00:00, 17 at 02:00:00)
--     reverse_standings   1   (03:00:00)
--     faab                0
--   For all 55, the non-faab branch of that handler calls
--   public.process_all_pending_waivers(), whose live body (read via
--   pg_get_functiondef) contains NO time predicate whatsoever - it loops
--   over every non-faab league with a pending claim. So this broken RPC
--   gate is the ONLY thing standing between an hourly workflow and
--   processing every league's waivers at every hour of the day.
--
--   It has not bitten yet only because production currently holds ZERO
--   waiver_claims in status 'pending', so the handler returns early at
--   `if (leagueIds.length === 0)`. That is a launch blocker with a fuse
--   on it, not a live outage: the first pending claim after the iOS
--   build ships gets processed at the top of the next hour instead of at
--   the commissioner's configured time.
--
--   Why a boolean overload rather than teaching the caller to read the
--   table: the caller wants one league and one bit. Returning SETOF
--   forces every caller to re-implement row selection and to decide what
--   an empty set means, and the existing caller got that wrong. A
--   scalar, non-nullable boolean has exactly one reading. The
--   zero-argument form is kept, and kept exposed to anon and
--   authenticated, because it is the human-facing diagnostic referenced
--   from docs/PERFORMANCE_AND_SCALE_2026-09-02.md.
--
--   Definition of due, identical in both forms and in
--   process_all_faab_waivers():
--     due_at := waiver_last_due_at(l.waiver_process_time)
--     due    := EXISTS (pending claim with created_at <= due_at)
--               AND NOT EXISTS (any claim with processed_at >= due_at)
--   A NULL waiver_process_time means "no configured time", which stays
--   what it has always meant: due at every run.
--
--   The old 300-second window in the zero-argument form had the same two
--   flaws documented at length in 20260903190000: it is only ever true
--   inside a five-minute band of wall-clock time, and TIME minus TIME
--   does not wrap at midnight. It was never load-bearing because no
--   caller read it correctly, which is precisely why it went unnoticed.
--
--   PROD_CHANGE_LEDGER Rule 2 (history read before authoring):
--     20260116100000 create_waiver_processing_rpc - created the
--       zero-argument form with the 300-second window. Predates the
--       migration ledger (earliest recorded version is 20260215234217),
--       which is why it is not listed as applied.
--     20260228000000 11th_audit_comprehensive_fixes - replaced it to fix
--       l.league_name to l.name and pin search_path. The live body
--       matches this version, so it reached production even though the
--       version is absent from supabase_migrations.schema_migrations.
--     20260305000000 standardize_waiver_timezone_to_mountain - would
--       have renamed the output column current_time_est to
--       current_time_mt. NOT APPLIED (absent from schema_migrations, and
--       the live output column is still current_time_est). This file
--       keeps current_time_est, because renaming an output column of a
--       RETURNS TABLE function requires DROP plus CREATE and would break
--       any consumer selecting it by name.
--
--   Blast radius: one new function name, and one replaced body whose
--   only machine consumer is a caller that could never read it. Grants
--   are restated to match the live ACL exactly. No schema change, no
--   data change.
--
--   Reversibility:
--     DROP FUNCTION IF EXISTS public.should_process_waivers_now(uuid);
--     then CREATE OR REPLACE from the capture file above, which restores
--     the zero-argument body byte-for-byte.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, waiver-scheduling sweep ahead of the iOS
--   TestFlight build. Apply AFTER
--   20260903190000_faab_waiver_gate_due_since_last_run.sql.
--
--   Ships with the matching application fix in
--   server/src/routes/scheduled.ts, which must deploy together with this
--   migration: the handler starts calling the boolean overload and, for
--   non-faab leagues, switches from the global
--   process_all_pending_waivers() to the per-league
--   process_waiver_claims(uuid) so that a single due league no longer
--   drags every other league's waivers through with it.
--
-- Idempotent: CREATE OR REPLACE throughout. A second apply is a no-op.
-- ============================================================================

BEGIN;

-- Precondition: the shared helper from 20260903190000 must exist.
DO $require$
BEGIN
  IF to_regprocedure('public.waiver_last_due_at(time without time zone)') IS NULL THEN
    RAISE EXCEPTION 'public.waiver_last_due_at(time) is missing; apply 20260903190000_faab_waiver_gate_due_since_last_run.sql first';
  END IF;
END $require$;

-- ----------------------------------------------------------------------------
-- NEW: the per-league boolean the scheduled handler needs.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.should_process_waivers_now(p_league_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- EXISTS, so the result is always true or false and never NULL: an
  -- unknown league id reads as "not due", which is the safe answer.
  SELECT EXISTS (
    SELECT 1
    FROM leagues l
    CROSS JOIN LATERAL (
      SELECT public.waiver_last_due_at(l.waiver_process_time) AS due_at
    ) d
    WHERE l.id = p_league_id
      AND EXISTS (
        SELECT 1 FROM waiver_claims wc
        WHERE wc.league_id = l.id
          AND wc.status = 'pending'
          AND (d.due_at IS NULL OR wc.created_at <= d.due_at)
      )
      AND (
        d.due_at IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM waiver_claims wc2
          WHERE wc2.league_id = l.id
            AND wc2.processed_at >= d.due_at
        )
      )
  );
$function$;

COMMENT ON FUNCTION public.should_process_waivers_now(uuid) IS
  'True when this league holds a claim that was pending at its last waiver_process_time and has not been processed since. Called by POST /api/scheduled/waiver-process.';

-- Granted to the same roles as the zero-argument form, and for a
-- non-obvious reason: that form is SECURITY INVOKER and is callable by
-- anon, and it now calls this overload. Granting service_role only would
-- make the existing anon-facing diagnostic fail with "permission denied
-- for function should_process_waivers_now(uuid)". Exposure is not
-- widened: this overload is SECURITY INVOKER too, so it reads leagues
-- and waiver_claims under the caller's own RLS, and an id the caller
-- cannot see simply reads as false.
REVOKE ALL ON FUNCTION public.should_process_waivers_now(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.should_process_waivers_now(uuid) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- REPLACED: the zero-argument diagnostic, now agreeing with the processors.
-- Return shape and column names are byte-identical to the live function.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.should_process_waivers_now()
 RETURNS TABLE(league_id uuid, league_name text, waiver_process_time time without time zone, current_time_est time without time zone, should_process boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    l.id AS league_id,
    l.name AS league_name,
    l.waiver_process_time,
    (now() AT TIME ZONE public.waiver_processing_timezone())::TIME AS current_time_est,
    public.should_process_waivers_now(l.id) AS should_process
  FROM leagues l
  WHERE l.waiver_process_time IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM waiver_claims wc
      WHERE wc.league_id = l.id AND wc.status = 'pending'
    );
END;
$function$;

-- Grants restated from the live ACL
-- (postgres=X | anon=X | authenticated=X | service_role=X).
REVOKE ALL ON FUNCTION public.should_process_waivers_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.should_process_waivers_now() TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Post-conditions.
-- ----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_body   text;
  v_arity  int;
  v_sample uuid;
  v_bool   boolean;
BEGIN
  -- The boolean overload must exist and be exactly one row alongside the
  -- zero-argument form.
  SELECT count(*) INTO v_arity
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'should_process_waivers_now';
  IF v_arity <> 2 THEN
    RAISE EXCEPTION 'expected exactly 2 should_process_waivers_now overloads (0-arg and uuid), found %', v_arity;
  END IF;

  IF pg_get_function_result('public.should_process_waivers_now(uuid)'::regprocedure) <> 'boolean' THEN
    RAISE EXCEPTION 'should_process_waivers_now(uuid) must return boolean, returns %',
      pg_get_function_result('public.should_process_waivers_now(uuid)'::regprocedure);
  END IF;

  -- The zero-argument diagnostic must no longer carry the 300-second window.
  v_body := pg_get_functiondef('public.should_process_waivers_now()'::regprocedure);
  IF v_body LIKE '%< 300%' THEN
    RAISE EXCEPTION 'should_process_waivers_now() still contains the 300-second clock window';
  END IF;

  -- It must still expose current_time_est, or existing readers break.
  IF pg_get_function_result('public.should_process_waivers_now()'::regprocedure) NOT LIKE '%current_time_est%' THEN
    RAISE EXCEPTION 'should_process_waivers_now() lost its current_time_est output column';
  END IF;

  -- Smoke test: the overload must return a non-NULL boolean for a real
  -- league id and for an id that does not exist.
  SELECT id INTO v_sample FROM leagues LIMIT 1;
  IF v_sample IS NOT NULL THEN
    v_bool := public.should_process_waivers_now(v_sample);
    IF v_bool IS NULL THEN
      RAISE EXCEPTION 'should_process_waivers_now(uuid) returned NULL for league %', v_sample;
    END IF;
  END IF;
  v_bool := public.should_process_waivers_now('00000000-0000-0000-0000-000000000000'::uuid);
  IF v_bool IS NOT false THEN
    RAISE EXCEPTION 'should_process_waivers_now(uuid) must be false for an unknown league, got %', v_bool;
  END IF;

  -- The zero-argument diagnostic calls the overload as SECURITY INVOKER,
  -- so every role that can execute the diagnostic must be able to execute
  -- the overload and the two helpers it reaches.
  IF NOT has_function_privilege('anon', 'public.should_process_waivers_now(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.waiver_last_due_at(time without time zone)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.waiver_processing_timezone()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute should_process_waivers_now() but not everything it calls; the diagnostic would fail with permission denied';
  END IF;

  RAISE NOTICE 'should_process_waivers_now: boolean overload added, diagnostic realigned; 0-arg body md5 = %', md5(v_body);
END $verify$;

COMMIT;

-- ===========================================================================
-- [03/12] 20260903200000_auction_lot_award_and_completion.sql
-- ===========================================================================
-- ============================================================================
-- Auction: award the uncontested lot, guard the budget, and finish the draft
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- 8cfb4889c4a26716cf5bed542a9c702a against live prod):
--   supabase/migrations/captures/2026-09-03_pre_auction_lot_award_and_completion.sql
--
-- (a) WHAT CHANGED
--   1. close_nomination_v2() no longer treats a single-bid lot as "no sale".
--      Every lot with a high bidder closes 'sold' to that bidder at that
--      amount. An uncontested lot therefore awards the nominator at their
--      opening bid, which is what every other auction in the sport does.
--   2. The budget UPDATE is now guarded: a decrement that matches zero rows
--      raises instead of silently succeeding.
--   3. close_nomination_v2() emits 'draft_completed' when the last lot of
--      the auction resolves. Nothing did before.
--   4. auction_nominations_status_check gains 'cancelled'.
--
--   Signature, return shape, SECURITY DEFINER, search_path and grants are
--   unchanged.
--
-- (b) WHY NOW
--
--   DEFECT 1 - the uncontested lot took the player away from its winner.
--   The body computed `v_no_sale := v_total_bids = 1`, and
--   nominate_player_v2 writes the nominator's opening bid as a row in
--   auction_bids. So a lot nobody else bid on had exactly one bid and ended
--   'no_sale': no player awarded, no budget spent, the nominator's turn
--   burned. Its own comment called this "6a simplicity", not a rule.
--
--   The product disagrees with it in four places, all read this session:
--     * v1 (AuctionService.ts:157-197, the behaviour ADR-002 carries
--       forward) sets 'sold' unconditionally and awards the high bidder.
--       v1's nominatePlayer also wrote the opening bid as a bid row, so
--       under v1 an uncontested lot awarded the nominator every time.
--     * ADR-002:162 defines auction_nomination_expired as "on window expiry
--       WITHOUT bid" - a state that cannot occur, because the opening bid
--       always exists. The 6a shortcut reinterpreted "without bid" as
--       "with exactly one bid".
--     * The client tells the nominator "You lead this auction"
--       (AuctionPanel.tsx:249-253) and disables their own bid button
--       because iAmLeading is true (AuctionPanel.tsx:216-222) - then prints
--       "No sale. <player> went unsold" when the timer expires.
--     * No DESIGN doc or Decision Log entry proposes no-sale-on-no-follow-up.
--
--   DEFECT 2 - the budget decrement could silently do nothing.
--   `UPDATE auction_budgets ... WHERE league_id = ... AND team_id = ...`
--   with no row check. League f548834a has ZERO rows in auction_budgets
--   (its draft_started predates the 20260824214706 seeding trigger), so on
--   that league every lot would have closed with no budget accounting at
--   all. Measured on production 2026-09-03:
--     auction_budgets rows                3 (all remaining_budget 200,
--                                            players_won 0, never written)
--     auction_nominations rows            1 (still 'active', the lot wedged
--                                            by the close-<uuid> 22P02 on
--                                            2026-09-01T17:16:23Z)
--     lots ever closed by this function   0
--   The 'sold' branch has never executed in production. Treat the first
--   auction close as a first run, not a regression.
--
--   DEFECT 3 - an auction could never finish.
--   Searched every function in the database: only submit_pick_v2 and
--   offline_import_draft_v2 contain 'draft_completed'. No auction RPC does.
--   The engine decides completion in memory (LobbyManager.ts:5303-5306,
--   `nominationsCompleted >= nominationOrder.length * draftRounds`) and
--   persists nothing - snapshotPersistence.ts:319-348 takes a draftStatus
--   argument and drops it, and LobbyManager never writes public.leagues at
--   all. So the league stays draft_status='in_progress' forever, the
--   tg_draft_events_sync_roster trigger never fires, no roster is written,
--   and - the sharp edge - deploy-engine.yml:278 refuses to deploy while
--   ANY league is in_progress. One failed auction test locks out engine
--   deploys until somebody edits the row by hand.
--
--   The completion predicate below counts LOTS OFFERED from draft_order
--   (the structural truth, mirroring submit_pick_v2's D1 ruling) rather
--   than leagues.roster_size or draft_rounds, because those two disagree
--   in production: league a1a125c8 has roster_size=21 and draft_rounds=18.
--   Verified against prod: SUM(jsonb_array_length(team_order)) is 54 for
--   a1a125c8 (3 teams x 18 rounds) and 42 for f548834a (2 x 21), both
--   exactly matching the engine's own arithmetic.
--
--   It counts LOTS RESOLVED as every event that advances the engine's
--   nominationsCompleted pointer, including the two commissioner override
--   actions that advance it (LobbyManager.ts:4241, :4259). A roster-slot
--   predicate would be wrong: auction_nomination_skip_v2 awards no player,
--   so a skipped team finishes short and a "every team has roster_size
--   players" test would hang that league forever - the same failure mode
--   with a different cause.
--
--   DEFECT 4 - the commissioner could not cancel a lot.
--   auction_commissioner_override_v2's cancel_nomination branch writes
--   status='cancelled'; the live CHECK allows only active/sold/no_sale, so
--   every cancel raises 23514. The four-value constraint was written a
--   month ago in 20260722000000_staging_schema_alignment.sql:124-131 and
--   never applied - that migration is absent from schema_migrations while
--   its sibling section A.1 (the draft_events event_type enum) did land.
--   Partial application. draftV2Auction.ts:232 already documents the
--   four-value enum as if it shipped. This replays A.2 verbatim.
--   'no_sale' stays in the enum: force_close_nomination still writes it
--   for the genuine zero-bid case, and historical rows must stay valid.
--
--   Blast radius: 0 rows currently hold status='no_sale' (verified), so
--   no historical row changes meaning. draft_picks is the correct target
--   for auction awards and stays so - draft_picks_v2 is written only by
--   tg_draft_events_project_pick on event_type='pick', which casts
--   player_id to int, and auction player ids are text.
--
--   Reversibility: CREATE OR REPLACE from the capture file restores the
--   prior body byte for byte. The CHECK constraint change is additive and
--   reversible by re-adding the three-value form.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch.
--
-- APPLY ORDER: this migration, then redeploy the draft engine. The engine
-- carries the close-key fix (md5UuidFromSeed) without which no lot closes
-- at all; this migration decides what a close DOES. Neither alone is
-- enough to run an auction.
--
-- Idempotent: CREATE OR REPLACE plus a DROP/ADD CONSTRAINT pair. A second
-- apply is a no-op. Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. The status enum the override RPC has always assumed --------------
ALTER TABLE public.auction_nominations
  DROP CONSTRAINT IF EXISTS auction_nominations_status_check;
ALTER TABLE public.auction_nominations
  ADD CONSTRAINT auction_nominations_status_check
  CHECK (status IN ('active', 'sold', 'no_sale', 'cancelled'));

-- -- 2. close_nomination_v2: award, guard, and finish --------------------
CREATE OR REPLACE FUNCTION public.close_nomination_v2(p_league_id uuid, p_nomination_id uuid, p_idempotency_key uuid, p_payload_hash text, p_actor jsonb, p_correlation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id        bigint;
  v_existing_seq       bigint;
  v_existing_hash      text;
  v_actor_kind         text;
  v_caller_role        text;
  v_nom_status         text;
  v_winner_team_id     uuid;
  v_final_bid          numeric;
  v_player_id          text;
  v_player_name        text;
  v_total_bids         int;
  v_payload            jsonb;
  v_event_type         text;
  v_new_seq            bigint;
  v_event_id           bigint;
  v_correlation_id     uuid;
  v_no_sale            boolean;
  v_budget_rows        int;
  v_completed_rows     int;
  v_lots_offered       int;
  v_lots_resolved      int;
  v_completion_payload jsonb;
  v_completion_hash    text;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- Step 2: Auth - close_nomination is engine-only (timer fire).
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: close_nomination_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by close_nomination_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Step 3: Load + lock the nomination row.
  SELECT status, current_high_bidder_team_id, current_high_bid,
         player_id, player_name
    INTO v_nom_status, v_winner_team_id, v_final_bid,
         v_player_id, v_player_name
    FROM public.auction_nominations
   WHERE id = p_nomination_id AND league_id = p_league_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: nomination % not found in league %',
      p_nomination_id, p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_nom_status <> 'active' THEN
    RAISE EXCEPTION 'illegal_state: nomination % is % (expected active)',
      p_nomination_id, v_nom_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_total_bids
    FROM public.auction_bids
   WHERE nomination_id = p_nomination_id;

  -- 2026-09-03: "no sale" is now what ADR-002:162 always said it was -
  -- a lot with NO bid at all. nominate_player_v2 writes the nominator's
  -- opening bid, so in practice a nomination always has a high bidder and
  -- this branch does not fire; it is kept because force_close_nomination
  -- can produce a bidder-less nomination, and a NULL winner must never
  -- reach the budget UPDATE or the draft_picks insert below.
  v_no_sale := v_winner_team_id IS NULL;

  -- Step 4: Atomic write block.

  IF v_no_sale THEN
    UPDATE public.auction_nominations
       SET status = 'no_sale'
     WHERE id = p_nomination_id;

    v_event_type := 'auction_nomination_expired';
    v_payload := jsonb_build_object(
      'nomination_id', p_nomination_id,
      'reason',        'no_bids'
    );
  ELSE
    UPDATE public.auction_nominations
       SET status = 'sold'
     WHERE id = p_nomination_id;

    UPDATE public.auction_budgets
       SET remaining_budget = remaining_budget - v_final_bid,
           players_won      = players_won + 1,
           updated_at       = now()
     WHERE league_id = p_league_id AND team_id = v_winner_team_id;

    -- A lot that awards a player MUST move a budget. Before 2026-09-03
    -- this UPDATE could match zero rows and the close would still report
    -- success; league f548834a has no auction_budgets rows at all, so
    -- every lot there would have been free. Fail the close instead: the
    -- engine's one-shot retry and the RPC's idempotency replay make a
    -- raised close recoverable, a silently free player is not.
    GET DIAGNOSTICS v_budget_rows = ROW_COUNT;
    IF v_budget_rows <> 1 THEN
      RAISE EXCEPTION 'illegal_state: auction_budgets has % rows for league % team % (expected exactly 1); refusing to award % without charging for it',
        v_budget_rows, p_league_id, v_winner_team_id, v_player_id
        USING ERRCODE = 'no_data_found';
    END IF;

    INSERT INTO public.draft_picks (
      league_id, round_number, pick_number, team_id,
      player_id, picked_at
    )
    VALUES (
      p_league_id,
      1,
      (SELECT nomination_number FROM public.auction_nominations
        WHERE id = p_nomination_id),
      v_winner_team_id,
      v_player_id,
      now()
    );

    v_event_type := 'auction_nomination_closed';
    v_payload := jsonb_build_object(
      'nomination_id',    p_nomination_id,
      'winning_team_id',  v_winner_team_id,
      'final_amount',     v_final_bid,
      'total_bids',       v_total_bids,
      'player_id',        v_player_id,
      'player_name',      v_player_name
    );
  END IF;

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, v_event_type, v_payload,
    p_payload_hash, p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  -- -- Step 4.5: Completion detection -----------------------------------
  --
  -- Placement mirrors submit_pick_v2's D3 invariant exactly: this runs
  -- AFTER the terminal event INSERT and AFTER the leagues counter UPDATE
  -- that holds the row lock, so the row just written is inside the count
  -- and no concurrent close can interleave. Do not hoist it.
  --
  -- Lots offered comes from draft_order, not from leagues.roster_size or
  -- draft_rounds - those disagree in production (a1a125c8: 21 vs 18).
  -- Lots resolved counts every event that advances the engine's
  -- nominationsCompleted pointer, so the two agree by construction.
  SELECT COALESCE(SUM(jsonb_array_length(d.team_order)), 0)::int
    INTO v_lots_offered
    FROM public.draft_order d
   WHERE d.league_id = p_league_id
     AND d.deleted_at IS NULL;

  SELECT count(*)::int
    INTO v_lots_resolved
    FROM public.draft_events e
   WHERE e.league_id = p_league_id
     AND ( e.event_type IN ( 'auction_nomination_closed'
                           , 'auction_nomination_expired'
                           , 'auction_nomination_skipped' )
        OR ( e.event_type = 'auction_commissioner_override'
             AND e.payload ->> 'override_action'
                 IN ('force_close_nomination', 'award_to_team') ) );

  IF v_lots_offered > 0 AND v_lots_resolved >= v_lots_offered THEN
    IF v_lots_resolved > v_lots_offered THEN
      RAISE WARNING
        'close_nomination_v2 completion: % lots resolved > % offered for league % - absorbing, but the rotation and draft_order disagree',
        v_lots_resolved, v_lots_offered, p_league_id;
    END IF;

    -- SINGLE-FIRE. The status flip is the latch: only the close that moves
    -- the league out of a non-completed state may emit draft_completed.
    -- Without this a late or retried close after the final lot emits a
    -- SECOND draft_completed, and tg_draft_events_sync_roster runs the
    -- roster sync twice. submit_pick_v2 gets this for free from its
    -- pick_out_of_order preflight; close_nomination_v2 has no equivalent
    -- bound on lot count, so it needs the latch. Safe under concurrency:
    -- the leagues row lock taken by the counter UPDATE above is still held.
    -- Caught by scripts/proof/auction-lot-award-and-completion.proof.sh
    -- step 6 before this migration was ever applied.
    UPDATE public.leagues
       SET draft_status  = 'completed',
           pick_deadline = NULL
     WHERE id = p_league_id
       AND draft_status IS DISTINCT FROM 'completed';

    GET DIAGNOSTICS v_completed_rows = ROW_COUNT;
    IF v_completed_rows = 0 THEN
      RETURN jsonb_build_object(
        'event_id',      v_event_id,
        'seq',           v_new_seq,
        'event_type',    v_event_type,
        'no_sale',       v_no_sale,
        'was_duplicate', false
      );
    END IF;

    -- Payload shape is fixed by validate_draft_event_payload('draft_completed'):
    -- completed_at and total_picks are both required. total_picks carries
    -- the lot count, which for an auction is the number of players awarded
    -- plus the lots that expired or were skipped.
    v_completion_payload := jsonb_build_object(
      'completed_at', now(),
      'total_picks',  v_lots_offered
    );
    v_completion_hash := encode(
      sha256(convert_to(v_completion_payload::text, 'UTF8')),
      'hex'
    );

    PERFORM public.append_draft_event(
      p_league_id,
      'draft_completed',
      v_completion_payload,
      NULL,
      v_completion_hash,
      p_actor,
      v_correlation_id
    );
  END IF;

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'event_type',    v_event_type,
    'no_sale',       v_no_sale,
    'was_duplicate', false
  );
END;
$function$;

-- Grants unchanged from the live function.
REVOKE ALL ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) FROM public;
GRANT ALL ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) TO service_role;
GRANT ALL ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) TO authenticated;

-- -- 3. Post-conditions: refuse to commit on drift -----------------------
DO $$
DECLARE v_body text; v_check text;
BEGIN
  v_body := pg_get_functiondef('public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid)'::regprocedure);

  IF v_body LIKE '%v_no_sale := v_total_bids = 1;%' THEN
    RAISE EXCEPTION 'close_nomination_v2 still forfeits the uncontested lot';
  END IF;
  IF v_body NOT LIKE '%v_no_sale := v_winner_team_id IS NULL;%' THEN
    RAISE EXCEPTION 'close_nomination_v2 is missing the winner-is-null no-sale rule';
  END IF;
  IF v_body NOT LIKE '%GET DIAGNOSTICS v_budget_rows = ROW_COUNT;%' THEN
    RAISE EXCEPTION 'close_nomination_v2 is missing the budget row guard';
  END IF;
  IF v_body NOT LIKE '%draft_completed%' THEN
    RAISE EXCEPTION 'close_nomination_v2 is missing the completion emitter';
  END IF;
  IF v_body NOT LIKE '%AND draft_status IS DISTINCT FROM ''completed''%' THEN
    RAISE EXCEPTION 'close_nomination_v2 completion is not single-fire latched';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_check
    FROM pg_constraint
   WHERE conrelid = 'public.auction_nominations'::regclass
     AND conname  = 'auction_nominations_status_check';
  IF v_check IS NULL OR v_check NOT LIKE '%cancelled%' THEN
    RAISE EXCEPTION 'auction_nominations_status_check does not admit cancelled: %', COALESCE(v_check, '<missing>');
  END IF;

  RAISE NOTICE 'close_nomination_v2 replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;

-- ===========================================================================
-- [04/12] 20260903210000_matchup_scoreboard_uses_v2_scoring_rules.sql
-- ===========================================================================
-- ============================================================================
-- Matchup scoreboard: the writer scores by the league's rules, not by twelve
-- categories hardcoded in a function body
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- 484fb2d84119aacf336b7828eb1a74de against live prod, 619 bytes):
--   supabase/migrations/captures/2026-09-03_pre_matchup_scoreboard_uses_v2_scoring_rules.sql
--
-- (a) WHAT CHANGED
--   calculate_matchup_total_score() now sums calculate_daily_matchup_scores_v2
--   instead of calculate_daily_matchup_scores. One function, one FROM clause.
--
--   Signature, return type, STABLE, SECURITY DEFINER, search_path, owner and
--   grants are unchanged. Nothing else is touched: update_all_matchup_scores
--   keeps its body, calculate_daily_matchup_scores keeps its body, and no new
--   scoring formula is introduced anywhere. This migration deliberately does
--   NOT write a fourth copy of the scoring arithmetic - it deletes a caller of
--   the stale copy and points it at the one the product already reads.
--
-- (b) WHY NOW
--
--   THE DEFECT - the scoreboard and the box score are computed by two
--   different engines, and only one of them can read the league's rules.
--
--   Write path (what fills matchups.team1_score / team2_score):
--     .github/workflows/daily-waiver-process.yml:36 posts hourly to
--     /api/scheduled/matchup-sweep -> server/src/routes/scheduled.ts:371
--     -> update_all_matchup_scores(league)
--     -> calculate_matchup_total_score(matchup, team, week_start, week_end)
--     -> calculate_daily_matchup_scores(...)   <-- 12 categories, hardcoded
--   calculate_daily_matchup_scores declares twelve NUMERIC weight variables in
--   its DECLARE block and reads their overrides out of the leagues.scoring_settings
--   JSONB. A category that is not one of those twelve cannot affect the number
--   it returns, whatever the league has priced.
--
--   Read path (what the matchup page and the box score show):
--     MatchupService.ts:1184 -> calculate_daily_matchup_scores_v2
--     -> score_matchup_lines -> get_effective_scoring_rules(league_id)
--     and persist_matchup_lines() -> get_effective_scoring_rules(league_id)
--   Both read every row of stat_catalog through v_player_game_stat_long.
--
--   Measured on production 2026-09-03, by this session:
--     stat_catalog rows                                        35
--     categories the legacy writer can express                 12
--       goalie: wins, saves, shutouts, goals_against
--       skater: goals, assists, power_play_points,
--               short_handed_points, shots_on_goal, blocks,
--               hits, penalty_minutes
--     categories the writer silently drops                     23
--       even_saves, faceoff_losses, faceoff_wins,
--       game_winning_goals, giveaways, goalie_toi_minutes,
--       losses, ot_losses, overtime_goals, plus_minus,
--       power_play_assists, power_play_goals, pp_saves,
--       sh_saves, shifts, short_handed_assists,
--       short_handed_goals, shot_attempts, shots_blocked_by_opp,
--       shots_faced, shots_missed, takeaways, toi_minutes
--     live leagues pricing a dropped category (plus_minus 0.5)  7
--       Claude Auction League, Claude Linear League,
--       Claude Linear Verify, Claude Proof League, DACOSTA!,
--       Finalsz, Launch Dry Run
--
--   HOW MUCH IT IS WRONG BY TODAY: nothing, yet. I ran both engines over
--   every live matchup - 662 team-matchup sides across the 9 non-[DELETED
--   leagues that have matchups - and got differing_sides = 0, max absolute
--   difference 0.000. Only 4 of those 662 sides score non-zero at all (Demo
--   League weeks 7 and 8), because every other league's fantasy_daily_rosters
--   start 2026-09-28 while player_game_stats ends 2026-06-14. No stored score
--   in production is currently wrong.
--
--   That is the whole point of doing this now rather than after 2026-09-29.
--   The defect is armed, not yet fired. It fires on the first night of real
--   games, on seven leagues at once, and it fires on the number users see.
--
--   HOW MUCH IT WILL BE WRONG BY: measured two ways, both on real stats.
--
--   1. Counterfactual on the only league with real scored weeks. Demo League
--      prices plus_minus at 0. Repricing it at 0.5 and re-summing that
--      league's actual rostered player-days moves:
--        week 7   team1 -3.500   team2 +0.500   (stored 58.000 - 70.900)
--        week 8   team1 -0.500   team2 +3.000   (stored 122.900 - 104.800)
--      A 4.000-point and a 3.500-point swing in the margin, on matchups
--      decided by 12.900 and 18.100.
--
--   2. Forward sizing on the seven exposed leagues' own current rosters,
--      scored over the last real 7-day regular-season window in the corpus:
--        Finalsz                6.500 largest single team-week, 3.250 avg abs
--        DACOSTA!               4.500                            3.000
--        Claude Auction League  3.500                            2.500
--        Launch Dry Run         2.500                            1.750
--        Claude Linear Verify   2.000                            1.750
--      (Claude Linear League and Claude Proof League price plus_minus but
--      have no rosters yet, so they cannot be sized; they are exposed all
--      the same.)
--      Every one of those points is a point the box score shows and the
--      scoreboard does not.
--
--   WHAT BREAKS BESIDES THE NUMBER. pg_cron job 28 'matchup-score-calibration'
--   runs log_matchup_score_calibration() -> check_matchup_score_calibration()
--   -> verify_matchup_scores(), which compares matchups.team1_score against
--   SUM(fantasy_matchup_lines.total_points) with a 0.01 tolerance. The lines
--   are written by persist_matchup_lines() through get_effective_scoring_rules.
--   So the alarm is wired to exactly this divergence. It returns 0 rows today.
--   On 2026-09-29 it starts failing nightly for seven leagues and cannot be
--   silenced by anything except this change.
--
--   server/src/services/MatchupService.ts:1168-1181 predicted this in a
--   comment when the READ path was switched to _v2 and called the remaining
--   half "NOT optional". The writer was never switched. This is that switch.
--
--   CORRECTION TO THE PRIOR AUDIT NOTE. An earlier pass recorded measured
--   gaps of 2.0, 3.0 and 8.0 points on "completed weeks" in DACOSTA! and a
--   matchup there finishing 140.3-136.8. I could not reproduce any of it:
--   all 27 DACOSTA! matchups score 0.000-0.000 under both engines, its
--   fantasy_daily_rosters are dated 2026-09-28..2026-10-04, and no
--   player_game_stats row exists in that range. Same for the 173.700 vs
--   203.700 figure in the MatchupService comment. Those numbers appear to be
--   from a scratch or since-reseeded fixture. The defect is real and the
--   reasoning holds; the specific magnitudes above are the ones that
--   reproduce today, and they are the ones to quote.
--
--   WHY THIS IS SAFE FOR LEAGUES THAT HAVE NOT CHANGED THEIR SCORING.
--   The two engines take their weights from different places - the legacy one
--   from leagues.scoring_settings, _v2 from league_scoring_rules via
--   get_effective_scoring_rules - so agreement had to be checked, not assumed.
--   Checked, on prod:
--     * Weight parity: for all 15 live leagues x the 12 legacy categories,
--       the weight the legacy body would resolve (JSONB override, else its
--       hardcoded default) differs from get_effective_scoring_rules in
--       0 cases.
--     * Goalie branch: the legacy body branches on
--       COALESCE(pd.is_goalie, pgs.is_goalie, false) OR pd.position_code='G';
--       v_player_game_stat_long branches on pgs.is_goalie alone. Across all
--       52,478 player-game rows of the 2025-26 regular season these disagree
--       in 0 rows.
--     * Legacy column fallbacks: the legacy body has
--       COALESCE(NULLIF(pgs.nhl_wins,0), pgs.wins, 0) style fallbacks that
--       _v2 does not. Across the same 52,478 rows there are 0 NULL nhl_*
--       columns and 0 rows where any of those fallbacks would fire.
--     * End to end on real data: Demo League, whose effective rules are
--       exactly the 12 legacy categories, scores identically under both
--       engines and identically to what is already stored -
--       58.000 / 70.900 (week 7) and 122.900 / 104.800 (week 8), to the cent.
--   So for a 12-category league the new number IS the old number. The only
--   score that moves is one the league asked to have moved by pricing a
--   category, which is the entire complaint.
--
--   BLAST RADIUS. calculate_matchup_total_score has exactly one caller in the
--   database - update_all_matchup_scores - confirmed by scanning prosrc across
--   every function in public. Nothing in server/ or apps/ calls it directly.
--   calculate_daily_matchup_scores is left installed and unchanged; after this
--   migration its only remaining caller is server/src/routes/demoMatchup.ts,
--   which is out of scope here and noted for follow-up.
--
--   REVERSIBILITY. CREATE OR REPLACE from the capture file restores the prior
--   body byte for byte. No data is written by this migration.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the 2026-09-29
--   season opener.
--
-- APPLY ORDER: standalone. No engine redeploy and no server deploy is
-- required; the read path is already on _v2. Existing stored scores are NOT
-- recomputed by this migration - see the separately-run backfill section in
-- the accompanying report, which the owner runs deliberately.
--
-- Idempotent: a single CREATE OR REPLACE plus a COMMENT. A second apply is a
-- no-op. Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. The scoreboard writer delegates to the rules-driven scorer ---------
--
-- Body is otherwise character-for-character the captured one: same DECLARE,
-- same NUMERIC(10,3) accumulator (so the 3-decimal rounding of the stored
-- score is unchanged), same COALESCE, same RETURN. Only the relation in the
-- FROM clause moves from the 12-category function to the 35-category one.
CREATE OR REPLACE FUNCTION public.calculate_matchup_total_score(p_matchup_id uuid, p_team_id uuid, p_week_start date, p_week_end date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_score NUMERIC(10, 3) := 0;
BEGIN
  -- Sum the daily scores from calculate_daily_matchup_scores_v2.
  --
  -- 2026-09-03: this used to read calculate_daily_matchup_scores, which
  -- hardcodes twelve categories in its DECLARE block. The matchup page and
  -- the persisted box-score lines both score through
  -- get_effective_scoring_rules, which serves all 35 rows of stat_catalog.
  -- Reading the legacy function here meant the stored scoreboard number and
  -- the line items behind it were produced by different engines, and the
  -- scoreboard could not see any of the 23 categories outside the twelve -
  -- plus_minus among them, which seven live leagues price at 0.5.
  --
  -- _v2 sums score_matchup_lines, the same relation persist_matchup_lines
  -- rolls up, so the scoreboard is now the sum of its own box score by
  -- construction rather than by coincidence.
  SELECT COALESCE(SUM(daily_score), 0) INTO v_total_score
  FROM calculate_daily_matchup_scores_v2(p_matchup_id, p_team_id, p_week_start, p_week_end);

  RETURN v_total_score;
END;
$function$;

COMMENT ON FUNCTION public.calculate_matchup_total_score(uuid, uuid, date, date) IS
  'Total matchup score for one team over one week. Sums calculate_daily_matchup_scores_v2, '
  'which scores through get_effective_scoring_rules (all 35 stat_catalog categories) rather '
  'than the 12 hardcoded in calculate_daily_matchup_scores. Called only by '
  'update_all_matchup_scores, the writer behind matchups.team1_score / team2_score. '
  'Changed 2026-09-03 so the stored scoreboard and the persisted box-score lines are '
  'produced by the same engine.';

-- Grants unchanged from the live function: owner postgres plus service_role.
-- calculate_matchup_total_score is NOT granted to authenticated in production
-- and must not become so here.
REVOKE ALL ON FUNCTION public.calculate_matchup_total_score(uuid,uuid,date,date) FROM public;
GRANT EXECUTE ON FUNCTION public.calculate_matchup_total_score(uuid,uuid,date,date) TO service_role;

-- -- 2. Post-conditions: refuse to commit on drift ------------------------
DO $$
DECLARE
  v_body     text;
  v_writer   text;
  v_catalog  int;
  v_acl      text;
BEGIN
  v_body := pg_get_functiondef('public.calculate_matchup_total_score(uuid,uuid,date,date)'::regprocedure);

  IF v_body NOT LIKE '%calculate_daily_matchup_scores_v2(p_matchup_id, p_team_id, p_week_start, p_week_end)%' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score does not call the v2 scorer';
  END IF;
  IF v_body ~ 'FROM calculate_daily_matchup_scores\(' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score still reads the 12-category scorer';
  END IF;
  IF v_body NOT LIKE '%STABLE SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score lost STABLE SECURITY DEFINER';
  END IF;
  IF v_body NOT LIKE '%SET search_path TO ''public''%' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score lost its pinned search_path';
  END IF;

  -- The writer must still be the thing that calls us, and must be untouched.
  SELECT prosrc INTO v_writer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'update_all_matchup_scores';
  IF v_writer IS NULL OR v_writer NOT LIKE '%calculate_matchup_total_score%' THEN
    RAISE EXCEPTION 'update_all_matchup_scores no longer calls calculate_matchup_total_score';
  END IF;

  -- The v2 chain must be present end to end, or the writer would return 0
  -- for every team instead of failing loudly.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'calculate_daily_matchup_scores_v2';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calculate_daily_matchup_scores_v2 is missing';
  END IF;
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'score_matchup_lines';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_matchup_lines is missing';
  END IF;
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_effective_scoring_rules';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'get_effective_scoring_rules is missing';
  END IF;

  -- A truncated or unseeded stat_catalog would silently shrink every score.
  SELECT count(*) INTO v_catalog FROM public.stat_catalog;
  IF v_catalog < 35 THEN
    RAISE EXCEPTION 'stat_catalog has % rows, expected at least 35', v_catalog;
  END IF;

  -- Do not let this migration widen access.
  SELECT coalesce(array_to_string(proacl, ' | '), '<default>') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_matchup_total_score';
  IF v_acl LIKE '%authenticated=%' OR v_acl LIKE '%anon=%' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score was granted to a client role: %', v_acl;
  END IF;

  RAISE NOTICE 'calculate_matchup_total_score replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;

-- ===========================================================================
-- [05/12] 20260903220000_playoff_pool_season_scope.sql
-- ===========================================================================
-- ============================================================================
-- Playoff pools score the playoff run they belong to, not "whatever season it is"
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- 4a633e563066cec2c3ec21f70379ba50 against live prod):
--   supabase/migrations/captures/2026-09-03_pre_playoff_pool_season_scope.sql
-- public.pool_playoff_season is NEW in this migration, so it has no prior
-- definition to capture.
--
-- (a) WHAT CHANGED
--   1. New nullable column public.leagues.playoff_season: the explicit
--      playoff run a pool belongs to. Nothing writes it yet; it is the
--      override slot and the place a future pool-creation path records the
--      run it was made for.
--   2. New function public.pool_playoff_season(uuid): resolves a pool's
--      playoff season from the pool itself, in this order -
--        (i)   leagues.playoff_season
--        (ii)  leagues.settings->>'playoffSeason'
--        (iii) the season of the earliest playoff game on or after the
--              pool's anchor date (first roster pick, else the configured
--              roster lock, else league creation)
--        (iv)  the calendar rule on that same anchor, for a pool created
--              for a playoff run whose schedule is not loaded yet.
--   3. score_playoff_roster_pool() takes its season from
--      pool_playoff_season(p_league_id) instead of get_current_season().
--   4. score_playoff_roster_pool() now refuses to write at all when the
--      resolved season has no scoreable playoff game. It returns 0 and
--      raises a NOTICE instead of recomputing every standing to zero.
--
--   Signature, return type, SECURITY DEFINER, search_path and grants of
--   score_playoff_roster_pool are unchanged. The scoring arithmetic, the
--   per-pick date floor and the RANK() are byte-identical to the capture.
--
-- (b) WHY NOW
--
--   DEFECT - on 2026-09-29 this function zeroes every playoff pool standing.
--
--   The scorer selected its games with
--     WHERE g.game_type = 'playoff' AND g.season = v_season
--   where v_season := public.get_current_season(). Measured on production
--   2026-09-03:
--     get_current_season()                          2025
--     get_current_season('2026-09-29')              2026
--     nhl_games season 2025, game_type playoff      82 games, all 'final',
--                                                   2026-04-18 .. 2026-06-14
--     nhl_games season 2026, game_type playoff      0 games
--     nhl_games season 2026, game_type regular      1344 games, first
--                                                   2026-09-29
--   get_current_season() reads the loaded regular-season fixture list, so it
--   flips to 2026 the moment the 2026-27 regular season opens - 2026-09-29,
--   twenty-two days after launch. From that morning the playoff_games CTE
--   matches zero rows.
--
--   The CTE feeds a LEFT JOIN, so an empty CTE does not produce an empty
--   result: every playoff_roster_picks user still appears, with
--   COALESCE(SUM(...), 0) = 0. RANK() OVER (ORDER BY total_points DESC) then
--   ties every user at rank 1. The INSERT ... ON CONFLICT DO UPDATE writes
--   that straight over the live standings, and playoff_pool_standings keeps
--   no history - it has exactly six columns (league_id, user_id,
--   total_points, correct_picks, current_rank, last_updated) and no audit
--   table shadows it. There is nothing to restore from.
--
--   pg_cron job 40 'playoff-roster-pool-standings' (schedule '55 9 * * *',
--   active, command 'select public.score_all_playoff_roster_pools();') runs
--   this unattended every morning over every league with
--   settings->>'leagueType' = 'playoff-roster-pool'.
--
--   Blast radius measured on production 2026-09-03:
--     playoff_pool_standings rows                   42, in 16 leagues
--     rows currently zero                           0
--     max total_points                              970.20
--     last_updated                                  2026-09-03 09:55:00Z
--     leagues typed playoff-roster-pool             13
--     of those, leagues holding roster picks        6
--     standings rows those 6 leagues own            21
--     total points those 21 rows carry              11015.00
--   The other 21 standings rows belong to bracket-pickem and confidence
--   pools, which are scored by different functions and are not touched by
--   this defect. 21 rows and 11015.00 points is the exact loss on the first
--   cron fire after 2026-09-29.
--
--   WHY THIS SEASON KEY AND NOT ANOTHER
--
--   A playoff pool is tied to one specific playoff run. It is not tied to
--   "the current season", which is what the old code asked, and it is not
--   tied to "the newest season that has playoff games", which only delays
--   the same bug: the 2025 pools would flip to 2026 and zero out in April
--   2027, when the 2026-27 playoff schedule loads. Any key derived from a
--   moving clock has this shape.
--
--   So the key is derived from the pool, from data that cannot move:
--     * anchor = the first roster pick's created_at, else the configured
--       playoffRosterLockedAt, else the league's created_at. All three are
--       historical facts about this pool.
--     * the run = the season of the earliest playoff game on or after that
--       anchor. Stable by construction: playoff runs are disjoint and
--       ordered in time, so a later run's games are always later than the
--       anchor and can never displace the earlier one under
--       ORDER BY game_date LIMIT 1.
--
--   Verified against every playoff-type league on production 2026-09-03
--   (16 distinct anchor groups, 30 leagues). Both the game-derived key and
--   the calendar fallback return 2025 for all 15 groups anchored between
--   2026-04-17 and 2026-05-18 - which is every league that holds a roster
--   pick or a standings row. The single group anchored 2026-08-29 (league
--   16c58ff8 'Claude Bracket Verify', created 2026-08-24) has no playoff
--   game on or after its anchor and resolves through the calendar rule to
--   2026, the upcoming 2026-27 run. That is the "new pool for the next
--   playoffs" case, already present in the data, and it resolves correctly
--   before those games exist and keeps resolving to 2026 after they load.
--
--   The calendar fallback is deliberately NOT get_nhl_season_year(). That
--   function answers "which regular season is this date in" and returns
--   2025 for September 2026. The question here is "which playoff run is
--   this pool aiming at", and the playoffs of season S are played in April
--   to June of year S+1. Hence: months 1-6 belong to run year-1, months
--   7-12 to run year. 2026-04-17 -> 2025. 2026-08-29 -> 2026.
--   2027-01-15 -> 2026. 2027-04-20 -> 2026.
--
--   The pool_playoff_season resolution is stable against data retention:
--   run_data_retention() was read this session and deletes only from
--   security_audit_log, integrity_check_results, function_error_log and
--   cron.job_run_details. It never touches nhl_games, so the game-derived
--   key cannot silently fall through to the calendar rule later.
--
--   WHY THE NO-GAMES GUARD IS SEPARATE FROM THE KEY
--
--   The season key is a judgement; the guard is an invariant. Even with a
--   perfect key, "recompute every standing from an empty game set and write
--   the zeros over live results" is never the right answer. The guard makes
--   the destructive path unreachable regardless of what any future season
--   rule decides: no scoreable playoff game for the resolved season means
--   no write at all. It returns 0 rather than raising because
--   score_all_playoff_roster_pools loops every pool in one transaction and
--   a raise would abort the whole nightly job for every league.
--
--   NOT FIXED HERE, FOUND WHILE READING THIS FUNCTION: the per-pick date
--   floor reads settings->>'playoffScoringStartDate', and that key is
--   present in zero league settings on production (all 54 distinct settings
--   keys were enumerated). v_league_floor is therefore always
--   1900-01-01 and the floor collapses to rp.created_at::date. Behaviour is
--   carried forward byte-for-byte; flagged, not changed.
--
--   Reversibility: CREATE OR REPLACE from the capture file restores the
--   prior body byte for byte. The column is additive and nullable, so
--   dropping it is a one-line reversal, and nothing reads it but the new
--   resolver.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Pools subsystem, defect PL1.
--
-- APPLY ORDER: independent. No engine redeploy, no client deploy needed.
-- This migration must land before 2026-09-29 or the standings are gone.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS plus two CREATE OR REPLACE. A second
-- apply is a no-op. Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. The explicit season key a playoff pool may carry -----------------
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS playoff_season integer;

COMMENT ON COLUMN public.leagues.playoff_season IS
  'The NHL season whose playoff run this pool scores (2025 = the 2025-26 run, played April-June 2026). NULL means "derive it", which public.pool_playoff_season does from the pool''s own first roster pick / roster lock / creation date. Set it explicitly to pin a pool to a run or to override a wrong derivation.';

-- -- 2. Resolve a pool's playoff run from the pool, never from the clock --
CREATE OR REPLACE FUNCTION public.pool_playoff_season(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_explicit INT;
  v_anchor   DATE;
  v_season   INT;
BEGIN
  -- (i) and (ii): an explicit key always wins. The settings form exists so
  -- a client can pin a pool without knowing the column.
  SELECT COALESCE(
           l.playoff_season,
           NULLIF(l.settings ->> 'playoffSeason', '')::INT
         )
    INTO v_explicit
    FROM public.leagues l
   WHERE l.id = p_league_id;

  IF v_explicit IS NOT NULL THEN
    RETURN v_explicit;
  END IF;

  -- The anchor: the moment this pool committed to a run. All three sources
  -- are historical facts about the pool and none of them move.
  SELECT COALESCE(
           (SELECT MIN(rp.created_at)::DATE
              FROM public.playoff_roster_picks rp
             WHERE rp.league_id = l.id),
           NULLIF(l.settings ->> 'playoffRosterLockedAt', '')::TIMESTAMPTZ::DATE,
           l.created_at::DATE
         )
    INTO v_anchor
    FROM public.leagues l
   WHERE l.id = p_league_id;

  IF v_anchor IS NULL THEN
    RETURN NULL;
  END IF;

  -- (iii) The run this pool was drafted into: the earliest playoff game at
  -- or after the anchor. Stable because playoff runs are disjoint and
  -- ordered, so a later run can never win this ORDER BY.
  SELECT g.season
    INTO v_season
    FROM public.nhl_games g
   WHERE g.game_type = 'playoff'
     AND g.game_date >= v_anchor
   ORDER BY g.game_date
   LIMIT 1;

  IF v_season IS NOT NULL THEN
    RETURN v_season;
  END IF;

  -- (iv) A pool created for a run whose schedule has not been loaded yet.
  -- The playoffs of season S are played April-June of year S+1, so a date
  -- in months 1-6 is aiming at run year-1 and months 7-12 at run year.
  -- Deliberately NOT get_nhl_season_year(), which answers the regular-season
  -- question and returns 2025 for September 2026.
  RETURN CASE
           WHEN EXTRACT(MONTH FROM v_anchor) <= 6
             THEN EXTRACT(YEAR FROM v_anchor)::INT - 1
           ELSE EXTRACT(YEAR FROM v_anchor)::INT
         END;
END $function$;

REVOKE ALL ON FUNCTION public.pool_playoff_season(uuid) FROM public;
GRANT ALL ON FUNCTION public.pool_playoff_season(uuid) TO service_role;

-- -- 3. score_playoff_roster_pool: pool-scoped season, and never zero-out --
CREATE OR REPLACE FUNCTION public.score_playoff_roster_pool(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings JSONB; v_league_floor DATE; v_updated INTEGER; v_season INT;
  v_scoreable INT;
BEGIN
  -- 2026-09-03: was public.get_current_season(), which is a clock. On
  -- 2026-09-29 it flips to 2026, season 2026 has no playoff game, and the
  -- LEFT JOIN below recomputes every standing to 0 with RANK() tying
  -- everyone at 1. The season a playoff pool scores is a property of the
  -- pool, not of today's date.
  v_season := public.pool_playoff_season(p_league_id);

  -- The invariant, independent of the key above: never recompute standings
  -- from an empty game set. A season with nothing scoreable yields zeros for
  -- every user, and playoff_pool_standings has no history to restore from.
  -- Return 0 rather than raise: score_all_playoff_roster_pools loops every
  -- pool, and a raise would abort the nightly job for all of them.
  SELECT count(*) INTO v_scoreable
    FROM public.nhl_games g
   WHERE g.game_type = 'playoff'
     AND g.season = v_season
     AND g.status IN ('live', 'in_progress', 'final');

  IF v_season IS NULL OR v_scoreable = 0 THEN
    RAISE NOTICE 'score_playoff_roster_pool: league % resolves to playoff season % with % scoreable game(s); leaving standings untouched',
      p_league_id, COALESCE(v_season::text, '<null>'), v_scoreable;
    RETURN 0;
  END IF;

  SELECT scoring_settings INTO v_settings FROM leagues WHERE id = p_league_id;
  IF v_settings IS NULL THEN v_settings := '{}'::jsonb; END IF;

  -- NOTE 2026-09-03: 'playoffScoringStartDate' appears in zero league
  -- settings on production, so this floor is always 1900-01-01 and the
  -- effective floor is rp.created_at::date. Carried forward unchanged.
  SELECT COALESCE((settings->>'playoffScoringStartDate')::DATE, '1900-01-01'::DATE)
    INTO v_league_floor FROM leagues WHERE id = p_league_id;

  WITH playoff_games AS (
    SELECT pgs.player_id, pgs.is_goalie,
           pgs.nhl_goals, pgs.goals, pgs.nhl_assists, pgs.primary_assists, pgs.secondary_assists,
           pgs.nhl_ppp, pgs.ppp, pgs.nhl_shp, pgs.shp,
           pgs.nhl_shots_on_goal, pgs.shots_on_goal, pgs.nhl_blocks, pgs.blocks,
           pgs.nhl_hits, pgs.hits, pgs.nhl_pim, pgs.pim, pgs.nhl_plus_minus, pgs.plus_minus,
           pgs.nhl_wins, pgs.wins, pgs.nhl_saves, pgs.saves,
           pgs.nhl_shutouts, pgs.shutouts, pgs.nhl_goals_against, pgs.goals_against,
           g.game_date AS pg_date
    FROM player_game_stats pgs
    JOIN nhl_games g ON g.game_id = pgs.game_id
    WHERE g.game_type = 'playoff'
      AND g.season = v_season
      AND g.status IN ('live', 'in_progress', 'final')
  ),
  user_totals AS (
    SELECT rp.user_id,
      COALESCE(SUM(
        CASE WHEN COALESCE(pg.is_goalie, false) THEN
          COALESCE(COALESCE(pg.nhl_wins, pg.wins), 0) * COALESCE((v_settings->'goalie'->>'wins')::NUMERIC, 4) +
          COALESCE(COALESCE(pg.nhl_saves, pg.saves), 0) * COALESCE((v_settings->'goalie'->>'saves')::NUMERIC, 0.2) +
          COALESCE(COALESCE(pg.nhl_shutouts, pg.shutouts), 0) * COALESCE((v_settings->'goalie'->>'shutouts')::NUMERIC, 3) +
          COALESCE(COALESCE(pg.nhl_goals_against, pg.goals_against), 0) * COALESCE((v_settings->'goalie'->>'goals_against')::NUMERIC, -1)
        ELSE
          COALESCE(COALESCE(pg.nhl_goals, pg.goals), 0) * COALESCE((v_settings->'skater'->>'goals')::NUMERIC, 3) +
          COALESCE(COALESCE(pg.nhl_assists, COALESCE(pg.primary_assists,0)+COALESCE(pg.secondary_assists,0)), 0)
            * COALESCE((v_settings->'skater'->>'assists')::NUMERIC, 2) +
          COALESCE(COALESCE(pg.nhl_ppp, pg.ppp), 0) * COALESCE((v_settings->'skater'->>'power_play_points')::NUMERIC, 1) +
          COALESCE(COALESCE(pg.nhl_shp, pg.shp), 0) * COALESCE((v_settings->'skater'->>'short_handed_points')::NUMERIC, 2) +
          COALESCE(COALESCE(pg.nhl_shots_on_goal, pg.shots_on_goal), 0) * COALESCE((v_settings->'skater'->>'shots_on_goal')::NUMERIC, 0.4) +
          COALESCE(COALESCE(pg.nhl_blocks, pg.blocks), 0) * COALESCE((v_settings->'skater'->>'blocks')::NUMERIC, 0.5) +
          COALESCE(COALESCE(pg.nhl_hits, pg.hits), 0) * COALESCE((v_settings->'skater'->>'hits')::NUMERIC, 0.2) +
          COALESCE(COALESCE(pg.nhl_pim, pg.pim), 0) * COALESCE((v_settings->'skater'->>'penalty_minutes')::NUMERIC, 0.5) +
          COALESCE(COALESCE(pg.nhl_plus_minus, pg.plus_minus), 0) * COALESCE((v_settings->'skater'->>'plus_minus')::NUMERIC, 0)
        END), 0) AS total_points
    FROM playoff_roster_picks rp
    LEFT JOIN playoff_games pg
      ON pg.player_id = rp.player_id
     AND pg.pg_date >= GREATEST(rp.created_at::date, v_league_floor)
    WHERE rp.league_id = p_league_id
    GROUP BY rp.user_id
  ),
  ranked AS (
    SELECT user_id, total_points, RANK() OVER (ORDER BY total_points DESC) AS rnk FROM user_totals
  )
  INSERT INTO playoff_pool_standings (league_id, user_id, total_points, correct_picks, current_rank, last_updated)
  SELECT p_league_id, user_id, total_points, 0, rnk, NOW() FROM ranked
  ON CONFLICT (league_id, user_id) DO UPDATE
    SET total_points = EXCLUDED.total_points,
        current_rank = EXCLUDED.current_rank,
        last_updated = NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END $function$;

-- Grants unchanged from the live function (postgres + service_role only).
REVOKE ALL ON FUNCTION public.score_playoff_roster_pool(uuid) FROM public;
GRANT ALL ON FUNCTION public.score_playoff_roster_pool(uuid) TO service_role;

-- -- 4. Post-conditions: refuse to commit on drift -----------------------
DO $$
DECLARE v_body text; v_col text;
BEGIN
  SELECT data_type INTO v_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'leagues'
     AND column_name = 'playoff_season';
  IF v_col IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'leagues.playoff_season missing or wrong type: %', COALESCE(v_col, '<missing>');
  END IF;

  v_body := pg_get_functiondef('public.score_playoff_roster_pool(uuid)'::regprocedure);

  IF v_body LIKE '%v_season := public.get_current_season();%' THEN
    RAISE EXCEPTION 'score_playoff_roster_pool still keys off the clock';
  END IF;
  IF v_body NOT LIKE '%v_season := public.pool_playoff_season(p_league_id);%' THEN
    RAISE EXCEPTION 'score_playoff_roster_pool is not using the pool-scoped season';
  END IF;
  IF v_body NOT LIKE '%IF v_season IS NULL OR v_scoreable = 0 THEN%' THEN
    RAISE EXCEPTION 'score_playoff_roster_pool is missing the no-scoreable-games guard';
  END IF;

  -- The guard must sit BEFORE the INSERT, or it guards nothing.
  IF position('v_scoreable = 0' in v_body) > position('INSERT INTO playoff_pool_standings' in v_body) THEN
    RAISE EXCEPTION 'score_playoff_roster_pool guard is placed after the INSERT';
  END IF;

  -- The resolver must not reach for the clock either.
  v_body := pg_get_functiondef('public.pool_playoff_season(uuid)'::regprocedure);
  IF v_body LIKE '%get_current_season%' THEN
    RAISE EXCEPTION 'pool_playoff_season must not depend on get_current_season';
  END IF;

  RAISE NOTICE 'score_playoff_roster_pool replaced; body md5 = %',
    md5(pg_get_functiondef('public.score_playoff_roster_pool(uuid)'::regprocedure));
END $$;

COMMIT;

-- ===========================================================================
-- [06/12] 20260903221000_confidence_week_game_scope.sql
-- ===========================================================================
-- ============================================================================
-- Confidence scoring credits a game only in the week the game is actually in
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- b5816504be3b384dadc8747daaa561ab against live prod):
--   supabase/migrations/captures/2026-09-03_pre_confidence_week_game_scope.sql
--
-- (a) WHAT CHANGED
--   score_confidence_week(uuid, integer) resolves each pick's game by id as
--   before, then refuses to credit it unless the game actually falls in
--   p_week_number. Week membership is decided by
--   public.get_current_pool_week(ng.game_date, ng.season), the database's
--   own documented inverse of get_pool_week_dates. A pick naming a game
--   from another week is left unscored (is_correct stays NULL) and raises a
--   WARNING that names the pick, the league, the user, the game and both
--   week numbers, so the attempt is visible in the log rather than silent.
--
--   The game lookup was also split in two: find the game by id, then judge
--   it. The old single SELECT folded "is it final" and "does it exist" into
--   one NOT FOUND, which cannot tell a pick on an unfinished game (normal,
--   score it later) from a pick on a game that is not in this week at all
--   (an attack, and it must never be scored). Splitting them is what makes
--   the WARNING possible.
--
--   Signature, return shape, SECURITY DEFINER, search_path, grants, the
--   winner rule and the tie rule are unchanged.
--
-- (b) WHY NOW
--
--   DEFECT - an ordinary league member could bank guaranteed points on a
--   game that had already finished. Two halves, one exploit:
--
--   Half 1, the client filter (server/src/services/PoolService.ts, fixed in
--   the same change as this migration). submitConfidencePicks built a map
--   of the requested week's games and then kept a pick when
--     !game || !this.isGameLocked(game)
--   The leading `!game ||` KEEPS every pick whose game_id is not in the
--   requested week - the exact opposite of the intended check. Its sibling
--   submitPickemPicks, ten lines of the same shape, has it right:
--   `if (!game) return false`. So a member could POST week 12 with the
--   game_id of a game played in week 3, and the row was written.
--
--   Half 2, this scorer. It resolved the game with
--     WHERE ng.id::TEXT = cp.game_id AND ng.status = 'final'
--   and never asked whether the game belongs to p_week_number. So the
--   laundered pick found a finished game, compared picked_team to a winner
--   that was already known when the pick was submitted, and paid out
--   confidence_points every time. Confidence pools weight by rank, so the
--   member would attach the maximum rank to the certain outcome.
--
--   Either half alone stops the exploit through the API; both are fixed
--   because the scorer is the last line and must hold against any writer -
--   a future endpoint, an import, a direct table write under RLS.
--
--   Measured on production 2026-09-03:
--     confidence_picks rows                          0
--     leagues configured for a confidence pool        4
--       settings->>'leagueType' = 'confidence-pool'   1
--       settings->>'leagueType' = 'playoff-confidence-pool'  3
--     pool_picks rows                                15 (all already scored)
--     survivor_selections rows                        1
--   Zero confidence_picks rows means there is nothing to repair and no
--   scoring result changes when this lands. The fix is pre-emptive: four
--   leagues are configured and the iOS build ships in four days.
--
--   WHY get_current_pool_week AND NOT A DATE WINDOW
--
--   The obvious alternative, SELECT week_start, week_end FROM
--   get_pool_week_dates(p_week_number) once and compare game_date to it,
--   defaults its season to get_current_season() - the same moving clock
--   that PL1 is about. Scoring week 5 of season 2025 on 2026-09-29 would
--   compute the season 2026 window and refuse every legitimate pick.
--   get_current_pool_week(ng.game_date, ng.season) derives the week from
--   the GAME's own season anchor and never asks what today is.
--
--   It is also exactly the inverse of the week arithmetic the submit path
--   uses, so the two cannot disagree. Verified: for season 2025 the SQL
--   anchor is MIN(game_date) = 2025-10-07, a Tuesday, giving week 1 Sunday
--   2025-10-05; PoolService.getFirstPoolSunday() derives 2025-10-05 from
--   getSeasonStartDate(2025) = '2025-10-07'. For season 2026 both give
--   2026-09-27 from the 2026-09-29 opener. Same anchor, same weeks.
--
--   A NULL week (no schedule loaded for that game's season) is treated as
--   "not this week" and refused. Refusing to credit a game the database
--   cannot place is the safe direction.
--
--   NOT FIXED HERE, FOUND WHILE READING: score_pickem_week(uuid, integer)
--   has the identical unscoped lookup - `ng.id::TEXT = pp.game_id AND
--   ng.status = 'final'` with no week check. It is not exploitable today
--   because submitPickemPicks drops unknown games correctly, and all 15
--   pool_picks rows on production are already scored (0 with is_correct
--   NULL), so there is no live exposure. Left alone deliberately: changing
--   it would need its own capture and its own proof, and it is defence in
--   depth rather than a live hole. Flagged for the next pass.
--
--   Reversibility: CREATE OR REPLACE from the capture file restores the
--   prior body byte for byte.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Pools subsystem, defect PL3.
--
-- APPLY ORDER: independent of 20260903220000. Pair it with the server
-- deploy carrying the PoolService.submitConfidencePicks filter fix; either
-- one alone closes the exploit, both together close it at both layers.
--
-- Idempotent: a single CREATE OR REPLACE. A second apply is a no-op.
-- Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.score_confidence_week(p_league_id uuid, p_week_number integer)
 RETURNS TABLE(pick_id uuid, user_id uuid, game_id text, picked_team text, confidence_points integer, is_correct boolean, points_earned integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pick RECORD; v_game RECORD; v_correct BOOLEAN; v_winner TEXT; v_earned INT;
  v_game_week INT;
BEGIN
  FOR v_pick IN
    SELECT cp.id, cp.user_id, cp.game_id, cp.picked_team, cp.confidence_points
    FROM confidence_picks cp
    WHERE cp.league_id = p_league_id AND cp.week_number = p_week_number
      AND cp.is_correct IS NULL
  LOOP
    -- Find the game by id ONLY. Judging status and week membership in
    -- plpgsql rather than folding them into this WHERE is what lets the
    -- out-of-week case be reported instead of silently skipped, and it
    -- keeps get_current_pool_week to one call per pick rather than one per
    -- row scanned.
    SELECT ng.* INTO v_game
    FROM nhl_games ng
    WHERE ng.id::TEXT = v_pick.game_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- 2026-09-03: the week check that was never here. Without it a pick
    -- could name ANY finished game in the database and be graded against
    -- it, which is a guaranteed payout on a result the picker already knew.
    -- Derived from the game's own season, never from today's date.
    v_game_week := public.get_current_pool_week(v_game.game_date, v_game.season);

    IF v_game_week IS DISTINCT FROM p_week_number THEN
      RAISE WARNING 'score_confidence_week: pick % (league %, user %) names game % which is in pool week %, not week % - refusing to score it',
        v_pick.id, p_league_id, v_pick.user_id, v_pick.game_id,
        COALESCE(v_game_week::text, '<unknown>'), p_week_number;
      CONTINUE;
    END IF;

    -- Not final yet is the ordinary case: leave is_correct NULL and let the
    -- next run pick it up. score_pools_pending rescans every week that still
    -- has unscored picks, so nothing is stranded.
    IF v_game.status IS DISTINCT FROM 'final'
       OR v_game.home_score IS NULL OR v_game.away_score IS NULL THEN
      CONTINUE;
    END IF;

    IF v_game.home_score > v_game.away_score THEN v_winner := v_game.home_team;
    ELSIF v_game.away_score > v_game.home_score THEN v_winner := v_game.away_team;
    ELSE v_winner := 'TIE'; END IF;

    v_correct := (v_pick.picked_team = v_winner) AND v_winner <> 'TIE';
    v_earned := CASE WHEN v_correct THEN v_pick.confidence_points ELSE 0 END;

    UPDATE confidence_picks
       SET is_correct = v_correct, points_earned = v_earned
     WHERE id = v_pick.id;

    pick_id := v_pick.id; user_id := v_pick.user_id; game_id := v_pick.game_id;
    picked_team := v_pick.picked_team; confidence_points := v_pick.confidence_points;
    is_correct := v_correct; points_earned := v_earned;
    RETURN NEXT;
  END LOOP;
  RETURN;
END $function$;

-- Grants unchanged from the live function (postgres + service_role only).
REVOKE ALL ON FUNCTION public.score_confidence_week(uuid,integer) FROM public;
GRANT ALL ON FUNCTION public.score_confidence_week(uuid,integer) TO service_role;

-- -- Post-conditions: refuse to commit on drift --------------------------
DO $$
DECLARE v_body text;
BEGIN
  v_body := pg_get_functiondef('public.score_confidence_week(uuid,integer)'::regprocedure);

  IF v_body NOT LIKE '%get_current_pool_week(v_game.game_date, v_game.season)%' THEN
    RAISE EXCEPTION 'score_confidence_week is missing the week-membership check';
  END IF;
  IF v_body NOT LIKE '%v_game_week IS DISTINCT FROM p_week_number%' THEN
    RAISE EXCEPTION 'score_confidence_week does not refuse an out-of-week game';
  END IF;
  -- The refusal must come BEFORE the UPDATE, or it refuses nothing.
  IF position('v_game_week IS DISTINCT FROM p_week_number' in v_body)
     > position('UPDATE confidence_picks' in v_body) THEN
    RAISE EXCEPTION 'score_confidence_week week check is placed after the UPDATE';
  END IF;
  IF v_body LIKE '%ng.id::TEXT = v_pick.game_id AND ng.status = ''final''%' THEN
    RAISE EXCEPTION 'score_confidence_week still uses the unscoped single-SELECT lookup';
  END IF;

  RAISE NOTICE 'score_confidence_week replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;

-- ===========================================================================
-- [07/12] 20260903230000_playoff_bracket_season_and_seeding.sql
-- ===========================================================================
-- ============================================================================
-- One season rule for a fantasy playoff bracket, and seeding that agrees with
-- the standings page
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 captures (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-03):
--   supabase/migrations/captures/2026-09-03_pre_reset_playoff_bracket.sql
--     f46c613c95c787bf7900ec9b9ffd1a16
--   supabase/migrations/captures/2026-09-03_pre_generate_playoff_bracket.sql
--     6182e6e6beedd3a61c3fb21b1128df82
--   supabase/migrations/captures/2026-09-03_pre_auto_generate_playoff_bracket.sql
--     b753f177e749b19fa8dddca63f795c91
-- public.league_bracket_season is NEW in this migration, so it has no prior
-- definition to capture.
--
-- (a) WHAT CHANGED
--   1. New function public.league_bracket_season(date): the ONE answer to
--      "which season's playoff bracket is the current one for a fantasy
--      league". It delegates to public.get_current_season(p_on).
--   2. reset_playoff_bracket() keys off league_bracket_season() instead of
--      EXTRACT(YEAR FROM NOW()), and, when that season holds no bracket,
--      falls back to whichever bracket is actually blocking generation.
--   3. generate_playoff_bracket() and auto_generate_playoff_bracket() key off
--      league_bracket_season() instead of their own inline
--      "month >= 10 ? year : year - 1" copies.
--   4. playoff_brackets.season DEFAULT changes from EXTRACT(year FROM now())
--      to public.league_bracket_season(), so the column agrees with the
--      functions that write it.
--   5. generate_playoff_bracket() seeding now counts a matchup only when it
--      is FINAL and PLAYED, the same two gates as
--      packages/shared/src/utils/standings.ts.
--   6. generate_playoff_bracket() refuses outright when no regular-season
--      week has been played, and reports regular-season completeness in its
--      result JSON.
--   7. The seeding ORDER BY gains a deterministic tail (team_name, id).
--   8. auto_generate_playoff_bracket's LOWER(status) becomes
--      LOWER(status::TEXT). See "FOUND WHILE READING" below.
--
--   Signatures, return types, SECURITY DEFINER, search_path and grants of all
--   three replaced functions are unchanged.
--
-- (b) WHY NOW
--
--   DEFECT P1 - reset_playoff_bracket cannot find a bracket from January
--   through September, which is most of the fantasy playoff calendar.
--
--   Measured on production 2026-09-03:
--     EXTRACT(YEAR FROM NOW())                 2026   <- what reset asks for
--     public.get_current_season()              2025
--     public.get_nhl_season_year(CURRENT_DATE) 2025
--     playoff_brackets rows                    1, season 2025
--   The generators stamp season with "month >= 10 ? year : year - 1", which
--   is 2025 today. reset_playoff_bracket looks up the raw calendar year,
--   2026, finds nothing, and returns 'No bracket found for this season'.
--   The two rules agree only in October, November and December.
--
--   That matters because reset is the documented escape hatch. When a bracket
--   exists, generate_playoff_bracket returns 'An active playoff bracket
--   already exists. Reset it first.' From January to September the commissioner
--   is told to reset, and reset says there is nothing to reset. The bracket is
--   unrecoverable through the UI.
--
--   WHY get_current_season AND NOT THE CALENDAR RULE
--
--   The read side already picked. PlayoffService.getBracket filters
--   .eq('season', getCurrentSeason()) from packages/shared, and that TS
--   function carries SEASON_START_DATES = { 2026: '2026-09-29' } because the
--   2026-27 regular season opens in September. Measured on production:
--     get_current_season('2026-09-29')          2026
--     get_nhl_season_year('2026-09-29')         2025
--   So on 2026-09-29 and 2026-09-30 the calendar rule would stamp 2025 while
--   the client asks for 2026, and a freshly generated bracket would be
--   invisible on the page that generated it. get_current_season reads the
--   loaded fixture list, which is what SEASON_START_DATES exists to mirror, so
--   the two agree by construction on every date. Everywhere else the two SQL
--   rules already return the same value, including today.
--
--   The existing bracket keeps its key: it is season 2025 and
--   league_bracket_season() is 2025, so reset and generate both find it with
--   no data migration.
--
--   WHY NOT getPlayoffSeasonForDate / pool_playoff_season
--
--   packages/shared/src/constants/season.ts gained getPlayoffSeasonForDate
--   and getCurrentPlayoffSeason today, and public.pool_playoff_season landed
--   in 20260903220000. Both answer a different question: which NHL PLAYOFF RUN
--   (April-June) a pool is scoring. A fantasy league's bracket is not an NHL
--   playoff run - it is weeks 15-20 of that league's own schedule, inside one
--   NHL regular season, and it is keyed by the NHL season year. Using the
--   playoff-run rule here would return 2025 until April 2027 and would key
--   next season's brackets to last season's run. There is no missing SQL
--   equivalent to add: the right one already exists and is
--   get_current_season. league_bracket_season names it for this use so the
--   three functions and the column default share one definition.
--
--   WHY THE FALLBACK IN reset
--
--   The season rule is a judgement; "reset must be able to delete whatever
--   generate is complaining about" is an invariant. Even with a perfect key,
--   a bracket stamped under an older rule (every bracket generated before this
--   migration, if the rules ever diverge) would strand the league forever.
--   reset now looks, in order, for: the non-completed bracket for the current
--   season, then any non-completed bracket for the league, then any bracket
--   for the current season. The first two are exactly the rows that make
--   generate_playoff_bracket refuse; the third preserves today's behaviour of
--   clearing a finished bracket so a league can run playoffs again.
--
--   DEFECT P2 - seeding books unplayed weeks as ties and can disagree with
--   the standings page.
--
--   The seeding query joined every matchup with week_number <= regular weeks,
--   with no status filter and no played filter. A 0-0 week that nobody played
--   satisfies "team1_score = team2_score" and was written into
--   playoff_seeds.regular_season_ties.
--
--   Measured on production 2026-09-03, old rule versus the standings rule,
--   over the 12 leagues that have matchups:
--     matchups rows                                  407
--     rows at 0-0                                    373
--     rows with a score on either side                34
--     rows FINAL but never played                     62
--     rows played but not yet FINAL                    0
--   Phantom ties the old seeding query would write, by league:
--     Launch Dry Run                     200 -> 0
--     MLSE Walkthrough Rehearsal         100 -> 0
--     [DELETED] The Alpha League           80 -> 0
--     Finalsz                              56 -> 0
--     Claude Linear Verify                 54 -> 0
--     Claude Auction League                54 -> 0
--     Claude BestBall Verify               54 -> 0
--     DACOSTA!                             54 -> 0
--     Claude Engine Verify League          50 -> 0
--     Demo League - Citrus Storm Showcase  36 -> 0
--     [DELETED] I love Hutson               2 -> 0
--   740 phantom ties across 11 leagues. The standings page shows 0 for every
--   one of them, because packages/shared/src/utils/standings.ts already
--   applies FINAL + PLAYED. A commissioner comparing the bracket's seed table
--   to the standings table would have found two different records for the
--   same season.
--
--   Wins, losses and points-for do not move on today's data: a 0-0 week
--   contributes 0 to points-for and produces neither a win nor a loss, and
--   there are zero rows that are played-but-not-final. So this migration
--   changes recorded ties and nothing else about the current data - which is
--   precisely why it is safe to land now, and why it must land before a
--   played-but-not-yet-completed week exists and starts moving real seeds.
--
--   THE TWO GATES ARE COPIED, NOT INVENTED. standings.ts:
--     FINAL  : status = 'completed' OR week_end_date is in the past
--     PLAYED : team1_score > 0 OR team2_score > 0 (for a bye, team1_score > 0)
--   and PLAYED is itself the predicate auto_complete_matchups() uses to decide
--   a week is over. This migration writes the same two predicates in SQL.
--
--   WHY generate REFUSES ON ZERO PLAYED WEEKS, AND WHY IT DOES NOT GET
--   auto_generate's "regular season complete" GATE
--
--   auto_generate_playoff_bracket refuses with 'regular_season_in_progress'
--   when any regular-season matchup is not completed. That gate exists because
--   auto-generation is UNATTENDED - it fires from PlayoffService.getBracket on
--   every read, so it must never fire early. A commissioner pressing Generate
--   is an attended, deliberate act, and leagues legitimately generate before
--   the final week auto-completes. Measured on production 2026-09-03:
--     leagues with matchups                        12
--     leagues whose regular season is complete      1
--   Giving the manual path auto_generate's gate would block 11 of 12 leagues,
--   including the demo league, three days before the iOS build.
--
--   What the manual path DOES need is the invariant that gate incidentally
--   provided: never seed from an empty record set. With the new PLAYED gate,
--   a league where nothing has been played produces all-zero records and the
--   seed order collapses to whatever order Postgres returned rows in - the
--   same "decide something from nothing" shape as defect P3 one function over.
--     leagues with matchups but zero played weeks  10 of 12
--   So generate now refuses outright in that case, and reports
--   regular_season_weeks / unfinished_weeks in its result so the route and the
--   UI can warn about the softer case without the database guessing.
--   The route POST /api/playoffs/league/:id/generate is deliberately left
--   without its own gate: the rule belongs in the RPC, where it holds for the
--   client RPC path and psql too, not only for one Hono handler.
--
--   FOUND WHILE READING, AND FIXED HERE BECAUSE IT IS IN A FUNCTION THIS
--   MIGRATION ALREADY REPLACES: auto_generate_playoff_bracket contained
--     AND LOWER(status) NOT IN ('completed', 'final')
--   over public.matchups, whose status column is the enum matchup_status.
--   Verified against production 2026-09-03:
--     select lower(status) from matchups
--     ERROR 42883: function lower(matchup_status) does not exist
--   plpgsql resolves that statement on first execution, so every call that got
--   past the earlier gates raised 42883 rather than returning a skip reason.
--   PlayoffService.getBracket calls this RPC inside a bare try/catch that
--   discards the error, so auto-generation has been failing silently.
--   Blast radius of the fix, measured on production 2026-09-03:
--     leagues that reach the broken statement today        4
--     of those, leagues that would now generate a bracket   0
--   All four still have unfinished regular-season weeks, so the fix converts a
--   swallowed exception into the correct 'regular_season_in_progress' skip and
--   creates no bracket today. Leaving a known-broken cast in a body I am
--   rewriting anyway is not an option; carrying it forward unchanged would
--   mean shipping a function that cannot run.
--
--   Reversibility: CREATE OR REPLACE from the three capture files restores the
--   prior bodies byte for byte, and the column default is a one-line revert.
--   league_bracket_season is additive; nothing but these three functions and
--   the default read it.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Playoffs subsystem, defects P1 and P2.
--
-- APPLY ORDER: independent of 20260903220000 and 20260903221000. Must land
-- before 20260903231000, which replaces advance_playoff_round and asserts
-- these bodies are in place. No engine redeploy needed; the server change that
-- pairs with this one is read-only reporting.
--
-- Idempotent: four CREATE OR REPLACE and one SET DEFAULT. A second apply is a
-- no-op. Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. The one season rule a fantasy playoff bracket is keyed by ----------
CREATE OR REPLACE FUNCTION public.league_bracket_season(p_on date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Deliberately delegates rather than re-deriving. get_current_season reads
  -- the loaded regular-season fixture list, which is what the browser's
  -- getCurrentSeason() + SEASON_START_DATES pair exists to mirror, so the
  -- season a bracket is STAMPED with and the season the client READS with
  -- cannot drift. The raw calendar year (what reset_playoff_bracket used) and
  -- the month>=10 rule (what the two generators used) both disagree with that
  -- reader on at least two days of the 2026-27 season opening.
  SELECT public.get_current_season(p_on);
$function$;

COMMENT ON FUNCTION public.league_bracket_season(date) IS
  'The NHL season a fantasy league playoff bracket belongs to (playoff_brackets.season). Single source of truth for generate_playoff_bracket, auto_generate_playoff_bracket, reset_playoff_bracket and the playoff_brackets.season default. NOT the same question as public.pool_playoff_season, which answers which NHL playoff RUN a pool scores.';

REVOKE ALL ON FUNCTION public.league_bracket_season(date) FROM public;
GRANT EXECUTE ON FUNCTION public.league_bracket_season(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_bracket_season(date) TO service_role;

-- -- 2. The column default agrees with the functions that write it --------
ALTER TABLE public.playoff_brackets
  ALTER COLUMN season SET DEFAULT public.league_bracket_season();

-- -- 3. reset_playoff_bracket: find the bracket that blocks generation ----
CREATE OR REPLACE FUNCTION public.reset_playoff_bracket(p_league_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket_id UUID;
  v_season INT;
BEGIN
  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = p_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can reset playoff brackets');
  END IF;

  -- 2026-09-03: was season = EXTRACT(YEAR FROM NOW()), the raw calendar year.
  -- The generators stamp season with the NHL season year, so from January to
  -- September this lookup asked for a season no bracket carries and the escape
  -- hatch out of 'An active playoff bracket already exists. Reset it first.'
  -- did not exist.
  v_season := public.league_bracket_season();

  -- (i) The bracket that blocks generation for the current season.
  SELECT pb.id INTO v_bracket_id
  FROM public.playoff_brackets pb
  WHERE pb.league_id = p_league_id
    AND pb.season = v_season
    AND pb.status <> 'completed'
  LIMIT 1;

  -- (ii) Any other bracket that blocks generation, whatever season it carries.
  -- This is the invariant, independent of the season rule above: reset must be
  -- able to clear whatever generate is refusing over, including a bracket
  -- stamped by an older rule.
  IF v_bracket_id IS NULL THEN
    SELECT pb.id INTO v_bracket_id
    FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
      AND pb.status <> 'completed'
    ORDER BY pb.season DESC, pb.created_at DESC
    LIMIT 1;
  END IF;

  -- (iii) A finished bracket for the current season. Preserves the old
  -- behaviour of clearing a completed bracket so a league can run again.
  IF v_bracket_id IS NULL THEN
    SELECT pb.id INTO v_bracket_id
    FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
      AND pb.season = v_season
    ORDER BY pb.created_at DESC
    LIMIT 1;
  END IF;

  IF v_bracket_id IS NULL THEN
    RETURN json_build_object('error', 'No bracket found for this league');
  END IF;

  -- Delete bracket and cascade (seeds and series auto-deleted via CASCADE)
  DELETE FROM public.playoff_brackets WHERE id = v_bracket_id;

  -- Clean up playoff matchups (week_number > regular season)
  DELETE FROM public.matchups
  WHERE league_id = p_league_id
  AND week_number > COALESCE(
    (SELECT (settings->>'regularSeasonWeeks')::INT FROM public.leagues WHERE id = p_league_id),
    (SELECT COALESCE(MAX(m2.week_number), 0) FROM public.matchups m2 WHERE m2.league_id = p_league_id)
  );

  RETURN json_build_object('success', true, 'bracket_id', v_bracket_id, 'season', v_season);
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_playoff_bracket(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reset_playoff_bracket(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_playoff_bracket(uuid) TO service_role;

-- -- 4. auto_generate_playoff_bracket: same season rule as everyone else --
CREATE OR REPLACE FUNCTION public.auto_generate_playoff_bracket(p_league_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_league RECORD;
  v_series_season INT;
  v_regular_weeks INT;
  v_incomplete_count INT;
  v_matchups_exist BOOLEAN;
  v_playoff_teams INT;
  v_result JSON;
BEGIN
  -- 2026-09-03: was an inline "month >= 10 ? year : year - 1". One rule now.
  v_series_season := public.league_bracket_season();

  SELECT l.*,
    COALESCE(l.settings->>'leagueType', 'fantasy') AS cfg_league_type,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks,
    COALESCE((l.settings->>'autoPlayoffs')::BOOLEAN, TRUE) AS cfg_auto_playoffs,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN RETURN json_build_object('skipped', 'league_not_found'); END IF;
  IF v_league.cfg_league_type != 'fantasy' THEN RETURN json_build_object('skipped', 'not_fantasy'); END IF;
  IF NOT v_league.cfg_auto_playoffs THEN RETURN json_build_object('skipped', 'auto_disabled'); END IF;
  IF v_league.cfg_playoff_teams < 4 THEN RETURN json_build_object('skipped', 'playoffs_disabled'); END IF;
  IF v_league.draft_status != 'completed' THEN RETURN json_build_object('skipped', 'draft_not_completed'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id AND pb.season = v_series_season
  ) THEN
    RETURN json_build_object('skipped', 'bracket_already_exists');
  END IF;

  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_weeks
    FROM public.matchups WHERE league_id = p_league_id;
  END IF;

  IF v_regular_weeks = 0 THEN RETURN json_build_object('skipped', 'no_matchups'); END IF;

  SELECT EXISTS (SELECT 1 FROM public.matchups WHERE league_id = p_league_id AND week_number <= v_regular_weeks)
  INTO v_matchups_exist;
  IF NOT v_matchups_exist THEN RETURN json_build_object('skipped', 'no_regular_season_matchups'); END IF;

  SELECT COUNT(*) INTO v_incomplete_count
  FROM public.matchups
  WHERE league_id = p_league_id
    AND week_number <= v_regular_weeks
    AND LOWER(status::TEXT) NOT IN ('completed', 'final');

  IF v_incomplete_count > 0 THEN
    RETURN json_build_object('skipped', 'regular_season_in_progress', 'remaining', v_incomplete_count);
  END IF;

  SELECT public.generate_playoff_bracket(
    p_league_id,
    COALESCE((v_league.settings->>'consolationBracket')::BOOLEAN, FALSE),
    COALESCE((v_league.settings->>'twoWeekMatchups')::BOOLEAN, FALSE),
    COALESCE((v_league.settings->>'reseedEachRound')::BOOLEAN, FALSE),
    COALESCE(v_league.settings->>'seedingMethod', 'standings')
  ) INTO v_result;

  RETURN json_build_object('generated', true, 'result', v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_generate_playoff_bracket(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.auto_generate_playoff_bracket(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_generate_playoff_bracket(uuid) TO service_role;

-- -- 5. generate_playoff_bracket: one season rule, and seeding that uses ---
-- --    the shared FINAL + PLAYED gates -----------------------------------
CREATE OR REPLACE FUNCTION public.generate_playoff_bracket(p_league_id uuid, p_consolation_enabled boolean DEFAULT false, p_two_week_matchups boolean DEFAULT false, p_reseed_each_round boolean DEFAULT false, p_seeding_method text DEFAULT 'standings'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket_id UUID;
  v_league RECORD;
  v_bracket_size INT;
  v_total_rounds INT;
  v_playoff_teams INT;
  v_team_count INT;
  v_regular_season_weeks INT;
  v_playoff_start_week INT;
  v_team RECORD;
  v_seed_num INT := 0;
  v_series_season INT;
  v_qf1 UUID; v_qf2 UUID; v_qf3 UUID; v_qf4 UUID;
  v_sf1 UUID; v_sf2 UUID;
  v_finals UUID;
  v_third_place UUID;
  v_con_sf1 UUID; v_con_sf2 UUID; v_con_finals UUID;
  v_con_r1_1 UUID; v_con_r1_2 UUID;
  v_week_offset INT;
  v_counted_matchups INT;
  v_unfinished_weeks INT;
BEGIN
  -- 2026-09-03: was an inline "month >= 10 ? year : year - 1". One rule now,
  -- shared with auto_generate_playoff_bracket, reset_playoff_bracket and the
  -- playoff_brackets.season column default, so the season a bracket is stamped
  -- with is the season every reader and the reset path look it up by.
  v_series_season := public.league_bracket_season();

  SELECT l.*,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams,
    COALESCE((l.settings->>'playoffWeeks')::INT, 3) AS cfg_playoff_weeks,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks,
    COALESCE(l.settings->>'leagueType', 'fantasy') AS cfg_league_type
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'League not found');
  END IF;

  -- Allow admin/service callers (auth.uid() IS NULL) to bypass commissioner gate
  IF auth.uid() IS NOT NULL AND v_league.commissioner_id != auth.uid() THEN
    RETURN json_build_object('error', 'Only the commissioner can generate playoff brackets');
  END IF;

  IF v_league.cfg_league_type != 'fantasy' THEN
    RETURN json_build_object('error', 'Playoff brackets are only available for fantasy leagues');
  END IF;

  IF v_league.draft_status != 'completed' THEN
    RETURN json_build_object('error', 'Draft must be completed before generating playoffs');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
    AND pb.season = v_series_season
    AND pb.status != 'completed'
  ) THEN
    RETURN json_build_object('error', 'An active playoff bracket already exists. Reset it first.');
  END IF;

  SELECT COUNT(*) INTO v_team_count FROM public.teams t WHERE t.league_id = p_league_id;

  v_playoff_teams := v_league.cfg_playoff_teams;
  IF v_playoff_teams > v_team_count THEN v_playoff_teams := v_team_count; END IF;

  IF v_playoff_teams >= 8 THEN v_bracket_size := 8;
  ELSIF v_playoff_teams >= 6 THEN v_bracket_size := 6;
  ELSIF v_playoff_teams >= 4 THEN v_bracket_size := 4;
  ELSE RETURN json_build_object('error', 'Need at least 4 teams for playoffs');
  END IF;

  IF v_bracket_size = 8 THEN v_total_rounds := 3;
  ELSIF v_bracket_size = 6 THEN v_total_rounds := 3;
  ELSE v_total_rounds := 2;
  END IF;

  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_season_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_season_weeks
    FROM public.matchups m WHERE m.league_id = p_league_id;
  END IF;
  v_playoff_start_week := v_regular_season_weeks + 1;

  -- 2026-09-03: never seed a bracket from an empty record set. With the FINAL
  -- + PLAYED gates added to the seeding query below, a league where nothing has
  -- been played produces all-zero records for every team and the seed order
  -- collapses to whatever order Postgres happened to return rows in. 10 of the
  -- 12 production leagues that have matchups were in exactly that state on
  -- 2026-09-03. This is the invariant auto_generate_playoff_bracket's
  -- 'regular_season_in_progress' gate provided by accident; the manual
  -- commissioner path needs the invariant without the full gate, because
  -- generating a week early is a legitimate attended act and that gate would
  -- block 11 of 12 leagues today.
  SELECT COUNT(*) INTO v_counted_matchups
  FROM public.matchups m
  WHERE m.league_id = p_league_id
    AND m.week_number <= v_regular_season_weeks
    AND (m.status = 'completed' OR m.week_end_date < CURRENT_DATE)
    AND (CASE WHEN m.team2_id IS NULL THEN m.team1_score > 0
              ELSE (m.team1_score > 0 OR m.team2_score > 0) END);

  IF v_counted_matchups = 0 THEN
    RETURN json_build_object('error', 'No regular-season week has been played yet, so there is nothing to seed from');
  END IF;

  -- Reported, not gated: lets the route and the UI say "you are seeding from
  -- an unfinished regular season" instead of the database guessing for them.
  SELECT COUNT(*) INTO v_unfinished_weeks
  FROM public.matchups m
  WHERE m.league_id = p_league_id
    AND m.week_number <= v_regular_season_weeks
    AND NOT (m.status = 'completed' OR m.week_end_date < CURRENT_DATE);

  INSERT INTO public.playoff_brackets (
    league_id, season, bracket_size, status, current_round, total_rounds,
    seeding_method, reseed_each_round, consolation_enabled, two_week_matchups,
    generated_by, started_at
  ) VALUES (
    p_league_id, v_series_season, v_bracket_size, 'active', 1, v_total_rounds,
    p_seeding_method, p_reseed_each_round, p_consolation_enabled, p_two_week_matchups,
    auth.uid(), NOW()
  )
  RETURNING id INTO v_bracket_id;

  v_seed_num := 0;
  FOR v_team IN
    SELECT t.id AS team_id,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score > m.team2_score THEN 1
                        WHEN m.team2_id = t.id AND m.team2_score > m.team1_score THEN 1
                        ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score < m.team2_score THEN 1
                        WHEN m.team2_id = t.id AND m.team2_score < m.team1_score THEN 1
                        ELSE 0 END), 0) AS losses,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score = m.team2_score AND m.team2_id IS NOT NULL THEN 1
                        WHEN m.team2_id = t.id AND m.team1_score = m.team2_score THEN 1
                        ELSE 0 END), 0) AS ties,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id THEN m.team1_score
                        WHEN m.team2_id = t.id THEN m.team2_score
                        ELSE 0 END), 0) AS points_for
    FROM public.teams t
    LEFT JOIN public.matchups m ON ((m.team1_id = t.id OR m.team2_id = t.id)
      AND m.league_id = p_league_id AND m.week_number <= v_regular_season_weeks
      -- 2026-09-03: the two gates from packages/shared/src/utils/standings.ts,
      -- so the seed table and the standings page cannot disagree about the
      -- same season.
      -- FINAL: 'completed', or the week has already ended. The date half is not
      -- redundant - auto_complete_matchups() runs on a schedule, so a fully
      -- scored week can be a day late to 'completed'.
      AND (m.status = 'completed' OR m.week_end_date < CURRENT_DATE)
      -- PLAYED: at least one side scored, including the bye-week form. This is
      -- auto_complete_matchups()'s own predicate for "this week is over", so
      -- the seeding query stops contradicting the function that decides when a
      -- week ends. Without it a 0-0 week nobody played satisfied
      -- team1_score = team2_score and was written into
      -- playoff_seeds.regular_season_ties: 740 phantom ties across 11
      -- production leagues on 2026-09-03.
      AND (CASE WHEN m.team2_id IS NULL THEN m.team1_score > 0
                ELSE (m.team1_score > 0 OR m.team2_score > 0) END))
    WHERE t.league_id = p_league_id
    GROUP BY t.id
    -- team_name then id break the remaining tie so seeding is reproducible
    -- rather than left to whatever order Postgres returned. Mirrors the tail
    -- of rankStandings() in packages/shared/src/utils/standings.ts.
    ORDER BY wins DESC, points_for DESC, losses ASC, t.team_name ASC, t.id ASC
    LIMIT v_bracket_size
  LOOP
    v_seed_num := v_seed_num + 1;
    INSERT INTO public.playoff_seeds (
      bracket_id, team_id, seed_number,
      regular_season_wins, regular_season_losses, regular_season_ties,
      regular_season_points_for, source
    ) VALUES (
      v_bracket_id, v_team.team_id, v_seed_num,
      v_team.wins, v_team.losses, v_team.ties,
      v_team.points_for, p_seeding_method
    );
  END LOOP;

  IF v_bracket_size = 8 THEN
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 1, 8, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 4, 5, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf2;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 3, 'winners', 2, 7, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf3;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 4, 'winners', 3, 6, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf4;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 2, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 3, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'home' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'home' WHERE id = v_qf3;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf4;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;

      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 1, 'consolation', 'pending', v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END), CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END)
      RETURNING id INTO v_con_r1_1;
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 2, 'consolation', 'pending', v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END), CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END)
      RETURNING id INTO v_con_r1_2;
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'consolation', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_con_finals;

      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'home' WHERE id = v_qf1;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'away' WHERE id = v_qf2;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'home' WHERE id = v_qf3;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'away' WHERE id = v_qf4;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'home' WHERE id = v_con_r1_1;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'away' WHERE id = v_con_r1_2;
    END IF;

  ELSIF v_bracket_size = 6 THEN
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 3, 6, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 4, 5, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf2;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 1, 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 2, 'winners', 2, 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 3, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;

  ELSE
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 1, 4, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 2, 3, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;
  END IF;

  UPDATE public.playoff_series ps
  SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed),
      away_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.away_seed)
  WHERE ps.bracket_id = v_bracket_id AND ps.round_number = 1 AND ps.home_seed IS NOT NULL;

  IF v_bracket_size = 6 THEN
    UPDATE public.playoff_series ps
    SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed)
    WHERE ps.bracket_id = v_bracket_id AND ps.round_number = 2 AND ps.home_seed IS NOT NULL;
  END IF;

  INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
  SELECT p_league_id, ps.matchup_week_1, ps.home_team_id, ps.away_team_id,
    0, 0, 'scheduled', CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
  FROM public.playoff_series ps
  WHERE ps.bracket_id = v_bracket_id AND ps.home_team_id IS NOT NULL AND ps.away_team_id IS NOT NULL AND ps.status = 'active'
  ON CONFLICT DO NOTHING;

  RETURN json_build_object(
    'bracket_id', v_bracket_id,
    'bracket_size', v_bracket_size,
    'total_rounds', v_total_rounds,
    'playoff_start_week', v_playoff_start_week,
    'consolation_enabled', p_consolation_enabled,
    'two_week_matchups', p_two_week_matchups,
    'regular_season_weeks', v_regular_season_weeks,
    'seeded_from_matchups', v_counted_matchups,
    'unfinished_weeks', v_unfinished_weeks,
    'regular_season_complete', (v_unfinished_weeks = 0),
    'success', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_playoff_bracket(uuid, boolean, boolean, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_playoff_bracket(uuid, boolean, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_playoff_bracket(uuid, boolean, boolean, boolean, text) TO service_role;

-- -- 6. Post-conditions: refuse to commit on drift -----------------------
DO $$
DECLARE v_body text; v_code text; v_def text;
BEGIN
  -- Every LIKE below runs against a comment-stripped copy. The new bodies
  -- explain in comments what the old rule was, and an unstripped body would
  -- match its own explanation.

  -- The shared season rule exists and answers the same thing get_current_season
  -- does, on a date where the raw calendar year does NOT.
  IF public.league_bracket_season('2026-09-03'::date) <> public.get_current_season('2026-09-03'::date) THEN
    RAISE EXCEPTION 'league_bracket_season disagrees with get_current_season';
  END IF;
  IF public.league_bracket_season('2026-09-03'::date) = 2026 THEN
    RAISE EXCEPTION 'league_bracket_season is returning the raw calendar year';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.playoff_brackets'::regclass AND a.attname = 'season';
  IF v_def IS NULL OR v_def NOT LIKE '%league_bracket_season%' THEN
    RAISE EXCEPTION 'playoff_brackets.season default is still %', COALESCE(v_def, '<none>');
  END IF;

  -- No function may carry its own copy of the season rule any more.
  FOREACH v_body IN ARRAY ARRAY[
    pg_get_functiondef('public.reset_playoff_bracket(uuid)'::regprocedure),
    pg_get_functiondef('public.generate_playoff_bracket(uuid,boolean,boolean,boolean,text)'::regprocedure),
    pg_get_functiondef('public.auto_generate_playoff_bracket(uuid)'::regprocedure)
  ] LOOP
    v_code := regexp_replace(v_body, '--[^\n]*', '', 'g');
    IF v_code NOT LIKE '%public.league_bracket_season()%' THEN
      RAISE EXCEPTION 'a playoff bracket function is not using league_bracket_season()';
    END IF;
    IF v_code LIKE '%EXTRACT(MONTH FROM NOW())%' OR v_code LIKE '%season = EXTRACT(YEAR FROM NOW())%' THEN
      RAISE EXCEPTION 'a playoff bracket function still carries its own season rule';
    END IF;
  END LOOP;

  -- The seeding query applies both standings gates, and the refusal sits
  -- BEFORE the bracket row is inserted or it would leave a half-built bracket.
  v_code := regexp_replace(
    pg_get_functiondef('public.generate_playoff_bracket(uuid,boolean,boolean,boolean,text)'::regprocedure),
    '--[^\n]*', '', 'g');
  IF v_code NOT LIKE '%m.status = ''completed'' OR m.week_end_date < CURRENT_DATE%' THEN
    RAISE EXCEPTION 'generate_playoff_bracket is missing the FINAL gate';
  END IF;
  IF v_code NOT LIKE '%CASE WHEN m.team2_id IS NULL THEN m.team1_score > 0%' THEN
    RAISE EXCEPTION 'generate_playoff_bracket is missing the PLAYED gate';
  END IF;
  IF position('IF v_counted_matchups = 0 THEN' in v_code)
       > position('INSERT INTO public.playoff_brackets' in v_code) THEN
    RAISE EXCEPTION 'generate_playoff_bracket would insert a bracket before refusing';
  END IF;

  -- LOWER() has no matchup_status overload; the uncast form raised 42883.
  v_code := regexp_replace(
    pg_get_functiondef('public.auto_generate_playoff_bracket(uuid)'::regprocedure), '--[^\n]*', '', 'g');
  IF v_code LIKE '%LOWER(status) NOT IN%' THEN
    RAISE EXCEPTION 'auto_generate_playoff_bracket still calls LOWER() on the matchup_status enum';
  END IF;

  RAISE NOTICE 'playoff bracket season rule unified; generate_playoff_bracket md5 = %',
    md5(pg_get_functiondef('public.generate_playoff_bracket(uuid,boolean,boolean,boolean,text)'::regprocedure));
END $$;

COMMIT;

-- ===========================================================================
-- [08/12] 20260903231000_playoff_advance_requires_completed_series.sql
-- ===========================================================================
-- ============================================================================
-- A playoff series is decided by games that were played, or it is not decided
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-03,
-- 5173b0b2b3e5b2065e7d2096ecb8f8ca):
--   supabase/migrations/captures/2026-09-03_pre_advance_playoff_round.sql
--
-- (a) WHAT CHANGED
--   advance_playoff_round() only. Signature, return type, SECURITY DEFINER,
--   search_path and grants are unchanged, and so are the bracket lookup, the
--   commissioner gate, the advance/drop wiring and the bracket-completion
--   branch.
--   1. Before deciding a series, the function now counts the matchup rows for
--      that series and requires that at least one exists and that EVERY one of
--      them is FINAL and was PLAYED. A series that fails is skipped with a
--      reason, not decided.
--   2. The tiebreak reads the seed from playoff_seeds BY TEAM instead of from
--      playoff_series.home_seed / away_seed, and falls through points-for and
--      wins to an explicit refusal. It never picks a side arbitrarily.
--   3. current_round only moves when the round is genuinely finished: no
--      active series left and at least one completed. It used to move
--      unconditionally.
--   4. The result JSON gains skipped_count, skipped[] and round_advanced.
--      advanced_count and current_round keep their existing meanings.
--
-- (b) WHY NOW
--
--   DEFECT P3 - the function crowns a champion off games nobody played, and in
--   the finals it hands the title to the away team for no reason at all.
--
--   The old body selected every 'active' series in the current round and
--   decided it on the spot. There was no check that the series' matchups were
--   complete and no check that anything had been scored. With no matchup rows,
--   or with 0-0 rows, both sides summed to 0 and control fell to:
--
--     IF home_seed IS NOT NULL AND away_seed IS NOT NULL AND home_seed < away_seed
--       -> home wins
--     ELSE
--       -> away wins
--
--   home_seed and away_seed are columns on playoff_series, and
--   generate_playoff_bracket only ever writes them on round-1 series and on the
--   two 6-team round-2 bye slots. In a semi-final or a final they are NULL, the
--   condition is false, and the ELSE fires. The away team wins. In the finals
--   that is the league champion, decided by which slot the team happened to
--   land in.
--
--   Measured on production 2026-09-03. There is exactly one bracket
--   (0fdae469, season 2025, 6 teams, 3 rounds, status completed) and five
--   series. Re-deciding each one against the matchup rows as they stand today:
--
--     rd match  home/away seeds  series score  old rule picks  bracket records
--     1  1      3 / 6            0.000-0.000   home (seed 3)   away (seed 6)
--     1  2      4 / 5            0.000-0.000   home (seed 4)   home (seed 4)
--     2  1      1 / NULL         151.0-136.8   home            home
--     2  2      2 / NULL         0.000-0.000   AWAY            home (seed 2)
--     3  1      NULL / NULL      143.3-103.3   home            home
--
--   Three of the five series read 0.000-0.000 from their matchup rows right
--   now (their weeks were re-zeroed after the bracket ran), and re-deciding
--   them today flips two of the three away from what the bracket records.
--   Round 2 match 2 is the exact defect: the home team is the 2 seed, the away
--   seed is NULL because that slot is a bye, the scores are 0-0, and the old
--   rule gives the series to the 6 seed. The final is the only series with
--   NULL on BOTH sides, which is the case with no possible tiebreak at all.
--
--   Supporting counts on production 2026-09-03:
--     playoff_series rows                                  5
--     series with a NULL seed on at least one side         3
--     series with NULL on both sides (all finals)          1
--     matchup rows total                                 407
--     matchup rows at 0-0                                373
--     matchup rows FINAL but never played                 62
--     matchup rows played but not yet FINAL                0
--
--   The commissioner path is one button. POST /api/playoffs/bracket/:id/advance
--   checks league membership, then advance_playoff_round checks
--   leagues.commissioner_id = auth.uid() and decides everything in the current
--   round. Pressing it a week early was enough.
--
--   WHAT COUNTS AS DECIDABLE
--
--   Same two gates as packages/shared/src/utils/standings.ts, which is already
--   the single source of truth for W/L/T on the client and the API server:
--     FINAL  : status = 'completed', or week_end_date is in the past
--     PLAYED : at least one side scored above zero
--   PLAYED is not an invention. auto_complete_matchups() will only move a
--   matchup to 'completed' when team1_score > 0 and team2_score > 0, so a 0-0
--   week can never legitimately be over. The gate here adopts the database's
--   own predicate rather than a second one.
--
--   The rule is "every matchup row found for this series is final and played,
--   and there is at least one". Not "both configured weeks exist": for a
--   two-week series, neither generate_playoff_bracket nor advance_playoff_round
--   has ever inserted a matchup row for matchup_week_2, so requiring both would
--   permanently brick two-week brackets. Zero production leagues use
--   twoWeekMatchups today (settings->>'twoWeekMatchups' = 'true' on 0 of 55
--   leagues, two_week_matchups true on 0 of 1 brackets), so nothing is affected
--   either way. The missing week-2 row is flagged below, not fixed here.
--
--   THE TIE RULE, AND WHY IT IS THIS ONE
--
--   A series that really was played can still finish level on points. In order:
--     1. HIGHER SEED. Read from playoff_seeds by team_id, which every team in
--        the bracket has, in every round. This is the fix for the actual
--        defect: the old code read the per-series seed columns, which do not
--        exist past round 1, so the "higher seed wins" rule it advertised was
--        unreachable exactly where it mattered most. playoff_seeds carries
--        UNIQUE (bracket_id, seed_number), so two teams can never share a seed
--        and this rule is TOTAL for any well-formed bracket. It is also the
--        rule every real playoff format uses: the reward for a better regular
--        season is winning the coin flip you did not lose.
--     2. REFUSE. The series stays 'active', the round does not advance, and the
--        caller is told which series and why.
--
--   There is deliberately no third rule. The obvious candidates - more
--   regular-season points for, more regular-season wins - sit on the same
--   playoff_seeds row as seed_number, so they are present exactly when rule 1
--   has already decided and absent exactly when it has not: as tiebreakers they
--   are unreachable code that reads like a safety net. Rule 1 can only fail
--   when a team's seed row is gone (deleted and re-added mid-playoffs), and
--   then every seeding fact for that team is gone with it. Recomputing one from
--   the matchups would produce a number that can disagree with the bracket it
--   is breaking a tie inside - which is the same species of defect as the one
--   being fixed. A refusal is visible and recoverable; a silent coin flip is
--   neither.
--
--   WHY current_round NO LONGER MOVES ON ITS OWN
--
--   The old body bumped current_round outside the loop, so a call that decided
--   nothing still marched the bracket forward. Combined with the loop reading
--   only v_bracket.current_round, a skipped series would then be stranded
--   forever. The new condition - no active series left in the round, and at
--   least one completed - is strictly safer than the old unconditional bump and
--   also covers a round a commissioner completed by hand.
--
--   NOT FIXED HERE, FOUND WHILE READING THIS FUNCTION:
--     * A two-week series never gets a matchup row for matchup_week_2. Both
--       generate_playoff_bracket and advance_playoff_round insert
--       ps.matchup_week_1 only, so a two-week series is decided on one week.
--       Unreachable today (no league uses twoWeekMatchups) and fixing it means
--       changing what the generators write, which is a bigger change than this
--       one. Flagged, not changed.
--     * The bracket-completion branch fires as soon as the 'winners' final is
--       completed, even if a 'third_place' series in the same round is still
--       active, leaving third_place_team_id NULL. Pre-existing; carried
--       forward unchanged.
--
--   Reversibility: CREATE OR REPLACE from the capture file restores the prior
--   body byte for byte. No schema change, no data change.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Playoffs subsystem, defect P3.
--
-- APPLY ORDER: after 20260903230000, which this migration's post-conditions
-- assume for the seeding gates. No engine redeploy; the paired client change
-- is the Advance toast in apps/web/src/pages/PlayoffBracket.tsx.
--
-- Idempotent: one CREATE OR REPLACE. A second apply is a no-op.
-- Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.advance_playoff_round(p_bracket_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket RECORD;
  v_series RECORD;
  v_winner_id UUID;
  v_loser_id UUID;
  v_advanced_count INT := 0;
  v_league_id UUID;
  v_home_score NUMERIC;
  v_away_score NUMERIC;
  v_rows_found INT;
  v_rows_final INT;
  v_rows_played INT;
  v_reason TEXT;
  v_skipped_count INT := 0;
  v_skipped JSONB := '[]'::JSONB;
  v_home_seed INT;
  v_away_seed INT;
  v_active_in_round INT;
  v_completed_in_round INT;
  v_round_advanced BOOLEAN := false;
BEGIN
  -- Get bracket
  SELECT * INTO v_bracket
  FROM public.playoff_brackets
  WHERE id = p_bracket_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Bracket not found');
  END IF;

  v_league_id := v_bracket.league_id;

  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can advance rounds');
  END IF;

  IF v_bracket.status = 'completed' THEN
    RETURN json_build_object('error', 'Bracket is already completed');
  END IF;

  -- Process each active series in the current round
  FOR v_series IN
    SELECT ps.*
    FROM public.playoff_series ps
    WHERE ps.bracket_id = p_bracket_id
    AND ps.round_number = v_bracket.current_round
    AND ps.status = 'active'
    AND ps.home_team_id IS NOT NULL
    AND ps.away_team_id IS NOT NULL
  LOOP
    -- Get scores from matchups table (aggregate if two-week), and at the same
    -- time count how many of those weeks are FINAL and were actually PLAYED.
    -- 2026-09-03: the old body counted nothing. It summed whatever rows were
    -- there, got 0 and 0 from an unplayed week, and went straight to the
    -- tiebreak. Both gates are the ones in
    -- packages/shared/src/utils/standings.ts. Both teams are non-null in this
    -- loop and the join pins the exact pair, so m.team2_id is never null here
    -- and the bye form of the PLAYED rule cannot apply.
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE m.status = 'completed' OR m.week_end_date < CURRENT_DATE),
      COUNT(*) FILTER (WHERE m.team1_score > 0 OR m.team2_score > 0),
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.home_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.home_team_id THEN m.team2_score ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.away_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.away_team_id THEN m.team2_score ELSE 0 END), 0)
    INTO v_rows_found, v_rows_final, v_rows_played, v_home_score, v_away_score
    FROM public.matchups m
    WHERE m.league_id = v_league_id
    AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
    AND (
      (m.team1_id = v_series.home_team_id AND m.team2_id = v_series.away_team_id) OR
      (m.team1_id = v_series.away_team_id AND m.team2_id = v_series.home_team_id)
    );

    -- REFUSE to decide a series that was not actually played out.
    v_reason := NULL;
    IF v_rows_found = 0 THEN
      v_reason := 'no matchup row exists for this series yet';
    ELSIF v_rows_final < v_rows_found THEN
      v_reason := format('%s of %s week(s) in this series have not finished',
                         v_rows_found - v_rows_final, v_rows_found);
    ELSIF v_rows_played < v_rows_found THEN
      v_reason := format('%s of %s week(s) in this series were never scored',
                         v_rows_found - v_rows_played, v_rows_found);
    END IF;

    IF v_reason IS NOT NULL THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'series_id', v_series.id,
        'round', v_series.round_number,
        'match', v_series.match_number,
        'reason', v_reason);
      CONTINUE;
    END IF;

    -- Determine winner. The series really was played, so these scores mean
    -- something and the tiebreak below is only reached on a genuine tie.
    IF v_home_score > v_away_score THEN
      v_winner_id := v_series.home_team_id;
      v_loser_id := v_series.away_team_id;
    ELSIF v_away_score > v_home_score THEN
      v_winner_id := v_series.away_team_id;
      v_loser_id := v_series.home_team_id;
    ELSE
      -- THE TIE RULE:
      --   1. the higher seed wins (the lower seed_number)
      --   2. if that cannot separate them, refuse to decide, and say why
      --
      -- Seeds are read from playoff_seeds BY TEAM, not from ps.home_seed /
      -- ps.away_seed. Those two columns are populated only on round-1 series,
      -- plus the two 6-team round-2 bye slots, so in a semi-final or a final
      -- they are NULL and the old condition
      --   home_seed IS NOT NULL AND away_seed IS NOT NULL AND home_seed < away_seed
      -- could never be true. Every tied later-round series fell through to the
      -- ELSE and handed the win to the AWAY team on no basis whatsoever - in
      -- the finals, where both seeds are always NULL, that is the champion.
      -- Production 2026-09-03 shows the shape exactly: of the five series in
      -- the only bracket that exists, three have a NULL seed on at least one
      -- side and the final has NULL on both.
      --
      -- playoff_seeds holds a row for every team in the bracket and carries
      -- UNIQUE (bracket_id, seed_number), so two teams can never share a seed.
      -- Rule 1 is therefore TOTAL for any well-formed bracket, and it is the
      -- rule the rest of the sport uses: the reward for a better regular season
      -- is winning the coin flip you did not lose.
      --
      -- There is deliberately no third rule. The obvious candidates - more
      -- regular-season points for, more regular-season wins - live on the same
      -- playoff_seeds row as seed_number, so they are available exactly when
      -- rule 1 has already decided and missing exactly when it has not. Adding
      -- them would be unreachable code that reads like a safety net. When a
      -- seed row is genuinely gone (a team deleted and re-added mid-playoffs)
      -- every seeding fact for that team is gone with it, and recomputing one
      -- from the matchups would be a number that could disagree with the
      -- bracket it is supposed to be breaking a tie inside. So rule 2 is a
      -- refusal: the series stays active, the round does not advance, and the
      -- caller is told which series and why.
      SELECT s.seed_number INTO v_home_seed
        FROM public.playoff_seeds s
       WHERE s.bracket_id = p_bracket_id AND s.team_id = v_series.home_team_id;
      SELECT s.seed_number INTO v_away_seed
        FROM public.playoff_seeds s
       WHERE s.bracket_id = p_bracket_id AND s.team_id = v_series.away_team_id;

      v_home_seed := COALESCE(v_home_seed, v_series.home_seed);
      v_away_seed := COALESCE(v_away_seed, v_series.away_seed);

      IF v_home_seed IS NOT NULL AND v_away_seed IS NOT NULL AND v_home_seed <> v_away_seed THEN
        IF v_home_seed < v_away_seed THEN
          v_winner_id := v_series.home_team_id;
          v_loser_id := v_series.away_team_id;
        ELSE
          v_winner_id := v_series.away_team_id;
          v_loser_id := v_series.home_team_id;
        END IF;
      ELSE
        v_skipped_count := v_skipped_count + 1;
        v_skipped := v_skipped || jsonb_build_object(
          'series_id', v_series.id,
          'round', v_series.round_number,
          'match', v_series.match_number,
          'reason', 'series is tied on points and the two teams have no usable seed in this bracket; a commissioner must decide it');
        CONTINUE;
      END IF;
    END IF;

    -- Update series with results
    UPDATE public.playoff_series
    SET
      home_score = v_home_score,
      away_score = v_away_score,
      winner_team_id = v_winner_id,
      loser_team_id = v_loser_id,
      status = 'completed'
    WHERE id = v_series.id;

    -- Advance winner to next series
    IF v_series.winner_advances_to IS NOT NULL THEN
      IF v_series.winner_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_winner_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_winner_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      END IF;

      -- Create matchup rows for the newly activated series
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.winner_advances_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    -- Drop loser to consolation/third-place if configured
    IF v_series.loser_drops_to IS NOT NULL THEN
      IF v_series.loser_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_loser_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_loser_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      END IF;

      -- Create matchup rows for consolation
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.loser_drops_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    v_advanced_count := v_advanced_count + 1;
  END LOOP;

  -- Check if the finals are now completed -> bracket complete
  IF EXISTS (
    SELECT 1 FROM public.playoff_series
    WHERE bracket_id = p_bracket_id
    AND bracket_position = 'winners'
    AND round_number = v_bracket.total_rounds
    AND status = 'completed'
  ) THEN
    -- Get champion and runner-up from finals
    UPDATE public.playoff_brackets
    SET
      status = 'completed',
      current_round = v_bracket.total_rounds,
      champion_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      runner_up_team_id = (
        SELECT loser_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      third_place_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'third_place'
        AND status = 'completed' LIMIT 1
      ),
      completed_at = NOW()
    WHERE id = p_bracket_id;
  ELSE
    -- 2026-09-03: only move the bracket on when this round is genuinely
    -- finished. The old body bumped current_round unconditionally - even when
    -- v_advanced_count was 0 - so pressing Advance on a round where nothing had
    -- been played still marched the bracket forward. Worse, the loop above only
    -- reads v_bracket.current_round, so any series this call refused to decide
    -- would never be looked at again once the round moved past it.
    SELECT COUNT(*) FILTER (WHERE ps.status = 'active'),
           COUNT(*) FILTER (WHERE ps.status = 'completed')
      INTO v_active_in_round, v_completed_in_round
      FROM public.playoff_series ps
     WHERE ps.bracket_id = p_bracket_id
       AND ps.round_number = v_bracket.current_round;

    IF v_active_in_round = 0 AND v_completed_in_round > 0 THEN
      UPDATE public.playoff_brackets
      SET current_round = v_bracket.current_round + 1
      WHERE id = p_bracket_id;
      v_round_advanced := true;
    END IF;
  END IF;

  -- 'current_round' keeps its original meaning: the round this call processed,
  -- not the round the bracket moved to. 'round_advanced' says whether it moved.
  RETURN json_build_object(
    'advanced_count', v_advanced_count,
    'skipped_count', v_skipped_count,
    'skipped', v_skipped,
    'round_advanced', v_round_advanced,
    'current_round', v_bracket.current_round,
    'success', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_playoff_round(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.advance_playoff_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_playoff_round(uuid) TO service_role;

-- -- Post-conditions: refuse to commit on drift --------------------------
DO $$
DECLARE v_body text; v_code text;
BEGIN
  v_body := pg_get_functiondef('public.advance_playoff_round(uuid)'::regprocedure);
  -- Match against a comment-stripped copy: the new body quotes the old rule in
  -- a comment, and an unstripped body would match its own explanation.
  v_code := regexp_replace(v_body, '--[^\n]*', '', 'g');

  -- The arbitrary tiebreak is gone.
  IF v_code LIKE '%v_series.home_seed IS NOT NULL AND v_series.away_seed IS NOT NULL AND v_series.home_seed < v_series.away_seed%' THEN
    RAISE EXCEPTION 'advance_playoff_round still tiebreaks off the per-series seed columns';
  END IF;
  IF v_code NOT LIKE '%FROM public.playoff_seeds s%' THEN
    RAISE EXCEPTION 'advance_playoff_round is not reading seeds from playoff_seeds';
  END IF;

  -- Both gates are present.
  IF v_code NOT LIKE '%m.status = ''completed'' OR m.week_end_date < CURRENT_DATE%' THEN
    RAISE EXCEPTION 'advance_playoff_round is missing the FINAL gate';
  END IF;
  IF v_code NOT LIKE '%m.team1_score > 0 OR m.team2_score > 0%' THEN
    RAISE EXCEPTION 'advance_playoff_round is missing the PLAYED gate';
  END IF;

  -- And the gate must sit BEFORE the series is written, or it guards nothing.
  IF position('IF v_reason IS NOT NULL THEN' in v_code)
       > position('UPDATE public.playoff_series' in v_code) THEN
    RAISE EXCEPTION 'advance_playoff_round decides the series before its gate runs';
  END IF;

  -- The round no longer moves on its own.
  IF v_code NOT LIKE '%IF v_active_in_round = 0 AND v_completed_in_round > 0 THEN%' THEN
    RAISE EXCEPTION 'advance_playoff_round still advances the round unconditionally';
  END IF;

  RAISE NOTICE 'advance_playoff_round replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;

-- ===========================================================================
-- [09/12] 20260903232000_trade_vote_and_commissioner_authorization.sql
-- ===========================================================================
-- ============================================================================
-- You vote as your own team, and a commissioner can approve a trade
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 captures (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-03):
--   supabase/migrations/captures/2026-09-03_pre_submit_trade_vote.sql
--     f8959251e88ff55d3941267016a8d3cb
--   supabase/migrations/captures/2026-09-03_pre_execute_trade.sql
--     c4c470298e84c20c2c0d69e691849188
--
-- (a) WHAT CHANGED
--   1. submit_trade_vote() refuses a p_voter_team_id that is not in the
--      trade's league, and - when auth.uid() is present - refuses one the
--      caller does not own. Both checks run before any other check, so a
--      spoofed vote cannot even learn the trade's status.
--   2. execute_trade()'s caller gate now also admits the commissioner of
--      p_league_id. The existing owner check is unchanged.
--   Signatures, return types, SECURITY DEFINER, search_path and grants of both
--   functions are unchanged, as is all vote counting, veto thresholding,
--   roster movement, ledger writing and error handling.
--
-- (b) WHY NOW
--
--   DEFECT T3 - any league member can cast votes as every other team.
--
--   server/src/routes/trades.ts POST /api/trades/:tradeId/vote checked only
--   league membership and then passed body.voterTeamId straight through to
--   TradeService.submitTradeVote, which handed it to this RPC as
--   p_voter_team_id. The RPC never checked that the caller owns that team.
--
--   Because the function is SECURITY DEFINER, the policy that would have
--   stopped it never ran. Production, 2026-09-03:
--     policy trade_votes_insert, cmd INSERT, WITH CHECK
--       (voter_team_id IN (SELECT teams.id FROM teams
--                          WHERE teams.owner_id = (SELECT auth.uid())))
--   That is exactly the right rule. SECURITY DEFINER executes the INSERT as
--   the function owner, so it is bypassed by construction.
--
--   And the write is
--     ON CONFLICT (trade_offer_id, voter_team_id) DO UPDATE SET vote = p_vote
--   backed by UNIQUE (trade_offer_id, voter_team_id), so a member could not
--   only fabricate other managers' votes, they could overwrite votes those
--   managers had already cast. With trade_veto_threshold defaulting to 0.5,
--   one member can veto any trade in the league by themselves.
--
--   Exposure today is zero and that is the only reason this is not an
--   incident. Measured on production 2026-09-03:
--     leagues by trade_review_type          none = 55, commissioner = 0,
--                                           league_vote = 0
--     trade_votes rows                      1
--     trade_offers by status                cancelled 15, accepted 5,
--                                           rejected 1, vetoed 1, expired 1
--   submit_trade_vote is only reachable for a trade in 'under_review', and a
--   trade only reaches 'under_review' when its league sets
--   trade_review_type = 'league_vote'. No league does. The exposure begins the
--   moment one commissioner picks that setting in the UI, with no code change
--   and no deploy.
--
--   WHERE THE CHECK BELONGS: BOTH, AND WHY
--   The RPC is the load-bearing one. It is SECURITY DEFINER, so RLS gives the
--   database no other defence, and EXECUTE is granted to 'authenticated' -
--   any logged-in user can call it straight from the browser with
--   supabase.rpc('submit_trade_vote', {...}) and never touch the Hono route.
--   A check that only lives in the route protects only the callers that choose
--   to use the route.
--   The route check is added anyway (this migration's paired change in
--   server/src/routes/trades.ts) because it turns a silent refusal into a 403
--   with a clear message, resolves the caller's team with the codebase's
--   canonical fresh resolver rather than trusting the body, and matches the
--   house principle in LeagueMembershipService: "RLS is a backup layer -
--   explicit checks are primary".
--
--   The league check is separate from the ownership check on purpose. Ownership
--   is skipped when auth.uid() is NULL (the service role, unreachable from a
--   client - the same convention execute_trade and generate_playoff_bracket
--   already use), but "the voting team must be in this trade's league" is an
--   invariant that should hold for every caller, including a future admin tool.
--
--   DEFECT T2 - a commissioner cannot approve a trade they are reviewing.
--
--   execute_trade opened with:
--     v_caller_uid := auth.uid();
--     IF v_caller_uid IS NOT NULL THEN
--       IF NOT EXISTS (SELECT 1 FROM teams WHERE id IN (from, to)
--                        AND league_id = ... AND owner_id = v_caller_uid) THEN
--         RETURN ... 'Unauthorized: you are not an owner of either team'
--   TradeService.commissionerDecision('approve') calls it with the
--   commissioner's own JWT. A commissioner usually owns neither trading team,
--   so approve returned 400 while the service-role cron path (auth.uid() NULL)
--   worked. Production shape that makes this the normal case:
--     teams rows                            166
--     teams with owner_id NULL              55
--   A commissioner who owns no team in their own league cannot pass an owner
--   check, ever.
--
--   THE FIX, AND WHY IT IS NOT A HOLE. The gate stays; the commissioner of
--   p_league_id is added to the set it admits. Everything else in the function
--   already pins both teams to p_league_id, so a commissioner of league L can
--   only move players between two teams that are both in L. That is the power
--   the role already holds by design: they choose trade_review_type, they can
--   veto, and public.is_commissioner_of_league already backs the trade_votes
--   DELETE policy. No manager gains anything.
--
--   REJECTED ALTERNATIVE: run commissionerDecision through the service-role
--   client so auth.uid() is NULL and the gate is skipped. That does not fix the
--   control, it deletes it - the database would stop verifying the commissioner
--   for that path and LeagueMembershipService.requireCommissioner in Node would
--   be the only thing between a bug and an arbitrary roster move. The point of
--   the auth.uid() gate is that it holds regardless of which caller arrives, so
--   the right change is to teach it who else is legitimately allowed through.
--
--   NOT FIXED HERE, ANOTHER WORKSTREAM OWNS IT: the trade_offers UPDATE
--   policies permit only ('pending','cancelled') for the proposer and
--   ('pending','accepted','rejected','countered') for the recipient. The review
--   workflow writes 'under_review' and 'vetoed', which no policy allows, so
--   submitTradeForReview and the veto branch silently no-op under a user JWT
--   today. That is why T3's blast radius is theoretical rather than live, and
--   it is deliberately untouched here.
--
--   Reversibility: CREATE OR REPLACE from the two capture files restores both
--   prior bodies byte for byte. No schema change, no data change.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Trades subsystem, defects T3 and T2.
--
-- APPLY ORDER: independent of the playoff migrations. Pairs with the server
-- changes in server/src/routes/trades.ts and
-- server/src/services/TradeService.ts, which are safe to deploy in either
-- order: the route change only narrows what it sends, and the RPC change only
-- widens who execute_trade admits.
--
-- Idempotent: two CREATE OR REPLACE. A second apply is a no-op.
-- Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. submit_trade_vote: you vote as your own team, or not at all -------
CREATE OR REPLACE FUNCTION public.submit_trade_vote(p_trade_offer_id uuid, p_voter_team_id uuid, p_vote text)
 RETURNS TABLE(success boolean, message text, veto_count integer, approve_count integer, votes_needed integer, is_vetoed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade RECORD;
  v_league RECORD;
  v_total_teams INT;
  v_eligible_voters INT;
  v_veto_count INT;
  v_approve_count INT;
  v_threshold INT;
  v_is_vetoed BOOLEAN := false;
  v_caller_uid UUID;
BEGIN
  -- Get trade details
  SELECT * INTO v_trade FROM trade_offers WHERE id = p_trade_offer_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Trade not found'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- 2026-09-03: AUTHORIZE THE VOTER BEFORE ANYTHING ELSE.
  -- This function is SECURITY DEFINER, so the trade_votes_insert RLS policy
  --   WITH CHECK (voter_team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()))
  -- never runs against the INSERT below. p_voter_team_id arrived straight from
  -- the request body, and the INSERT is ON CONFLICT (trade_offer_id,
  -- voter_team_id) DO UPDATE, so any league member could cast - and overwrite -
  -- a vote as every other team and veto any trade single-handed.
  --
  -- The check lives here rather than only in the route because SECURITY DEFINER
  -- means the database has no other defence: RLS is bypassed by construction,
  -- and any caller with EXECUTE (that is every 'authenticated' JWT) can call
  -- the RPC directly from the browser without going near the Hono handler.
  -- server/src/routes/trades.ts checks it too, so a spoof gets a 403 with a
  -- clear message instead of a silent no-op, but the route is the second layer.
  IF NOT EXISTS (
    SELECT 1 FROM teams t
     WHERE t.id = p_voter_team_id
       AND t.league_id = v_trade.league_id
  ) THEN
    RETURN QUERY SELECT false, 'Voting team is not in this league'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- auth.uid() IS NULL means the service role, which is not reachable from a
  -- client: every anon/authenticated JWT sets it. Same convention as
  -- execute_trade and generate_playoff_bracket.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM teams t
     WHERE t.id = p_voter_team_id
       AND t.owner_id = v_caller_uid
  ) THEN
    RETURN QUERY SELECT false, 'You can only vote as a team you own'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Trade must be under_review to accept votes
  IF v_trade.status != 'under_review' THEN
    RETURN QUERY SELECT false, format('Trade is not under review (status: %s)', v_trade.status)::TEXT,
      0, 0, 0, false;
    RETURN;
  END IF;

  -- Can't vote on your own trade
  IF p_voter_team_id = v_trade.from_team_id OR p_voter_team_id = v_trade.to_team_id THEN
    RETURN QUERY SELECT false, 'Cannot vote on a trade you are involved in'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Check review period hasn't expired
  IF v_trade.review_ends_at IS NOT NULL AND NOW() > v_trade.review_ends_at THEN
    RETURN QUERY SELECT false, 'Review period has ended'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Get league settings
  SELECT * INTO v_league FROM leagues WHERE id = v_trade.league_id;

  -- Insert or update vote
  INSERT INTO trade_votes (trade_offer_id, league_id, voter_team_id, vote)
  VALUES (p_trade_offer_id, v_trade.league_id, p_voter_team_id, p_vote)
  ON CONFLICT (trade_offer_id, voter_team_id)
  DO UPDATE SET vote = p_vote, created_at = NOW();

  -- Count votes
  SELECT COUNT(*) INTO v_total_teams FROM teams WHERE league_id = v_trade.league_id;
  v_eligible_voters := v_total_teams - 2;  -- Exclude the two trading teams

  SELECT
    COUNT(*) FILTER (WHERE vote = 'veto'),
    COUNT(*) FILTER (WHERE vote = 'approve')
  INTO v_veto_count, v_approve_count
  FROM trade_votes WHERE trade_offer_id = p_trade_offer_id;

  v_threshold := CEIL(v_eligible_voters * COALESCE(v_league.trade_veto_threshold, 0.5));

  -- Check if trade is vetoed
  IF v_veto_count >= v_threshold THEN
    v_is_vetoed := true;
    UPDATE trade_offers
    SET status = 'vetoed', vetoed_at = NOW(), processed_at = NOW()
    WHERE id = p_trade_offer_id;
  END IF;

  RETURN QUERY SELECT true, 'Vote recorded'::TEXT,
    v_veto_count, v_approve_count, v_threshold, v_is_vetoed;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_trade_vote(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_trade_vote(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_trade_vote(uuid, uuid, text) TO service_role;

-- -- 2. execute_trade: the commissioner of THIS league is allowed through -
CREATE OR REPLACE FUNCTION public.execute_trade(p_trade_id uuid, p_league_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_offered_player_ids text[], p_requested_player_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pid TEXT; v_now TIMESTAMPTZ := NOW();
  v_offered_moved INT := 0; v_requested_moved INT := 0;
  v_caller_uid UUID; v_from_team_size INT; v_to_team_size INT; v_max_roster_size INT;
  v_from_user UUID; v_to_user UUID; v_commissioner UUID;
  v_n_offered INT := COALESCE(array_length(p_offered_player_ids, 1), 0);
  v_n_requested INT := COALESCE(array_length(p_requested_player_ids, 1), 0);
BEGIN
  -- 2026-09-03: the owner gate below is a real control on the ordinary accept
  -- path and is unchanged. What is added is the league's COMMISSIONER, and
  -- only for the league named in p_league_id.
  --
  -- Why it was needed: TradeService.commissionerDecision('approve') calls this
  -- RPC with the commissioner's own JWT. A commissioner usually owns neither
  -- trading team, so the gate returned 'Unauthorized: you are not an owner of
  -- either team' and approve failed with a 400 - while the service-role cron
  -- path, where auth.uid() is NULL, sailed through. The one review workflow
  -- that needs a human decision was the one that could not make it.
  --
  -- Why this is not a hole:
  --   * It is scoped to p_league_id. Every other check in this function already
  --     requires both teams to be in p_league_id, so a commissioner of league L
  --     can only ever move players between two teams that are both in L. That
  --     is the power the role already has - they set the trade review policy,
  --     they can veto, and public.is_commissioner_of_league already backs the
  --     trade_votes DELETE policy.
  --   * It does not widen the ordinary accept path by one row: a manager who
  --     owns neither team is still refused.
  --   * The alternative - having commissionerDecision call this with the
  --     service-role key so auth.uid() is NULL - was rejected. That removes the
  --     database-side check for the commissioner path entirely and leaves
  --     LeagueMembershipService.requireCommissioner in Node as the only thing
  --     standing between a bug and an arbitrary roster move. Teaching the RPC
  --     about commissioners keeps the verification in the database, where it
  --     holds no matter which caller arrives.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM teams WHERE id IN (p_from_team_id, p_to_team_id)
                     AND league_id = p_league_id AND owner_id = v_caller_uid)
       AND NOT EXISTS (SELECT 1 FROM leagues l
                        WHERE l.id = p_league_id AND l.commissioner_id = v_caller_uid) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: you are not an owner of either team or the commissioner of this league');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_from_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'From-team does not exist in this league';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_to_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'To-team does not exist in this league';
  END IF;
  IF p_from_team_id = p_to_team_id THEN
    RAISE EXCEPTION 'A team cannot trade with itself';
  END IF;
  IF v_n_offered = 0 AND v_n_requested = 0 THEN
    RAISE EXCEPTION 'Trade moves no players';
  END IF;

  SELECT l.commissioner_id, COALESCE(NULLIF(l.roster_size, 0), 22)
    INTO v_commissioner, v_max_roster_size
  FROM leagues l WHERE l.id = p_league_id;

  SELECT COALESCE(owner_id, v_commissioner) INTO v_from_user FROM teams WHERE id = p_from_team_id;
  SELECT COALESCE(owner_id, v_commissioner) INTO v_to_user   FROM teams WHERE id = p_to_team_id;

  SELECT COUNT(*) INTO v_from_team_size FROM roster_assignments
   WHERE team_id = p_from_team_id AND league_id = p_league_id;
  SELECT COUNT(*) INTO v_to_team_size FROM roster_assignments
   WHERE team_id = p_to_team_id AND league_id = p_league_id;

  IF (v_from_team_size - v_n_offered + v_n_requested) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for proposing team (% players)', v_max_roster_size;
  END IF;
  IF (v_to_team_size - v_n_requested + v_n_offered) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for accepting team (% players)', v_max_roster_size;
  END IF;

  FOREACH v_pid IN ARRAY COALESCE(p_offered_player_ids, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM roster_assignments
                    WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid) THEN
      RAISE EXCEPTION 'Offered player % is not on from-team roster', v_pid;
    END IF;
    UPDATE roster_assignments SET team_id = p_to_team_id, updated_at = v_now
     WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid;
    PERFORM public.trade_move_player_lineup(p_league_id, p_from_team_id, p_to_team_id, v_pid, v_now);
    v_offered_moved := v_offered_moved + 1;
  END LOOP;

  FOREACH v_pid IN ARRAY COALESCE(p_requested_player_ids, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM roster_assignments
                    WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid) THEN
      RAISE EXCEPTION 'Requested player % is not on to-team roster', v_pid;
    END IF;
    UPDATE roster_assignments SET team_id = p_from_team_id, updated_at = v_now
     WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid;
    PERFORM public.trade_move_player_lineup(p_league_id, p_to_team_id, p_from_team_id, v_pid, v_now);
    v_requested_moved := v_requested_moved + 1;
  END LOOP;

  INSERT INTO transaction_ledger (league_id, user_id, team_id, player_id, type, source, created_at)
  SELECT p_league_id, v_from_user, p_from_team_id, x, 'TRADE', 'Trade out', v_now
    FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_to_user, p_to_team_id, x, 'TRADE', 'Trade in', v_now
    FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_to_user, p_to_team_id, x, 'TRADE', 'Trade out', v_now
    FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_from_user, p_from_team_id, x, 'TRADE', 'Trade in', v_now
    FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x;

  INSERT INTO trade_history (league_id, trade_offer_id, team1_id, team2_id, team1_players, team2_players)
  VALUES (p_league_id, p_trade_id, p_from_team_id, p_to_team_id,
          ARRAY(SELECT x::int FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x),
          ARRAY(SELECT x::int FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x));

  RETURN jsonb_build_object('success', true,
    'offered_moved', v_offered_moved, 'requested_moved', v_requested_moved);

EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM public.log_function_error('execute_trade', SQLSTATE, SQLERRM, 'trade rolled back whole', jsonb_build_object('trade_id', p_trade_id, 'league_id', p_league_id, 'from_team_id', p_from_team_id, 'to_team_id', p_to_team_id)); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$;

REVOKE ALL ON FUNCTION public.execute_trade(uuid, uuid, uuid, uuid, text[], text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.execute_trade(uuid, uuid, uuid, uuid, text[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_trade(uuid, uuid, uuid, uuid, text[], text[]) TO service_role;

-- -- 3. Post-conditions: refuse to commit on drift -----------------------
DO $$
DECLARE v_body text;
BEGIN
  -- Comment-stripped: both new bodies quote the strings they are being checked
  -- for inside their own rationale comments.
  v_body := regexp_replace(
    pg_get_functiondef('public.submit_trade_vote(uuid,uuid,text)'::regprocedure), '--[^\n]*', '', 'g');
  IF v_body NOT LIKE '%You can only vote as a team you own%' THEN
    RAISE EXCEPTION 'submit_trade_vote is not checking team ownership';
  END IF;
  IF v_body NOT LIKE '%Voting team is not in this league%' THEN
    RAISE EXCEPTION 'submit_trade_vote is not checking league membership of the voting team';
  END IF;
  -- The authorization must precede the INSERT, or it guards nothing.
  IF position('You can only vote as a team you own' in v_body)
       > position('INSERT INTO trade_votes' in v_body) THEN
    RAISE EXCEPTION 'submit_trade_vote authorizes after it has already written the vote';
  END IF;

  v_body := regexp_replace(
    pg_get_functiondef('public.execute_trade(uuid,uuid,uuid,uuid,text[],text[])'::regprocedure), '--[^\n]*', '', 'g');
  IF v_body NOT LIKE '%l.commissioner_id = v_caller_uid%' THEN
    RAISE EXCEPTION 'execute_trade does not admit the league commissioner';
  END IF;
  -- The owner check must still be there: this migration widens the gate, it
  -- does not remove it.
  IF v_body NOT LIKE '%AND league_id = p_league_id AND owner_id = v_caller_uid%' THEN
    RAISE EXCEPTION 'execute_trade lost its team-owner check';
  END IF;
  IF v_body NOT LIKE '%IF v_caller_uid IS NOT NULL THEN%' THEN
    RAISE EXCEPTION 'execute_trade lost its caller gate entirely';
  END IF;
  -- And the commissioner allowance must be scoped to p_league_id.
  IF v_body NOT LIKE '%WHERE l.id = p_league_id AND l.commissioner_id = v_caller_uid%' THEN
    RAISE EXCEPTION 'execute_trade commissioner allowance is not scoped to p_league_id';
  END IF;

  RAISE NOTICE 'trade authorization tightened; submit_trade_vote md5 = %, execute_trade md5 = %',
    md5(pg_get_functiondef('public.submit_trade_vote(uuid,uuid,text)'::regprocedure)),
    md5(pg_get_functiondef('public.execute_trade(uuid,uuid,uuid,uuid,text[],text[])'::regprocedure));
END $$;

COMMIT;

-- ===========================================================================
-- [10/12] 20260904000000_nuclear_reset_draft_clears_v2_state.sql
-- ===========================================================================
-- ============================================================================
-- A draft reset has to actually reset a v2 draft
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-04):
--   supabase/migrations/captures/2026-09-04_pre_nuclear_reset_draft.sql
--     93fb6a0f3823af8cee6da82555f36480
--
-- (a) WHAT CHANGED
--   nuclear_reset_draft(uuid) additionally deletes draft_picks_v2,
--   draft_events, draft_snapshots and the three auction tables for the
--   league, and additionally resets leagues.draft_state to 'not_started' and
--   drops settings->'draftCompletedAt'. The commissioner gate, the signature,
--   the return type, SECURITY DEFINER, search_path and every existing DELETE
--   and UPDATE are unchanged.
--
-- (b) WHY NOW
--
--   DEFECT: v2 has no working reset at all, and the failure is silent.
--
--   The function as it stands deletes draft_picks, draft_order, team_lineups
--   and roster_assignments. Every one of those is right. The problem is what
--   it does not name.
--
--   Citrus moved to the v2 engine on 2026-08-18. Since then picks are written
--   to draft_picks_v2 and the authoritative log is draft_events;
--   draft_picks is EMPTY on every league drafted since. Measured on
--   production 2026-09-04:
--     league "Test at golf"   draft_picks_v2 = 252, draft_events = 254,
--                             draft_picks = 0, roster_assignments = 252
--   So the reset's only pick-deleting statement targets the one table that
--   holds nothing, and all 252 picks plus the full event log survive it.
--
--   What the commissioner is left with is worse than a no-op. The rosters and
--   lineups really are gone, and leagues.draft_status really is 'not_started'
--   -- but leagues.draft_state is still 'completed', so the league now
--   disagrees with itself, and the picks it would re-derive from are all
--   still sitting there.
--
--   The next roster sync then finishes the job. sync_roster_assignments_for_
--   league sees EXISTS(draft_picks_v2), takes the v2 branch, finds
--   existing_count = 0, concludes this is a first sync, and rebuilds every
--   roster row from draft_picks_v2.team_id -- the DRAFTING team. Any trade
--   executed since the draft is silently reversed, because execute_trade
--   moves roster_assignments and roster_assignments is exactly what was just
--   deleted and re-derived.
--
--   And there is no way back: no path anywhere in server/src deletes
--   draft_picks_v2 or draft_events (grep, 2026-09-04), so a league in this
--   state cannot be re-drafted by any code the product ships. The reset
--   button on Profile.tsx:1717 is, for a v2 league, a one-way door.
--
--   Test drafts with real managers begin 2026-09-08. A commissioner whose
--   test draft goes sideways will reach for exactly this button.
--
-- (c) WHY THESE SIX TABLES AND NOT OTHERS
--
--   draft_picks_v2, draft_events   the pick record and the log the engine
--                                  rebuilds its whole state from. Without
--                                  both, "reset" means nothing.
--   draft_snapshots                the engine's restore point (9 rows in
--                                  production). Left behind, a restart can
--                                  resurrect the draft the commissioner just
--                                  reset.
--   auction_nominations,           an auction league re-drafting with stale
--   auction_bids,                  nominations, live bids or spent budgets is
--   auction_budgets                not re-drafting. draft_started re-seeds
--                                  budgets via
--                                  tg_draft_events_seed_auction_budgets, so
--                                  clearing them is the correct half of that
--                                  round trip.
--
--   Deliberately NOT deleted:
--   draft_queues                   a manager's own pre-draft prep. It is not
--                                  draft state and it is the thing they would
--                                  most want to keep for the re-draft.
--   draft_metrics_*                telemetry history, partitioned by month.
--                                  Deleting it destroys analytics and buys
--                                  the reset nothing.
--
--   Every trigger on draft_events is AFTER INSERT (verified on prod
--   2026-09-04: draft_events_notify_after_insert, draft_events_project_pick_
--   trg, draft_events_seed_auction_budgets_trg, draft_events_sync_roster_trg),
--   so deleting rows fires nothing. leagues.draft_state is plain text with no
--   constraint; draft_status is the draft_status enum and 'not_started' is a
--   member of it.
--
-- (d) WHO CAN RUN IT
--   Unchanged: the league commissioner, and only him. The gate is the first
--   statement and it still raises before any DELETE.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.nuclear_reset_draft(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id UUID;
BEGIN
  SELECT commissioner_id INTO v_commissioner_id
  FROM public.leagues
  WHERE id = p_league_id;

  IF v_commissioner_id IS NULL OR v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can reset the draft';
  END IF;

  -- The pick record, both generations. draft_picks is the pre-2026-08-18
  -- table and is empty on every modern league; draft_picks_v2 is the live one.
  DELETE FROM public.draft_picks WHERE league_id = p_league_id;
  DELETE FROM public.draft_picks_v2 WHERE league_id = p_league_id;

  -- The log the engine rebuilds its entire state from, and the snapshot it
  -- restores from on restart. Leaving either behind means the draft comes
  -- back.
  DELETE FROM public.draft_events WHERE league_id = p_league_id;
  DELETE FROM public.draft_snapshots WHERE league_id = p_league_id;

  DELETE FROM public.draft_order WHERE league_id = p_league_id;

  -- Auction state. Budgets are re-seeded from the next 'draft_started' event
  -- by tg_draft_events_seed_auction_budgets, so clearing them here is the
  -- other half of that round trip, not a loss.
  DELETE FROM public.auction_bids WHERE league_id = p_league_id;
  DELETE FROM public.auction_nominations WHERE league_id = p_league_id;
  DELETE FROM public.auction_budgets WHERE league_id = p_league_id;

  DELETE FROM public.team_lineups
    WHERE team_id IN (SELECT id FROM public.teams WHERE league_id = p_league_id);
  DELETE FROM public.roster_assignments WHERE league_id = p_league_id;

  UPDATE public.leagues
  SET draft_status = 'not_started',
      -- draft_state was left reading 'completed' next to a 'not_started'
      -- draft_status, so the league disagreed with itself after every reset.
      draft_state = 'not_started',
      scheduled_draft_time = NULL,
      settings = jsonb_set(
        -- A stale draftCompletedAt anchors week-1 math to a draft that no
        -- longer exists.
        COALESCE(settings, '{}'::jsonb) - 'draftCompletedAt',
        '{timerStartedAt}', 'null'::jsonb)
  WHERE id = p_league_id;
END;
$function$;

-- ── Guard: the migration is only correct if all of this is true afterwards ──
DO $$
DECLARE
  v_body text;
  v_tbl  text;
BEGIN
  v_body := pg_get_functiondef('public.nuclear_reset_draft(uuid)'::regprocedure);

  -- Every table the reset must now clear.
  FOREACH v_tbl IN ARRAY ARRAY[
    'draft_picks', 'draft_picks_v2', 'draft_events', 'draft_snapshots',
    'draft_order', 'auction_bids', 'auction_nominations', 'auction_budgets',
    'team_lineups', 'roster_assignments'
  ] LOOP
    IF v_body NOT LIKE '%DELETE FROM public.' || v_tbl || '%' THEN
      RAISE EXCEPTION 'nuclear_reset_draft no longer clears %', v_tbl;
    END IF;
  END LOOP;

  -- The two league columns must be reset together, or the league disagrees
  -- with itself exactly the way it did before this migration.
  IF v_body NOT LIKE '%draft_status = ''not_started''%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft lost its draft_status reset';
  END IF;
  IF v_body NOT LIKE '%draft_state = ''not_started''%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft does not reset draft_state';
  END IF;
  IF v_body NOT LIKE '%- ''draftCompletedAt''%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft leaves a stale draftCompletedAt behind';
  END IF;

  -- The commissioner gate must survive, and must still precede every DELETE.
  IF v_body NOT LIKE '%Only the commissioner can reset the draft%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft lost its commissioner gate';
  END IF;
  IF position('Only the commissioner can reset the draft' in v_body)
       > position('DELETE FROM public.draft_picks' in v_body) THEN
    RAISE EXCEPTION 'nuclear_reset_draft deletes before it authorizes';
  END IF;

  -- A manager's own draft queue is prep, not draft state. If a future edit
  -- starts deleting it, that is a product decision and should not arrive by
  -- accident.
  IF v_body LIKE '%DELETE FROM public.draft_queues%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft now destroys draft queues; that is a product decision, not a reset';
  END IF;

  RAISE NOTICE 'nuclear_reset_draft md5 = %', md5(v_body);
END $$;

COMMIT;

-- ===========================================================================
-- [11/12] 20260904001000_make_draft_pick_team_ownership.sql
-- ===========================================================================
-- ============================================================================
-- You may pick for your own team, not for everyone else's
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-04):
--   supabase/migrations/captures/2026-09-04_pre_make_draft_pick.sql
--     a8a9e137445268ac3d5cffb2cc75561d
--
-- (a) WHAT CHANGED
--   make_draft_pick(...) now requires p_team_id to belong to p_league_id, and
--   requires the caller to be either the league commissioner or the owner of
--   that specific team. The signature, return type, SECURITY DEFINER,
--   search_path, grants, both duplicate checks, the soft-deleted cleanup and
--   the INSERT are all unchanged.
--
-- (b) WHY NOW
--
--   DEFECT: the authorization check was never correlated to the team being
--   picked for.
--
--   The gate read:
--     commissioner_id = auth.uid()
--     OR EXISTS (SELECT 1 FROM public.teams
--                WHERE teams.league_id = p_league_id
--                  AND teams.owner_id = auth.uid())
--   The subquery asks "does this caller own SOME team in this league". It is
--   never joined to p_team_id. So any member of a league could file a pick
--   assigning any player to any other manager's team, in any round, at any
--   pick number -- and p_team_id was never even checked against p_league_id,
--   so the team did not have to be in the league at all.
--
--   Because the function is SECURITY DEFINER, the policy that gets this right
--   never runs. On production 2026-09-04, draft_picks carries policy
--   "Team owners can make picks", whose WITH CHECK does correlate
--   teams.id = draft_picks.team_id. SECURITY DEFINER executes the INSERT as
--   the function owner, so that policy is bypassed by construction.
--
--   server/src/routes/draft.ts:148-163 already blocks this at the route, and
--   its comment names this exact RPC weakness. That check is real but it is
--   advisory: the RPC is reachable directly from any client holding the anon
--   key, and the anon key ships inside the iOS bundle. The fix belongs in the
--   function, where it cannot be routed around.
--
--   The v2 engine path is not affected and was never wrong: submit_pick_v2
--   checks v_team_owner IS DISTINCT FROM auth.uid() before it writes. This
--   migration brings the v1 RPC up to that standard.
--
--   Test drafts with real managers begin 2026-09-08.
--
-- (c) WHAT DOES NOT CHANGE
--   A service-role caller (auth.uid() IS NULL) was already refused by the old
--   gate -- both branches compare against auth.uid() -- and is still refused.
--   No engine or scheduled job calls this function; the only caller in the
--   tree is DraftService.makePick, which uses the requesting user's own
--   client. Nothing in the codebase matches on the old exception text
--   (grep, 2026-09-04).
--
--   The commissioner keeps the ability to pick on behalf of a manager, which
--   is a real commissioner power during a live draft. He is now held to the
--   same league-scope rule as everyone else: the team must be in his league.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.make_draft_pick(p_league_id uuid, p_team_id uuid, p_player_id text, p_round_number integer, p_pick_number integer, p_draft_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pick_id UUID;
  v_is_member BOOLEAN;
BEGIN
  -- The team has to be in the league, whoever is asking. The previous body
  -- never related p_team_id to p_league_id at all.
  IF NOT EXISTS (
    SELECT 1 FROM public.teams
    WHERE teams.id = p_team_id
    AND teams.league_id = p_league_id
  ) THEN
    RAISE EXCEPTION 'That team is not in this league';
  END IF;

  -- The commissioner may pick on behalf of any team in his league; everyone
  -- else may pick only for the team they own. The second EXISTS is correlated
  -- to p_team_id, which is the whole point of this migration.
  SELECT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
    AND commissioner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.teams
    WHERE teams.id = p_team_id
    AND teams.owner_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Not authorized to make picks for this team';
  END IF;

  -- Check if player already drafted in THIS SESSION (active picks only)
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
    AND draft_session_id = p_draft_session_id
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

  -- Clean up stale soft-deleted picks from THIS SESSION ONLY
  -- (Don't delete picks from other sessions - they're historical data)
  DELETE FROM public.draft_picks
  WHERE league_id = p_league_id
  AND draft_session_id = p_draft_session_id
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
$function$;

-- ── Guard: the migration is only correct if all of this is true afterwards ──
DO $$
DECLARE
  v_body text;
BEGIN
  v_body := pg_get_functiondef('public.make_draft_pick(uuid,uuid,text,integer,integer,uuid)'::regprocedure);

  -- The ownership EXISTS must be correlated to the team being picked for.
  -- This is the defect, stated as a contract.
  IF v_body NOT LIKE '%WHERE teams.id = p_team_id%AND teams.owner_id = auth.uid()%' THEN
    RAISE EXCEPTION 'make_draft_pick does not tie team ownership to p_team_id';
  END IF;

  -- The old uncorrelated form must be gone, not merely joined by a better one.
  IF v_body LIKE '%WHERE teams.league_id = p_league_id%AND teams.owner_id = auth.uid()%' THEN
    RAISE EXCEPTION 'make_draft_pick still carries the uncorrelated ownership check';
  END IF;

  IF v_body NOT LIKE '%That team is not in this league%' THEN
    RAISE EXCEPTION 'make_draft_pick lost its league-scope check on p_team_id';
  END IF;

  -- Authorization must precede the INSERT, or it guards nothing.
  IF position('Not authorized to make picks for this team' in v_body)
       > position('INSERT INTO public.draft_picks' in v_body) THEN
    RAISE EXCEPTION 'make_draft_pick authorizes after it has already written the pick';
  END IF;

  -- The commissioner allowance must stay scoped to p_league_id.
  IF v_body NOT LIKE '%FROM public.leagues%WHERE id = p_league_id%AND commissioner_id = auth.uid()%' THEN
    RAISE EXCEPTION 'make_draft_pick commissioner allowance is not scoped to p_league_id';
  END IF;

  -- Everything the migration promised not to touch.
  IF v_body NOT LIKE '%Player already drafted in this session%'
     OR v_body NOT LIKE '%This pick number is already taken in this session%'
     OR v_body NOT LIKE '%deleted_at IS NOT NULL%' THEN
    RAISE EXCEPTION 'make_draft_pick lost one of its pre-existing checks';
  END IF;

  RAISE NOTICE 'make_draft_pick md5 = %', md5(v_body);
END $$;

COMMIT;

-- ===========================================================================
-- [12/12] 20260904002000_get_matchup_stats_filters_by_player.sql
-- ===========================================================================
-- ============================================================================
-- The matchup page's slowest query stops reading the whole league
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-04):
--   supabase/migrations/captures/2026-09-04_pre_get_matchup_stats.sql
--     db5f7c1da98dc3beea83a39b0ccb22aa
--
-- (a) WHAT CHANGED
--   Two WHERE clauses, and nothing else in the entire function.
--     week_rows   gains  WHERE pgs.player_id = ANY(p_player_ids)
--     week_shots  gains  WHERE s.shooter_id = ANY(p_player_ids)
--   The signature, the return table, LANGUAGE sql, STABLE, SECURITY DEFINER,
--   search_path, all seventeen SUM(CASE ...) aggregates, the xg rollup and the
--   final LEFT JOIN are byte-identical to the capture. This migration file was
--   GENERATED from that capture by string substitution rather than retyped,
--   which is the only way to be certain of that.
--
-- (b) WHY NOW
--
--   This is the slowest thing on the matchup page's critical path, and the
--   function was reading the whole league to answer a question about forty
--   players.
--
--   Measured on production 2026-09-04, pg_stat_statements, PostgREST-served:
--     get_matchup_stats            13 calls   mean  961.7 ms   max 6446.6 ms
--     update_all_matchup_scores   956 calls   mean   17.0 ms   max 1349.3 ms
--     get_daily_projections       355 calls   mean    2.2 ms
--
--   It is awaited inside the four-way Promise.all in
--   apps/web/src/services/MatchupService.ts fetchMatchupStatsForPlayers, so it
--   is the long pole: no player row can paint its week totals until it
--   returns.
--
--   The cause is not a missing index. Both MATERIALIZED CTEs ignored
--   p_player_ids entirely and aggregated every row in the date window for
--   every player in the NHL; only the final LEFT JOIN against player_list
--   narrowed the result. So the answer was always right and the work was
--   always ~20x too large.
--
--   EXPLAIN (ANALYZE, BUFFERS) on production, 40 real roster player ids, one
--   week (2026-03-29..04-04):
--     as shipped, warm     week_rows 2200 rows, week_shots 4699 rows
--                          7653 buffers hit                 29.1 ms
--     with the filters     week_rows  115 rows, week_shots  284 rows
--                          4717 buffers hit                  7.0 ms
--   19x fewer stat rows and 16x fewer shot rows materialized.
--
--   week_rows also selects pgs.* - all 68 columns of player_game_stats, a
--   459 MB table - while window_stats reads 27 of them. Narrowing that would
--   shrink the materialized tuple further and is deliberately NOT done here:
--   naming 27 columns by hand is a chance to drop one silently, and with the
--   row count down 19x the remaining win is small. Left as a note, not a
--   change.
--
-- (c) WHY THIS IS SAFE
--
--   The two filters are provably output-preserving, not merely tested to be.
--   Every consumer of week_rows is window_stats, which GROUPs BY
--   wr.player_id; every consumer of week_shots is xg, which GROUPs BY
--   shooter_id. Both aggregates are then joined to player_list - the unnest
--   of p_player_ids - by a LEFT JOIN on that same id. A group whose id is not
--   in p_player_ids therefore has no row in player_list to join to and was
--   already discarded. Removing those rows earlier cannot change a single
--   output cell; it only stops computing sums nobody reads.
--
--   Checked empirically as well as argued: the proof script compares the OLD
--   and NEW functions cell for cell over the same fixture, including the
--   awkward inputs (empty array, ids with no rows at all, ids whose rows are
--   entirely outside the date window, goalies and skaters mixed, NULL xg).
--
--   Production spot check, 40 players, goals/assists/saves/x_goals:
--   0 mismatches.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_matchup_stats(p_player_ids integer[], p_start_date date, p_end_date date)
 RETURNS TABLE(player_id integer, goals bigint, assists bigint, points bigint, shots_on_goal bigint, hits bigint, blocks bigint, pim bigint, ppp bigint, shp bigint, plus_minus bigint, goalie_gp bigint, wins bigint, saves bigint, goals_against bigint, shots_faced bigint, shutouts bigint, x_goals numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH player_list AS (SELECT unnest(p_player_ids) AS player_id),
  filtered_games AS MATERIALIZED (
    SELECT game_id FROM public.nhl_games
     WHERE game_date >= p_start_date AND game_date <= p_end_date AND game_type = 'regular'
  ),
  week_rows AS MATERIALIZED (
    SELECT pgs.* FROM public.player_game_stats pgs
    JOIN filtered_games ng ON pgs.game_id = ng.game_id
    WHERE pgs.player_id = ANY(p_player_ids)
  ),
  window_stats AS (
    SELECT wr.player_id,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_goals, 0) ELSE 0 END)::bigint AS goals,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_assists, 0) ELSE 0 END)::bigint AS assists,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_points, 0) ELSE 0 END)::bigint AS points,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_shots_on_goal, 0) ELSE 0 END)::bigint AS shots_on_goal,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_hits, 0) ELSE 0 END)::bigint AS hits,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_blocks, 0) ELSE 0 END)::bigint AS blocks,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_pim, 0) ELSE 0 END)::bigint AS pim,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(NULLIF(wr.nhl_ppp, 0), (COALESCE(wr.nhl_ppg, 0) + COALESCE(wr.nhl_ppa, 0))) ELSE 0 END)::bigint AS ppp,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(NULLIF(wr.nhl_shp, 0), (COALESCE(wr.nhl_shg, 0) + COALESCE(wr.nhl_sha, 0))) ELSE 0 END)::bigint AS shp,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_plus_minus, 0) ELSE 0 END)::bigint AS plus_minus,
      SUM(CASE WHEN wr.is_goalie = true THEN wr.goalie_gp ELSE 0 END)::bigint AS goalie_gp,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_wins, 0), wr.wins, 0) ELSE 0 END)::bigint AS wins,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_saves, 0), wr.saves, 0) ELSE 0 END)::bigint AS saves,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_goals_against, 0), wr.goals_against, 0) ELSE 0 END)::bigint AS goals_against,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_shots_faced, 0), wr.shots_faced, 0) ELSE 0 END)::bigint AS shots_faced,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_shutouts, 0), wr.shutouts, 0) ELSE 0 END)::bigint AS shutouts
    FROM week_rows wr
    GROUP BY wr.player_id
  ),
  week_shots AS MATERIALIZED (
    SELECT s.shooter_id, s.xg_sql FROM public.nhl_shots s
    JOIN filtered_games ng ON s.game_id = ng.game_id
    WHERE s.shooter_id = ANY(p_player_ids)
  ),
  xg AS (
    SELECT ws.shooter_id AS player_id, SUM(ws.xg_sql)::numeric AS x_goals
    FROM week_shots ws GROUP BY ws.shooter_id
  )
  SELECT pl.player_id,
    COALESCE(ws.goals, 0)::bigint, COALESCE(ws.assists, 0)::bigint, COALESCE(ws.points, 0)::bigint,
    COALESCE(ws.shots_on_goal, 0)::bigint, COALESCE(ws.hits, 0)::bigint, COALESCE(ws.blocks, 0)::bigint,
    COALESCE(ws.pim, 0)::bigint, COALESCE(ws.ppp, 0)::bigint, COALESCE(ws.shp, 0)::bigint,
    COALESCE(ws.plus_minus, 0)::bigint, COALESCE(ws.goalie_gp, 0)::bigint, COALESCE(ws.wins, 0)::bigint,
    COALESCE(ws.saves, 0)::bigint, COALESCE(ws.goals_against, 0)::bigint, COALESCE(ws.shots_faced, 0)::bigint,
    COALESCE(ws.shutouts, 0)::bigint, COALESCE(x.x_goals, 0)::numeric
  FROM player_list pl
  LEFT JOIN window_stats ws ON ws.player_id = pl.player_id
  LEFT JOIN xg x ON x.player_id = pl.player_id;
$function$;

-- Guard: the migration is only correct if all of this is true afterwards.
DO $$
DECLARE
  v_body text;
BEGIN
  v_body := pg_get_functiondef('public.get_matchup_stats(integer[],date,date)'::regprocedure);

  -- The two filters this migration exists to add.
  IF v_body NOT LIKE '%WHERE pgs.player_id = ANY(p_player_ids)%' THEN
    RAISE EXCEPTION 'get_matchup_stats still reads every player''s game rows';
  END IF;
  IF v_body NOT LIKE '%WHERE s.shooter_id = ANY(p_player_ids)%' THEN
    RAISE EXCEPTION 'get_matchup_stats still reads every player''s shots';
  END IF;

  -- Both must stay MATERIALIZED. Without the fence the planner may inline
  -- them, and the whole reason these are CTEs is that the aggregate is
  -- computed once rather than per output row.
  IF v_body NOT LIKE '%week_rows AS MATERIALIZED%'
     OR v_body NOT LIKE '%week_shots AS MATERIALIZED%' THEN
    RAISE EXCEPTION 'get_matchup_stats lost a MATERIALIZED fence';
  END IF;

  -- The properties the callers depend on.
  IF v_body NOT LIKE '%LANGUAGE sql%'
     OR v_body NOT LIKE '%STABLE SECURITY DEFINER%'
     OR v_body NOT LIKE '%SET search_path TO ''public''%' THEN
    RAISE EXCEPTION 'get_matchup_stats changed language, volatility or search_path';
  END IF;

  -- A sample of the arithmetic that must NOT have changed. These three are
  -- the awkward ones: two COALESCE(NULLIF(...)) fallbacks and the goalie
  -- games-played sum that deliberately does not COALESCE.
  IF v_body NOT LIKE '%COALESCE(NULLIF(wr.nhl_ppp, 0), (COALESCE(wr.nhl_ppg, 0) + COALESCE(wr.nhl_ppa, 0)))%' THEN
    RAISE EXCEPTION 'get_matchup_stats lost the powerplay-points fallback';
  END IF;
  IF v_body NOT LIKE '%COALESCE(NULLIF(wr.nhl_shp, 0), (COALESCE(wr.nhl_shg, 0) + COALESCE(wr.nhl_sha, 0)))%' THEN
    RAISE EXCEPTION 'get_matchup_stats lost the shorthanded-points fallback';
  END IF;
  IF v_body NOT LIKE '%SUM(CASE WHEN wr.is_goalie = true THEN wr.goalie_gp ELSE 0 END)%' THEN
    RAISE EXCEPTION 'get_matchup_stats lost the goalie games-played sum';
  END IF;

  -- The result is still assembled from player_list, which is what makes the
  -- new filters output-preserving in the first place.
  IF v_body NOT LIKE '%FROM player_list pl%'
     OR v_body NOT LIKE '%LEFT JOIN window_stats ws ON ws.player_id = pl.player_id%'
     OR v_body NOT LIKE '%LEFT JOIN xg x ON x.player_id = pl.player_id%' THEN
    RAISE EXCEPTION 'get_matchup_stats no longer projects through player_list';
  END IF;

  RAISE NOTICE 'get_matchup_stats md5 = %', md5(v_body);
END $$;

COMMIT;


-- ============================================================================
-- VERIFICATION — run this AFTER the script above finishes.
-- Every row should read APPLIED. Anything reading NOT APPLIED did not take.
-- ============================================================================
SELECT check_name, CASE WHEN ok THEN 'APPLIED' ELSE 'NOT APPLIED' END AS status
FROM (
  SELECT 'auction: single-bid lot is sold, not no-sale' AS check_name,
         pg_get_functiondef('public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid)'::regprocedure)
           LIKE '%v_no_sale := v_winner_team_id IS NULL%' AS ok
  UNION ALL SELECT 'auction: cancelled is a legal status',
         pg_get_constraintdef(oid) LIKE '%cancelled%'
    FROM pg_constraint WHERE conrelid='public.auction_nominations'::regclass AND conname='auction_nominations_status_check'
  UNION ALL SELECT 'reset draft clears v2 state',
         pg_get_functiondef('public.nuclear_reset_draft(uuid)'::regprocedure) LIKE '%draft_picks_v2%'
  UNION ALL SELECT 'pick authorization is tied to the team',
         pg_get_functiondef('public.make_draft_pick(uuid,uuid,text,integer,integer,uuid)'::regprocedure)
           LIKE '%WHERE teams.id = p_team_id%'
  UNION ALL SELECT 'matchup stats filters by player',
         pg_get_functiondef('public.get_matchup_stats(integer[],date,date)'::regprocedure)
           LIKE '%WHERE pgs.player_id = ANY(p_player_ids)%'
  UNION ALL SELECT 'waiver gate: per-league overload exists',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='should_process_waivers_now'
                   AND pg_get_function_identity_arguments(p.oid) = 'p_league_id uuid')
  UNION ALL SELECT 'trade votes are tied to the voter',
         pg_get_functiondef('public.submit_trade_vote(uuid,uuid,text)'::regprocedure) LIKE '%auth.uid()%'
) t ORDER BY check_name;
