-- ============================================================================
-- COMPLETE ROSTER RESYNC: Sync ALL dates from team_lineups → fantasy_daily_rosters
-- ============================================================================
-- Problem: fantasy_daily_rosters is incomplete for ALL dates, not just Jan 13-14
--          Previous migrations only restored specific dates
--          Need COMPLETE resync to match Roster tab (which uses team_lineups)
--
-- Solution: DELETE all non-locked entries, then repopulate from team_lineups
--           for ALL active matchups and ALL dates in their week ranges
--
-- Safety: Only touches non-locked entries (preserves frozen historical data)
-- ============================================================================

-- Store counts BEFORE resync
DO $$
DECLARE
  v_before_count INTEGER;
  v_locked_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_before_count FROM fantasy_daily_rosters;
  SELECT COUNT(*) INTO v_locked_count FROM fantasy_daily_rosters WHERE is_locked = true;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '📊 BEFORE RESYNC:';
  RAISE NOTICE '   Total entries: %', v_before_count;
  RAISE NOTICE '   Locked entries (preserved): %', v_locked_count;
  RAISE NOTICE '   Non-locked (will delete): %', v_before_count - v_locked_count;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ============================================================================
-- STEP 1: DELETE all non-locked entries (preserves frozen historical data)
-- ============================================================================
DELETE FROM fantasy_daily_rosters 
WHERE is_locked = false;

-- Log deletion
DO $$
DECLARE
  v_after_delete INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_after_delete FROM fantasy_daily_rosters;
  RAISE NOTICE '🗑️  Deleted non-locked entries. Remaining (locked): %', v_after_delete;
END $$;

-- ============================================================================
-- STEP 2: REPOPULATE from team_lineups for ALL active matchups
-- ============================================================================

-- Insert STARTERS (active players)
INSERT INTO fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.starters)::integer) AS player_id,
  d.roster_date,
  'active' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.starters)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series(
  m.week_start_date,
  m.week_end_date,
  '1 day'::interval
) AS d(roster_date)
WHERE m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Insert BENCH players
INSERT INTO fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.bench)::integer) AS player_id,
  d.roster_date,
  'bench' AS slot_type,
  NULL AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series(
  m.week_start_date,
  m.week_end_date,
  '1 day'::interval
) AS d(roster_date)
WHERE m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.bench IS NOT NULL
  AND jsonb_array_length(tl.bench) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Insert IR players
INSERT INTO fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.ir)::integer) AS player_id,
  d.roster_date,
  'ir' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.ir)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series(
  m.week_start_date,
  m.week_end_date,
  '1 day'::interval
) AS d(roster_date)
WHERE m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.ir IS NOT NULL
  AND jsonb_array_length(tl.ir) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- ============================================================================
-- STEP 3: VERIFICATION - Count entries by date
-- ============================================================================
DO $$
DECLARE
  v_after_count INTEGER;
  v_date_record RECORD;
  v_team_record RECORD;
  v_total_expected INTEGER;
  v_total_actual INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_after_count FROM fantasy_daily_rosters;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ RESYNC COMPLETE';
  RAISE NOTICE '';
  RAISE NOTICE '📊 AFTER RESYNC:';
  RAISE NOTICE '   Total entries: %', v_after_count;
  RAISE NOTICE '';
  RAISE NOTICE '📅 ENTRIES BY DATE:';
  
  -- Show counts per date
  FOR v_date_record IN
    SELECT 
      roster_date,
      COUNT(*) as entry_count,
      COUNT(DISTINCT team_id) as team_count,
      COUNT(DISTINCT CASE WHEN slot_type = 'active' THEN player_id END) as starters,
      COUNT(DISTINCT CASE WHEN slot_type = 'bench' THEN player_id END) as bench,
      COUNT(DISTINCT CASE WHEN slot_type = 'ir' THEN player_id END) as ir
    FROM fantasy_daily_rosters
    WHERE roster_date >= CURRENT_DATE - INTERVAL '7 days'
      AND roster_date <= CURRENT_DATE + INTERVAL '7 days'
    GROUP BY roster_date
    ORDER BY roster_date
  LOOP
    RAISE NOTICE '   % : % entries (% teams, % starters, % bench, % IR)',
      v_date_record.roster_date,
      v_date_record.entry_count,
      v_date_record.team_count,
      v_date_record.starters,
      v_date_record.bench,
      v_date_record.ir;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '🔍 TEAM SYNC CHECK (comparing team_lineups vs fantasy_daily_rosters):';
  
  -- Compare team_lineups counts vs fantasy_daily_rosters for today
  FOR v_team_record IN
    WITH lineup_counts AS (
      SELECT 
        tl.team_id,
        t.team_name,
        jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as expected
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
    ),
    daily_counts AS (
      SELECT 
        fdr.team_id,
        COUNT(DISTINCT fdr.player_id) as actual
      FROM fantasy_daily_rosters fdr
      WHERE fdr.roster_date = CURRENT_DATE
      GROUP BY fdr.team_id
    )
    SELECT 
      lc.team_name,
      lc.expected,
      COALESCE(dc.actual, 0) as actual,
      lc.expected - COALESCE(dc.actual, 0) as difference
    FROM lineup_counts lc
    LEFT JOIN daily_counts dc ON dc.team_id = lc.team_id
    ORDER BY lc.team_name
  LOOP
    IF v_team_record.difference = 0 THEN
      RAISE NOTICE '   ✅ % : % players (synced)', v_team_record.team_name, v_team_record.expected;
    ELSE
      RAISE WARNING '   ⚠️  % : Expected % but got % (diff: %)', 
        v_team_record.team_name, 
        v_team_record.expected, 
        v_team_record.actual,
        v_team_record.difference;
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✅ COMPLETE ROSTER RESYNC FINISHED';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Run VERIFY_COMPLETE_SYNC.sql for detailed verification';
  RAISE NOTICE '  2. Check Matchup tab in UI - should show complete rosters';
  RAISE NOTICE '  3. Verify all dates work (past, today, future)';
  RAISE NOTICE '';
  RAISE NOTICE 'The auto-sync trigger will keep data in sync going forward.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
