-- 0D-SEC-2: collapse the anonymous SECURITY DEFINER function surface.
--
-- Context
--   77 SECURITY DEFINER functions in public.* were EXECUTE-able by anon and
--   authenticated. SECURITY DEFINER bypasses RLS, so each function's body was
--   the only authorization boundary. This migration collapses that surface.
--
-- Classification (from 0D-SEC-2 investigation; see PR body for evidence table).
--   A1 TRIGGER-ONLY (11)      — invoked by pg_trigger only; revoke from
--                                anon + authenticated. All confirmed via
--                                pg_trigger dependency check.
--   A2 AUTHENTICATED-ONLY (53) — called by the Hono API server and edge
--                                functions in JWT-authed contexts; revoke
--                                from anon only.
--   A3 GENUINELY PUBLIC (0)    — no frontend call site executes any RPC
--                                before authentication (apps/web has ZERO
--                                .rpc() calls; every RPC flows through the
--                                server with a per-request JWT-scoped client).
--                                Bucket is empty by construction.
--   A4 SERVICE-ROLE-ONLY (13)  — batch/cron/pipeline invocations only
--                                (data-pipeline scripts, pg_cron jobs);
--                                revoke from anon + authenticated.
--
-- Strategy
--   Applied to BOTH prod (77 funcs) and staging (97 funcs, extras from
--   in-progress feature work). To be idempotent across both AND across the
--   many overloaded signatures Postgres tracks per name, we work in DO blocks
--   that iterate pg_proc and dispatch via function OID.
--
--   Step 1: REVOKE EXECUTE FROM anon on EVERY SECURITY DEFINER function in
--   public. Safe default because A3 is empty — nothing in public needs anon
--   RPC access. If a future function DOES need anon access, add an explicit
--   GRANT in the migration that creates it.
--
--   Step 2: REVOKE EXECUTE FROM authenticated on the A1 + A4 named sets. Uses
--   explicit name lists (24 total) for auditability. If a name is not present
--   on the target project (staging vs prod drift), the loop skips silently.
--
-- Verification (in code, no manual step required):
--   The DO blocks RAISE NOTICE the count of functions touched at each step.
--   Read the migration logs post-apply.
--
-- Out of scope
--   Function bodies are NOT modified. Identity-parameter impersonation review
--   is deferred to the D-flag list in the 0D-SEC-2 PR body (join_league_with_
--   code, send_league_chat_message, submit_trade_vote, handle_roster_
--   transaction, and adjacent identity-taking functions).

BEGIN;

-- ============================================================================
-- STEP 1: revoke EXECUTE from `anon` on ALL SECURITY DEFINER funcs in public.
-- ============================================================================
DO $sec2_revoke_anon$
DECLARE
  r RECORD;
  revoked_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon',
                   r.proname, r.args);
    revoked_count := revoked_count + 1;
  END LOOP;
  RAISE NOTICE '[SEC-2] revoked EXECUTE from anon on % SECURITY DEFINER public functions', revoked_count;
END
$sec2_revoke_anon$;

-- ============================================================================
-- STEP 2: revoke EXECUTE from `authenticated` on A1 (trigger-only) + A4
-- (service-role-only) — 24 named functions.
-- ============================================================================
DO $sec2_revoke_authenticated$
DECLARE
  a1_a4_names TEXT[] := ARRAY[
    -- A1 TRIGGER-ONLY (11): invoked only by pg_trigger
    'create_matchup_scoring_snapshot',
    'create_notifications_from_transaction',
    'enforce_trade_deadline',
    'handle_new_user',
    'log_league_scoring_change',
    'log_settings_change',
    'notify_league_on_transaction',
    'propagate_playoff_series_winner',
    'sync_playoff_scores',
    'validate_league_settings',
    'validate_team_insert',
    -- A4 SERVICE-ROLE-ONLY (13): batch/cron/pipeline
    'aggregate_player_playoff_stats',
    'aggregate_player_playoff_stats_live',
    'cleanup_old_audit_logs',
    'cleanup_old_join_attempts',
    'detect_security_anomalies',
    'expire_stale_trade_offers',
    'populate_player_weekly_stats',
    'process_all_faab_waivers',
    'process_all_pending_waivers',
    'process_expired_trade_reviews',
    'score_all_playoff_roster_pools',
    'score_all_pools_for_week',
    'update_playoff_series_from_games'
  ];
  r RECORD;
  revoked_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname = ANY (a1_a4_names)
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated',
                   r.proname, r.args);
    revoked_count := revoked_count + 1;
  END LOOP;
  RAISE NOTICE '[SEC-2] revoked EXECUTE from authenticated on % A1/A4 functions', revoked_count;

  -- Also announce any A1/A4 name NOT present on the target project (drift
  -- report; not an error — staging vs prod drift is expected).
  FOR r IN
    SELECT n.name
    FROM unnest(a1_a4_names) AS n(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname = n.name AND p.prosecdef
    )
  LOOP
    RAISE NOTICE '[SEC-2] note: A1/A4 name % is not present on this project (drift OK)', r.name;
  END LOOP;
END
$sec2_revoke_authenticated$;

-- ============================================================================
-- STEP 3: post-verification — count SECURITY DEFINER functions still
-- EXECUTE-able by anon. Should be 0 (A3 bucket is empty).
-- ============================================================================
DO $sec2_verify$
DECLARE
  anon_exec_remaining INT;
  auth_exec_remaining INT;
BEGIN
  SELECT COUNT(*) INTO anon_exec_remaining
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  SELECT COUNT(*) INTO auth_exec_remaining
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  RAISE NOTICE '[SEC-2] post-apply: anon can EXECUTE % SD public funcs (expected 0)', anon_exec_remaining;
  RAISE NOTICE '[SEC-2] post-apply: authenticated can EXECUTE % SD public funcs', auth_exec_remaining;

  IF anon_exec_remaining <> 0 THEN
    RAISE EXCEPTION '[SEC-2] FAILED — % SECURITY DEFINER funcs still EXECUTE-able by anon', anon_exec_remaining;
  END IF;
END
$sec2_verify$;

COMMIT;
