-- ============================================================================
-- CRITICAL FIX: Auto-Sync Trigger Bug (>= vs > bug)
-- ============================================================================
-- Problem: The auto-sync trigger created in 20260115000001 has a critical bug
--          on line 40: roster_date >= v_today
--          This DELETES TODAY's data every time a lineup is updated!
--
-- This is the SAME bug that caused Monday/Tuesday data loss, now in the trigger.
--
-- Root Cause: Using >= means "today and future"
--             Should use > which means "only future"
--
-- Impact: Every time team_lineups is updated, TODAY's fantasy_daily_rosters
--         entries get deleted, causing data loss that appears "overnight"
-- ============================================================================

-- Drop and recreate the trigger function with the fix
DROP TRIGGER IF EXISTS trigger_auto_sync_roster_to_daily ON team_lineups;
DROP FUNCTION IF EXISTS auto_sync_team_lineup_to_daily_rosters();

-- Create CORRECTED function to sync team lineup changes to daily rosters
CREATE OR REPLACE FUNCTION auto_sync_team_lineup_to_daily_rosters()
RETURNS TRIGGER AS $$
DECLARE
  v_matchup_id UUID;
  v_week_start DATE;
  v_week_end DATE;
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Find current/future matchup for this team
  SELECT m.id, m.week_start_date, m.week_end_date
  INTO v_matchup_id, v_week_start, v_week_end
  FROM matchups m
  WHERE m.league_id = NEW.league_id
    AND (m.team1_id = NEW.team_id OR m.team2_id = NEW.team_id)
    AND m.week_end_date >= v_today
  ORDER BY m.week_start_date ASC
  LIMIT 1;
  
  -- If no current/future matchup, nothing to sync
  IF v_matchup_id IS NULL THEN
    RAISE NOTICE '[AUTO-SYNC] No current/future matchup for team %, skipping sync', NEW.team_id;
    RETURN NEW;
  END IF;
  
  RAISE NOTICE '[AUTO-SYNC] Syncing team % lineup to daily rosters for matchup %', NEW.team_id, v_matchup_id;
  
  -- CRITICAL FIX: Delete existing daily roster entries for FUTURE dates ONLY
  -- CHANGED: roster_date >= v_today (BUG) to roster_date > v_today (CORRECT)
  -- This preserves TODAY's data while still allowing future updates
  DELETE FROM fantasy_daily_rosters
  WHERE team_id = NEW.team_id
    AND matchup_id = v_matchup_id
    AND roster_date > v_today  -- FIXED: Only future dates, NOT today
    AND is_locked = false;
  
  -- Insert starters for today/future dates
  INSERT INTO fantasy_daily_rosters (
    league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
  )
  SELECT 
    NEW.league_id,
    NEW.team_id,
    v_matchup_id,
    (jsonb_array_elements_text(NEW.starters)::integer),
    d.roster_date,
    'active',
    NEW.slot_assignments->>(jsonb_array_elements_text(NEW.starters)::text),
    false
  FROM generate_series(
    GREATEST(v_today, v_week_start),
    v_week_end,
    '1 day'::interval
  ) AS d(roster_date)
  WHERE NEW.starters IS NOT NULL
    AND jsonb_array_length(NEW.starters) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
  SET 
    slot_type = EXCLUDED.slot_type,
    slot_id = EXCLUDED.slot_id,
    updated_at = NOW();
  
  -- Insert bench for today/future dates
  INSERT INTO fantasy_daily_rosters (
    league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
  )
  SELECT 
    NEW.league_id,
    NEW.team_id,
    v_matchup_id,
    (jsonb_array_elements_text(NEW.bench)::integer),
    d.roster_date,
    'bench',
    NULL,
    false
  FROM generate_series(
    GREATEST(v_today, v_week_start),
    v_week_end,
    '1 day'::interval
  ) AS d(roster_date)
  WHERE NEW.bench IS NOT NULL
    AND jsonb_array_length(NEW.bench) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
  SET 
    slot_type = EXCLUDED.slot_type,
    updated_at = NOW();
  
  -- Insert IR for today/future dates
  INSERT INTO fantasy_daily_rosters (
    league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
  )
  SELECT 
    NEW.league_id,
    NEW.team_id,
    v_matchup_id,
    (jsonb_array_elements_text(NEW.ir)::integer),
    d.roster_date,
    'ir',
    NEW.slot_assignments->>(jsonb_array_elements_text(NEW.ir)::text),
    false
  FROM generate_series(
    GREATEST(v_today, v_week_start),
    v_week_end,
    '1 day'::interval
  ) AS d(roster_date)
  WHERE NEW.ir IS NOT NULL
    AND jsonb_array_length(NEW.ir) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
  SET 
    slot_type = EXCLUDED.slot_type,
    slot_id = EXCLUDED.slot_id,
    updated_at = NOW();
  
  RAISE NOTICE '[AUTO-SYNC] ✅ Synced lineup for team % to daily rosters', NEW.team_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger on team_lineups UPDATE
CREATE TRIGGER trigger_auto_sync_roster_to_daily
AFTER UPDATE ON team_lineups
FOR EACH ROW
WHEN (
  -- Only trigger if lineup actually changed (not just updated_at)
  NEW.starters IS DISTINCT FROM OLD.starters OR
  NEW.bench IS DISTINCT FROM OLD.bench OR
  NEW.ir IS DISTINCT FROM OLD.ir OR
  NEW.slot_assignments IS DISTINCT FROM OLD.slot_assignments
)
EXECUTE FUNCTION auto_sync_team_lineup_to_daily_rosters();

-- Add table comment documenting the fix
COMMENT ON FUNCTION auto_sync_team_lineup_to_daily_rosters() IS 
'FIXED: Changed roster_date >= to roster_date > to prevent deleting TODAY''s data. 
This bug caused data loss on Jan 13, 14, and 15. 
CRITICAL: NEVER use >= with CURRENT_DATE in DELETE statements - it will delete today''s active data!';

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ AUTO-SYNC TRIGGER BUG FIXED';
  RAISE NOTICE '';
  RAISE NOTICE 'Changed: roster_date >= v_today (DELETES TODAY)';
  RAISE NOTICE 'To:      roster_date > v_today (ONLY FUTURE)';
  RAISE NOTICE '';
  RAISE NOTICE 'This bug caused data loss on:';
  RAISE NOTICE '  - Monday Jan 13 (faulty cleanup migration)';
  RAISE NOTICE '  - Tuesday Jan 14 (same faulty migration)';
  RAISE NOTICE '  - Wednesday Jan 15 (auto-sync trigger bug)';
  RAISE NOTICE '';
  RAISE NOTICE 'REMINDER: NEVER use >= with CURRENT_DATE in DELETE statements!';
  RAISE NOTICE '          Always use > to preserve today''s active data.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
