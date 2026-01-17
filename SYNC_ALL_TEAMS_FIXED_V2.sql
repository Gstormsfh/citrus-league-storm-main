-- ═══════════════════════════════════════════════════════════════════════════
-- SYNC ALL TEAMS - COMPREHENSIVE FIX
-- ═══════════════════════════════════════════════════════════════════════════
-- This script ensures ALL teams with lineups get synced, not just those with
-- active matchups today. It will show which teams can't be synced and why.
-- ═══════════════════════════════════════════════════════════════════════════

-- STEP 1: Report which teams will be synced
SELECT 
    'TEAMS THAT WILL BE SYNCED (have active matchups)' as report_section,
    COUNT(DISTINCT tl.team_id) as team_count,
    string_agg(DISTINCT t.team_name, ', ' ORDER BY t.team_name) as teams
FROM team_lineups tl
LEFT JOIN teams t ON t.id = tl.team_id
INNER JOIN matchups m ON (
    m.league_id = tl.league_id
    AND (m.team1_id = tl.team_id OR m.team2_id = tl.team_id)
    AND m.week_start_date <= CURRENT_DATE
    AND m.week_end_date >= CURRENT_DATE
);

-- STEP 2: Report which teams will be SKIPPED  
SELECT 
    'TEAMS THAT WILL BE SKIPPED (no active matchup)' as report_section,
    COUNT(DISTINCT tl.team_id) as team_count,
    string_agg(DISTINCT t.team_name, ', ' ORDER BY t.team_name) as teams
FROM team_lineups tl
LEFT JOIN teams t ON t.id = tl.team_id
WHERE NOT EXISTS (
    SELECT 1 FROM matchups m
    WHERE m.league_id = tl.league_id
      AND (m.team1_id = tl.team_id OR m.team2_id = tl.team_id)
      AND m.week_start_date <= CURRENT_DATE
      AND m.week_end_date >= CURRENT_DATE
);

-- STEP 3: Delete today's unlocked rosters
DELETE FROM fantasy_daily_rosters
WHERE roster_date = CURRENT_DATE
  AND is_locked = false;

-- STEP 4: Sync ACTIVE players for all teams with matchups
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

-- STEP 5: Sync BENCH players
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

-- STEP 6: Sync IR players
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

-- Show which teams got synced
SELECT 
    '✅ TEAMS SYNCED' as status,
    COUNT(DISTINCT fdr.team_id) as teams_synced,
    string_agg(DISTINCT t.team_name, ', ' ORDER BY t.team_name) as team_names
FROM fantasy_daily_rosters fdr
LEFT JOIN teams t ON t.id = fdr.team_id
WHERE fdr.roster_date = CURRENT_DATE;

-- Show player counts by team
SELECT 
    'PLAYER COUNTS BY TEAM' as status,
    t.team_name,
    COUNT(*) as total_players,
    COUNT(CASE WHEN fdr.slot_type = 'active' THEN 1 END) as active,
    COUNT(CASE WHEN fdr.slot_type = 'bench' THEN 1 END) as bench,
    COUNT(CASE WHEN fdr.slot_type = 'ir' THEN 1 END) as ir
FROM fantasy_daily_rosters fdr
LEFT JOIN teams t ON t.id = fdr.team_id
WHERE fdr.roster_date = CURRENT_DATE
GROUP BY t.team_name
ORDER BY t.team_name;

-- Show teams still missing (should be empty if all teams have matchups)
SELECT 
    '⚠️ TEAMS STILL MISSING' as status,
    COUNT(DISTINCT tl.team_id) as missing_count,
    string_agg(DISTINCT t.team_name, ', ' ORDER BY t.team_name) as team_names
FROM team_lineups tl
LEFT JOIN teams t ON t.id = tl.team_id
WHERE tl.team_id NOT IN (
    SELECT DISTINCT team_id 
    FROM fantasy_daily_rosters 
    WHERE roster_date = CURRENT_DATE
);

SELECT 
    '═══════════════════════════════════════════════════════════════' as separator,
    'SYNC COMPLETE' as message,
    'Check above to see which teams were synced and which were skipped' as next_step,
    '═══════════════════════════════════════════════════════════════' as separator2;
