-- ============================================================================
-- Create SECURITY DEFINER RPC for system/commissioner notifications
-- ============================================================================
-- PROBLEM: The notifications table has no INSERT policy for type = 'SYSTEM'.
-- The only INSERT policy allows type = 'CHAT'. Commissioners trying to notify
-- league members about settings changes via direct INSERT are silently blocked.
--
-- SOLUTION: Create a SECURITY DEFINER RPC (like send_league_chat_message)
-- that bypasses RLS and validates the caller is the commissioner.
-- ============================================================================

-- Also add an INSERT policy for SYSTEM notifications from commissioners
-- This ensures both the RPC and direct-insert paths work
DROP POLICY IF EXISTS "Commissioners can insert SYSTEM notifications" ON public.notifications;
CREATE POLICY "Commissioners can insert SYSTEM notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  type = 'SYSTEM' AND
  auth.uid() IS NOT NULL AND
  -- Verify the caller is the commissioner of the league
  EXISTS (
    SELECT 1 FROM public.leagues
    WHERE leagues.id = notifications.league_id
    AND leagues.commissioner_id = auth.uid()
  ) AND
  -- Verify the recipient is a member of the league
  EXISTS (
    SELECT 1 FROM public.teams
    WHERE teams.league_id = notifications.league_id
    AND teams.owner_id = notifications.user_id
  )
);

-- Create the SECURITY DEFINER RPC for sending system notifications
-- This is the preferred path — bypasses RLS with built-in validation
CREATE OR REPLACE FUNCTION public.notify_league_members(
  p_league_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_notification_type TEXT DEFAULT 'SYSTEM'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id UUID;
  v_league_member_id UUID;
  v_notifications_created INTEGER := 0;
BEGIN
  -- Get authenticated user
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- Verify caller is the commissioner of the league
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
    AND commissioner_id = v_caller_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only commissioners can send system notifications');
  END IF;

  -- Validate notification type
  IF p_notification_type NOT IN ('ADD', 'DROP', 'WAIVER', 'TRADE', 'CHAT', 'SYSTEM') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid notification type');
  END IF;

  -- Validate message
  IF p_message IS NULL OR trim(p_message) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Message cannot be empty');
  END IF;

  -- Create notifications for ALL league members (including commissioner)
  FOR v_league_member_id IN
    SELECT DISTINCT t.owner_id
    FROM public.teams t
    WHERE t.league_id = p_league_id
      AND t.owner_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications (
      league_id,
      user_id,
      type,
      title,
      message,
      metadata,
      read_status,
      read_at
    ) VALUES (
      p_league_id,
      v_league_member_id,
      p_notification_type,
      COALESCE(p_title, 'League Update'),
      trim(p_message),
      jsonb_build_object(
        'source', 'commissioner',
        'commissioner_id', v_caller_id
      ),
      -- Mark as read for the commissioner (they initiated the action)
      v_league_member_id = v_caller_id,
      CASE WHEN v_league_member_id = v_caller_id THEN now() ELSE NULL END
    );
    v_notifications_created := v_notifications_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'notifications_created', v_notifications_created,
    'message', format('Notified %s league members', v_notifications_created)
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.notify_league_members(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
  -- Verify the RPC exists
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'notify_league_members'
  ) THEN
    RAISE NOTICE '✅ notify_league_members RPC created successfully';
  ELSE
    RAISE WARNING '❌ notify_league_members RPC was NOT created';
  END IF;
  
  -- Verify the INSERT policy exists
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'notifications' 
    AND policyname = 'Commissioners can insert SYSTEM notifications'
  ) THEN
    RAISE NOTICE '✅ SYSTEM notification INSERT policy created';
  ELSE
    RAISE WARNING '❌ SYSTEM notification INSERT policy was NOT created';
  END IF;
END $$;
