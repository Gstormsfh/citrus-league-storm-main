-- 0D-SEC-3b: Close the seven RLS-disabled public tables to end-user roles.
--
-- APPLIED: prod 20260804005912 / staging (same name). Authoritative record of what is live.
--
-- Clears 8 of the 9 ERROR-level Supabase security advisories:
--   rls_disabled_in_public x7 and policy_exists_rls_disabled x1.
--   (The 9th, security_definer_view on current_rosters, was fixed in 20260803170351.)
--
-- WHY THIS SHAPE, and why NOT a public-read policy:
--   A repo-wide census established that every RUNTIME reader of these tables is either the
--   Python data-pipeline (service_role) or an operator CLI script:
--       team_stats        <- data-pipeline/projections/nightly_projection_batch.py:246 (read)
--                            data-pipeline/acquisition/populate_team_stats.py:175      (write)
--       raw_player_stats  <- data-pipeline/acquisition/data_acquisition.py:4302,4324
--       players           <- scripts/_deprecated/*, scripts/populate-nhl-teams-*.ts (operator)
--       staging_202[45]_* <- scripts/verify-staging-tables.ts (operator) and docs only
--   ZERO reads from apps/web (the browser bundle), ZERO from the Hono server, ZERO from
--   edge functions. So these need no anon/authenticated access at all, and giving them a
--   cosmetic USING (true) policy would preserve exposure for no consumer.
--
-- WHY REVOKE **AND** ENABLE RLS (both, not either):
--   Enabling RLS on a table with no SELECT policy does not error -- it silently returns
--   zero rows. If this census has missed a reader, a silent empty set is the worst possible
--   failure: no exception, no log, just data quietly gone. REVOKE makes that same mistake
--   fail LOUDLY with 42501 permission denied, which is diagnosable. RLS is then kept as
--   defense in depth in case a grant is ever restored by a future migration.
--   Note `players` is the sharp case: it had INSERT and UPDATE policies but NO SELECT
--   policy while RLS was disabled, so enabling RLS alone would have blanked every player
--   read in the app with no error at all.
--
-- WHY THIS CANNOT BREAK THE PIPELINE (verified, not assumed):
--   pg_roles shows service_role and postgres both have rolbypassrls = true, while anon and
--   authenticated have rolbypassrls = false. RLS therefore never filters the pipeline or
--   the pg_cron jobs. Confirmed empirically on staging: for every table, SET ROLE
--   service_role returned the same count as the owner after the change.
--
-- ALSO REVOKED: the MAINTAIN privilege. On PostgreSQL 17 the prior ACL was anon=rm and
--   authenticated=rm -- r = SELECT, m = MAINTAIN. MAINTAIN lets a role run VACUUM / ANALYZE
--   / REINDEX / CLUSTER, so any logged-in user could have triggered expensive maintenance
--   on a million-row table. REVOKE ALL removes it.
--
-- EXPECTED AFTER: these tables will raise the INFO-level advisory rls_enabled_no_policy.
--   That is correct and intended for service-role-only tables -- no policy is the point.
--
-- VERIFIED ON PROD AFTER APPLY: every table returns 42501 to anon, while service_role reads
--   full counts (players 801, raw_player_stats 15801, team_stats 32, staging_2024_skaters
--   4600, staging_2025_skaters 3945, staging_2024_goalies 515, staging_2025_goalies 390).

DO $mig$
DECLARE
  v_tabs text[] := ARRAY['players','raw_player_stats','team_stats',
                         'staging_2024_skaters','staging_2025_skaters',
                         'staging_2024_goalies','staging_2025_goalies'];
  t text; v_oid oid; v_bad int := 0; v_owner bigint; v_svc bigint;
BEGIN
  FOREACH t IN ARRAY v_tabs LOOP
    v_oid := to_regclass('public.'||t);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  -- GATE 1: no end-user SELECT (and no MAINTAIN) survives.
  FOREACH t IN ARRAY v_tabs LOOP
    v_oid := to_regclass('public.'||t);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    IF has_table_privilege('anon', v_oid,'SELECT')
       OR has_table_privilege('authenticated', v_oid,'SELECT')
       OR has_table_privilege('anon', v_oid,'MAINTAIN')
       OR has_table_privilege('authenticated', v_oid,'MAINTAIN') THEN
      v_bad := v_bad + 1;
    END IF;
  END LOOP;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE1 FAIL: % tables still end-user accessible', v_bad; END IF;

  -- GATE 2: RLS actually on.
  v_bad := 0;
  FOREACH t IN ARRAY v_tabs LOOP
    v_oid := to_regclass('public.'||t);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=v_oid) THEN v_bad := v_bad + 1; END IF;
  END LOOP;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE2 FAIL: RLS not enabled on % tables', v_bad; END IF;

  -- GATE 3: service_role still sees every row. This is the data-pipeline test.
  FOREACH t IN ARRAY v_tabs LOOP
    v_oid := to_regclass('public.'||t);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_owner;
    SET ROLE service_role;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_svc;
    RESET ROLE;
    IF v_svc <> v_owner THEN
      RAISE EXCEPTION 'GATE3 FAIL: % owner=% service_role=%', t, v_owner, v_svc;
    END IF;
  END LOOP;

  RAISE NOTICE '0D-SEC-3b OK: 7 tables revoked + RLS enabled, service_role reads intact';
END
$mig$;
