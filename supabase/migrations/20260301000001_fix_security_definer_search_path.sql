-- ============================================================================
-- FIX: Add SET search_path = public to ALL SECURITY DEFINER functions
-- ============================================================================
-- Date: 2026-03-01
--
-- SECURITY DEFINER functions execute with the privileges of the function
-- creator. Without SET search_path = public, a malicious user could create
-- a schema with the same name as a table referenced in the function, causing
-- the function to operate on the wrong data (search_path hijacking).
--
-- This migration adds SET search_path = public to every SECURITY DEFINER
-- function that is missing it, using ALTER FUNCTION (non-destructive).
--
-- Functions already fixed by prior migrations (11th audit, 12th audit, etc.)
-- are NOT included here — only genuinely unfixed functions remain.
--
-- AUDIT METHODOLOGY:
--   1. Searched all supabase/migrations/*.sql for SECURITY DEFINER
--   2. For each function, checked if SET search_path was in the CREATE block
--   3. Checked if a later migration (ALTER or CREATE OR REPLACE) added it
--   4. Only functions still missing search_path are listed below
-- ============================================================================


-- ============================================================================
-- 1. Trigger functions (no parameters)
-- ============================================================================

-- auto_create_waiver_priority() — trigger on teams INSERT
-- Defined: 20260110000006_auto_create_waiver_priority.sql
DO $$ BEGIN
  ALTER FUNCTION public.auto_create_waiver_priority() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- create_notifications_from_transaction() — trigger on roster_transactions INSERT
-- Defined: 20260110000005_fix_notification_trigger_fullname.sql
DO $$ BEGIN
  ALTER FUNCTION public.create_notifications_from_transaction() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- enforce_trade_deadline() — trigger on trade_offers INSERT
-- Defined: 20260227000000_fix_all_remaining_gaps.sql
DO $$ BEGIN
  ALTER FUNCTION public.enforce_trade_deadline() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- log_settings_change() — trigger on leagues UPDATE
-- Defined: 20260226000000_a_plus_audit_fixes.sql
DO $$ BEGIN
  ALTER FUNCTION public.log_settings_change() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- sync_playoff_scores() — trigger on matchups UPDATE
-- Defined: 20260227000000_fix_all_remaining_gaps.sql
DO $$ BEGIN
  ALTER FUNCTION public.sync_playoff_scores() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- track_dropped_player_for_waivers() — trigger on roster_transactions INSERT
-- Defined: 20260112000000_fix_waiver_system_comprehensive.sql
DO $$ BEGIN
  ALTER FUNCTION public.track_dropped_player_for_waivers() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- validate_league_settings() — trigger on leagues INSERT/UPDATE
-- Defined: 20260226000000_a_plus_audit_fixes.sql
DO $$ BEGIN
  ALTER FUNCTION public.validate_league_settings() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- 2. RLS helper functions (used in policies)
-- ============================================================================

-- check_commissioner_simple(uuid) — used by teams SELECT policy
-- Defined: 20250101000008_fix_rls_final.sql
DO $$ BEGIN
  ALTER FUNCTION public.check_commissioner_simple(UUID) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- check_team_owner_simple(uuid) — used by leagues SELECT policy
-- Defined: 20250101000008_fix_rls_final.sql
DO $$ BEGIN
  ALTER FUNCTION public.check_team_owner_simple(UUID) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- 3. SOC 2 / audit functions
-- ============================================================================

-- cleanup_old_audit_logs(int) — purges old security_audit_log rows
-- Defined: 20260206000000_security_hardening_soc_compliance.sql
DO $$ BEGIN
  ALTER FUNCTION public.cleanup_old_audit_logs(INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- detect_security_anomalies() — scans for security violations
-- Defined: 20260206000000_security_hardening_soc_compliance.sql
DO $$ BEGIN
  ALTER FUNCTION public.detect_security_anomalies() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- 4. Waiver system functions
-- ============================================================================

-- create_waiver_priority_for_team(uuid, uuid) — RPC for waiver priority init
-- Defined: 20260113200005_create_waiver_priority_rpc.sql
DO $$ BEGIN
  ALTER FUNCTION public.create_waiver_priority_for_team(UUID, UUID) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- process_waiver_claims(uuid) — core waiver processing engine
-- Defined: 20260225000000_close_all_gaps_world_class.sql (latest CREATE OR REPLACE)
DO $$ BEGIN
  ALTER FUNCTION public.process_waiver_claims(UUID) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- 5. Roster transaction functions
-- ============================================================================

-- process_roster_moves_batch(jsonb) — batch roster operations for waivers
-- Defined: 20260117000001_create_process_roster_move.sql
DO $$ BEGIN
  ALTER FUNCTION public.process_roster_moves_batch(JSONB) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- 6. Notification functions
-- ============================================================================

-- notify_league_members(uuid, text, text, text) — commissioner notification RPC
-- Defined: 20260208300000_create_system_notification_rpc.sql
DO $$ BEGIN
  ALTER FUNCTION public.notify_league_members(UUID, TEXT, TEXT, TEXT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- send_league_chat_message(uuid, text, text) — league chat RPC
-- Defined: 20251213000000_add_chat_insert_policy.sql
DO $$ BEGIN
  ALTER FUNCTION public.send_league_chat_message(UUID, TEXT, TEXT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- 7. Trade functions
-- ============================================================================

-- expire_stale_trade_offers() — cron-triggered trade expiration
-- Defined: 20260226000000_a_plus_audit_fixes.sql
DO $$ BEGIN
  ALTER FUNCTION public.expire_stale_trade_offers() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- 8. Standings / scoring functions
-- ============================================================================

-- calculate_ppg_standings(uuid, int) — points-per-game standings RPC
-- Defined: 20260227000000_fix_all_remaining_gaps.sql
DO $$ BEGIN
  ALTER FUNCTION public.calculate_ppg_standings(UUID, INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- get_trending_players(int, int, text) — trending player analytics RPC
-- Defined: 20260205000000_create_player_transactions_table.sql
DO $$ BEGIN
  ALTER FUNCTION public.get_trending_players(INT, INT, TEXT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
  v_func RECORD;
  v_count INT := 0;
  v_missing INT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  SECURITY DEFINER search_path FIX — VERIFICATION';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';

  -- Check all SECURITY DEFINER functions for search_path
  FOR v_func IN
    SELECT
      p.proname AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args,
      p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true  -- SECURITY DEFINER
    ORDER BY p.proname
  LOOP
    v_count := v_count + 1;
    IF v_func.proconfig IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM unnest(v_func.proconfig) AS c
         WHERE c LIKE 'search_path=%'
       )
    THEN
      v_missing := v_missing + 1;
      RAISE NOTICE '  MISSING search_path: %(%)', v_func.func_name, v_func.args;
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '  Total SECURITY DEFINER functions: %', v_count;
  RAISE NOTICE '  Functions with search_path set:    %', v_count - v_missing;
  RAISE NOTICE '  Functions still missing:           %', v_missing;

  IF v_missing = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '  ALL SECURITY DEFINER functions now have SET search_path = public';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '  WARNING: % functions still need search_path', v_missing;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
END $$;
