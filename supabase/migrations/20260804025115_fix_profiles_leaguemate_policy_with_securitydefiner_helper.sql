-- 0D-SEC-3e: Make the profiles league-scoped SELECT policy actually work, and remove the
-- always-true policy that was masking the fact that it never did.
--
-- APPLIED: prod 20260804025115 / staging (same name). Authoritative record of what is live.
--
-- DELETES NOTHING. Adds one function; replaces one policy with a corrected version of
-- itself; drops one always-true policy. No table, column or row is touched.
--
-- BUG 1 -- the always-true policy made the league-scoped one dead code.
--   profiles carried "Authenticated users can view all profiles" USING (true) alongside
--   "League members can view each other profiles". PostgreSQL ORs permissive policies, so
--   every signed-up account could read every user's first_name, last_name, phone, Email,
--   location, bio and is_admin -- the last also letting an attacker enumerate admins.
--
-- BUG 2 -- and the league-scoped policy did not work anyway. Its body was a raw
--   teams-to-teams join:
--       id IN (SELECT t2.owner_id FROM teams t1 JOIN teams t2 ON t1.league_id=t2.league_id
--               WHERE t1.owner_id = auth.uid())
--   RLS POLICY SUBQUERIES ARE THEMSELVES SUBJECT TO RLS. teams has its own policies
--   (teams_select_own, teams_select_commissioner, demo league), so as `authenticated` the
--   inner join could only see teams the caller could already read. Measured on prod for the
--   most-connected user (18 leagues, 16 commissioned):
--       teams rows visible : 130 as owner -> 74 as authenticated
--       distinct co-owners :  14 as owner -> 13 as authenticated
--   So in leagues the user merely PLAYS in, leaguemates were invisible. Dropping the
--   always-true policy without fixing this would have rendered opponent names "Unknown" on
--   exactly those leagues -- a regression that looks like a UI bug, not a policy change.
--
-- THE FIX is the pattern this codebase already uses twice -- user_owns_team_in_league_simple
--   and is_commissioner_of_league are SECURITY DEFINER precisely so their lookups escape
--   RLS. profiles never got one. Verified directly before applying: for the 14 ground-truth
--   co-owners (computed as owner), shares_league_with() returns true for 14/14 when called
--   as authenticated, versus 13 via the raw subquery.
--
-- GATE DESIGN NOTE: the ground-truth owner set is captured into a uuid[] AS OWNER and the
--   gate then tests visibility of that fixed array. An earlier version of this gate used a
--   subquery evaluated as `authenticated` and therefore inherited the very RLS filtering it
--   was meant to detect -- it could never have reported better than 13/14 even with a
--   perfect fix. Do not reintroduce a live subquery here.
--
-- The new policy is scoped TO authenticated deliberately. Policies applying to PUBLIC are
--   evaluated by anon too, and 0D-SEC-2a established empirically that RLS enforces function
--   EXECUTE with NO short-circuit -- an anon read would then need EXECUTE on the helper or
--   fail 42501. Scoping to authenticated means anon never evaluates it. "Users can view own
--   profile" (TO public) is retained untouched.
--
-- Admin routes are unaffected: GET /api/admin/stats and GET /api/admin/users use
--   supabaseAdmin (service_role, rolbypassrls = true), so RLS never applied to them.
--
-- KNOWN COUPLING: membership resolves through teams.owner_id. All 43 distinct
--   (league_id, user_id) pool participants currently also own a team in that league, so the
--   pool screens are covered. A future pool-only participant with no team row would NOT be
--   visible -- if pools decouple from team ownership, add a pool_picks clause here.
--
-- VERIFIED ON PROD AFTER APPLY:
--   total=72  authenticated_sees=14  leaguemates=14/14  service_role=72  anon=0

CREATE OR REPLACE FUNCTION public.shares_league_with(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t1
      JOIN public.teams t2 ON t1.league_id = t2.league_id
     WHERE t1.owner_id = auth.uid() AND t2.owner_id = p_user
  ) OR EXISTS (
    SELECT 1 FROM public.leagues l
      JOIN public.teams t ON t.league_id = l.id
     WHERE t.owner_id = auth.uid() AND l.commissioner_id = p_user
  );
$fn$;

COMMENT ON FUNCTION public.shares_league_with(uuid) IS
  'SECURITY DEFINER so the membership lookup escapes RLS on teams/leagues. Required by the '
  'profiles league-scoped SELECT policy: a raw subquery there is filtered by the caller''s '
  'own visibility of teams and silently hides leaguemates in leagues they do not commission.';

REVOKE EXECUTE ON FUNCTION public.shares_league_with(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shares_league_with(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.shares_league_with(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.shares_league_with(uuid) TO service_role;

DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "League members can view each other profiles" ON public.profiles;

CREATE POLICY "League members can view each other profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_league_with(id));

DO $mig$
DECLARE
  v_uid uuid; v_owners uuid[]; v_n int;
  v_total bigint; v_after bigint; v_vis bigint; v_svc bigint; v_anon bigint;
BEGIN
  SELECT t.owner_id INTO v_uid FROM public.teams t WHERE t.owner_id IS NOT NULL
   GROUP BY t.owner_id ORDER BY count(DISTINCT t.league_id) DESC, t.owner_id LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE '0D-SEC-3e: no team owners; structural change applied without identity gate';
    RETURN;
  END IF;

  SELECT count(*) INTO v_total FROM public.profiles;

  -- Ground truth captured AS OWNER into an array so RLS cannot filter the yardstick.
  SELECT array_agg(DISTINCT t2.owner_id) INTO v_owners
    FROM public.teams t1 JOIN public.teams t2 ON t1.league_id=t2.league_id
   WHERE t1.owner_id=v_uid AND t2.owner_id IS NOT NULL;
  v_n := COALESCE(array_length(v_owners,1),0);

  PERFORM set_config('request.jwt.claims',
    json_build_object('role','authenticated','sub',v_uid)::text, true);
  SET ROLE authenticated;
  SELECT count(*) INTO v_after FROM public.profiles;
  SELECT count(*) INTO v_vis  FROM public.profiles p WHERE p.id = ANY(v_owners);
  RESET ROLE;

  IF v_vis <> v_n THEN
    RAISE EXCEPTION 'GATE1 FAIL: leaguemates lost -- %/% visible', v_vis, v_n;
  END IF;
  IF v_after >= v_total THEN
    RAISE EXCEPTION 'GATE2 FAIL: exposure not reduced (total=% visible=%)', v_total, v_after;
  END IF;
  IF v_after = 0 THEN
    RAISE EXCEPTION 'GATE2b FAIL: user sees zero profiles -- policy set broken';
  END IF;

  SET ROLE service_role;
  SELECT count(*) INTO v_svc FROM public.profiles;
  RESET ROLE;
  IF v_svc <> v_total THEN
    RAISE EXCEPTION 'GATE3 FAIL: service_role sees %/% -- admin routes would break', v_svc, v_total;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    SET ROLE anon;
    SELECT count(*) INTO v_anon FROM public.profiles;
  EXCEPTION WHEN OTHERS THEN v_anon := 0;
  END;
  RESET ROLE;
  IF v_anon <> 0 THEN
    RAISE EXCEPTION 'GATE4 FAIL: anon sees % profiles', v_anon;
  END IF;

  RAISE NOTICE '0D-SEC-3e OK: total=% authenticated_sees=% leaguemates=%/% service_role=% anon=%',
    v_total, v_after, v_vis, v_n, v_svc, v_anon;
END
$mig$;
