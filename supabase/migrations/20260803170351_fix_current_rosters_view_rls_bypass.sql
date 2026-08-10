-- 0D-SEC-3a: Stop public.current_rosters from laundering past row-level security.
--
-- APPLIED: prod 20260803170351 / staging (same name). Both end at security_invoker = on.
--
-- THE LEAK (measured on prod, not theorised). current_rosters is owned by postgres with
-- security_invoker unset (= false), so it executed as its OWNER and base-table RLS never
-- applied to the caller. Direct contrast as role anon:
--       SELECT count(*) FROM roster_assignments  ->   0 rows   (RLS working)
--       SELECT count(*) FROM current_rosters     -> 216 rows   (RLS bypassed)
-- Exposed league d907a77c-425f-4b52-83ac-8f5c281682e8 -- NOT the demo league. Any caller
-- with the publishable anon key (it ships in the browser bundle) could read a private
-- league's full roster: league name, team names, teams.owner_id auth UUIDs, player ids,
-- acquisition timestamps. One league had roster rows at the time; at launch, all of them.
--
-- THE FIX. security_invoker = on makes the view evaluate base-table RLS as the querying
-- user. It invents no new rules -- it defers to policies that already exist and are
-- already correct: roster_assignments "Users can view rosters in their leagues"
-- (own teams OR leagues you commission OR the demo league), plus the teams SELECT
-- policies. After the change anon sees demo-league rows only; members and commissioners
-- are unaffected. Post-change on prod: owner_sees=216, anon_sees=0.
--
-- Gated: rolls back unless anon sees zero non-demo rows afterwards.

DO $mig$
DECLARE v_owner bigint; v_anon bigint; v_nondemo bigint;
BEGIN
  IF to_regclass('public.current_rosters') IS NULL THEN
    RAISE NOTICE 'current_rosters absent; nothing to do';
    RETURN;
  END IF;

  EXECUTE 'ALTER VIEW public.current_rosters SET (security_invoker = on)';

  SELECT count(*) INTO v_owner FROM public.current_rosters;

  BEGIN
    SET ROLE anon;
    SELECT count(*),
           count(*) FILTER (WHERE league_id <> '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::uuid)
      INTO v_anon, v_nondemo
      FROM public.current_rosters;
  EXCEPTION WHEN OTHERS THEN
    v_anon := -1; v_nondemo := -1;
  END;
  RESET ROLE;

  IF v_nondemo <> 0 THEN
    RAISE EXCEPTION 'GATE FAIL: anon still sees % non-demo roster rows (anon total %)', v_nondemo, v_anon;
  END IF;

  RAISE NOTICE '0D-SEC-3a OK: owner=% anon=% nondemo=%', v_owner, v_anon, v_nondemo;
END
$mig$;
