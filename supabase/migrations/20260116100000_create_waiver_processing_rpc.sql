-- ═══════════════════════════════════════════════════════════════════════════
-- CREATE WAIVER PROCESSING RPC FUNCTION
-- ═══════════════════════════════════════════════════════════════════════════
-- This creates an RPC function that can be called from:
-- 1. Frontend (manual "Process Waivers" button for commissioners)
-- 2. Edge Function (scheduled daily processing)
-- 3. Direct SQL call for testing
-- ═══════════════════════════════════════════════════════════════════════════

-- Create RPC function to process all pending waivers across all leagues
CREATE OR REPLACE FUNCTION public.process_all_pending_waivers()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  total_processed INT,
  successful INT,
  failed INT,
  details JSONB
) AS $$
DECLARE
  v_league RECORD;
  v_result RECORD;
  v_processed INT := 0;
  v_successful INT := 0;
  v_failed INT := 0;
  v_details JSONB := '[]'::JSONB;
BEGIN
  -- Loop through all leagues with pending claims
  FOR v_league IN 
    SELECT DISTINCT wc.league_id, l.league_name
    FROM waiver_claims wc
    JOIN leagues l ON l.id = wc.league_id
    WHERE wc.status = 'pending'
  LOOP
    v_processed := 0;
    v_successful := 0;
    v_failed := 0;
    v_details := '[]'::JSONB;
    
    -- Process claims for this league
    FOR v_result IN 
      SELECT * FROM process_waiver_claims(v_league.league_id)
    LOOP
      v_processed := v_processed + 1;
      
      IF v_result.status = 'successful' THEN
        v_successful := v_successful + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;
      
      -- Add result to details
      v_details := v_details || jsonb_build_object(
        'claim_id', v_result.claim_id,
        'player_id', v_result.player_id,
        'team_id', v_result.team_id,
        'status', v_result.status,
        'failure_reason', v_result.failure_reason
      );
    END LOOP;
    
    -- Return row for this league
    league_id := v_league.league_id;
    league_name := v_league.league_name;
    total_processed := v_processed;
    successful := v_successful;
    failed := v_failed;
    details := v_details;
    
    RETURN NEXT;
  END LOOP;
  
  -- Also clear any players whose waiver period has expired
  UPDATE player_waiver_status
  SET cleared_at = NOW()
  WHERE cleared_at IS NULL
    AND NOW() > dropped_at + (waiver_period_hours || ' hours')::INTERVAL;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.process_all_pending_waivers() TO authenticated;

-- Create a function to check if waivers should be processed (based on league settings)
CREATE OR REPLACE FUNCTION public.should_process_waivers_now()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  waiver_process_time TIME,
  current_time_est TIME,
  should_process BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.id as league_id,
    l.league_name,
    l.waiver_process_time,
    (NOW() AT TIME ZONE 'America/New_York')::TIME as current_time_est,
    -- Should process if current time is within 5 minutes of waiver_process_time
    ABS(EXTRACT(EPOCH FROM (l.waiver_process_time - (NOW() AT TIME ZONE 'America/New_York')::TIME))) < 300 as should_process
  FROM leagues l
  WHERE l.waiver_process_time IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM waiver_claims wc 
      WHERE wc.league_id = l.id AND wc.status = 'pending'
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.should_process_waivers_now() TO authenticated;

-- Create a function to get waiver processing status
CREATE OR REPLACE FUNCTION public.get_waiver_processing_status()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  pending_claims INT,
  last_processed TIMESTAMPTZ,
  next_process_time TIME
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.id as league_id,
    l.league_name,
    COALESCE(pending.count, 0)::INT as pending_claims,
    (SELECT MAX(processed_at) FROM waiver_claims WHERE league_id = l.id AND processed_at IS NOT NULL) as last_processed,
    l.waiver_process_time as next_process_time
  FROM leagues l
  LEFT JOIN (
    SELECT league_id, COUNT(*) as count
    FROM waiver_claims
    WHERE status = 'pending'
    GROUP BY league_id
  ) pending ON pending.league_id = l.id
  WHERE EXISTS (
    SELECT 1 FROM teams t WHERE t.league_id = l.id
  )
  ORDER BY l.league_name;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.get_waiver_processing_status() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ WAIVER PROCESSING RPC FUNCTIONS CREATED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Available functions:';
  RAISE NOTICE '  1. process_all_pending_waivers() - Process all pending claims';
  RAISE NOTICE '  2. should_process_waivers_now() - Check if it''s time to process';
  RAISE NOTICE '  3. get_waiver_processing_status() - Get status for all leagues';
  RAISE NOTICE '';
  RAISE NOTICE 'Usage from frontend:';
  RAISE NOTICE '  const { data } = await supabase.rpc(''process_all_pending_waivers'')';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANT: You still need to either:';
  RAISE NOTICE '  A. Enable pg_cron and schedule daily calls, OR';
  RAISE NOTICE '  B. Create an Edge Function with scheduled trigger, OR';
  RAISE NOTICE '  C. Add a "Process Waivers" button for commissioners';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
