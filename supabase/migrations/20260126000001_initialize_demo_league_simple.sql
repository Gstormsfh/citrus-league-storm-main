-- ============================================================================
-- INITIALIZE DEMO LEAGUE FOR GUEST VIEWING - SIMPLIFIED VERSION
-- ============================================================================
-- This migration creates a demo league using YOUR user ID as commissioner
-- The league is still publicly readable via RLS policies
-- ============================================================================

-- STEP 1: Clean up any existing demo league data
DO $$
BEGIN
  DELETE FROM fantasy_daily_rosters WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
  DELETE FROM team_lineups WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
  DELETE FROM matchups WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
  DELETE FROM draft_picks WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
  DELETE FROM draft_order WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
  DELETE FROM teams WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
  DELETE FROM leagues WHERE id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
  
  RAISE NOTICE 'Cleaned up existing demo league data';
END $$;

-- STEP 2: Create the demo league using the FIRST user in auth.users as commissioner
-- This ensures we have a valid commissioner_id that satisfies the NOT NULL constraint
DO $$
DECLARE
  first_user_id UUID;
  player_count INTEGER;
BEGIN
  -- Get the first user from auth.users to use as demo commissioner
  SELECT id INTO first_user_id 
  FROM auth.users 
  ORDER BY created_at 
  LIMIT 1;
  
  IF first_user_id IS NULL THEN
    RAISE EXCEPTION 'No users found in auth.users table. Please create at least one user account first.';
  END IF;
  
  RAISE NOTICE 'Using user % as demo league commissioner', first_user_id;
  
  -- Check if we have enough players
  SELECT COUNT(*) INTO player_count
  FROM players
  WHERE position IN ('C', 'LW', 'RW', 'D', 'G');
  
  IF player_count < 210 THEN
    RAISE EXCEPTION 'Not enough players in database. Found % players, need at least 210. Run player ingestion first.', player_count;
  END IF;
  
  RAISE NOTICE 'Found % players in database', player_count;
  
  -- Create the demo league
  INSERT INTO leagues (
    id,
    name,
    commissioner_id,
    join_code,
    roster_size,
    draft_rounds,
    draft_status,
    settings,
    created_at,
    updated_at,
    waiver_type,
    waiver_period_hours,
    waiver_process_time,
    waiver_game_lock,
    allow_trades_during_games,
    scoring_settings
  ) VALUES (
    '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID,
    'Demo League - Citrus Storm Showcase',
    first_user_id,
    'DEMO2026',
    21,
    21,
    'completed',
    '{"demo": true, "public": true}'::jsonb,
    NOW() - INTERVAL '3 weeks',
    NOW() - INTERVAL '3 weeks',
    'rolling',
    48,
    '03:00:00'::TIME,
    true,
    true,
    '{
      "skater": {
        "goals": 3,
        "assists": 2,
        "power_play_points": 1,
        "short_handed_points": 2,
        "shots_on_goal": 0.4,
        "blocks": 0.5,
        "hits": 0.2,
        "penalty_minutes": 0.5
      },
      "goalie": {
        "wins": 4,
        "shutouts": 3,
        "saves": 0.2,
        "goals_against": -1
      }
    }'::jsonb
  );
  
  RAISE NOTICE 'Demo league created successfully';
END $$;

-- STEP 3: Create 10 demo teams
DO $$
DECLARE
  team_names TEXT[] := ARRAY[
    'Citrus Crushers',
    'Storm Surge',
    'Thunder Bolts',
    'Ice Kings',
    'Frost Giants',
    'Lightning Strikes',
    'Avalanche Force',
    'Blizzard Brigade',
    'Hurricane Heroes',
    'Tornado Titans'
  ];
  team_id UUID;
  i INTEGER;
BEGIN
  FOR i IN 1..10 LOOP
    team_id := gen_random_uuid();
    
    INSERT INTO teams (
      id,
      league_id,
      team_name,
      owner_id,
      created_at,
      updated_at
    ) VALUES (
      team_id,
      '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID,
      team_names[i],
      NULL, -- No owner_id for demo teams (allows public viewing)
      NOW() - INTERVAL '3 weeks',
      NOW() - INTERVAL '3 weeks'
    );
    
    RAISE NOTICE 'Created team %: %', i, team_names[i];
  END LOOP;
END $$;

-- STEP 4: Simulate completed draft with serpentine order
DO $$
DECLARE
  teams_array UUID[];
  player_ids UUID[]; -- FIXED: players.id is UUID, not INTEGER
  current_pick INTEGER := 1;
  current_round INTEGER;
  pick_in_round INTEGER;
  team_index INTEGER;
  team_id UUID;
  player_id UUID; -- FIXED: UUID, not INTEGER
  session_id UUID := gen_random_uuid();
BEGIN
  -- Get all demo team IDs in order
  SELECT ARRAY_AGG(id ORDER BY created_at) INTO teams_array
  FROM teams
  WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  
  -- Get players for draft: ensure BALANCED mix with enough of each position
  -- Select players that exist in BOTH players AND player_directory to ensure lineup generation works
  -- For 10 teams × 21 rounds = 210 players, we need: ~30 goalies, ~50 D, ~130 forwards
  WITH matched_goalies AS (
    SELECT DISTINCT
      p.id::UUID,
      p.position,
      p.points
    FROM players p
    INNER JOIN player_directory pd 
      ON pd.full_name = p.full_name 
      AND pd.team_abbrev = p.team 
      AND pd.season = 2025
    WHERE pd.is_goalie = true
    ORDER BY p.points DESC NULLS LAST
    LIMIT 30  -- Enough for 2-3 per team
  ),
  matched_defense AS (
    SELECT DISTINCT
      p.id::UUID,
      p.position,
      p.points
    FROM players p
    INNER JOIN player_directory pd 
      ON pd.full_name = p.full_name 
      AND pd.team_abbrev = p.team 
      AND pd.season = 2025
    WHERE pd.position_code = 'D'
    ORDER BY p.points DESC NULLS LAST
    LIMIT 50  -- Enough for 4-5 per team
  ),
  matched_forwards AS (
    SELECT DISTINCT
      p.id::UUID,
      p.position,
      p.points
    FROM players p
    INNER JOIN player_directory pd 
      ON pd.full_name = p.full_name 
      AND pd.team_abbrev = p.team 
      AND pd.season = 2025
    WHERE pd.position_code IN ('C', 'LW', 'RW')
      OR (pd.position_code LIKE 'C/%' OR pd.position_code LIKE 'LW/%' OR pd.position_code LIKE 'RW/%')
    ORDER BY p.points DESC NULLS LAST
    LIMIT 130  -- Rest are forwards
  ),
  all_draft_players AS (
    SELECT id, position, points FROM matched_goalies
    UNION ALL
    SELECT id, position, points FROM matched_defense
    UNION ALL
    SELECT id, position, points FROM matched_forwards
  )
  SELECT ARRAY_AGG(id::UUID ORDER BY points DESC NULLS LAST) INTO player_ids
  FROM all_draft_players;
  
  RAISE NOTICE 'Starting draft simulation with % teams and % players', 
    array_length(teams_array, 1), array_length(player_ids, 1);
  
  -- Simulate serpentine draft (snake draft)
  FOR current_round IN 1..21 LOOP
    FOR pick_in_round IN 1..10 LOOP
      -- Serpentine: odd rounds go forward (1-10), even rounds go backward (10-1)
      IF current_round % 2 = 1 THEN
        team_index := pick_in_round;
      ELSE
        team_index := 11 - pick_in_round;
      END IF;
      
      team_id := teams_array[team_index];
      player_id := player_ids[current_pick];
      
      INSERT INTO draft_picks (
        league_id,
        team_id,
        player_id,
        round_number,
        pick_number,
        draft_session_id,
        picked_at
      ) VALUES (
        '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID,
        team_id,
        player_id::TEXT, -- FIXED: draft_picks.player_id is TEXT, cast UUID to TEXT
        current_round,
        current_pick,
        session_id,
        NOW() - INTERVAL '3 weeks' + (current_pick || ' seconds')::INTERVAL
      );
      
      current_pick := current_pick + 1;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'Completed draft simulation: % picks created', current_pick - 1;
END $$;

-- STEP 5: Create draft order records
DO $$
DECLARE
  teams_array UUID[];
  reversed_array UUID[];
  session_id UUID;
  current_round INTEGER;
  i INTEGER;
BEGIN
  -- Get session ID from first draft pick
  SELECT draft_session_id INTO session_id
  FROM draft_picks
  WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
  ORDER BY pick_number
  LIMIT 1;
  
  -- Get all demo team IDs in order
  SELECT ARRAY_AGG(id ORDER BY created_at) INTO teams_array
  FROM teams
  WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  
  -- Create draft order for each round (serpentine)
  FOR current_round IN 1..21 LOOP
    -- For even rounds, reverse the array manually
    IF current_round % 2 = 0 THEN
      reversed_array := ARRAY[]::UUID[];
      FOR i IN REVERSE array_length(teams_array, 1)..1 LOOP
        reversed_array := array_append(reversed_array, teams_array[i]);
      END LOOP;
      
      INSERT INTO draft_order (
        league_id,
        round_number,
        team_order,
        draft_session_id
      ) VALUES (
        '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID,
        current_round,
        to_jsonb(reversed_array), -- FIXED: team_order is JSONB, not UUID[]
        session_id
      );
    ELSE
      INSERT INTO draft_order (
        league_id,
        round_number,
        team_order,
        draft_session_id
      ) VALUES (
        '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID,
        current_round,
        to_jsonb(teams_array), -- FIXED: team_order is JSONB, not UUID[]
        session_id
      );
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Created draft order for 21 rounds';
END $$;

-- STEP 6: Initialize team lineups
-- CRITICAL: team_lineups columns are: team_id (UUID), league_id (UUID), starters (JSONB), bench (JSONB), ir (JSONB), slot_assignments (JSONB)
DO $$
DECLARE
  team_record RECORD;
  player_rec RECORD;
  starters_list TEXT[];
  bench_list TEXT[];
  slot_assignments_json JSONB;
  nhl_player_id TEXT;
  position_code TEXT;
  current_slot TEXT;
  c_count INTEGER;
  rw_count INTEGER;
  lw_count INTEGER;
  d_count INTEGER;
  g_count INTEGER;
  util_count INTEGER;
BEGIN
  FOR team_record IN 
    SELECT id, team_name 
    FROM teams 
    WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
    ORDER BY created_at
  LOOP
    -- Reset counters and arrays for each team
    starters_list := ARRAY[]::TEXT[];
    bench_list := ARRAY[]::TEXT[];
    slot_assignments_json := '{}'::jsonb;
    c_count := 0;
    rw_count := 0;
    lw_count := 0;
    d_count := 0;
    g_count := 0;
    util_count := 0;
    
    -- Get all players for this team with their positions, ordered by draft pick
    -- CRITICAL: Convert UUIDs to NHL player IDs (INTEGER as TEXT) for trigger compatibility
    FOR player_rec IN
      SELECT 
        dp.pick_number,
        (SELECT pd.player_id::TEXT
         FROM players p
         INNER JOIN player_directory pd ON pd.full_name = p.full_name AND pd.team_abbrev = p.team
         WHERE p.id::TEXT = dp.player_id
         AND pd.season = 2025
         LIMIT 1) as nhl_player_id,
        (SELECT pd.position_code
         FROM players p
         INNER JOIN player_directory pd ON pd.full_name = p.full_name AND pd.team_abbrev = p.team
         WHERE p.id::TEXT = dp.player_id
         AND pd.season = 2025
         LIMIT 1) as position_code
      FROM draft_picks dp
      WHERE dp.league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
      AND dp.team_id = team_record.id
      AND dp.deleted_at IS NULL
      ORDER BY dp.pick_number
    LOOP
      -- Skip if no NHL ID or position found
      IF player_rec.nhl_player_id IS NULL OR player_rec.position_code IS NULL THEN
        CONTINUE;
      END IF;
      
      nhl_player_id := player_rec.nhl_player_id;
      position_code := player_rec.position_code;
      
      -- Fill starters: 2C, 2RW, 2LW, 4D, 2G, 1UTIL (13 total)
      -- Use simpler position matching - player_directory.position_code is typically single letter
      IF array_length(starters_list, 1) < 13 THEN
        -- Check if we need this position (position_code is typically 'C', 'RW', 'LW', 'D', 'G')
        IF (position_code = 'C' OR position_code LIKE '%C%') AND c_count < 2 THEN
          c_count := c_count + 1;
          current_slot := 'slot-C-' || c_count;
          starters_list := array_append(starters_list, nhl_player_id);
          slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
        ELSIF (position_code = 'RW' OR position_code LIKE '%RW%' OR position_code LIKE '%Right%') AND rw_count < 2 THEN
          rw_count := rw_count + 1;
          current_slot := 'slot-RW-' || rw_count;
          starters_list := array_append(starters_list, nhl_player_id);
          slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
        ELSIF (position_code = 'LW' OR position_code LIKE '%LW%' OR position_code LIKE '%Left%') AND lw_count < 2 THEN
          lw_count := lw_count + 1;
          current_slot := 'slot-LW-' || lw_count;
          starters_list := array_append(starters_list, nhl_player_id);
          slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
        ELSIF (position_code = 'D' OR position_code LIKE '%D%') AND d_count < 4 THEN
          d_count := d_count + 1;
          current_slot := 'slot-D-' || d_count;
          starters_list := array_append(starters_list, nhl_player_id);
          slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
        ELSIF (position_code = 'G' OR position_code LIKE '%G%') AND g_count < 2 THEN
          g_count := g_count + 1;
          current_slot := 'slot-G-' || g_count;
          starters_list := array_append(starters_list, nhl_player_id);
          slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
        ELSIF util_count < 1 THEN
          -- Fill UTIL slot with any remaining position (catch-all for positions we don't recognize)
          util_count := util_count + 1;
          current_slot := 'slot-UTIL';
          starters_list := array_append(starters_list, nhl_player_id);
          slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
        ELSE
          -- This position slot is full, but we still need more starters - add to bench for now
          -- Actually, if we're here and starters_list < 13, we should still try to fill
          -- This means we have extra players of positions we already filled - put them in UTIL if available
          IF util_count < 1 THEN
            util_count := util_count + 1;
            current_slot := 'slot-UTIL';
            starters_list := array_append(starters_list, nhl_player_id);
            slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
          ELSE
            -- UTIL also full, add to bench
            bench_list := array_append(bench_list, nhl_player_id);
          END IF;
        END IF;
      ELSE
        -- Starters full (13 players), add to bench
        bench_list := array_append(bench_list, nhl_player_id);
      END IF;
    END LOOP;
    
    -- Insert lineup with proper column names: team_id, league_id, starters, bench, ir, slot_assignments
    INSERT INTO team_lineups (
      team_id,
      league_id,
      starters,
      bench,
      ir,
      slot_assignments
    ) VALUES (
      team_record.id,
      '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID,
      to_jsonb(starters_list),
      to_jsonb(bench_list),
      '[]'::jsonb,
      slot_assignments_json
    );
    
    RAISE NOTICE 'Created lineup for team: % with % slot assignments', 
      team_record.team_name, 
      (SELECT COUNT(*) FROM jsonb_object_keys(slot_assignments_json));
  END LOOP;
END $$;

-- STEP 7: Create demo matchups - ONE matchup per week for ALL weeks (simple showcase)
-- Use SAME date calculation logic as frontend (getFirstWeekStartDate, getWeekStartDate, getWeekEndDate)
DO $$
DECLARE
  teams_array UUID[];
  team1_id UUID;
  team2_id UUID;
  current_week INTEGER;
  week_start DATE;
  week_end DATE;
  total_weeks INTEGER := 20; -- Create matchups for all 20 weeks
  draft_completion_date DATE;
  first_week_start DATE;
  day_of_week INTEGER;
  days_to_add INTEGER;
BEGIN
  -- Get all demo team IDs in order
  SELECT ARRAY_AGG(id ORDER BY created_at) INTO teams_array
  FROM teams
  WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  
  -- Use first two teams for ALL matchups (consistent showcase)
  team1_id := teams_array[1];
  team2_id := teams_array[2];
  
  -- Get draft completion date from league (updated_at when draft_status is 'completed')
  SELECT updated_at::DATE INTO draft_completion_date
  FROM leagues
  WHERE id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  
  IF draft_completion_date IS NULL THEN
    RAISE EXCEPTION 'Demo league not found or has no updated_at date';
  END IF;
  
  -- Calculate first week start (Monday after draft completion) - SAME logic as frontend
  -- Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  day_of_week := EXTRACT(DOW FROM draft_completion_date);
  
  -- Calculate days to add to get to Monday
  -- If it's Monday (1), add 0 days
  -- If it's Sunday (0), add 1 day
  -- Otherwise, add (8 - day_of_week) days to get to next Monday
  IF day_of_week = 1 THEN
    days_to_add := 0;
  ELSIF day_of_week = 0 THEN
    days_to_add := 1;
  ELSE
    days_to_add := 8 - day_of_week;
  END IF;
  
  first_week_start := draft_completion_date + (days_to_add || ' days')::INTERVAL;
  
  RAISE NOTICE 'Draft completion: %, First week start (Monday): %', draft_completion_date, first_week_start;
  
  -- Create ONE matchup per week for all weeks
  FOR current_week IN 1..total_weeks LOOP
    -- Calculate week dates using SAME logic as frontend getWeekStartDate/getWeekEndDate
    week_start := first_week_start + ((current_week - 1) * 7 || ' days')::INTERVAL;
    week_end := week_start + INTERVAL '6 days'; -- Sunday is 6 days after Monday
    
    -- Insert matchup with realistic scores (max 175)
    INSERT INTO matchups (
      league_id,
      week_number,
      team1_id,
      team2_id,
      team1_score,
      team2_score,
      status,
      week_start_date,
      week_end_date
    ) VALUES (
      '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID,
      current_week,
      team1_id,
      team2_id,
      (120 + (random() * 55))::NUMERIC, -- Random score between 120-175
      (120 + (random() * 55))::NUMERIC, -- Random score between 120-175
      CASE 
        WHEN current_week <= 3 THEN 'completed'::matchup_status
        WHEN current_week = 4 THEN 'in_progress'::matchup_status
        ELSE 'scheduled'::matchup_status
      END,
      week_start,
      week_end
    );
  END LOOP;
  
  RAISE NOTICE 'Created % matchups (one per week, weeks 1-%)', total_weeks, total_weeks;
END $$;

-- STEP 8: Verification
DO $$
DECLARE
  league_count INTEGER;
  teams_count INTEGER;
  picks_count INTEGER;
  lineups_count INTEGER;
  matchups_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO league_count FROM leagues WHERE id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  SELECT COUNT(*) INTO teams_count FROM teams WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  SELECT COUNT(*) INTO picks_count FROM draft_picks WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID AND deleted_at IS NULL;
  SELECT COUNT(*) INTO lineups_count FROM team_lineups WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  SELECT COUNT(*) INTO matchups_count FROM matchups WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'DEMO LEAGUE INITIALIZATION COMPLETE';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'League: % (expected: 1)', league_count;
  RAISE NOTICE 'Teams: % (expected: 10)', teams_count;
  RAISE NOTICE 'Draft Picks: % (expected: 210)', picks_count;
  RAISE NOTICE 'Lineups: % (expected: 10)', lineups_count;
  RAISE NOTICE 'Matchups: % (expected: 20)', matchups_count;
  RAISE NOTICE '==============================================';
  
  IF league_count != 1 OR teams_count != 10 OR picks_count != 210 OR lineups_count != 10 OR matchups_count != 20 THEN
    RAISE WARNING 'Demo league initialization incomplete! Please check the data.';
  ELSE
    RAISE NOTICE '✅ Demo league ready for guest viewing!';
  END IF;
END $$;
