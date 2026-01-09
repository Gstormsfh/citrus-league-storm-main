-- Create function to process waiver claims
-- This should be called daily by a cron job at the league's waiver_process_time

CREATE OR REPLACE FUNCTION process_waiver_claims(p_league_id UUID)
RETURNS TABLE (
  claim_id UUID,
  team_id UUID,
  player_id INT,
  status TEXT,
  failure_reason TEXT
) AS $$
DECLARE
  v_claim RECORD;
  v_roster_count INT;
  v_max_roster_size INT := 23; -- Standard NHL fantasy roster size
  v_priority_order INT[];
BEGIN
  -- Get waiver priority order for this league
  SELECT array_agg(wp.team_id ORDER BY wp.priority ASC)
  INTO v_priority_order
  FROM waiver_priority wp
  WHERE wp.league_id = p_league_id;

  -- Process all pending claims in priority order
  FOR v_claim IN
    SELECT 
      wc.id,
      wc.team_id,
      wc.player_id,
      wc.drop_player_id,
      wp.priority
    FROM waiver_claims wc
    JOIN waiver_priority wp ON wp.team_id = wc.team_id AND wp.league_id = wc.league_id
    WHERE wc.league_id = p_league_id
      AND wc.status = 'pending'
    ORDER BY wp.priority ASC, wc.created_at ASC
  LOOP
    -- Check if roster is full
    SELECT COUNT(*)
    INTO v_roster_count
    FROM team_lineups
    WHERE team_id = v_claim.team_id
      AND league_id = p_league_id;

    -- Check if player is already rostered in this league
    IF EXISTS (
      SELECT 1 FROM team_lineups tl
      WHERE tl.league_id = p_league_id
        AND tl.player_id = v_claim.player_id
    ) THEN
      -- Player already claimed by another team
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Player already rostered',
          processed_at = NOW()
      WHERE id = v_claim.id;
      
      RETURN QUERY SELECT 
        v_claim.id,
        v_claim.team_id,
        v_claim.player_id,
        'failed'::TEXT,
        'Player already rostered'::TEXT;
        
    ELSIF v_roster_count >= v_max_roster_size AND v_claim.drop_player_id IS NULL THEN
      -- Roster full and no drop specified
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Roster full - no drop player specified',
          processed_at = NOW()
      WHERE id = v_claim.id;
      
      RETURN QUERY SELECT 
        v_claim.id,
        v_claim.team_id,
        v_claim.player_id,
        'failed'::TEXT,
        'Roster full'::TEXT;
        
    ELSE
      -- Successful claim! Add player to team
      
      -- Drop player if specified
      IF v_claim.drop_player_id IS NOT NULL THEN
        DELETE FROM team_lineups
        WHERE team_id = v_claim.team_id
          AND league_id = p_league_id
          AND player_id = v_claim.drop_player_id;
      END IF;
      
      -- Add new player to roster
      INSERT INTO team_lineups (team_id, league_id, player_id, roster_slot)
      VALUES (v_claim.team_id, p_league_id, v_claim.player_id, 'BN')
      ON CONFLICT (team_id, league_id, player_id) DO NOTHING;
      
      -- Mark claim as successful
      UPDATE waiver_claims
      SET status = 'successful',
          processed_at = NOW()
      WHERE id = v_claim.id;
      
      -- Update waiver priority (rolling: successful claimer moves to last)
      UPDATE waiver_priority wp
      SET priority = priority - 1
      WHERE wp.league_id = p_league_id
        AND wp.priority > (SELECT priority FROM waiver_priority WHERE team_id = v_claim.team_id AND league_id = p_league_id);
        
      UPDATE waiver_priority
      SET priority = (SELECT MAX(priority) FROM waiver_priority WHERE league_id = p_league_id)
      WHERE team_id = v_claim.team_id
        AND league_id = p_league_id;
      
      RETURN QUERY SELECT 
        v_claim.id,
        v_claim.team_id,
        v_claim.player_id,
        'successful'::TEXT,
        NULL::TEXT;
    END IF;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION process_waiver_claims(UUID) TO authenticated;
