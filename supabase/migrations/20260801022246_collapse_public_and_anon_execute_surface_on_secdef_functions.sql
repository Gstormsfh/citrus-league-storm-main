-- 0D-SEC-2a: Collapse the PUBLIC + anon EXECUTE surface on public SECURITY DEFINER functions.
--
-- APPLIED: prod 20260801022246 / staging 20260801022329 (identical body).
-- This file is the authoritative record of what is already live in both databases.
--
-- Two facts established empirically on staging before writing this (do not "optimise" them away):
--
--   1. RLS policy expressions DO enforce EXECUTE on functions they call, and do NOT
--      short-circuit. A probe table with a permissive policy that matched a row STILL
--      failed with 42501 because a *sibling* permissive policy called a function the
--      role could not execute. Therefore any SECURITY DEFINER function referenced by a
--      policy applying to PUBLIC/anon MUST retain anon EXECUTE or anonymous reads break.
--      On this database that is exactly:
--          is_commissioner_of_league(uuid)        -- teams, keeper_designations,
--                                                 -- player_autopick_rankings, trade_votes
--          user_owns_team_in_league_simple(uuid)  -- leagues (league_select_team_owner)
--      Both derive identity from auth.uid() internally and take no identity parameter,
--      so anon EXECUTE on them is not an impersonation vector.
--
--   2. Trigger functions do NOT require EXECUTE at fire time (checked only at CREATE
--      TRIGGER). A probe trigger stamped its row while anon held zero EXECUTE. Trigger
--      functions also cannot be called directly (they return `trigger`), so EXECUTE
--      grants on them are pure attack surface and are removed.
--
-- The keep-anon set is DERIVED from pg_policy dependencies, not hardcoded, so it stays
-- correct as policies change and is identical across prod and staging.
--
-- authenticated and service_role effective privileges are preserved exactly (except
-- authenticated on trigger functions). Note that REVOKE ... FROM PUBLIC removes access
-- for roles that only reached the function via PUBLIC, so the snapshot is taken first
-- and those grants are explicitly re-issued.
--
-- Result: prod anon-executable SECURITY DEFINER functions 77 -> 2, PUBLIC grants 70 -> 0.
--         staging 97 -> 2, PUBLIC grants 90 -> 0.

DO $mig$
DECLARE
  r record; v_keep oid[]; v_bad int; v_anon int; v_pub int; v_expect int;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT d.refobjid),'{}'::oid[]) INTO v_keep
  FROM pg_policy pol
  JOIN pg_depend d ON d.objid=pol.oid AND d.classid='pg_policy'::regclass AND d.refclassid='pg_proc'::regclass
  JOIN pg_proc p ON p.oid=d.refobjid
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND (pol.polroles='{0}'::oid[] OR 'anon'::regrole = ANY(pol.polroles));
  v_expect := COALESCE(array_length(v_keep,1),0);

  CREATE TEMP TABLE _acl_snap ON COMMIT DROP AS
  SELECT p.oid, p.oid::regprocedure::text AS sig,
         (p.prorettype='trigger'::regtype) AS is_trigger,
         has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_x,
         has_function_privilege('service_role',p.oid,'EXECUTE')  AS svc_x
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef;

  FOR r IN SELECT * FROM _acl_snap LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    IF r.oid = ANY(v_keep) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    END IF;
    IF r.is_trigger THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    ELSIF r.auth_x THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    IF r.svc_x THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_bad FROM _acl_snap s
   WHERE has_function_privilege('service_role',s.oid,'EXECUTE') <> s.svc_x;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE1 FAIL: service_role changed on % fns', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM _acl_snap s
   WHERE NOT s.is_trigger AND has_function_privilege('authenticated',s.oid,'EXECUTE') <> s.auth_x;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE2 FAIL: authenticated changed on % non-trigger fns', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM _acl_snap s
   WHERE s.is_trigger AND has_function_privilege('authenticated',s.oid,'EXECUTE');
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE3 FAIL: % trigger fns still authenticated-executable', v_bad; END IF;

  SELECT count(*) INTO v_anon FROM _acl_snap s WHERE has_function_privilege('anon',s.oid,'EXECUTE');
  IF v_anon<>v_expect THEN RAISE EXCEPTION 'GATE4 FAIL: % anon-executable, expected %', v_anon, v_expect; END IF;

  SELECT count(*) INTO v_pub FROM _acl_snap s JOIN pg_proc p ON p.oid=s.oid
   WHERE p.proacl IS NULL
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE');
  IF v_pub<>0 THEN RAISE EXCEPTION 'GATE5 FAIL: % fns still grant EXECUTE to PUBLIC', v_pub; END IF;

  RAISE NOTICE '0D-SEC-2a OK anon=% public=0', v_anon;
END
$mig$;
