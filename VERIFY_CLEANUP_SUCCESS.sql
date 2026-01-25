-- ============================================================================
-- VERIFY: Cleanup Was Successful
-- ============================================================================

-- Check remaining leagues (should be 0 or only demo league)
SELECT 
  'Remaining Leagues' as status,
  COUNT(*) as count
FROM public.leagues
WHERE id != '00000000-0000-0000-0000-000000000001';

-- Show any leagues that remain
SELECT 
  'League Details' as item,
  id,
  name,
  commissioner_id,
  created_at
FROM public.leagues
ORDER BY created_at;

-- Check remaining teams (should be 0 or only demo teams)
SELECT 
  'Remaining Teams' as status,
  COUNT(*) as count
FROM public.teams
WHERE league_id != '00000000-0000-0000-0000-000000000001';

-- Check remaining matchups
SELECT 
  'Remaining Matchups' as status,
  COUNT(*) as count
FROM public.matchups
WHERE league_id != '00000000-0000-0000-0000-000000000001';

-- Check remaining draft picks
SELECT 
  'Remaining Draft Picks' as status,
  COUNT(*) as count
FROM public.draft_picks
WHERE league_id != '00000000-0000-0000-0000-000000000001';

-- Final status
DO $$
DECLARE
  league_count integer;
  team_count integer;
BEGIN
  SELECT COUNT(*) INTO league_count
  FROM public.leagues
  WHERE id != '00000000-0000-0000-0000-000000000001';
  
  SELECT COUNT(*) INTO team_count
  FROM public.teams
  WHERE league_id != '00000000-0000-0000-0000-000000000001';
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '📊 CLEANUP VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  IF league_count = 0 AND team_count = 0 THEN
    RAISE NOTICE '✅ SUCCESS! Database is clean';
    RAISE NOTICE '✅ All user leagues deleted';
    RAISE NOTICE '✅ All user teams deleted';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 NEXT STEPS:';
    RAISE NOTICE '   1. Log out of your app';
    RAISE NOTICE '   2. Hard refresh (Ctrl+Shift+R)';
    RAISE NOTICE '   3. Log back in';
    RAISE NOTICE '   4. Create a fresh league';
    RAISE NOTICE '   5. Test league isolation!';
  ELSE
    RAISE NOTICE '⚠️ Warning: Database still has data:';
    RAISE NOTICE '   - Leagues: %', league_count;
    RAISE NOTICE '   - Teams: %', team_count;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
