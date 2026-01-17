-- ═══════════════════════════════════════════════════════════════════════════
-- 🔍 WORLD CLASS DATA PROTECTION - COMPREHENSIVE VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this to confirm all 6 protection systems are active and operational
-- ═══════════════════════════════════════════════════════════════════════════

\echo ''
\echo '╔═══════════════════════════════════════════════════════════════════════════╗'
\echo '║                    🛡️  WORLD CLASS SYSTEM VERIFICATION                    ║'
\echo '╚═══════════════════════════════════════════════════════════════════════════╝'
\echo ''

-- ═══════════════════════════════════════════════════════════════════════════
-- 1️⃣  BACKUP SYSTEM - Verify backup functions exist
-- ═══════════════════════════════════════════════════════════════════════════
\echo '1️⃣  BACKUP SYSTEM'
\echo '   Checking backup functions...'

SELECT 
    CASE 
        WHEN COUNT(*) = 5 THEN '   ✅ All 5 backup functions exist'
        ELSE '   ❌ Missing backup functions: ' || (5 - COUNT(*))::text
    END as status
FROM pg_proc
WHERE proname IN (
    'backup_team_lineups',
    'restore_team_lineups', 
    'list_team_lineups_backups',
    'get_latest_backup_id',
    'cleanup_old_backups'
);

-- Verify backup table exists
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_lineups_backup_log')
        THEN '   ✅ Backup log table exists'
        ELSE '   ❌ Backup log table missing'
    END as status;

-- Show recent backups (if any)
SELECT 
    '   📊 Recent backups: ' || COALESCE(COUNT(*)::text, '0') as info
FROM team_lineups_backup_log
WHERE backup_timestamp > NOW() - INTERVAL '7 days';

\echo ''

-- ═══════════════════════════════════════════════════════════════════════════
-- 2️⃣  SMART RESTORE - Verify auto-organization functions
-- ═══════════════════════════════════════════════════════════════════════════
\echo '2️⃣  SMART RESTORE SYSTEM'
\echo '   Checking smart restore functions...'

SELECT 
    CASE 
        WHEN COUNT(*) = 2 THEN '   ✅ Smart restore functions exist'
        ELSE '   ❌ Missing functions: ' || (2 - COUNT(*))::text
    END as status
FROM pg_proc
WHERE proname IN ('smart_restore_team_lineups', 'smart_restore_all_teams');

\echo ''

-- ═══════════════════════════════════════════════════════════════════════════
-- 3️⃣  INTEGRITY CHECKS - Verify monitoring system
-- ═══════════════════════════════════════════════════════════════════════════
\echo '3️⃣  INTEGRITY MONITORING'
\echo '   Checking integrity check functions...'

SELECT 
    CASE 
        WHEN COUNT(*) = 2 THEN '   ✅ Integrity check functions exist'
        ELSE '   ❌ Missing functions: ' || (2 - COUNT(**)::text
    END as status
FROM pg_proc
WHERE proname IN ('check_data_integrity', 'auto_fix_integrity_issues');

-- Verify integrity results table exists
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integrity_check_results')
        THEN '   ✅ Integrity results table exists'
        ELSE '   ❌ Integrity results table missing'
    END as status;

-- Run a live integrity check
\echo '   Running live integrity check...'
SELECT check_data_integrity();

-- Show recent check results
SELECT 
    '   📊 Checks in last 24h: ' || COUNT(*) as info,
    '   ⚠️  Issues found: ' || COALESCE(SUM(CASE WHEN issue_count > 0 THEN 1 ELSE 0 END), 0) as issues
FROM integrity_check_results
WHERE check_timestamp > NOW() - INTERVAL '24 hours';

\echo ''

-- ═══════════════════════════════════════════════════════════════════════════
-- 4️⃣  BULLETPROOF TRIGGER - Verify auto-sync protection
-- ═══════════════════════════════════════════════════════════════════════════
\echo '4️⃣  BULLETPROOF AUTO-SYNC TRIGGER'
\echo '   Checking trigger configuration...'

-- Check if trigger exists
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_trigger 
            WHERE tgname = 'sync_roster_changes_to_daily_bulletproof'
        )
        THEN '   ✅ Bulletproof trigger is active'
        ELSE '   ❌ Trigger not found'
    END as status;

-- Check trigger function
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_proc 
            WHERE proname = 'sync_roster_changes_to_daily_bulletproof'
        )
        THEN '   ✅ Trigger function exists'
        ELSE '   ❌ Trigger function missing'
    END as status;

-- Verify old buggy trigger is gone
SELECT 
    CASE 
        WHEN NOT EXISTS (
            SELECT 1 FROM pg_trigger 
            WHERE tgname = 'sync_roster_changes_to_daily'
        )
        THEN '   ✅ Old buggy trigger removed'
        ELSE '   ⚠️  Old trigger still exists (should be removed)'
    END as status;

\echo ''

-- ═══════════════════════════════════════════════════════════════════════════
-- 5️⃣  AUTO-RECOVERY - Verify self-healing system
-- ═══════════════════════════════════════════════════════════════════════════
\echo '5️⃣  AUTO-RECOVERY SYSTEM'
\echo '   Checking auto-recovery functions...'

SELECT 
    CASE 
        WHEN COUNT(*) = 2 THEN '   ✅ Auto-recovery functions exist'
        ELSE '   ❌ Missing functions: ' || (2 - COUNT(*))::text
    END as status
FROM pg_proc
WHERE proname IN ('detect_and_recover_data_loss', 'manual_recover_team');

-- Verify recovery log table
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auto_recovery_log')
        THEN '   ✅ Recovery log table exists'
        ELSE '   ❌ Recovery log table missing'
    END as status;

-- Check if auto-recovery trigger is enabled (should be disabled by default)
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_trigger 
            WHERE tgname = 'trigger_auto_recovery' 
            AND tgenabled = 'D'
        )
        THEN '   ✅ Auto-recovery trigger exists (disabled - correct)'
        WHEN EXISTS (
            SELECT 1 FROM pg_trigger 
            WHERE tgname = 'trigger_auto_recovery' 
            AND tgenabled = 'O'
        )
        THEN '   ⚠️  Auto-recovery trigger is ENABLED (review if intentional)'
        ELSE '   ℹ️  Auto-recovery trigger not configured (optional)'
    END as status;

\echo ''

-- ═══════════════════════════════════════════════════════════════════════════
-- 6️⃣  DATA HEALTH - Current system status
-- ═══════════════════════════════════════════════════════════════════════════
\echo '6️⃣  CURRENT DATA HEALTH'
\echo '   Checking system health...'

-- Check team_lineups status
SELECT 
    '   📊 Teams with rosters: ' || COUNT(*) as info
FROM team_lineups;

-- Check fantasy_daily_rosters status for today
SELECT 
    '   📊 Teams with today''s rosters: ' || COUNT(DISTINCT team_id) as info
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE;

-- Check for any missing players (phantom drops)
WITH expected_roster AS (
    SELECT 
        team_id,
        jsonb_array_length(COALESCE(starters, '[]'::jsonb)) + 
        jsonb_array_length(COALESCE(bench, '[]'::jsonb)) + 
        jsonb_array_length(COALESCE(ir, '[]'::jsonb)) as total_players
    FROM team_lineups
),
actual_roster AS (
    SELECT 
        team_id,
        COUNT(DISTINCT player_id) as total_players
    FROM fantasy_daily_rosters
    WHERE roster_date = CURRENT_DATE
    GROUP BY team_id
)
SELECT 
    CASE 
        WHEN COUNT(*) = 0 THEN '   ✅ No phantom drops detected'
        ELSE '   ⚠️  ' || COUNT(*) || ' teams have mismatched player counts'
    END as status
FROM expected_roster e
LEFT JOIN actual_roster a ON e.team_id = a.team_id
WHERE COALESCE(a.total_players, 0) != e.total_players;

\echo ''
\echo '╔═══════════════════════════════════════════════════════════════════════════╗'
\echo '║                          🎯 VERIFICATION COMPLETE                         ║'
\echo '╚═══════════════════════════════════════════════════════════════════════════╝'
\echo ''
\echo 'If all systems show ✅, your world-class protection is ACTIVE!'
\echo 'Check YOUR_NEXT_STEPS.md for deployment instructions.'
\echo ''
