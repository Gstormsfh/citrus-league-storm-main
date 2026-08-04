-- 0D-SEC-3h: Close the two anonymous write doors that survived the RLS sweep.
--
-- APPLIED: prod 20260804033750 / staging (same name). Authoritative record of what is live.
--
-- RLS was enabled everywhere by 20260804005912 and TRUNCATE/TRIGGER stripped by
-- 20260804010511, but RLS only helps if the POLICIES are restrictive. Two tables still
-- paired an anon INSERT grant with a permissive INSERT policy, so anon really could write:
--
--   stormy_chat_log       policy "Service role can insert chat logs"
--                         -- despite the NAME, it is TO PUBLIC WITH CHECK (true).
--                         Any holder of the publishable anon key could insert arbitrary
--                         rows. This log feeds the Stormy assistant, so that is a content
--                         injection path, not merely spam.
--
--   fantasy_daily_rosters policy "System can create roster snapshots" -- TO PUBLIC, and its
--                         WITH CHECK only verifies that team_id and league_id agree with
--                         each other. It does NOT check ownership, so anon could inject
--                         fabricated daily roster snapshots for any team. This table has
--                         ~79M reads and drives matchup scoring, so bad rows corrupt games.
--
-- WHY REVOKING anon IS SAFE HERE:
--   fantasy_daily_rosters -- the permissive policy exists for trigger functions that were
--     SECURITY INVOKER (bulletproof_auto_sync_team_lineup_to_daily_rosters,
--     sync_new_team_lineup_to_daily_rosters) and therefore inserted as the calling user.
--     Those triggers were DROPPED by 20260402100000_drop_auto_sync_triggers.sql and are
--     confirmed absent from pg_trigger. Every remaining writer -- calculate_daily_matchup_scores,
--     calculate_h2h_category_matchup, get_daily_lineup, optimize_best_ball_daily_rosters --
--     is SECURITY DEFINER and runs as owner, bypassing RLS entirely. The policy is vestigial.
--   stormy_chat_log -- written by the stormy-chat edge function, which has verify_jwt = true;
--     anon has no path to it.
--   In both cases anon has no legitimate write route, so this removes surface only.
--
-- DELIBERATELY OUT OF SCOPE:
--   * `authenticated` INSERT on both tables is left ALONE pending a repo call-site census.
--     Note the fantasy_daily_rosters policy still lets any authenticated user insert
--     snapshots for a team they do not own -- worth tightening to ownership once the
--     writers are confirmed.
--   * `waitlist` keeps its anon INSERT: "Anyone can join waitlist" is intended behaviour for
--     public signup. It is unbounded though, so rate limiting belongs at the app edge.
--
-- GATED: anon must lose INSERT/UPDATE/DELETE on both, and authenticated + service_role
-- privileges must be byte-identical to a pre-change snapshot.
--
-- VERIFIED ON PROD AFTER APPLY:
--   fantasy_daily_rosters anon_insert=false  authenticated=true  service_role=true
--   stormy_chat_log       anon_insert=false  authenticated=true  service_role=true
--   waitlist              anon_insert=true   (intentionally retained)

DO $mig$
DECLARE
  v_tabs text[] := ARRAY['stormy_chat_log','fantasy_daily_rosters'];
  t text; v_oid oid; v_bad int := 0; v_n int;
BEGIN
  CREATE TEMP TABLE _snap ON COMMIT DROP AS
  SELECT c.oid, c.relname,
         has_table_privilege('authenticated', c.oid,'INSERT') auth_i,
         has_table_privilege('authenticated', c.oid,'SELECT') auth_s,
         has_table_privilege('authenticated', c.oid,'UPDATE') auth_u,
         has_table_privilege('authenticated', c.oid,'DELETE') auth_d,
         has_table_privilege('service_role',  c.oid,'INSERT') svc_i,
         has_table_privilege('service_role',  c.oid,'SELECT') svc_s
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname = ANY(v_tabs);

  FOREACH t IN ARRAY v_tabs LOOP
    v_oid := to_regclass('public.'||t);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon', t);
  END LOOP;

  SELECT count(*) INTO v_bad FROM _snap s
   WHERE has_table_privilege('anon', s.oid,'INSERT')
      OR has_table_privilege('anon', s.oid,'UPDATE')
      OR has_table_privilege('anon', s.oid,'DELETE');
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE1 FAIL: anon retains write on % tables', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM _snap s
   WHERE has_table_privilege('authenticated', s.oid,'INSERT') <> s.auth_i
      OR has_table_privilege('authenticated', s.oid,'SELECT') <> s.auth_s
      OR has_table_privilege('authenticated', s.oid,'UPDATE') <> s.auth_u
      OR has_table_privilege('authenticated', s.oid,'DELETE') <> s.auth_d
      OR has_table_privilege('service_role',  s.oid,'INSERT') <> s.svc_i
      OR has_table_privilege('service_role',  s.oid,'SELECT') <> s.svc_s;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE2 FAIL: authenticated/service_role changed on % tables', v_bad; END IF;

  SELECT count(*) INTO v_n FROM _snap;
  RAISE NOTICE '0D-SEC-3h OK: anon write revoked on % tables', v_n;
END
$mig$;
