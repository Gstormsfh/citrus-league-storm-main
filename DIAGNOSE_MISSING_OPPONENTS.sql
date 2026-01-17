-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNOSE MISSING OPPONENT TEAMS
-- ═══════════════════════════════════════════════════════════════════════════
-- This script identifies WHY opponent teams have no players in fantasy_daily_rosters
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Overview: How many teams exist and how many are synced?
SELECT 
    '1. TEAM COUNTS' as section,
    (SELECT COUNT(DISTINCT team_id) FROM team_lineups) as total_teams_in_lineups,
    (SELECT COUNT(DISTINCT team_id) FROM fantasy_daily_rosters WHERE roster_date = CURRENT_DATE) as teams_synced_today,
    (SELECT COUNT(DISTINCT team_id) FROM team_lineups) - 
    (SELECT COUNT(DISTINCT team_id) FROM fantasy_daily_rosters WHERE roster_date = CURRENT_DATE) as missing_teams;

-- 2. Which specific teams are in team_lineups?
SELECT 
    '2. ALL TEAMS IN team_lineups' as section,
    tl.team_id,
    tl.league_id,
    t.team_name,
    jsonb_array_length(tl.starters) as starter_count,
    jsonb_array_length(tl.bench) as bench_count,
    jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as ir_count
FROM team_lineups tl
LEFT JOIN teams t ON t.id = tl.team_id
ORDER BY t.team_name;

-- 3. Which teams got synced to fantasy_daily_rosters TODAY?
SELECT 
    '3. TEAMS SYNCED TODAY' as section,
    fdr.team_id,
    t.team_name,
    fdr.league_id,
    COUNT(*) as player_count,
    COUNT(CASE WHEN fdr.slot_type = 'active' THEN 1 END) as active_count,
    COUNT(CASE WHEN fdr.slot_type = 'bench' THEN 1 END) as bench_count
FROM fantasy_daily_rosters fdr
LEFT JOIN teams t ON t.id = fdr.team_id
WHERE fdr.roster_date = CURRENT_DATE
GROUP BY fdr.team_id, t.team_name, fdr.league_id
ORDER BY t.team_name;

-- 4. Which teams are MISSING from fantasy_daily_rosters?
SELECT 
    '4. MISSING TEAMS (in team_lineups but NOT in fantasy_daily_rosters)' as section,
    tl.team_id,
    t.team_name,
    tl.league_id,
    jsonb_array_length(tl.starters) as has_starters,
    jsonb_array_length(tl.bench) as has_bench
FROM team_lineups tl
LEFT JOIN teams t ON t.id = tl.team_id
WHERE tl.team_id NOT IN (
    SELECT DISTINCT team_id 
    FROM fantasy_daily_rosters 
    WHERE roster_date = CURRENT_DATE
)
ORDER BY t.team_name;

-- 5. Check active matchups TODAY
SELECT 
    '5. ACTIVE MATCHUPS TODAY' as section,
    m.id as matchup_id,
    m.league_id,
    l.league_name,
    m.week_number,
    m.week_start_date,
    m.week_end_date,
    t1.team_name as team1_name,
    t2.team_name as team2_name,
    m.team1_id,
    m.team2_id
FROM matchups m
LEFT JOIN leagues l ON l.id = m.league_id
LEFT JOIN teams t1 ON t1.id = m.team1_id
LEFT JOIN teams t2 ON t2.id = m.team2_id
WHERE m.week_start_date <= CURRENT_DATE
  AND m.week_end_date >= CURRENT_DATE
ORDER BY l.league_name, m.week_number;

-- 6. For each team_lineups entry, check if it has a matching active matchup
SELECT 
    '6. TEAM_LINEUPS vs MATCHUPS (Does each team have an active matchup?)' as section,
    tl.team_id,
    t.team_name,
    tl.league_id,
    l.league_name,
    CASE 
        WHEN m.id IS NOT NULL THEN 'HAS MATCHUP ✅'
        ELSE 'NO MATCHUP ❌'
    END as matchup_status,
    m.id as matchup_id
FROM team_lineups tl
LEFT JOIN teams t ON t.id = tl.team_id
LEFT JOIN leagues l ON l.id = tl.league_id
LEFT JOIN matchups m ON (
    m.league_id = tl.league_id
    AND (m.team1_id = tl.team_id OR m.team2_id = tl.team_id)
    AND m.week_start_date <= CURRENT_DATE
    AND m.week_end_date >= CURRENT_DATE
)
ORDER BY l.league_name, t.team_name;

-- 7. Check if league_id matches between team_lineups and matchups
SELECT 
    '7. LEAGUE_ID VERIFICATION' as section,
    tl.team_id,
    t.team_name,
    tl.league_id as lineups_league_id,
    t.league_id as teams_league_id,
    CASE 
        WHEN tl.league_id = t.league_id THEN '✅ MATCH'
        ELSE '❌ MISMATCH'
    END as league_id_match
FROM team_lineups tl
LEFT JOIN teams t ON t.id = tl.team_id
ORDER BY t.team_name;

-- 8. Sample data from fantasy_daily_rosters to verify structure
SELECT 
    '8. SAMPLE fantasy_daily_rosters DATA' as section,
    fdr.team_id,
    t.team_name,
    fdr.player_id,
    fdr.slot_type,
    fdr.slot_id,
    fdr.roster_date,
    fdr.matchup_id
FROM fantasy_daily_rosters fdr
LEFT JOIN teams t ON t.id = fdr.team_id
WHERE fdr.roster_date = CURRENT_DATE
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 
    '═══════════════════════════════════════════════════════════' as separator,
    'DIAGNOSTIC COMPLETE' as status,
    'Review sections 1-8 above to identify the issue' as next_step,
    '═══════════════════════════════════════════════════════════' as separator2;
