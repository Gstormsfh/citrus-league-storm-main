-- ============================================================================
-- VERIFICATION SCRIPT: Check if all migrations are applied
-- ============================================================================
-- This script checks if all required policies, functions, and columns exist
-- Run this to verify your database is ready for multi-user testing
-- ============================================================================

SELECT '🔍 Checking Migration Status...' AS status;

-- ============================================================================
-- CHECK 1: Join Code RLS Policy
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'leagues' 
      AND policyname = 'Authenticated users can find leagues by join code'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 1: Join Code RLS";

-- ============================================================================
-- CHECK 2: fantasy_daily_rosters RLS Policies (CRITICAL)
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'fantasy_daily_rosters' 
      AND policyname = 'Users can view rosters in their leagues'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 2a: fantasy_daily_rosters READ policy";

SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'fantasy_daily_rosters' 
      AND policyname = 'Users can update only their own team rosters'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 2b: fantasy_daily_rosters UPDATE policy";

SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'fantasy_daily_rosters' 
      AND policyname = 'System can create roster snapshots'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 2c: fantasy_daily_rosters INSERT policy";

SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'fantasy_daily_rosters' 
      AND policyname = 'Users can delete their own team roster entries'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 2d: fantasy_daily_rosters DELETE policy";

-- ============================================================================
-- CHECK 3: Waiver Concurrency Function
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'process_waiver_claims'
      AND pg_get_functiondef(oid) LIKE '%pg_try_advisory_xact_lock%'
    ) THEN '✅ APPLIED (with advisory locks)'
    WHEN EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'process_waiver_claims'
    ) THEN '⚠️  EXISTS (but may not have locks)'
    ELSE '❌ MISSING'
  END AS "Migration 3: Waiver Concurrency Locks";

-- ============================================================================
-- CHECK 4: Draft Pick Reservation Columns
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'draft_picks' 
      AND column_name = 'reserved_by'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 4a: draft_picks reservation columns";

SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'reserve_draft_pick'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 4b: reserve_draft_pick() function";

SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'confirm_draft_pick'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 4c: confirm_draft_pick() function";

-- ============================================================================
-- CHECK 5: Waiver Priority Policy
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'teams' 
      AND policyname = 'System can set waiver priority on team creation'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 5: Waiver Priority Policy";

-- ============================================================================
-- CHECK 6: Waiver Priority RPC
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'get_next_waiver_priority'
    ) THEN '✅ APPLIED'
    ELSE '❌ MISSING'
  END AS "Migration 6: get_next_waiver_priority() function";

-- ============================================================================
-- SUMMARY: Count Applied Migrations
-- ============================================================================
WITH migration_checks AS (
  SELECT 
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leagues' AND policyname = 'Authenticated users can find leagues by join code') +
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fantasy_daily_rosters' AND policyname IN (
      'Users can view rosters in their leagues',
      'Users can update only their own team rosters',
      'System can create roster snapshots',
      'Users can delete their own team roster entries'
    )) +
    (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('process_waiver_claims', 'reserve_draft_pick', 'confirm_draft_pick', 'cleanup_expired_draft_reservations', 'get_next_waiver_priority')) +
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'draft_picks' AND column_name = 'reserved_by') AS applied_count
)
SELECT 
  CASE 
    WHEN applied_count >= 10 THEN '🎉 ALL MIGRATIONS APPLIED! You''re ready for multi-user testing!'
    WHEN applied_count >= 7 THEN '⚠️  MOST migrations applied, but some may be missing'
    ELSE '❌ CRITICAL migrations missing - database not ready'
  END AS "Overall Status",
  applied_count || '/10+ components verified' AS "Details"
FROM migration_checks;

-- ============================================================================
-- BONUS: Check for old permissive policies (should NOT exist)
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'fantasy_daily_rosters' 
      AND policyname = 'Enable update access for authenticated users'
    ) THEN '⚠️  OLD PERMISSIVE POLICY STILL EXISTS - SECURITY RISK!'
    ELSE '✅ Old permissive policies removed (secure)'
  END AS "Security Check: Old Policies Removed";
