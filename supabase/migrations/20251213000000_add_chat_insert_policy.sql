-- Add INSERT policy and function for CHAT notifications
-- Allow authenticated users to send chat messages to leagues they're members of

-- Drop existing policy if it exists
drop policy if exists "Users can insert CHAT notifications" on public.notifications;

-- Create policy for inserting CHAT notifications
-- Users can insert CHAT notifications for any league member in leagues they belong to
create policy "Users can insert CHAT notifications"
on public.notifications
for insert
to authenticated
with check (
  type = 'CHAT' and
  auth.uid() is not null and
  -- Verify the sender is a member of the league
  exists (
    select 1 from public.leagues
    where leagues.id = notifications.league_id
    and (
      leagues.commissioner_id = auth.uid() or
      exists (
        select 1 from public.teams
        where teams.league_id = leagues.id
        and teams.owner_id = auth.uid()
      )
    )
  ) and
  -- Verify the recipient is a member of the league
  exists (
    select 1 from public.teams
    where teams.league_id = notifications.league_id
    and teams.owner_id = notifications.user_id
  )
);

-- Grant INSERT permission on notifications table
grant insert on public.notifications to authenticated;

-- Create a secure function to send chat messages to all league members
-- This ensures proper validation and creates notifications for all members
create or replace function public.send_league_chat_message(
  p_league_id uuid,
  p_message text,
  p_sender_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_sender_id uuid;
  v_sender_username text;
  v_team_name text;
  v_league_member_id uuid;
  v_notifications_created integer := 0;
  v_result jsonb;
begin
  -- Get authenticated user
  v_sender_id := auth.uid();
  if v_sender_id is null then
    return jsonb_build_object('success', false, 'error', 'Authentication required');
  end if;

  -- Verify sender is a member of the league
  if not exists (
    select 1 from public.leagues
    where id = p_league_id
    and (
      commissioner_id = v_sender_id or
      exists (
        select 1 from public.teams
        where league_id = p_league_id
        and owner_id = v_sender_id
      )
    )
  ) then
    return jsonb_build_object('success', false, 'error', 'You are not a member of this league');
  end if;

  -- Get sender name
  if p_sender_name is null or p_sender_name = '' then
    -- Try to get username from profile
    select username, default_team_name into v_sender_username, v_team_name
    from public.profiles
    where id = v_sender_id;
    
    v_sender_username := coalesce(v_sender_username, v_team_name, 'Someone');
  else
    v_sender_username := p_sender_name;
  end if;

  -- Validate message
  if p_message is null or trim(p_message) = '' then
    return jsonb_build_object('success', false, 'error', 'Message cannot be empty');
  end if;

  -- Create notifications for all league members
  for v_league_member_id in
    select distinct t.owner_id
    from public.teams t
    where t.league_id = p_league_id
      and t.owner_id is not null
  loop
    insert into public.notifications (
      league_id,
      user_id,
      type,
      title,
      message,
      metadata,
      read_status,
      read_at
    ) values (
      p_league_id,
      v_league_member_id,
      'CHAT',
      v_sender_username || ' sent a message',
      trim(p_message),
      jsonb_build_object(
        'sender_id', v_sender_id,
        'sender_name', v_sender_username
      ),
      v_league_member_id = v_sender_id, -- Mark as read for sender
      case when v_league_member_id = v_sender_id then now() else null end
    );
    v_notifications_created := v_notifications_created + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'notifications_created', v_notifications_created,
    'message', 'Chat message sent successfully'
  );
end;
$$;

-- Grant execute permission on the function
grant execute on function public.send_league_chat_message(uuid, text, text) to authenticated;

