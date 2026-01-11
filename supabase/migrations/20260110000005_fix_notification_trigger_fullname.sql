-- Fix the notification trigger function that incorrectly references profiles.full_name
-- The profiles table only has first_name and last_name columns (not full_name)
-- This was causing "column full_name does not exist" errors when adding/dropping players

-- Recreate the trigger function with corrected column references
CREATE OR REPLACE FUNCTION public.create_notifications_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_league_id uuid;
  v_user_id uuid;
  v_team_id uuid;
  v_player_id text;
  v_transaction_type text;
  v_team_name text;
  v_user_name text;
  v_player_name text;
  v_league_member_id uuid;
  v_notification_title text;
  v_notification_message text;
BEGIN
  -- Get transaction details
  v_league_id := NEW.league_id;
  v_user_id := NEW.user_id;
  v_team_id := NEW.team_id;
  v_player_id := NEW.player_id;
  v_transaction_type := NEW.type;
  
  -- Get team name
  SELECT team_name INTO v_team_name
  FROM public.teams
  WHERE id = v_team_id;
  
  -- Get user name (FIX: profiles has first_name and last_name, not full_name)
  SELECT COALESCE(
    NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
    'A user'
  ) INTO v_user_name
  FROM public.profiles
  WHERE id = v_user_id;
  
  -- Get player name (from staging tables - simplified for now)
  -- In production, you might want to join with a players table
  v_player_name := v_player_id; -- Placeholder - will be enriched by frontend
  
  -- Build notification content
  IF v_transaction_type = 'ADD' THEN
    v_notification_title := v_player_name || ' added';
    v_notification_message := v_user_name || ' added ' || v_player_name || ' to ' || COALESCE(v_team_name, 'their team');
  ELSIF v_transaction_type = 'DROP' THEN
    v_notification_title := v_player_name || ' dropped';
    v_notification_message := v_user_name || ' dropped ' || v_player_name || ' from ' || COALESCE(v_team_name, 'their team');
  ELSE
    -- Unknown type, skip
    RETURN NEW;
  END IF;
  
  -- Create notifications for all league members except the transaction owner
  FOR v_league_member_id IN
    SELECT DISTINCT t.owner_id
    FROM public.teams t
    WHERE t.league_id = v_league_id
      AND t.owner_id IS NOT NULL
      AND t.owner_id != v_user_id
  LOOP
    INSERT INTO public.notifications (
      league_id,
      user_id,
      type,
      title,
      message,
      metadata
    ) VALUES (
      v_league_id,
      v_league_member_id,
      v_transaction_type,
      v_notification_title,
      v_notification_message,
      jsonb_build_object(
        'transaction_id', NEW.id,
        'team_id', v_team_id,
        'player_id', v_player_id,
        'source', NEW.source
      )
    );
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- The trigger itself doesn't need to be recreated since it just references the function
-- But let's ensure it exists (idempotent)
DROP TRIGGER IF EXISTS trigger_create_notifications_from_transaction ON public.roster_transactions;
CREATE TRIGGER trigger_create_notifications_from_transaction
  AFTER INSERT ON public.roster_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.create_notifications_from_transaction();
