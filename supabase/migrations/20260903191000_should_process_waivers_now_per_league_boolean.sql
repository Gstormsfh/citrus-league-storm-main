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
