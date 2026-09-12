-- 20260912033000 — a commissioner notification can carry structured detail.
--
-- `notify_league_members` writes a title and a message and a FIXED metadata
-- object: { source: 'commissioner', commissioner_id: <uuid> }. Callers have no
-- channel for anything else, so every commissioner notification in the product
-- reads the same however much it matters -- "Draft settings have been updated
-- by the commissioner" whether the pick clock moved by five seconds or the
-- draft moved to a different night.
--
-- notifications.metadata is already a jsonb column and is already populated by
-- this function, so nothing about the table changes. This adds the parameter
-- the callers were missing.
--
-- WHY A DROP AND NOT A REPLACE: adding a parameter changes the arity, and
-- CREATE OR REPLACE on a different arity creates a second overload rather than
-- replacing the original. Two overloads reachable by the same PostgREST name is
-- a coin flip over which one answers. The drop and the create are in one
-- migration, so they are atomic. Every caller passes NAMED arguments --
-- verified across all eight call sites in KeeperService, TradeService,
-- WaiverService and LeagueService -- so a new trailing parameter with a default
-- is invisible to them. No database function calls this one.
--
-- Caller metadata is merged UNDER the authoritative keys, not over them: a
-- caller cannot rewrite `source` or `commissioner_id` to claim the write came
-- from somewhere it did not.

drop function if exists public.notify_league_members(uuid, text, text, text);

create or replace function public.notify_league_members(
  p_league_id uuid,
  p_title text,
  p_message text,
  p_notification_type text default 'SYSTEM',
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_caller_id UUID;
  v_league_member_id UUID;
  v_notifications_created INTEGER := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
      AND commissioner_id = v_caller_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only commissioners can send system notifications');
  END IF;

  IF p_notification_type NOT IN ('ADD', 'DROP', 'WAIVER', 'TRADE', 'CHAT', 'SYSTEM') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid notification type');
  END IF;

  IF p_message IS NULL OR trim(p_message) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Message cannot be empty');
  END IF;

  FOR v_league_member_id IN
    SELECT DISTINCT t.owner_id
    FROM public.teams t
    WHERE t.league_id = p_league_id
      AND t.owner_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications (
      league_id, user_id, type, title, message, metadata, read_status, read_at
    ) VALUES (
      p_league_id,
      v_league_member_id,
      p_notification_type,
      COALESCE(p_title, 'League Update'),
      trim(p_message),
      -- Caller keys first, authoritative keys last: `||` lets the right side
      -- win, so source and commissioner_id cannot be spoofed by a caller.
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'source', 'commissioner',
        'commissioner_id', v_caller_id
      ),
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
$function$;

-- The dropped function's grants went with it; restore the posture it had.
revoke all on function public.notify_league_members(uuid, text, text, text, jsonb) from public;
grant execute on function public.notify_league_members(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.notify_league_members(uuid, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
