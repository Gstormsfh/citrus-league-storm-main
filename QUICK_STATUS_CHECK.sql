-- ============================================================================
-- QUICK STATUS CHECK: Verify restoration success
-- ============================================================================

DO $$
DECLARE
  v_teams INTEGER;
  v_total_players INTEGER;
  v_mcdavid_found BOOLEAN;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'QUICK STATUS CHECK';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  -- Count teams
  SELECT COUNT(*) INTO v_teams FROM team_lineups;
  RAISE NOTICE 'Teams in team_lineups: %', v_teams;
  
  -- Count total players across all teams
  SELECT SUM(jsonb_array_length(COALESCE(bench, '[]'::jsonb)))
  INTO v_total_players
  FROM team_lineups;
  RAISE NOTICE 'Total players on bench: %', v_total_players;
  
  -- Check if McDavid exists
  SELECT EXISTS (
    SELECT 1 FROM team_lineups 
    WHERE bench ? '8478402'
  ) INTO v_mcdavid_found;
  
  IF v_mcdavid_found THEN
    RAISE NOTICE '✅ McDavid FOUND in team_lineups';
  ELSE
    RAISE WARNING '❌ McDavid NOT FOUND in team_lineups';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEP: Go to Roster tab and organize your starting lineup';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
