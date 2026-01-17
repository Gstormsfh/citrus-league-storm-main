-- ═══════════════════════════════════════════════════════════════════════════
-- 🔍 QUICK VERIFICATION (Supabase Dashboard)
-- ═══════════════════════════════════════════════════════════════════════════
-- Copy/paste this into Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1️⃣  Check all functions exist
SELECT 
    '🛡️ PROTECTION SYSTEMS STATUS' as section,
    '' as blank;

SELECT 
    'Backup Functions' as system,
    COUNT(*) as found,
    '5 expected' as expected
FROM pg_proc
WHERE proname IN (
    'backup_team_lineups',
    'restore_team_lineups', 
    'list_team_lineups_backups',
    'get_latest_backup_id',
    'cleanup_old_backups'
)
UNION ALL
SELECT 
    'Smart Restore Functions',
    COUNT(*),
    '2 expected'
FROM pg_proc
WHERE proname IN ('smart_restore_team_lineups', 'smart_restore_all_teams')
UNION ALL
SELECT 
    'Integrity Functions',
    COUNT(*),
    '2 expected'
FROM pg_proc
WHERE proname IN ('check_data_integrity', 'auto_fix_integrity_issues')
UNION ALL
SELECT 
    'Auto-Recovery Functions',
    COUNT(*),
    '2 expected'
FROM pg_proc
WHERE proname IN ('detect_and_recover_data_loss', 'manual_recover_team')
UNION ALL
SELECT 
    'Bulletproof Trigger',
    COUNT(*),
    '1 expected'
FROM pg_trigger
WHERE tgname = 'sync_roster_changes_to_daily_bulletproof';

-- 2️⃣  Check tables exist
SELECT 
    '' as blank,
    '📊 PROTECTION TABLES' as section;

SELECT 
    table_name as table,
    CASE 
        WHEN table_name IN ('team_lineups_backup_log', 'integrity_check_results', 'auto_recovery_log')
        THEN '✅ Exists'
        ELSE '❌ Missing'
    END as status
FROM (
    VALUES 
        ('team_lineups_backup_log'),
        ('integrity_check_results'),
        ('auto_recovery_log')
) AS expected(table_name)
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables t 
    WHERE t.table_name = expected.table_name
);

-- 3️⃣  Run live integrity check
SELECT 
    '' as blank,
    '🔍 RUNNING LIVE INTEGRITY CHECK...' as section;

SELECT check_data_integrity();

-- 4️⃣  Show data health
SELECT 
    '' as blank,
    '💚 CURRENT DATA HEALTH' as section;

SELECT 
    'Teams with rosters' as metric,
    COUNT(*)::text as value
FROM team_lineups
UNION ALL
SELECT 
    'Today''s daily rosters',
    COUNT(DISTINCT team_id)::text
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
UNION ALL
SELECT 
    'Total players tracked',
    COUNT(*)::text
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE;

-- 5️⃣  Final verdict
SELECT 
    '' as blank,
    '═══════════════════════════════════════════════════════════' as divider,
    '🎯 VERIFICATION COMPLETE - Check results above' as verdict,
    '═══════════════════════════════════════════════════════════' as divider2;
