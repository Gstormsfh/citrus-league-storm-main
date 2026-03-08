-- ============================================================================
-- FIX: INSERT trigger should populate ALL dates in matchup week, not just today+future
-- ============================================================================
-- Problem: When an AI team's lineup is INSERTed (first time), the trigger only
--          creates fantasy_daily_rosters entries from GREATEST(today, week_start).
--          Past dates in the matchup week are left empty, resulting in 0.0 scores.
--
-- Fix: Create a dedicated INSERT trigger function that starts from week_start
--      (not today), so all dates including past are populated on first insert.
-- ============================================================================

-- Drop the existing INSERT trigger (it reused the UPDATE function)
DROP TRIGGER IF EXISTS trigger_auto_sync_roster_to_daily_on_insert ON team_lineups;

-- New INSERT-specific function that covers the full week including past dates
CREATE OR REPLACE FUNCTION sync_new_team_lineup_to_daily_rosters()
RETURNS TRIGGER AS $$
DECLARE
  v_matchup_id UUID;
  v_week_start DATE;
  v_week_end DATE;
  v_today DATE := CURRENT_DATE;
BEGIN
  IF NEW.league_id IS NULL OR NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find current or most recent in-progress matchup for this team
  SELECT m.id, m.week_start_date, m.week_end_date
  INTO v_matchup_id, v_week_start, v_week_end
  FROM matchups m
  WHERE m.league_id = NEW.league_id
    AND (m.team1_id = NEW.team_id OR m.team2_id = NEW.team_id)
    AND m.week_end_date >= v_today
  ORDER BY m.week_start_date ASC
  LIMIT 1;

  IF v_matchup_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- INSERT starters for ALL dates in the week (including past)
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
    d.roster_date < v_today  -- Lock past dates
  FROM generate_series(v_week_start, v_week_end, '1 day'::interval) AS d(roster_date)
  WHERE NEW.starters IS NOT NULL
    AND jsonb_array_length(NEW.starters) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

  -- INSERT bench for ALL dates
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
    d.roster_date < v_today
  FROM generate_series(v_week_start, v_week_end, '1 day'::interval) AS d(roster_date)
  WHERE NEW.bench IS NOT NULL
    AND jsonb_array_length(NEW.bench) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

  -- INSERT IR for ALL dates
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
    d.roster_date < v_today
  FROM generate_series(v_week_start, v_week_end, '1 day'::interval) AS d(roster_date)
  WHERE NEW.ir IS NOT NULL
    AND jsonb_array_length(NEW.ir) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- Recreate the INSERT trigger with the new function
CREATE TRIGGER trigger_auto_sync_roster_to_daily_on_insert
AFTER INSERT ON team_lineups
FOR EACH ROW
EXECUTE FUNCTION sync_new_team_lineup_to_daily_rosters();

COMMENT ON TRIGGER trigger_auto_sync_roster_to_daily_on_insert ON team_lineups IS
'Fires on INSERT to sync new team lineups to fantasy_daily_rosters for ALL dates in the matchup week (including past). This ensures AI teams get full-week roster entries on first lineup creation.';
