-- ============================================================================
-- NUCLEAR OPTION: Delete ALL Leagues and Start Fresh
-- ============================================================================
-- This will delete ALL leagues (except demo league) and ALL related data
-- ============================================================================

-- STEP 1: Show what will be deleted
SELECT 
  'LEAGUES TO DELETE' as item_type,
  id,
  name,
  commissioner_id,
  created_at
FROM public.leagues
WHERE id != '00000000-0000-0000-0000-000000000001'  -- Keep demo league
ORDER BY name;

-- STEP 2: Count related data that will be cascade deleted
SELECT 'TEAMS TO DELETE' as item_type, COUNT(*) as count
FROM public.teams
WHERE league_id != '00000000-0000-0000-0000-000000000001';

SELECT 'MATCHUPS TO DELETE' as item_type, COUNT(*) as count
FROM public.matchups
WHERE league_id != '00000000-0000-0000-0000-000000000001';

SELECT 'DRAFT PICKS TO DELETE' as item_type, COUNT(*) as count
FROM public.draft_picks
WHERE league_id != '00000000-0000-0000-0000-000000000001';

-- STEP 3: DELETE EVERYTHING (CASCADE will handle related tables)
DELETE FROM public.leagues
WHERE id != '00000000-0000-0000-0000-000000000001';  -- Keep demo league

-- STEP 4: Verify cleanup
DO $$
DECLARE
  remaining_leagues integer;
  remaining_teams integer;
BEGIN
  SELECT COUNT(*) INTO remaining_leagues
  FROM public.leagues
  WHERE id != '00000000-0000-0000-0000-000000000001';
  
  SELECT COUNT(*) INTO remaining_teams
  FROM public.teams
  WHERE league_id != '00000000-0000-0000-0000-000000000001';
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ NUCLEAR CLEANUP COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining non-demo leagues: %', remaining_leagues;
  RAISE NOTICE 'Remaining non-demo teams: %', remaining_teams;
  RAISE NOTICE '';
  
  IF remaining_leagues = 0 AND remaining_teams = 0 THEN
    RAISE NOTICE '✅ All user leagues and teams deleted successfully';
    RAISE NOTICE '✅ Demo league preserved';
    RAISE NOTICE '';
    RAISE NOTICE 'You can now create fresh leagues from the app!';
  ELSE
    RAISE NOTICE '⚠️ Warning: Some data remains';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- STEP 5: Show what remains (should only be demo league if any)
SELECT 
  'REMAINING LEAGUES' as status,
  id,
  name,
  commissioner_id
FROM public.leagues
ORDER BY name;
