-- Surface every roster move (free-agent add, drop, waiver win) in the
-- league notification feed. transaction_ledger is the single source of
-- truth for adds/drops, so a single AFTER INSERT trigger covers manual
-- pickups, swaps from the dialog, and waiver claims processed by the
-- cron. Notifications are inserted for every league member so the feed
-- shows the activity in real time, just like chat messages.

CREATE OR REPLACE FUNCTION public.notify_league_on_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_name TEXT;
  v_player_name TEXT;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
BEGIN
  IF NEW.type NOT IN ('ADD', 'DROP') THEN
    RETURN NEW;
  END IF;

  SELECT team_name INTO v_team_name FROM public.teams WHERE id = NEW.team_id;
  v_team_name := COALESCE(v_team_name, 'A team');

  BEGIN
    SELECT full_name INTO v_player_name
    FROM public.player_directory
    WHERE player_id = NEW.player_id::INT
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_player_name := NULL;
  END;
  v_player_name := COALESCE(v_player_name, 'Player ' || NEW.player_id);

  IF NEW.type = 'ADD' THEN
    v_type := 'ADD';
    IF NEW.source = 'Waiver Processing' THEN
      v_title := 'Waiver Claim Awarded';
      v_message := v_team_name || ' was awarded ' || v_player_name || ' off waivers.';
    ELSE
      v_title := 'Free Agent Added';
      v_message := v_team_name || ' added ' || v_player_name || '.';
    END IF;
  ELSE
    v_type := 'DROP';
    v_title := 'Player Dropped';
    v_message := v_team_name || ' dropped ' || v_player_name || '.';
  END IF;

  INSERT INTO public.notifications (user_id, league_id, type, title, message, metadata, created_at)
  SELECT t.owner_id, NEW.league_id, v_type, v_title, v_message,
    jsonb_build_object(
      'team_id', NEW.team_id,
      'team_name', v_team_name,
      'player_id', NEW.player_id,
      'player_name', v_player_name,
      'source', NEW.source
    ),
    NOW()
  FROM public.teams t
  WHERE t.league_id = NEW.league_id AND t.owner_id IS NOT NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure roll back a roster move.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_league_on_transaction_trigger ON public.transaction_ledger;
CREATE TRIGGER notify_league_on_transaction_trigger
  AFTER INSERT ON public.transaction_ledger
  FOR EACH ROW EXECUTE FUNCTION public.notify_league_on_transaction();
