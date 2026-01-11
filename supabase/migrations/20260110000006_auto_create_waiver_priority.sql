-- Auto-create waiver priority when a new team joins a league
-- This ensures all teams always have a waiver priority record

-- Create the trigger function
CREATE OR REPLACE FUNCTION public.auto_create_waiver_priority()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max_priority INT;
BEGIN
  -- Get the current maximum priority in the league (if any)
  SELECT COALESCE(MAX(priority), 0) INTO v_max_priority
  FROM waiver_priority
  WHERE league_id = NEW.league_id;

  -- Insert new waiver priority record with next priority number
  -- New teams get lowest priority (highest number = last in line)
  INSERT INTO waiver_priority (league_id, team_id, priority, updated_at)
  VALUES (NEW.league_id, NEW.id, v_max_priority + 1, NOW())
  ON CONFLICT (league_id, team_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Create the trigger on teams table
DROP TRIGGER IF EXISTS trigger_auto_create_waiver_priority ON public.teams;
CREATE TRIGGER trigger_auto_create_waiver_priority
  AFTER INSERT ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_waiver_priority();

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.auto_create_waiver_priority() TO authenticated;
