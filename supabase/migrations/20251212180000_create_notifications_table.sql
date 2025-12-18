-- Create notifications table for league activity tracking
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check (type in ('ADD', 'DROP', 'WAIVER', 'TRADE', 'CHAT', 'SYSTEM')),
  title text not null,
  message text not null,
  metadata jsonb default '{}'::jsonb, -- Flexible data (player_id, team_id, etc.)
  read_status boolean default false not null,
  created_at timestamptz default now() not null,
  read_at timestamptz
);

-- Enable RLS
alter table public.notifications enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Users can view their own notifications" on public.notifications;
drop policy if exists "Users can update their own notifications" on public.notifications;

-- Users can view their own notifications in leagues they're members of
create policy "Users can view their own notifications"
on public.notifications
for select
using (
  user_id = auth.uid() and
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
  )
);

-- Users can update read_status and read_at for their own notifications
create policy "Users can update their own notifications"
on public.notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- No INSERT policy for regular users - only system/service role can insert via triggers

-- Create indexes for performance
create index if not exists idx_notifications_user_league on public.notifications(user_id, league_id, read_status, created_at desc);
create index if not exists idx_notifications_league_created on public.notifications(league_id, created_at desc);
create index if not exists idx_notifications_user_read_status on public.notifications(user_id, read_status) where read_status = false;

-- Create trigger function to auto-generate notifications from roster_transactions
create or replace function public.create_notifications_from_transaction()
returns trigger
language plpgsql
security definer
as $$
declare
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
begin
  -- Get transaction details
  v_league_id := NEW.league_id;
  v_user_id := NEW.user_id;
  v_team_id := NEW.team_id;
  v_player_id := NEW.player_id;
  v_transaction_type := NEW.type;
  
  -- Get team name
  select team_name into v_team_name
  from public.teams
  where id = v_team_id;
  
  -- Get user name
  select full_name into v_user_name
  from public.profiles
  where id = v_user_id;
  
  -- Get player name (from staging tables - simplified for now)
  -- In production, you might want to join with a players table
  v_player_name := v_player_id; -- Placeholder - will be enriched by frontend
  
  -- Build notification content
  if v_transaction_type = 'ADD' then
    v_notification_title := v_player_name || ' added';
    v_notification_message := v_user_name || ' added ' || v_player_name || ' to ' || coalesce(v_team_name, 'their team');
  elsif v_transaction_type = 'DROP' then
    v_notification_title := v_player_name || ' dropped';
    v_notification_message := v_user_name || ' dropped ' || v_player_name || ' from ' || coalesce(v_team_name, 'their team');
  else
    -- Unknown type, skip
    return NEW;
  end if;
  
  -- Create notifications for all league members except the transaction owner
  for v_league_member_id in
    select distinct t.owner_id
    from public.teams t
    where t.league_id = v_league_id
      and t.owner_id is not null
      and t.owner_id != v_user_id
  loop
    insert into public.notifications (
      league_id,
      user_id,
      type,
      title,
      message,
      metadata
    ) values (
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
  end loop;
  
  return NEW;
end;
$$;

-- Create trigger on roster_transactions
drop trigger if exists trigger_create_notifications_from_transaction on public.roster_transactions;
create trigger trigger_create_notifications_from_transaction
  after insert on public.roster_transactions
  for each row
  execute function public.create_notifications_from_transaction();

-- Grant necessary permissions
grant select, update on public.notifications to authenticated;
grant usage on schema public to authenticated;

