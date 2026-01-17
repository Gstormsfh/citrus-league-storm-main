-- ============================================================================
-- AUTO-FIX PHANTOM DROPS
-- ============================================================================
-- Automatically restores ALL missing players from team_lineups to fantasy_daily_rosters
-- Run this if COMPREHENSIVE_AUDIT.sql found phantom drops
-- ============================================================================

DO $$
DECLARE
  v_team RECORD;
  v_player_id INTEGER;
  v_matchup_id UUID;
  v_week_start DATE;
  v_week_end DATE;
  v_today DATE := CURRENT_DATE;
  v_slot_type TEXT;
  v_slot_id TEXT;
  v_fixed_count INTEGER := 0;
  v_total_missing INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'AUTO-FIX PHANTOM DROPS - Starting...';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Loop through all teams
  FOR v_team IN 
    SELECT 
      tl.team_id,
      tl.league_id,
      t.team_name,
      tl.starters,
      tl.bench,
      tl.ir,
      tl.slot_assignments
    FROM team_lineups tl
    JOIN teams t ON t.id = tl.team_id
  LOOP
    RAISE NOTICE 'Checking team: %', v_team.team_name;
    
    -- Get current matchup for this team
    SELECT m.id, m.week_start_date, m.week_end_date
    INTO v_matchup_id, v_week_start, v_week_end
    FROM matchups m
    WHERE m.league_id = v_team.league_id
      AND (m.team1_id = v_team.team_id OR m.team2_id = v_team.team_id)
      AND m.week_end_date >= v_today
    ORDER BY m.week_start_date ASC
    LIMIT 1;
    
    IF v_matchup_id IS NULL THEN
      RAISE NOTICE '  ⚠️  No current/future matchup found, skipping';
      CONTINUE;
    END IF;
    
    -- Check STARTERS
    IF v_team.starters IS NOT NULL AND jsonb_array_length(v_team.starters) > 0 THEN
      FOR v_player_id IN 
        SELECT (jsonb_array_elements_text(v_team.starters))::integer
      LOOP
        -- Check if player exists in fantasy_daily_rosters for today
        IF NOT EXISTS (
          SELECT 1 FROM fantasy_daily_rosters
          WHERE team_id = v_team.team_id
            AND player_id = v_player_id
            AND roster_date = v_today
        ) THEN
          v_total_missing := v_total_missing + 1;
          RAISE NOTICE '  🔧 FIXING: Player % missing from daily rosters (STARTER)', v_player_id;
          
          -- Get slot assignment
          v_slot_id := v_team.slot_assignments->>v_player_id::text;
          
          -- Insert for today through end of week
          INSERT INTO fantasy_daily_rosters (
            league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
          )
          SELECT 
            v_team.league_id,
            v_team.team_id,
            v_matchup_id,
            v_player_id,
            d.roster_date::DATE,
            'active',
            v_slot_id,
            false
          FROM generate_series(
            GREATEST(v_today, v_week_start),
            v_week_end,
            '1 day'::INTERVAL
          ) AS d(roster_date)
          ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
          SET slot_type = 'active', slot_id = EXCLUDED.slot_id, updated_at = NOW();
          
          v_fixed_count := v_fixed_count + 1;
        END IF;
      END LOOP;
    END IF;
    
    -- Check BENCH
    IF v_team.bench IS NOT NULL AND jsonb_array_length(v_team.bench) > 0 THEN
      FOR v_player_id IN 
        SELECT (jsonb_array_elements_text(v_team.bench))::integer
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM fantasy_daily_rosters
          WHERE team_id = v_team.team_id
            AND player_id = v_player_id
            AND roster_date = v_today
        ) THEN
          v_total_missing := v_total_missing + 1;
          RAISE NOTICE '  🔧 FIXING: Player % missing from daily rosters (BENCH)', v_player_id;
          
          INSERT INTO fantasy_daily_rosters (
            league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
          )
          SELECT 
            v_team.league_id,
            v_team.team_id,
            v_matchup_id,
            v_player_id,
            d.roster_date::DATE,
            'bench',
            NULL,
            false
          FROM generate_series(
            GREATEST(v_today, v_week_start),
            v_week_end,
            '1 day'::INTERVAL
          ) AS d(roster_date)
          ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
          SET slot_type = 'bench', updated_at = NOW();
          
          v_fixed_count := v_fixed_count + 1;
        END IF;
      END LOOP;
    END IF;
    
    -- Check IR
    IF v_team.ir IS NOT NULL AND jsonb_array_length(v_team.ir) > 0 THEN
      FOR v_player_id IN 
        SELECT (jsonb_array_elements_text(v_team.ir))::integer
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM fantasy_daily_rosters
          WHERE team_id = v_team.team_id
            AND player_id = v_player_id
            AND roster_date = v_today
        ) THEN
          v_total_missing := v_total_missing + 1;
          RAISE NOTICE '  🔧 FIXING: Player % missing from daily rosters (IR)', v_player_id;
          
          v_slot_id := v_team.slot_assignments->>v_player_id::text;
          
          INSERT INTO fantasy_daily_rosters (
            league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
          )
          SELECT 
            v_team.league_id,
            v_team.team_id,
            v_matchup_id,
            v_player_id,
            d.roster_date::DATE,
            'ir',
            v_slot_id,
            false
          FROM generate_series(
            GREATEST(v_today, v_week_start),
            v_week_end,
            '1 day'::INTERVAL
          ) AS d(roster_date)
          ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
          SET slot_type = 'ir', slot_id = EXCLUDED.slot_id, updated_at = NOW();
          
          v_fixed_count := v_fixed_count + 1;
        END IF;
      END LOOP;
    END IF;
    
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ AUTO-FIX COMPLETE!';
  RAISE NOTICE '';
  RAISE NOTICE 'Missing players found: %', v_total_missing;
  RAISE NOTICE 'Players restored: %', v_fixed_count;
  RAISE NOTICE '';
  IF v_total_missing = 0 THEN
    RAISE NOTICE '✅ No phantom drops detected - all rosters in sync!';
  ELSIF v_fixed_count = v_total_missing THEN
    RAISE NOTICE '✅ All phantom drops have been restored!';
  ELSE
    RAISE NOTICE '⚠️  Some players could not be restored. Check logs above.';
  END IF;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
END $$;

-- Verification: Show all teams with player counts
SELECT 
  t.team_name,
  (SELECT COUNT(DISTINCT player_id) FROM fantasy_daily_rosters 
   WHERE team_id = t.id AND roster_date = CURRENT_DATE) as players_today,
  jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
  jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
  jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as players_in_lineup,
  CASE 
    WHEN (SELECT COUNT(DISTINCT player_id) FROM fantasy_daily_rosters 
          WHERE team_id = t.id AND roster_date = CURRENT_DATE) =
         jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
         jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
         jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb))
    THEN '✅ SYNCED'
    ELSE '⚠️  MISMATCH'
  END as sync_status
FROM teams t
JOIN team_lineups tl ON tl.team_id = t.id
ORDER BY sync_status DESC, t.team_name;
