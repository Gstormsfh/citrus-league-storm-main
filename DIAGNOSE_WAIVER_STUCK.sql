-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNOSE STUCK WAIVERS - Why is Ekholm stuck on waivers for 4 days?
-- ═══════════════════════════════════════════════════════════════════════════
-- This script diagnoses why waivers aren't processing and what state
-- players are stuck in.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Check all pending waiver claims
SELECT 
    '1. PENDING WAIVER CLAIMS' as section,
    wc.id as claim_id,
    wc.league_id,
    l.league_name,
    wc.team_id,
    t.team_name,
    wc.player_id,
    pd.full_name as player_name,
    wc.drop_player_id,
    wc.status,
    wc.failure_reason,
    wc.created_at,
    wc.processed_at,
    NOW() - wc.created_at as time_stuck
FROM waiver_claims wc
LEFT JOIN leagues l ON l.id = wc.league_id
LEFT JOIN teams t ON t.id = wc.team_id
LEFT JOIN player_directory pd ON pd.player_id = wc.player_id
ORDER BY wc.created_at DESC
LIMIT 20;

-- 2. Check player_waiver_status table (shows players put on waivers when dropped)
SELECT 
    '2. PLAYER WAIVER STATUS (Recently Dropped Players)' as section,
    pws.id,
    pws.league_id,
    l.league_name,
    pws.player_id,
    pd.full_name as player_name,
    pws.dropped_at,
    pws.waiver_period_hours,
    pws.cleared_at,
    NOW() - pws.dropped_at as time_on_waivers,
    CASE 
        WHEN pws.cleared_at IS NOT NULL THEN 'CLEARED ✅'
        WHEN NOW() > pws.dropped_at + (pws.waiver_period_hours || ' hours')::INTERVAL THEN 'SHOULD BE CLEARED ⚠️'
        ELSE 'STILL ON WAIVERS'
    END as waiver_status
FROM player_waiver_status pws
LEFT JOIN leagues l ON l.id = pws.league_id
LEFT JOIN player_directory pd ON pd.player_id = pws.player_id
ORDER BY pws.dropped_at DESC
LIMIT 20;

-- 3. Search specifically for Ekholm (player_id search)
SELECT 
    '3. SEARCH FOR EKHOLM' as section,
    pd.player_id,
    pd.full_name,
    pd.team_abbrev
FROM player_directory pd
WHERE LOWER(pd.full_name) LIKE '%ekholm%'
   OR LOWER(pd.full_name) LIKE '%mattias%';

-- 4. Check waiver claims for Ekholm specifically (using name search)
SELECT 
    '4. EKHOLM WAIVER CLAIMS' as section,
    wc.*,
    pd.full_name
FROM waiver_claims wc
JOIN player_directory pd ON pd.player_id = wc.player_id
WHERE LOWER(pd.full_name) LIKE '%ekholm%'
ORDER BY wc.created_at DESC;

-- 5. Check if Ekholm is in any team's roster
SELECT 
    '5. EKHOLM IN TEAM ROSTERS' as section,
    tl.team_id,
    t.team_name,
    l.league_name,
    CASE 
        WHEN tl.starters @> jsonb_build_array(player_id::text) THEN 'STARTERS'
        WHEN tl.bench @> jsonb_build_array(player_id::text) THEN 'BENCH'
        WHEN tl.ir @> jsonb_build_array(player_id::text) THEN 'IR'
        ELSE 'NOT FOUND'
    END as roster_location
FROM player_directory pd
CROSS JOIN team_lineups tl
JOIN teams t ON t.id = tl.team_id
JOIN leagues l ON l.id = tl.league_id
WHERE LOWER(pd.full_name) LIKE '%ekholm%'
  AND (
    tl.starters @> jsonb_build_array(pd.player_id::text)
    OR tl.bench @> jsonb_build_array(pd.player_id::text)
    OR tl.ir @> jsonb_build_array(pd.player_id::text)
  );

-- 6. Check league waiver settings
SELECT 
    '6. LEAGUE WAIVER SETTINGS' as section,
    id as league_id,
    league_name,
    waiver_type,
    waiver_period_hours,
    waiver_process_time,
    waiver_game_lock
FROM leagues
WHERE waiver_type IS NOT NULL
ORDER BY league_name;

-- 7. Check waiver priority (who gets first pick)
SELECT 
    '7. WAIVER PRIORITY ORDER' as section,
    wp.league_id,
    l.league_name,
    wp.team_id,
    t.team_name,
    wp.priority,
    wp.updated_at
FROM waiver_priority wp
JOIN leagues l ON l.id = wp.league_id
JOIN teams t ON t.id = wp.team_id
ORDER BY wp.league_id, wp.priority;

-- 8. Check if process_waiver_claims function exists
SELECT 
    '8. WAIVER FUNCTION CHECK' as section,
    proname as function_name,
    prosrc IS NOT NULL as has_source
FROM pg_proc
WHERE proname LIKE '%waiver%';

-- 9. Check for any scheduled jobs (pg_cron)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'cron' AND table_name = 'job'
  ) THEN
    RAISE NOTICE 'pg_cron is available. Checking for waiver jobs...';
  ELSE
    RAISE WARNING '⚠️ pg_cron extension is NOT installed!';
    RAISE WARNING 'Waivers will NEVER process automatically without a scheduled job.';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNOSIS SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 
    '═══════════════════════════════════════════════════════════' as separator,
    'LIKELY ISSUE: No scheduled job to call process_waiver_claims()' as diagnosis,
    'SOLUTION: Create pg_cron job or Edge Function to process waivers daily' as solution,
    '═══════════════════════════════════════════════════════════' as separator2;
