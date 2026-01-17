-- ============================================================================
-- QUICK VERIFICATION - Run this immediately after migrations
-- ============================================================================

-- 1. Check data counts for Mon/Tue/Wed
SELECT 
  roster_date,
  COUNT(*) as entries,
  COUNT(DISTINCT team_id) as teams,
  COUNT(DISTINCT player_id) as unique_players,
  CASE 
    WHEN COUNT(*) = 0 THEN '❌ EMPTY'
    WHEN COUNT(*) < 50 THEN '⚠️  LOW'
    ELSE '✅ GOOD'
  END as status
FROM fantasy_daily_rosters
WHERE roster_date IN ('2026-01-13', '2026-01-14', '2026-01-15')
GROUP BY roster_date
ORDER BY roster_date;

-- 2. Verify trigger is fixed
DO $$
DECLARE
  v_function_source TEXT;
BEGIN
  SELECT pg_get_functiondef(oid)
  INTO v_function_source
  FROM pg_proc
  WHERE proname = 'auto_sync_team_lineup_to_daily_rosters';
  
  IF v_function_source LIKE '%roster_date >= v_today%' THEN
    RAISE WARNING '❌ BUG STILL EXISTS: roster_date >= v_today';
  ELSIF v_function_source LIKE '%roster_date > v_today%' THEN
    RAISE NOTICE '✅ TRIGGER FIXED: Uses roster_date > v_today (correct!)';
  ELSE
    RAISE WARNING '⚠️  Could not verify trigger';
  END IF;
END $$;

-- 3. Check for any team with missing players
WITH lineup_counts AS (
  SELECT 
    t.team_name,
    jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as total_in_lineup
  FROM team_lineups tl
  JOIN teams t ON t.id = tl.team_id
),
daily_counts AS (
  SELECT 
    t.team_name,
    COUNT(DISTINCT fdr.player_id) as total_in_daily
  FROM fantasy_daily_rosters fdr
  JOIN teams t ON t.id = fdr.team_id
  WHERE fdr.roster_date = '2026-01-15'::DATE
  GROUP BY t.team_name
)
SELECT 
  lc.team_name,
  lc.total_in_lineup,
  COALESCE(dc.total_in_daily, 0) as wed_players,
  lc.total_in_lineup - COALESCE(dc.total_in_daily, 0) as diff,
  CASE 
    WHEN lc.total_in_lineup = COALESCE(dc.total_in_daily, 0) THEN '✅ SYNCED'
    ELSE '⚠️  MISMATCH'
  END as status
FROM lineup_counts lc
LEFT JOIN daily_counts dc ON dc.team_name = lc.team_name
ORDER BY diff DESC;
