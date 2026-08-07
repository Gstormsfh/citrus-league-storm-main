-- 0D-SEC-2f: Lock cron-only waiver orchestrators to service_role, drop dead roster functions.
--
-- APPLIED: prod 20260801064252 / staging (same name, same body).
-- This file is the authoritative record of what is already live in both databases.
--
-- WHY (verified, not assumed):
--   process_all_pending_waivers() was executable by ANY authenticated user. It loops over
--   EVERY league platform-wide with pending claims and, per claim, calls
--   process_roster_move(league, <team owner's id>, ...). process_roster_move's guard is
--       IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RETURN <error> END IF;
--   so for any team the *caller* does not own it returns success=false, and
--   process_waiver_claims' ELSE branch then does
--       UPDATE waiver_claims SET status='failed', failure_reason=..., processed_at=NOW()
--   Net: one RPC from any free signup permanently failed every pending waiver claim in
--   every league on the platform. Destructive and irreversible.
--
--   That same guard is load-bearing for pg_cron: job 'process-pending-waivers' (0 3 * * *)
--   runs as postgres with no JWT, so auth.uid() IS NULL and the guard is bypassed -- which
--   is the ONLY reason nightly waiver processing works. Correcting the guard alone would
--   have silently killed waiver processing at 03:00, invisible until the season starts.
--   The orchestrators are locked down instead.
--
-- SAFE BECAUSE (repo-wide git grep evidence):
--   process_all_pending_waivers     - zero callers in server/. Frontend posts to
--                                     /api/waivers/process-all, a route that DOES NOT
--                                     EXIST (404). Production invocation is pg_cron only.
--   process_waiver_claims           - zero runtime .rpc() callers; SQL-internal only.
--   process_all_faab_waivers        - zero runtime callers; no cron job registered either.
--   process_faab_waivers_for_league - zero runtime callers; SQL-internal only.
--   Cron calls these as postgres (function owner), not subject to the EXECUTE check, so
--   revoking anon/authenticated cannot break the nightly chain. Verified on BOTH databases
--   by running process_all_pending_waivers() to completion inside a rolled-back
--   transaction post-migration: CRON_CHAIN_OK.
--
--   process_roster_move KEEPS authenticated EXECUTE: server/src/services/WaiverService.ts
--   :803 and :823 call it via createUserClient() (anon key + forwarded user JWT => role
--   authenticated, auth.uid() populated and equal to p_user_id).
--
-- DROPPED (dead, zero runtime callers, zero SQL callers, both verified):
--   handle_roster_transaction  - writes to public.roster_transactions, which does not exist
--                                in this database. Repo migration 20260307000002 already
--                                drops it as dead; that migration is absent from this
--                                database's history (drift).
--   process_roster_moves_batch - defined and search_path-hardened but never invoked.

DO $mig$
DECLARE
  v_lock text[] := ARRAY[
    'public.process_all_pending_waivers()',
    'public.process_waiver_claims(uuid)',
    'public.process_all_faab_waivers()',
    'public.process_faab_waivers_for_league(uuid)'
  ];
  v_drop text[] := ARRAY[
    'public.handle_roster_transaction(uuid,uuid,text,text,text)',
    'public.process_roster_moves_batch(jsonb)'
  ];
  s text; v_bad int := 0; v_oid oid;
BEGIN
  FOREACH s IN ARRAY v_lock LOOP
    v_oid := to_regprocedure(s);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', s);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', s);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', s);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', s);
  END LOOP;

  FOREACH s IN ARRAY v_drop LOOP
    IF to_regprocedure(s) IS NOT NULL THEN EXECUTE format('DROP FUNCTION %s', s); END IF;
  END LOOP;

  FOREACH s IN ARRAY v_lock LOOP
    v_oid := to_regprocedure(s);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    IF has_function_privilege('anon', v_oid,'EXECUTE')
       OR has_function_privilege('authenticated', v_oid,'EXECUTE') THEN v_bad := v_bad + 1; END IF;
  END LOOP;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE A FAIL: % orchestrators still end-user executable', v_bad; END IF;

  v_bad := 0;
  FOREACH s IN ARRAY v_lock LOOP
    v_oid := to_regprocedure(s);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    IF NOT has_function_privilege('service_role', v_oid,'EXECUTE') THEN v_bad := v_bad + 1; END IF;
  END LOOP;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE B FAIL: service_role lost on % orchestrators', v_bad; END IF;

  FOREACH s IN ARRAY v_drop LOOP
    IF to_regprocedure(s) IS NOT NULL THEN RAISE EXCEPTION 'GATE C FAIL: % still exists', s; END IF;
  END LOOP;

  IF to_regprocedure('public.process_roster_move(uuid,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'GATE D FAIL: process_roster_move missing';
  END IF;

  RAISE NOTICE '0D-SEC-2f OK';
END
$mig$;
