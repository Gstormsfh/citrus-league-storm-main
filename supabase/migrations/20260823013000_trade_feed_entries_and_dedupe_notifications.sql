-- LAUNCH QA (2026-08-22), finding E — two feed defects fixed at the choke point.
-- NOTE: already applied to prod via MCP on 2026-08-23 01:12 UTC (verified live:
-- TRADE + ADD test rows produced correct named entries for all owners, no
-- raw-id duplicates). This file mirrors prod so the repo stays the source of
-- truth.
--
-- 1) Trades never appeared in the League Activity feed: the ledger trigger
--    notify_league_on_transaction returned early for anything but ADD/DROP,
--    while every trade execution path (UI accept AND the review sweeper)
--    already writes TRADE rows to transaction_ledger. Extending the trigger
--    covers all paths with one change. Only 'Trade in' rows notify (each
--    traded player has exactly one), so a 2-for-2 posts one entry per player
--    acquired, matching the feed's per-player style.
--
-- 2) Every league member other than the actor also received a raw-id
--    duplicate ("A user added 8484801 to Gstorms") from the legacy trigger
--    trigger_create_notifications_from_transaction — double unread counts
--    and unreadable copy. notify_league_on_transaction already notifies all
--    owners with resolved names, so the legacy trigger is dropped (its
--    function is kept for easy rollback).

CREATE OR REPLACE FUNCTION public.notify_league_on_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team_name TEXT;
  v_player_name TEXT;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
BEGIN
  IF NEW.type NOT IN ('ADD', 'DROP', 'TRADE') THEN
    RETURN NEW;
  END IF;

  -- TRADE writes two ledger rows per player (out + in); notify once, on the
  -- acquiring side.
  IF NEW.type = 'TRADE' AND NEW.source IS DISTINCT FROM 'Trade in' THEN
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
  ELSIF NEW.type = 'TRADE' THEN
    v_type := 'TRADE';
    v_title := 'Trade Completed';
    v_message := v_team_name || ' acquired ' || v_player_name || ' via trade.';
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
  BEGIN PERFORM public.log_function_error('notify_league_on_transaction', SQLSTATE, SQLERRM, 'league notification dropped', jsonb_build_object('league_id', NEW.league_id, 'team_id', NEW.team_id, 'player_id', NEW.player_id)); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END;
$function$;

-- Kill the raw-id duplicate writer (function retained for rollback).
DROP TRIGGER IF EXISTS trigger_create_notifications_from_transaction ON public.transaction_ledger;
