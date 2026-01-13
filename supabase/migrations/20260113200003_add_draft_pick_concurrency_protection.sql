-- ============================================================================
-- ADD CONCURRENCY PROTECTION: Draft Picks
-- ============================================================================
-- PURPOSE: Improve UX when multiple users draft simultaneously
-- Prevents "player already drafted" errors by reserving picks
--
-- APPROACH: Add draft pick reservation system
-- - Users can "reserve" a pick for 30 seconds before confirming
-- - Prevents race conditions during network latency
-- - Better UX than relying solely on unique constraints
-- ============================================================================

-- Add optional reservation columns to draft_picks table
ALTER TABLE public.draft_picks 
ADD COLUMN IF NOT EXISTS reserved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ;

-- Create index for faster reservation queries
CREATE INDEX IF NOT EXISTS idx_draft_picks_reservation 
  ON public.draft_picks(league_id, reserved_by, reservation_expires_at)
  WHERE reserved_by IS NOT NULL;

-- ============================================================================
-- FUNCTION: Reserve a draft pick (30-second hold)
-- ============================================================================
CREATE OR REPLACE FUNCTION reserve_draft_pick(
  p_league_id UUID,
  p_player_id TEXT,
  p_user_id UUID,
  p_duration_seconds INT DEFAULT 30
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_existing_pick UUID;
  v_existing_reservation UUID;
BEGIN
  -- Check if player is already drafted (permanent pick)
  SELECT id INTO v_existing_pick
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND deleted_at IS NULL
    AND reserved_by IS NULL;  -- Only check confirmed picks
  
  IF v_existing_pick IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Player already drafted'::TEXT;
    RETURN;
  END IF;
  
  -- Check if player is reserved by someone else (and reservation hasn't expired)
  SELECT id INTO v_existing_reservation
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND reserved_by IS NOT NULL
    AND reserved_by != p_user_id
    AND reservation_expires_at > NOW()
    AND deleted_at IS NULL;
  
  IF v_existing_reservation IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Player is reserved by another user'::TEXT;
    RETURN;
  END IF;
  
  -- Clean up expired reservations for this player
  DELETE FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND reserved_by IS NOT NULL
    AND reservation_expires_at <= NOW()
    AND deleted_at IS NULL;
  
  -- Create reservation
  INSERT INTO draft_picks (
    league_id,
    player_id,
    reserved_by,
    reserved_at,
    reservation_expires_at,
    team_id,
    round_number,
    pick_number
  ) VALUES (
    p_league_id,
    p_player_id,
    p_user_id,
    NOW(),
    NOW() + (p_duration_seconds || ' seconds')::INTERVAL,
    '00000000-0000-0000-0000-000000000000'::UUID,  -- Placeholder, will be set on confirm
    0,  -- Placeholder
    0   -- Placeholder
  )
  ON CONFLICT (league_id, player_id) 
  DO UPDATE SET
    reserved_by = EXCLUDED.reserved_by,
    reserved_at = EXCLUDED.reserved_at,
    reservation_expires_at = EXCLUDED.reservation_expires_at;
  
  RETURN QUERY SELECT TRUE, 'Player reserved for 30 seconds'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Confirm a reserved pick (convert reservation to actual pick)
-- ============================================================================
CREATE OR REPLACE FUNCTION confirm_draft_pick(
  p_league_id UUID,
  p_player_id TEXT,
  p_team_id UUID,
  p_round_number INT,
  p_pick_number INT,
  p_user_id UUID,
  p_draft_session_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_reservation_id UUID;
BEGIN
  -- Check if user has a valid reservation
  SELECT id INTO v_reservation_id
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND reserved_by = p_user_id
    AND reservation_expires_at > NOW()
    AND deleted_at IS NULL;
  
  IF v_reservation_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Reservation expired or not found'::TEXT;
    RETURN;
  END IF;
  
  -- Update reservation to become a real pick
  UPDATE draft_picks
  SET 
    team_id = p_team_id,
    round_number = p_round_number,
    pick_number = p_pick_number,
    draft_session_id = p_draft_session_id,
    picked_at = NOW(),
    reserved_by = NULL,
    reserved_at = NULL,
    reservation_expires_at = NULL
  WHERE id = v_reservation_id;
  
  RETURN QUERY SELECT TRUE, 'Pick confirmed'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SCHEDULED JOB: Clean up expired reservations
-- ============================================================================
-- This should be run every minute via pg_cron or external scheduler
-- Cleans up reservations that expired but weren't cleaned up by reserve function

CREATE OR REPLACE FUNCTION cleanup_expired_draft_reservations()
RETURNS INT AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM draft_picks
  WHERE reserved_by IS NOT NULL
    AND reservation_expires_at <= NOW()
    AND deleted_at IS NULL;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reserve_draft_pick IS
'Reserve a player for 30 seconds to prevent race conditions during draft. Used for optimistic UI updates.';

COMMENT ON FUNCTION confirm_draft_pick IS
'Confirm a reserved pick and convert it to a permanent draft selection.';

COMMENT ON FUNCTION cleanup_expired_draft_reservations IS
'Clean up expired draft reservations. Should be run every minute via cron job.';
