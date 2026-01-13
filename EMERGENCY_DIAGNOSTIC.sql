-- ============================================================================
-- EMERGENCY DIAGNOSTIC: Monday January 13th Roster Mystery
-- Run this FIRST to understand what's happening
-- ============================================================================

-- 1. Check if Monday roster data exists
SELECT 'Monday Roster Count' as check_name, COUNT(*) as result
FROM fantasy_daily_rosters
WHERE roster_date = '2026-01-13'::DATE

UNION ALL

-- 2. Check what dates we have near Monday
SELECT 'Date Range Available' as check_name, COUNT(DISTINCT roster_date)::TEXT as result
FROM fantasy_daily_rosters
WHERE roster_date BETWEEN '2026-01-12'::DATE AND '2026-01-14'::DATE

UNION ALL

-- 3. Check if team_lineups has data
SELECT 'Teams with Lineups' as check_name, COUNT(*)::TEXT as result
FROM team_lineups

UNION ALL

-- 4. Check if we have starters
SELECT 'Teams with Starters' as check_name, COUNT(*)::TEXT as result
FROM team_lineups
WHERE starters IS NOT NULL AND jsonb_array_length(starters) > 0

UNION ALL

-- 5. Check if we have active matchups for this week
SELECT 'Active Matchups This Week' as check_name, COUNT(*)::TEXT as result
FROM matchups
WHERE week_start_date <= '2026-01-13'::DATE 
  AND week_end_date >= '2026-01-13'::DATE
  AND status IN ('scheduled', 'in_progress', 'completed');

-- ============================================================================
-- Show detailed breakdown by date
-- ============================================================================
SELECT 
  'DATE BREAKDOWN' as section,
  roster_date::TEXT,
  COUNT(*) as roster_entries,
  COUNT(DISTINCT team_id) as teams,
  COUNT(DISTINCT matchup_id) as matchups,
  string_agg(DISTINCT slot_type, ', ' ORDER BY slot_type) as slot_types
FROM fantasy_daily_rosters
WHERE roster_date BETWEEN '2026-01-10'::DATE AND '2026-01-15'::DATE
GROUP BY roster_date
ORDER BY roster_date;

-- ============================================================================
-- Show what's in team_lineups (sample 5 teams)
-- ============================================================================
SELECT 
  'TEAM LINEUPS SAMPLE' as section,
  team_id,
  league_id,
  jsonb_array_length(starters) as starters_count,
  jsonb_array_length(bench) as bench_count,
  jsonb_array_length(ir) as ir_count,
  updated_at
FROM team_lineups
LIMIT 5;

-- ============================================================================
-- Check if matchups exist for this week
-- ============================================================================
SELECT 
  'MATCHUPS FOR THIS WEEK' as section,
  id as matchup_id,
  week_start_date,
  week_end_date,
  status,
  team1_id,
  team2_id
FROM matchups
WHERE week_start_date <= '2026-01-13'::DATE 
  AND week_end_date >= '2026-01-13'::DATE
LIMIT 5;
