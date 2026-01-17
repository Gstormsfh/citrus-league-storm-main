-- ============================================================================
-- AUTO-SYNC: team_lineups to fantasy_daily_rosters
-- ============================================================================
-- Problem: When team_lineups changes, fantasy_daily_rosters doesn't update
-- Solution: Trigger that automatically syncs changes for today/future dates
-- ============================================================================

-- Create function to sync team lineup changes to daily rosters
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
  
  -- Delete existing daily roster entries for this team for today/future dates
  -- (Only unlocked entries - never touch locked historical data)
  DELETE FROM fantasy_daily_rosters
  WHERE team_id = NEW.team_id
    AND matchup_id = v_matchup_id
    AND roster_date >= v_today
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

-- Create trigger on team_lineups UPDATE
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

-- Log setup
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ AUTO-SYNC TRIGGER INSTALLED';
  RAISE NOTICE '';
  RAISE NOTICE 'When team_lineups is updated:';
  RAISE NOTICE '  1. Trigger detects lineup changes';
  RAISE NOTICE '  2. Finds current/future matchup';
  RAISE NOTICE '  3. Syncs to fantasy_daily_rosters for today/future dates';
  RAISE NOTICE '  4. Never touches past/locked dates';
  RAISE NOTICE '';
  RAISE NOTICE 'This prevents players from disappearing between tables!';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
