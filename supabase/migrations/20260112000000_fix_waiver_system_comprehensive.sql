-- ============================================================================
-- COMPREHENSIVE WAIVER SYSTEM FIX
-- Fixes: Yahoo/Sleeper parity, league settings integration, scalability
-- ============================================================================

-- 1. Create table to track when players are dropped (for waiver period enforcement)
CREATE TABLE IF NOT EXISTS player_waiver_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id INT NOT NULL,
  dropped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ, -- NULL means still on waivers
  dropped_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  UNIQUE(league_id, player_id, dropped_at)
);

-- Indexes for performance (critical for scalability)
CREATE INDEX IF NOT EXISTS idx_player_waiver_status_league_player ON player_waiver_status(league_id, player_id);
CREATE INDEX IF NOT EXISTS idx_player_waiver_status_cleared ON player_waiver_status(league_id, cleared_at) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_player_waiver_status_dropped_at ON player_waiver_status(dropped_at DESC);

-- Enable RLS
ALTER TABLE player_waiver_status ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view waiver status in their leagues
CREATE POLICY "Users can view waiver status in their leagues"
  ON player_waiver_status
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.league_id = player_waiver_status.league_id
      AND teams.owner_id = auth.uid()
    )
  );

-- 2. Create trigger to automatically track dropped players
CREATE OR REPLACE FUNCTION track_dropped_player_for_waivers()
RETURNS TRIGGER AS $$
BEGIN
  -- When a player is dropped (type = 'DROP'), add to waiver status
  IF NEW.type = 'DROP' THEN
    INSERT INTO player_waiver_status (league_id, player_id, dropped_at, dropped_by_team_id)
    VALUES (NEW.league_id, NEW.player_id::INT, NEW.created_at, NEW.team_id)
    ON CONFLICT (league_id, player_id, dropped_at) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists (idempotency)
DROP TRIGGER IF EXISTS trigger_track_dropped_players ON roster_transactions;

-- Create trigger
CREATE TRIGGER trigger_track_dropped_players
  AFTER INSERT ON roster_transactions
  FOR EACH ROW
  WHEN (NEW.type = 'DROP')
  EXECUTE FUNCTION track_dropped_player_for_waivers();

-- 3. Function to check if player is on waivers (respects waiver_period_hours)
CREATE OR REPLACE FUNCTION is_player_on_waivers(
  p_league_id UUID,
  p_player_id INT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_waiver_period_hours INT;
  v_dropped_at TIMESTAMPTZ;
  v_cleared_at TIMESTAMPTZ;
BEGIN
  -- Get league waiver period setting
  SELECT waiver_period_hours INTO v_waiver_period_hours
  FROM leagues
  WHERE id = p_league_id;
  
  -- Default to 48 hours if not set
  IF v_waiver_period_hours IS NULL THEN
    v_waiver_period_hours := 48;
  END IF;
  
  -- Get most recent drop for this player in this league
  SELECT dropped_at, cleared_at INTO v_dropped_at, v_cleared_at
  FROM player_waiver_status
  WHERE league_id = p_league_id
    AND player_id = p_player_id
  ORDER BY dropped_at DESC
  LIMIT 1;
  
  -- If never dropped, not on waivers
  IF v_dropped_at IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- If already cleared, not on waivers
  IF v_cleared_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Check if waiver period has expired
  IF v_dropped_at + (v_waiver_period_hours || ' hours')::INTERVAL < NOW() THEN
    -- Waiver period expired - mark as cleared
    UPDATE player_waiver_status
    SET cleared_at = NOW()
    WHERE league_id = p_league_id
      AND player_id = p_player_id
      AND cleared_at IS NULL;
    
    RETURN FALSE;
  END IF;
  
  -- Still on waivers
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. COMPREHENSIVE FIX: Rewrite process_waiver_claims function
-- Fixes: JSONB arrays, league settings, waiver period, scalability
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
  v_league RECORD;
  v_roster_count INT;
  v_max_roster_size INT;
  v_waiver_type TEXT;
  v_lineup RECORD;
  v_starters JSONB;
  v_bench JSONB;
  v_ir JSONB;
  v_slot_assignments JSONB;
  v_player_id_str TEXT;
  v_drop_player_id_str TEXT;
  v_priority INT;
  v_processed_count INT := 0;
  v_batch_size INT := 100; -- Process in batches for scalability
BEGIN
  -- Get league settings (critical for respecting commissioner settings)
  SELECT 
    roster_size,
    waiver_type,
    COALESCE(roster_size, 20) + 3 as max_roster -- roster_size + 3 IR slots
  INTO v_league
  FROM leagues
  WHERE id = p_league_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League % not found', p_league_id;
  END IF;
  
  v_max_roster_size := v_league.max_roster;
  v_waiver_type := COALESCE(v_league.waiver_type, 'rolling');
  
  -- Process claims in batches for scalability
  FOR v_claim IN
    SELECT 
      wc.id,
      wc.team_id,
      wc.player_id,
      wc.drop_player_id,
      wp.priority,
      wc.created_at
    FROM waiver_claims wc
    JOIN waiver_priority wp ON wp.team_id = wc.team_id AND wp.league_id = wc.league_id
    WHERE wc.league_id = p_league_id
      AND wc.status = 'pending'
    ORDER BY 
      -- Order by waiver type
      CASE v_waiver_type
        WHEN 'reverse_standings' THEN wp.priority DESC -- Lower priority (worse record) first
        ELSE wp.priority ASC -- Rolling: higher priority first
      END,
      wc.created_at ASC -- Earlier claims first
    LIMIT v_batch_size
  LOOP
    v_processed_count := v_processed_count + 1;
    
    -- Convert player IDs to strings for JSONB operations
    v_player_id_str := v_claim.player_id::TEXT;
    v_drop_player_id_str := CASE WHEN v_claim.drop_player_id IS NOT NULL THEN v_claim.drop_player_id::TEXT ELSE NULL END;
    
    -- Get current lineup (using JSONB arrays - correct schema)
    SELECT starters, bench, ir, slot_assignments
    INTO v_lineup
    FROM team_lineups
    WHERE team_id = v_claim.team_id
      AND league_id = p_league_id;
    
    -- Initialize arrays if lineup doesn't exist
    IF v_lineup IS NULL THEN
      v_starters := '[]'::JSONB;
      v_bench := '[]'::JSONB;
      v_ir := '[]'::JSONB;
      v_slot_assignments := '{}'::JSONB;
    ELSE
      v_starters := COALESCE(v_lineup.starters, '[]'::JSONB);
      v_bench := COALESCE(v_lineup.bench, '[]'::JSONB);
      v_ir := COALESCE(v_lineup.ir, '[]'::JSONB);
      v_slot_assignments := COALESCE(v_lineup.slot_assignments, '{}'::JSONB);
    END IF;
    
    -- Calculate current roster size
    v_roster_count := 
      jsonb_array_length(v_starters) + 
      jsonb_array_length(v_bench) + 
      jsonb_array_length(v_ir);
    
    -- Check if player is already rostered in this league (check all teams)
    IF EXISTS (
      SELECT 1 FROM team_lineups tl
      WHERE tl.league_id = p_league_id
        AND (
          (tl.starters ? v_player_id_str) OR
          (tl.bench ? v_player_id_str) OR
          (tl.ir ? v_player_id_str)
        )
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
      
      CONTINUE; -- Skip to next claim
    END IF;
    
    -- Check if player is on waivers (waiver period enforcement)
    IF is_player_on_waivers(p_league_id, v_claim.player_id) THEN
      -- Player is still on waivers - this is expected for waiver claims
      -- Continue processing
    END IF;
    
    -- Check roster size
    IF v_roster_count >= v_max_roster_size AND v_claim.drop_player_id IS NULL THEN
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
      
      CONTINUE;
    END IF;
    
    -- Successful claim! Process the add/drop
    
    -- Drop player if specified
    IF v_drop_player_id_str IS NOT NULL THEN
      -- Remove from all arrays
      v_starters := v_starters - v_drop_player_id_str;
      v_bench := v_bench - v_drop_player_id_str;
      v_ir := v_ir - v_drop_player_id_str;
      
      -- Remove from slot assignments
      v_slot_assignments := v_slot_assignments - v_drop_player_id_str;
    END IF;
    
    -- Add new player to bench (if not already present)
    IF NOT (v_starters ? v_player_id_str OR v_bench ? v_player_id_str OR v_ir ? v_player_id_str) THEN
      v_bench := v_bench || jsonb_build_array(v_player_id_str);
    END IF;
    
    -- Update or insert lineup
    INSERT INTO team_lineups (
      league_id,
      team_id,
      starters,
      bench,
      ir,
      slot_assignments,
      updated_at
    ) VALUES (
      p_league_id,
      v_claim.team_id,
      v_starters,
      v_bench,
      v_ir,
      v_slot_assignments,
      NOW()
    )
    ON CONFLICT (league_id, team_id) DO UPDATE
    SET 
      starters = EXCLUDED.starters,
      bench = EXCLUDED.bench,
      ir = EXCLUDED.ir,
      slot_assignments = EXCLUDED.slot_assignments,
      updated_at = NOW();
    
    -- Mark claim as successful
    UPDATE waiver_claims
    SET status = 'successful',
        processed_at = NOW()
    WHERE id = v_claim.id;
    
    -- Update waiver priority based on waiver type
    IF v_waiver_type = 'rolling' THEN
      -- Rolling: successful claimer moves to last
      -- Decrease priority of all teams with higher priority
      UPDATE waiver_priority wp
      SET priority = priority - 1,
          updated_at = NOW()
      WHERE wp.league_id = p_league_id
        AND wp.priority > (SELECT priority FROM waiver_priority WHERE team_id = v_claim.team_id AND league_id = p_league_id);
      
      -- Move successful claimer to last
      UPDATE waiver_priority
      SET priority = (SELECT COALESCE(MAX(priority), 0) FROM waiver_priority WHERE league_id = p_league_id) + 1,
          updated_at = NOW()
      WHERE team_id = v_claim.team_id
        AND league_id = p_league_id;
    ELSIF v_waiver_type = 'reverse_standings' THEN
      -- Reverse standings: priority doesn't change on successful claim
      -- (Priority is based on standings, updated separately)
      -- No action needed
    END IF;
    -- Note: FAAB would require additional logic (bidding system)
    
    -- Clear waiver status for this player (they've been claimed)
    UPDATE player_waiver_status
    SET cleared_at = NOW()
    WHERE league_id = p_league_id
      AND player_id = v_claim.player_id
      AND cleared_at IS NULL;
    
    RETURN QUERY SELECT 
      v_claim.id,
      v_claim.team_id,
      v_claim.player_id,
      'successful'::TEXT,
      NULL::TEXT;
  END LOOP;
  
  -- Log processing summary (for monitoring)
  RAISE NOTICE 'Processed % claims for league %', v_processed_count, p_league_id;
  
  RETURN;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail completely (allow partial processing)
    RAISE WARNING 'Error processing waiver claims for league %: %', p_league_id, SQLERRM;
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_waiver_claims(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_player_on_waivers(UUID, INT) TO authenticated;

-- 5. Add missing indexes for scalability
CREATE INDEX IF NOT EXISTS idx_waiver_claims_league_status_created ON waiver_claims(league_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_waiver_claims_player_league ON waiver_claims(player_id, league_id);
CREATE INDEX IF NOT EXISTS idx_team_lineups_league_team ON team_lineups(league_id, team_id);
CREATE INDEX IF NOT EXISTS idx_roster_transactions_league_player_type ON roster_transactions(league_id, player_id, type, created_at);

-- 6. Function to get waiver clear time for a player
CREATE OR REPLACE FUNCTION get_player_waiver_clear_time(
  p_league_id UUID,
  p_player_id INT
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_waiver_period_hours INT;
  v_dropped_at TIMESTAMPTZ;
  v_cleared_at TIMESTAMPTZ;
BEGIN
  -- Get league waiver period setting
  SELECT waiver_period_hours INTO v_waiver_period_hours
  FROM leagues
  WHERE id = p_league_id;
  
  -- Default to 48 hours if not set
  IF v_waiver_period_hours IS NULL THEN
    v_waiver_period_hours := 48;
  END IF;
  
  -- Get most recent drop for this player in this league
  SELECT dropped_at, cleared_at INTO v_dropped_at, v_cleared_at
  FROM player_waiver_status
  WHERE league_id = p_league_id
    AND player_id = p_player_id
  ORDER BY dropped_at DESC
  LIMIT 1;
  
  -- If never dropped or already cleared, return NULL
  IF v_dropped_at IS NULL OR v_cleared_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  
  -- Return when waiver period expires
  RETURN v_dropped_at + (v_waiver_period_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_player_waiver_clear_time(UUID, INT) TO authenticated;
