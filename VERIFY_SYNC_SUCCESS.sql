-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION SCRIPT - Confirm Sync Success
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this after SYNC_FANTASY_DAILY_ROSTERS_CORRECT.sql to verify everything
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Overall sync status
SELECT 
    '1. OVERALL STATUS' as check_section,
    COUNT(*) as total_players_today,
    COUNT(DISTINCT team_id) as teams_synced,
    COUNT(DISTINCT matchup_id) as active_matchups,
    COUNT(CASE WHEN slot_type = 'active' THEN 1 END) as active_players,
    COUNT(CASE WHEN slot_type = 'bench' THEN 1 END) as bench_players,
    COUNT(CASE WHEN slot_type = 'ir' THEN 1 END) as ir_players,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ Data synced'
        ELSE '❌ No data'
    END as status
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE;

-- 2. Verify slot_type constraint (should be ONLY 'active', 'bench', 'ir')
SELECT 
    '2. SLOT_TYPE VALIDATION' as check_section,
    slot_type,
    COUNT(*) as count,
    CASE 
        WHEN slot_type IN ('active', 'bench', 'ir') THEN '✅ Valid'
        ELSE '❌ INVALID'
    END as validation
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
GROUP BY slot_type
ORDER BY slot_type;

-- 3. Verify active players have slot_id
SELECT 
    '3. ACTIVE PLAYERS SLOT_ID CHECK' as check_section,
    COUNT(*) as active_players,
    COUNT(slot_id) as with_slot_id,
    COUNT(*) - COUNT(slot_id) as missing_slot_id,
    CASE 
        WHEN COUNT(*) = COUNT(slot_id) THEN '✅ All active players have slot_id'
        ELSE '⚠️ Some active players missing slot_id'
    END as status
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
  AND slot_type = 'active';

-- 4. Verify bench players have NULL slot_id
SELECT 
    '4. BENCH PLAYERS SLOT_ID CHECK' as check_section,
    COUNT(*) as bench_players,
    COUNT(slot_id) as with_slot_id,
    COUNT(*) - COUNT(slot_id) as null_slot_id,
    CASE 
        WHEN COUNT(slot_id) = 0 THEN '✅ All bench players have NULL slot_id'
        ELSE '⚠️ Some bench players have slot_id (unexpected)'
    END as status
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
  AND slot_type = 'bench';

-- 5. Sample data from each slot type
SELECT 
    '5. SAMPLE DATA (active)' as check_section,
    team_id,
    player_id,
    slot_type,
    slot_id,
    is_locked,
    created_at
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
  AND slot_type = 'active'
LIMIT 3;

SELECT 
    '5. SAMPLE DATA (bench)' as check_section,
    team_id,
    player_id,
    slot_type,
    slot_id,
    is_locked,
    created_at
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
  AND slot_type = 'bench'
LIMIT 3;

-- 6. Check for duplicate players (should be 0)
SELECT 
    '6. DUPLICATE CHECK' as check_section,
    team_id,
    player_id,
    COUNT(*) as duplicate_count,
    CASE 
        WHEN COUNT(*) = 1 THEN '✅ Unique'
        ELSE '❌ DUPLICATE'
    END as status
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
GROUP BY team_id, player_id
HAVING COUNT(*) > 1;

-- 7. Verify all required fields are populated
SELECT 
    '7. NULL FIELD CHECK' as check_section,
    COUNT(*) FILTER (WHERE id IS NULL) as null_id,
    COUNT(*) FILTER (WHERE league_id IS NULL) as null_league_id,
    COUNT(*) FILTER (WHERE team_id IS NULL) as null_team_id,
    COUNT(*) FILTER (WHERE matchup_id IS NULL) as null_matchup_id,
    COUNT(*) FILTER (WHERE player_id IS NULL) as null_player_id,
    COUNT(*) FILTER (WHERE roster_date IS NULL) as null_roster_date,
    COUNT(*) FILTER (WHERE slot_type IS NULL) as null_slot_type,
    COUNT(*) FILTER (WHERE is_locked IS NULL) as null_is_locked,
    CASE 
        WHEN COUNT(*) FILTER (WHERE id IS NULL OR league_id IS NULL OR team_id IS NULL 
                                OR matchup_id IS NULL OR player_id IS NULL 
                                OR roster_date IS NULL OR slot_type IS NULL 
                                OR is_locked IS NULL) = 0 
        THEN '✅ All required fields populated'
        ELSE '❌ Some required fields are NULL'
    END as status
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE;

-- 8. Compare with team_lineups source
SELECT 
    '8. SOURCE COMPARISON' as check_section,
    COUNT(DISTINCT tl.team_id) as teams_in_lineups,
    COUNT(DISTINCT fdr.team_id) as teams_in_daily_rosters,
    CASE 
        WHEN COUNT(DISTINCT tl.team_id) = COUNT(DISTINCT fdr.team_id) THEN '✅ All teams synced'
        ELSE '⚠️ Some teams missing (no active matchup)'
    END as status
FROM team_lineups tl
LEFT JOIN fantasy_daily_rosters fdr ON fdr.team_id = tl.team_id AND fdr.roster_date = CURRENT_DATE
INNER JOIN matchups m ON (
    m.league_id = tl.league_id
    AND (m.team1_id = tl.team_id OR m.team2_id = tl.team_id)
    AND m.week_start_date <= CURRENT_DATE
    AND m.week_end_date >= CURRENT_DATE
);

-- Final summary
SELECT 
    '═══════════════════════════════════════════════════════════════' as separator,
    '✅ VERIFICATION COMPLETE' as message,
    'If all checks passed, your sync is WORLD CLASS!' as next_step,
    '═══════════════════════════════════════════════════════════════' as separator2;
