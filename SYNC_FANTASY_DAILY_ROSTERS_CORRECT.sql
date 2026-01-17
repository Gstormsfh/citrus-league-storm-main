-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECT SYNC SCRIPT - Matches Schema & Constraints
-- ═══════════════════════════════════════════════════════════════════════════
-- This script syncs team_lineups to fantasy_daily_rosters for TODAY ONLY
-- Future dates are handled automatically by the bulletproof trigger
--
-- CRITICAL:
-- - slot_type must be 'active', 'bench', or 'ir' (NOT 'starter')
-- - Active players need slot_id from slot_assignments
-- - Uses jsonb_array_elements_text to properly handle quoted player IDs
-- ═══════════════════════════════════════════════════════════════════════════

-- Delete today's unlocked rosters
DELETE FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
  AND is_locked = false;  -- Only delete unlocked entries

-- Sync ACTIVE players (starters) with slot_id using UPSERT
INSERT INTO fantasy_daily_rosters (
    id,
    league_id,
    team_id,
    matchup_id,
    player_id,
    roster_date,
    slot_type,
    slot_id,
    is_locked,
    locked_at,
    created_at,
    updated_at
)
SELECT 
    gen_random_uuid() as id,
    tl.league_id,
    tl.team_id,
    m.id as matchup_id,
    player_info.player_id::integer as player_id,
    CURRENT_DATE as roster_date,
    'active' as slot_type,
    tl.slot_assignments->>player_info.player_id as slot_id,
    false as is_locked,
    NULL as locked_at,
    NOW() as created_at,
    NOW() as updated_at
FROM team_lineups tl
CROSS JOIN LATERAL jsonb_array_elements_text(tl.starters) AS player_info(player_id)
INNER JOIN matchups m ON (
    m.league_id = tl.league_id
    AND (m.team1_id = tl.team_id OR m.team2_id = tl.team_id)
    AND m.week_start_date <= CURRENT_DATE
    AND m.week_end_date >= CURRENT_DATE
)
WHERE tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date)
DO UPDATE SET
    slot_type = EXCLUDED.slot_type,
    slot_id = EXCLUDED.slot_id,
    updated_at = NOW();

-- Sync BENCH players (no slot_id) using UPSERT
INSERT INTO fantasy_daily_rosters (
    id,
    league_id,
    team_id,
    matchup_id,
    player_id,
    roster_date,
    slot_type,
    slot_id,
    is_locked,
    locked_at,
    created_at,
    updated_at
)
SELECT 
    gen_random_uuid() as id,
    tl.league_id,
    tl.team_id,
    m.id as matchup_id,
    player_info.player_id::integer as player_id,
    CURRENT_DATE as roster_date,
    'bench' as slot_type,
    NULL as slot_id,
    false as is_locked,
    NULL as locked_at,
    NOW() as created_at,
    NOW() as updated_at
FROM team_lineups tl
CROSS JOIN LATERAL jsonb_array_elements_text(tl.bench) AS player_info(player_id)
INNER JOIN matchups m ON (
    m.league_id = tl.league_id
    AND (m.team1_id = tl.team_id OR m.team2_id = tl.team_id)
    AND m.week_start_date <= CURRENT_DATE
    AND m.week_end_date >= CURRENT_DATE
)
WHERE tl.bench IS NOT NULL
  AND jsonb_array_length(tl.bench) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date)
DO UPDATE SET
    slot_type = EXCLUDED.slot_type,
    slot_id = EXCLUDED.slot_id,
    updated_at = NOW();

-- Sync IR players (with slot_id if assigned) using UPSERT
INSERT INTO fantasy_daily_rosters (
    id,
    league_id,
    team_id,
    matchup_id,
    player_id,
    roster_date,
    slot_type,
    slot_id,
    is_locked,
    locked_at,
    created_at,
    updated_at
)
SELECT 
    gen_random_uuid() as id,
    tl.league_id,
    tl.team_id,
    m.id as matchup_id,
    player_info.player_id::integer as player_id,
    CURRENT_DATE as roster_date,
    'ir' as slot_type,
    tl.slot_assignments->>player_info.player_id as slot_id,
    false as is_locked,
    NULL as locked_at,
    NOW() as created_at,
    NOW() as updated_at
FROM team_lineups tl
CROSS JOIN LATERAL jsonb_array_elements_text(tl.ir) AS player_info(player_id)
INNER JOIN matchups m ON (
    m.league_id = tl.league_id
    AND (m.team1_id = tl.team_id OR m.team2_id = tl.team_id)
    AND m.week_start_date <= CURRENT_DATE
    AND m.week_end_date >= CURRENT_DATE
)
WHERE tl.ir IS NOT NULL
  AND jsonb_array_length(tl.ir) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date)
DO UPDATE SET
    slot_type = EXCLUDED.slot_type,
    slot_id = EXCLUDED.slot_id,
    updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION REPORT
-- ═══════════════════════════════════════════════════════════════════════════

-- Show sync results
SELECT 
    '✅ SYNC COMPLETE' as status,
    COUNT(DISTINCT team_id) || ' teams' as teams_synced,
    COUNT(*) || ' total players' as total_players,
    COUNT(DISTINCT matchup_id) || ' matchups' as matchups_affected
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE;

-- Breakdown by slot type
SELECT 
    'Slot Type Breakdown' as category,
    slot_type,
    COUNT(*) as player_count,
    COUNT(DISTINCT team_id) as team_count
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
GROUP BY slot_type
ORDER BY 
    CASE slot_type 
        WHEN 'active' THEN 1 
        WHEN 'bench' THEN 2 
        WHEN 'ir' THEN 3 
    END;

-- Show teams that couldn't be synced (no active matchup today)
WITH teams_with_matchup AS (
    SELECT DISTINCT tl.team_id, tl.league_id
    FROM team_lineups tl
    INNER JOIN matchups m ON (
        m.league_id = tl.league_id
        AND (m.team1_id = tl.team_id OR m.team2_id = tl.team_id)
        AND m.week_start_date <= CURRENT_DATE
        AND m.week_end_date >= CURRENT_DATE
    )
),
all_teams AS (
    SELECT team_id, league_id FROM team_lineups
)
SELECT 
    '⚠️ TEAMS SKIPPED (No active matchup today)' as warning,
    COUNT(*) || ' teams' as skipped_count
FROM all_teams
WHERE team_id NOT IN (SELECT team_id FROM teams_with_matchup);

-- Verify active players have slot_id
SELECT 
    'Active Players with Missing slot_id' as check_name,
    COUNT(*) as count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ PASS'
        ELSE '⚠️ WARNING'
    END as status
FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
  AND slot_type = 'active'
  AND slot_id IS NULL;

SELECT 
    '═══════════════════════════════════════════════════════════════' as separator,
    'SYNC COMPLETE - Future dates handled by bulletproof trigger' as message,
    '═══════════════════════════════════════════════════════════════' as separator2;
