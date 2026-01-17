-- ═══════════════════════════════════════════════════════════════════════════
-- 🔍 SINGLE-QUERY VERIFICATION (exports cleanly to CSV)
-- ═══════════════════════════════════════════════════════════════════════════

WITH system_checks AS (
    SELECT 'Backup Functions' as check_name, COUNT(*) as actual, 5 as expected
    FROM pg_proc
    WHERE proname IN ('backup_team_lineups', 'restore_team_lineups', 'list_team_lineups_backups', 'get_latest_backup_id', 'cleanup_old_backups')
    
    UNION ALL
    
    SELECT 'Smart Restore Functions', COUNT(*), 2
    FROM pg_proc
    WHERE proname IN ('smart_restore_team_lineups', 'smart_restore_all_teams')
    
    UNION ALL
    
    SELECT 'Integrity Functions', COUNT(*), 2
    FROM pg_proc
    WHERE proname IN ('check_data_integrity', 'auto_fix_integrity_issues')
    
    UNION ALL
    
    SELECT 'Auto-Recovery Functions', COUNT(*), 2
    FROM pg_proc
    WHERE proname IN ('detect_and_recover_data_loss', 'manual_recover_team')
    
    UNION ALL
    
    SELECT 'Bulletproof Trigger', COUNT(*), 1
    FROM pg_trigger
    WHERE tgname = 'trigger_bulletproof_auto_sync_roster_to_daily'
    
    UNION ALL
    
    SELECT 'Backup Log Table', 
           CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'team_lineups_backup_log') THEN 1 ELSE 0 END,
           1
    
    UNION ALL
    
    SELECT 'Integrity Results Table',
           CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integrity_check_results') THEN 1 ELSE 0 END,
           1
    
    UNION ALL
    
    SELECT 'Auto Recovery Log Table',
           CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auto_recovery_log') THEN 1 ELSE 0 END,
           1
    
    UNION ALL
    
    SELECT 'Teams with Rosters', COUNT(*)::int, NULL
    FROM team_lineups
    
    UNION ALL
    
    SELECT 'Today''s Daily Rosters', COUNT(DISTINCT team_id)::int, NULL
    FROM fantasy_daily_rosters
    WHERE roster_date = CURRENT_DATE
    
    UNION ALL
    
    SELECT 'Total Players Today', COUNT(*)::int, NULL
    FROM fantasy_daily_rosters
    WHERE roster_date = CURRENT_DATE
)
SELECT 
    check_name as "System Check",
    actual as "Found",
    COALESCE(expected::text, 'N/A') as "Expected",
    CASE 
        WHEN expected IS NULL THEN '📊 Info'
        WHEN actual = expected THEN '✅ PASS'
        ELSE '❌ FAIL'
    END as "Status"
FROM system_checks
ORDER BY 
    CASE 
        WHEN check_name LIKE '%Function%' THEN 1
        WHEN check_name LIKE '%Trigger%' THEN 2
        WHEN check_name LIKE '%Table%' THEN 3
        ELSE 4
    END,
    check_name;
