-- ============================================================================
-- FIX TEAM CREATION FOR LEAGUE JOINING
-- ============================================================================
-- Problem: validate_team_insert() trigger only allows commissioner to create teams
-- This blocks users from creating their own teams when joining via join code
-- 
-- Solution: Update trigger to allow:
--   1. Commissioner creating teams (existing behavior)
--   2. User creating their own team (owner_id = auth.uid()) - NEW
-- ============================================================================

-- Update the trigger function to allow users to create their own teams
CREATE OR REPLACE FUNCTION public.validate_team_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  league_commissioner_id UUID;
BEGIN
  -- Validate league exists
  SELECT commissioner_id INTO league_commissioner_id
  FROM public.leagues
  WHERE id = NEW.league_id;
  
  IF league_commissioner_id IS NULL THEN
    RAISE EXCEPTION 'League does not exist';
  END IF;
  
  -- Allow team creation if:
  -- 1. User is the commissioner (can create teams for others), OR
  -- 2. User is creating their own team (owner_id = auth.uid())
  IF league_commissioner_id != auth.uid() AND NEW.owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the league commissioner can create teams for others. Users can only create their own teams.';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Ensure trigger exists (should already exist, but ensure it's correct)
DROP TRIGGER IF EXISTS validate_team_commissioner ON public.teams;

CREATE TRIGGER validate_team_commissioner
  BEFORE INSERT ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_team_insert();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TEAM CREATION TRIGGER UPDATED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'New behavior:';
  RAISE NOTICE '  ✅ Commissioner can create teams (for AI, etc.)';
  RAISE NOTICE '  ✅ Users can create their own teams (when joining via join code)';
  RAISE NOTICE '  ❌ Users CANNOT create teams for other users';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- If you need to revert to the old behavior (commissioner only):
--
-- CREATE OR REPLACE FUNCTION public.validate_team_insert()
-- RETURNS TRIGGER
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   league_commissioner_id UUID;
-- BEGIN
--   SELECT commissioner_id INTO league_commissioner_id
--   FROM public.leagues
--   WHERE id = NEW.league_id;
--   
--   IF league_commissioner_id IS NULL THEN
--     RAISE EXCEPTION 'League does not exist';
--   END IF;
--   
--   IF league_commissioner_id != auth.uid() THEN
--     RAISE EXCEPTION 'Only the league commissioner can create teams';
--   END IF;
--   
--   RETURN NEW;
-- END;
-- $$;
-- ============================================================================
