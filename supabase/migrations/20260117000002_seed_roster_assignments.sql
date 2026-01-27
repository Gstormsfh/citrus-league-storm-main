-- ============================================================================
-- TRANSACTIONAL ROSTER STATE ENGINE - PHASE 3: DATA MIGRATION
-- ============================================================================
-- Seeds roster_assignments from draft_picks (deleted_at IS NULL = current roster)
-- Implements comprehensive verification to catch duplicate player scenarios
-- ============================================================================

-- ============================================================================
-- STEP 1: Pre-migration diagnostics
-- ============================================================================
DO $$
DECLARE
  v_draft_count INT;
  v_league_count INT;
  v_team_count INT;
  v_potential_duplicates INT;
  r RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 02: PRE-MIGRATION DIAGNOSTICS';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  -- Count active draft picks
  SELECT COUNT(*) INTO v_draft_count
  FROM public.draft_picks
  WHERE deleted_at IS NULL;
  
  RAISE NOTICE 'Active draft picks (deleted_at IS NULL): %', v_draft_count;
  
  -- Count leagues
  SELECT COUNT(*) INTO v_league_count
  FROM public.leagues;
  
  RAISE NOTICE 'Total leagues: %', v_league_count;
  
  -- Count teams
  SELECT COUNT(*) INTO v_team_count
  FROM public.teams;
  
  RAISE NOTICE 'Total teams: %', v_team_count;
  
  -- Check for potential duplicates (same player on multiple teams in same league)
  SELECT COUNT(*) INTO v_potential_duplicates
  FROM (
    SELECT league_id, player_id, COUNT(*) as count
    FROM public.draft_picks
    WHERE deleted_at IS NULL
    GROUP BY league_id, player_id
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF v_potential_duplicates > 0 THEN
    RAISE WARNING '⚠️  Found % potential duplicate player assignments!', v_potential_duplicates;
    RAISE NOTICE '   These will be handled by THE GOALIE constraint (first one wins)';
    
    -- Log the duplicates for investigation
    RAISE NOTICE '   Duplicate players:';
    FOR r IN (
      SELECT league_id, player_id, COUNT(*) as count
      FROM public.draft_picks
      WHERE deleted_at IS NULL
      GROUP BY league_id, player_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 10
    ) LOOP
      RAISE NOTICE '     - League % has player % on % teams', 
        r.league_id, r.player_id, r.count;
    END LOOP;
  ELSE
    RAISE NOTICE '✅ No duplicate player assignments detected';
  END IF;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- STEP 2: Create temporary table for migration tracking
-- ============================================================================
CREATE TEMP TABLE migration_log (
  player_id TEXT,
  league_id UUID,
  team_id UUID,
  status TEXT, -- 'SUCCESS', 'DUPLICATE', 'ERROR'
  error_message TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- STEP 3: Seed roster_assignments from draft_picks
-- ============================================================================
DO $$
DECLARE
  v_inserted_count INT := 0;
  v_skipped_count INT := 0;
  v_error_count INT := 0;
  v_record RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 02: SEEDING ROSTER_ASSIGNMENTS';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Starting migration...';
  RAISE NOTICE '';
  
  -- Process each active draft pick
  FOR v_record IN (
    SELECT 
      dp.league_id,
      dp.team_id,
      dp.player_id,
      COALESCE(dp.picked_at, NOW()) as acquired_at
    FROM public.draft_picks dp
    WHERE dp.deleted_at IS NULL
    ORDER BY dp.league_id, dp.team_id, dp.pick_number
  )
  LOOP
    BEGIN
      -- Attempt to insert into roster_assignments
      INSERT INTO public.roster_assignments (
        league_id,
        team_id,
        player_id,
        acquired_at,
        created_at
      ) VALUES (
        v_record.league_id,
        v_record.team_id,
        v_record.player_id,
        v_record.acquired_at,
        NOW()
      )
      ON CONFLICT (league_id, player_id) DO NOTHING;
      
      -- Check if insert actually happened
      IF FOUND THEN
        v_inserted_count := v_inserted_count + 1;
        
        -- Log success
        INSERT INTO migration_log (player_id, league_id, team_id, status)
        VALUES (v_record.player_id, v_record.league_id, v_record.team_id, 'SUCCESS');
      ELSE
        -- Duplicate detected by THE GOALIE
        v_skipped_count := v_skipped_count + 1;
        
        -- Log duplicate
        INSERT INTO migration_log (
          player_id, 
          league_id, 
          team_id, 
          status, 
          error_message
        ) VALUES (
          v_record.player_id, 
          v_record.league_id, 
          v_record.team_id, 
          'DUPLICATE',
          'Player already assigned to another team in this league'
        );
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      -- Unexpected error
      v_error_count := v_error_count + 1;
      
      -- Log error
      INSERT INTO migration_log (
        player_id, 
        league_id, 
        team_id, 
        status, 
        error_message
      ) VALUES (
        v_record.player_id, 
        v_record.league_id, 
        v_record.team_id, 
        'ERROR',
        SQLERRM
      );
      
      RAISE WARNING 'Error migrating player %: %', v_record.player_id, SQLERRM;
    END;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Migration complete:';
  RAISE NOTICE '  ✅ Successfully inserted: % players', v_inserted_count;
  
  IF v_skipped_count > 0 THEN
    RAISE WARNING '  ⚠️  Skipped (duplicates): % players', v_skipped_count;
  END IF;
  
  IF v_error_count > 0 THEN
    RAISE WARNING '  ❌ Errors: % players', v_error_count;
  END IF;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- STEP 4: Verification and Reporting
-- ============================================================================
DO $$
DECLARE
  v_draft_count INT;
  v_assignment_count INT;
  v_difference INT;
  v_duplicate_record RECORD;
  v_error_record RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 02: VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  -- Count source and destination
  SELECT COUNT(*) INTO v_draft_count 
  FROM public.draft_picks 
  WHERE deleted_at IS NULL;
  
  SELECT COUNT(*) INTO v_assignment_count 
  FROM public.roster_assignments;
  
  v_difference := v_draft_count - v_assignment_count;
  
  RAISE NOTICE 'Source (draft_picks): % players', v_draft_count;
  RAISE NOTICE 'Destination (roster_assignments): % players', v_assignment_count;
  
  IF v_difference = 0 THEN
    RAISE NOTICE '✅ PERFECT MATCH: All players migrated successfully';
  ELSIF v_difference > 0 THEN
    RAISE WARNING '⚠️  MISMATCH: % players not migrated', v_difference;
    RAISE NOTICE '   This is expected if duplicate players were detected';
    RAISE NOTICE '   THE GOALIE constraint ensures only one team can own each player';
  ELSE
    RAISE WARNING '⚠️  UNEXPECTED: More assignments than draft picks (% extra)', ABS(v_difference);
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '-------------------------------------------------------------------';
  RAISE NOTICE 'Per-League Verification:';
  RAISE NOTICE '-------------------------------------------------------------------';
  
  -- Per-league verification
  FOR v_duplicate_record IN (
    SELECT 
      l.name as league_name,
      dp_count.count as draft_picks_count,
      ra_count.count as roster_assignments_count,
      (dp_count.count - ra_count.count) as difference
    FROM public.leagues l
    LEFT JOIN (
      SELECT league_id, COUNT(*) as count
      FROM public.draft_picks
      WHERE deleted_at IS NULL
      GROUP BY league_id
    ) dp_count ON l.id = dp_count.league_id
    LEFT JOIN (
      SELECT league_id, COUNT(*) as count
      FROM public.roster_assignments
      GROUP BY league_id
    ) ra_count ON l.id = ra_count.league_id
    WHERE dp_count.count IS NOT NULL OR ra_count.count IS NOT NULL
    ORDER BY l.name
  ) LOOP
    IF v_duplicate_record.difference = 0 THEN
      RAISE NOTICE '  ✅ %: % players (perfect match)', 
        v_duplicate_record.league_name, 
        v_duplicate_record.roster_assignments_count;
    ELSE
      RAISE WARNING '  ⚠️  %: % draft picks -> % assignments (% difference)', 
        v_duplicate_record.league_name,
        v_duplicate_record.draft_picks_count,
        v_duplicate_record.roster_assignments_count,
        v_duplicate_record.difference;
    END IF;
  END LOOP;
  
  -- Show duplicates if any
  RAISE NOTICE '';
  RAISE NOTICE '-------------------------------------------------------------------';
  RAISE NOTICE 'Duplicate Players Report:';
  RAISE NOTICE '-------------------------------------------------------------------';
  
  IF EXISTS (SELECT 1 FROM migration_log WHERE status = 'DUPLICATE') THEN
    RAISE WARNING 'THE GOALIE blocked the following duplicate assignments:';
    
    FOR v_duplicate_record IN (
      SELECT player_id, league_id, COUNT(*) as attempt_count
      FROM migration_log
      WHERE status = 'DUPLICATE'
      GROUP BY player_id, league_id
      ORDER BY attempt_count DESC
      LIMIT 20
    ) LOOP
      RAISE WARNING '  - Player % in league %: % duplicate attempts', 
        v_duplicate_record.player_id,
        v_duplicate_record.league_id,
        v_duplicate_record.attempt_count;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE 'Action Required: Investigate duplicate player assignments in draft_picks table';
    RAISE NOTICE 'Query to find all duplicates:';
    RAISE NOTICE '  SELECT league_id, player_id, array_agg(team_id) as teams';
    RAISE NOTICE '  FROM draft_picks WHERE deleted_at IS NULL';
    RAISE NOTICE '  GROUP BY league_id, player_id HAVING COUNT(*) > 1;';
  ELSE
    RAISE NOTICE '✅ No duplicate players detected';
  END IF;
  
  -- Show errors if any
  IF EXISTS (SELECT 1 FROM migration_log WHERE status = 'ERROR') THEN
    RAISE NOTICE '';
    RAISE NOTICE '-------------------------------------------------------------------';
    RAISE NOTICE 'Errors Report:';
    RAISE NOTICE '-------------------------------------------------------------------';
    RAISE WARNING 'The following players failed to migrate:';
    
    FOR v_error_record IN (
      SELECT player_id, league_id, team_id, error_message
      FROM migration_log
      WHERE status = 'ERROR'
      LIMIT 20
    ) LOOP
      RAISE WARNING '  - Player % (Team %): %', 
        v_error_record.player_id,
        v_error_record.team_id,
        v_error_record.error_message;
    END LOOP;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ MIGRATION 02 COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Review any warnings above';
  RAISE NOTICE '  2. Update frontend to query roster_assignments instead of draft_picks';
  RAISE NOTICE '  3. Test add/drop operations with process_roster_move RPC';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- STEP 5: Create helper view for easy roster queries
-- ============================================================================
CREATE OR REPLACE VIEW public.current_rosters AS
SELECT 
  ra.id as assignment_id,
  ra.league_id,
  l.name as league_name,
  ra.team_id,
  t.team_name,
  t.owner_id,
  ra.player_id,
  ra.acquired_at,
  ra.created_at
FROM public.roster_assignments ra
JOIN public.leagues l ON l.id = ra.league_id
JOIN public.teams t ON t.id = ra.team_id
ORDER BY l.name, t.team_name, ra.acquired_at;

COMMENT ON VIEW public.current_rosters IS 
  'Convenience view for querying current roster state with league/team names.';

GRANT SELECT ON public.current_rosters TO authenticated;
