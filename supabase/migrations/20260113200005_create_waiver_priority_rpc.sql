-- Create RPC function to create waiver priority for existing teams
-- Uses SECURITY DEFINER to bypass RLS, similar to the trigger function

CREATE OR REPLACE FUNCTION public.create_waiver_priority_for_team(
  p_league_id UUID,
  p_team_id UUID
)
RETURNS TABLE (
  priority INT,
  success BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max_priority INT;
  v_new_priority INT;
  v_user_id UUID;
BEGIN
  -- Verify user owns the team
  SELECT owner_id INTO v_user_id
  FROM teams
  WHERE id = p_team_id
    AND league_id = p_league_id;
  
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::INT, false::BOOLEAN, 'Team not found or user does not own team'::TEXT;
    RETURN;
  END IF;
  
  IF v_user_id != auth.uid() THEN
    RETURN QUERY SELECT NULL::INT, false::BOOLEAN, 'User does not own this team'::TEXT;
    RETURN;
  END IF;
  
  -- Check if priority already exists
  IF EXISTS (SELECT 1 FROM waiver_priority WHERE league_id = p_league_id AND team_id = p_team_id) THEN
    SELECT priority INTO v_new_priority
    FROM waiver_priority
    WHERE league_id = p_league_id AND team_id = p_team_id;
    RETURN QUERY SELECT v_new_priority, true::BOOLEAN, NULL::TEXT;
    RETURN;
  END IF;
  
  -- Get max priority in league
  SELECT COALESCE(MAX(priority), 0) INTO v_max_priority
  FROM waiver_priority
  WHERE league_id = p_league_id;
  
  -- Create priority record
  INSERT INTO waiver_priority (league_id, team_id, priority, updated_at)
  VALUES (p_league_id, p_team_id, v_max_priority + 1, NOW())
  ON CONFLICT (league_id, team_id) DO NOTHING
  RETURNING priority INTO v_new_priority;
  
  IF v_new_priority IS NULL THEN
    -- Conflict occurred, fetch existing
    SELECT priority INTO v_new_priority
    FROM waiver_priority
    WHERE league_id = p_league_id AND team_id = p_team_id;
  END IF;
  
  RETURN QUERY SELECT v_new_priority, true::BOOLEAN, NULL::TEXT;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.create_waiver_priority_for_team(UUID, UUID) TO authenticated;
