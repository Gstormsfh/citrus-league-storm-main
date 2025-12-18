-- Ensure team_lineups.team_id is UUID (in case UUID migration wasn't applied)
-- This fixes the "integer = uuid" error when querying team_lineups
do $$
begin
  -- Check if team_lineups exists and if team_id is not uuid
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'team_lineups' 
    and column_name = 'team_id'
    and data_type != 'uuid'
  ) then
    -- Drop primary key constraint
    alter table if exists public.team_lineups drop constraint if exists team_lineups_pkey;
    
    -- Clear existing data (old demo data with integer IDs)
    -- Real league lineups will be recreated automatically with proper UUIDs
    truncate table public.team_lineups;
    
    -- Drop and recreate team_id column as UUID
    -- This is cleaner than trying to convert integer to UUID
    alter table if exists public.team_lineups drop column if exists team_id;
    alter table if exists public.team_lineups add column team_id uuid primary key;
    
    -- Recreate index
    drop index if exists idx_team_lineups_team_id;
    create index if not exists idx_team_lineups_team_id on public.team_lineups(team_id);
  end if;
end $$;

-- Create roster_transactions table to track all add/drop operations
create table if not exists public.roster_transactions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null not null,
  team_id uuid references public.teams(id) on delete cascade not null,
  type text not null check (type in ('ADD', 'DROP')),
  player_id text not null, -- References player ID from staging files
  source text, -- e.g., 'Roster Tab', 'Free Agents Page'
  created_at timestamptz default now() not null
);

-- Enable RLS
alter table public.roster_transactions enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Users can view transactions in their leagues" on public.roster_transactions;
drop policy if exists "Users can insert their own transactions" on public.roster_transactions;

-- Users can view transactions in their leagues
create policy "Users can view transactions in their leagues"
on public.roster_transactions
for select
using (
  exists (
    select 1 from public.leagues
    where leagues.id = roster_transactions.league_id
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

-- Users can insert their own transactions
create policy "Users can insert their own transactions"
on public.roster_transactions
for insert
with check (
  user_id = auth.uid() and
  exists (
    select 1 from public.teams
    where teams.id = roster_transactions.team_id
    and teams.owner_id = auth.uid()
  )
);

-- Create indexes
create index if not exists idx_roster_transactions_league_id on public.roster_transactions(league_id);
create index if not exists idx_roster_transactions_team_id on public.roster_transactions(team_id);
create index if not exists idx_roster_transactions_user_id on public.roster_transactions(user_id);
create index if not exists idx_roster_transactions_player_id on public.roster_transactions(player_id);
create index if not exists idx_roster_transactions_created_at on public.roster_transactions(created_at desc);

-- Create function to handle add/drop transactions atomically
create or replace function public.handle_roster_transaction(
  p_league_id uuid,
  p_user_id uuid,
  p_drop_player_id text,
  p_add_player_id text,
  p_transaction_source text default 'Roster Tab'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_drop_pick_id uuid;
  v_add_pick_id uuid;
  v_existing_lineup jsonb;
  v_starters jsonb;
  v_bench jsonb;
  v_ir jsonb;
  v_slot_assignments jsonb;
  v_result jsonb;
  v_draft_session_id uuid;
  v_max_pick_number integer;
begin
  -- Begin transaction (implicit in function)
  
  -- Get user's team_id for this league
  select id into v_team_id
  from public.teams
  where league_id = p_league_id
    and owner_id = p_user_id
  limit 1;
  
  if v_team_id is null then
    raise exception 'User does not have a team in this league';
  end if;
  
  -- Validate: At least one operation must be specified
  if p_drop_player_id is null and p_add_player_id is null then
    raise exception 'Must specify at least one player to add or drop';
  end if;
  
  -- DROP LOGIC
  if p_drop_player_id is not null then
    -- Check ownership: Verify player is owned by this team
    select id into v_drop_pick_id
    from public.draft_picks
    where league_id = p_league_id
      and team_id = v_team_id
      and player_id = p_drop_player_id
      and deleted_at is null
    limit 1;
    
    if v_drop_pick_id is null then
      raise exception 'Player % is not owned by your team', p_drop_player_id;
    end if;
    
    -- Soft delete the draft_pick
    update public.draft_picks
    set deleted_at = now()
    where id = v_drop_pick_id;
    
    -- Remove player from team_lineups
    -- Get current lineup (check if row exists, with league_id check for isolation)
    select starters, bench, ir, slot_assignments
    into v_starters, v_bench, v_ir, v_slot_assignments
    from public.team_lineups
    where team_id = v_team_id
      and league_id = p_league_id;
    
    -- If lineup exists, remove player from arrays and slot_assignments
    if v_starters is not null or v_bench is not null or v_ir is not null then
      -- Initialize arrays if null
      if v_starters is null then v_starters := '[]'::jsonb; end if;
      if v_bench is null then v_bench := '[]'::jsonb; end if;
      if v_ir is null then v_ir := '[]'::jsonb; end if;
      
      -- Remove from starters array (filter out the player_id)
      v_starters := coalesce((
        select jsonb_agg(elem)
        from jsonb_array_elements_text(v_starters) elem
        where elem <> p_drop_player_id
      ), '[]'::jsonb);
      -- Remove from bench array
      v_bench := coalesce((
        select jsonb_agg(elem)
        from jsonb_array_elements_text(v_bench) elem
        where elem <> p_drop_player_id
      ), '[]'::jsonb);
      -- Remove from ir array
      v_ir := coalesce((
        select jsonb_agg(elem)
        from jsonb_array_elements_text(v_ir) elem
        where elem <> p_drop_player_id
      ), '[]'::jsonb);
      -- Remove from slot_assignments (this is an object, so use - operator)
      if v_slot_assignments is not null then
        v_slot_assignments := v_slot_assignments - p_drop_player_id;
      else
        v_slot_assignments := '{}'::jsonb;
      end if;
      
      -- Update team_lineups (with league_id check for isolation)
      update public.team_lineups
      set starters = v_starters,
          bench = v_bench,
          ir = v_ir,
          slot_assignments = v_slot_assignments,
          updated_at = now()
      where team_id = v_team_id
        and league_id = p_league_id;
    end if;
    
    -- Log the drop transaction
    insert into public.roster_transactions (
      league_id,
      user_id,
      team_id,
      type,
      player_id,
      source
    ) values (
      p_league_id,
      p_user_id,
      v_team_id,
      'DROP',
      p_drop_player_id,
      p_transaction_source
    );
  end if;
  
  -- ADD LOGIC
  if p_add_player_id is not null then
    -- Check availability: Verify player is not already owned in this league
    select id into v_add_pick_id
    from public.draft_picks
    where league_id = p_league_id
      and player_id = p_add_player_id
      and deleted_at is null
    limit 1;
    
    if v_add_pick_id is not null then
      raise exception 'Player % is already owned by another team in this league', p_add_player_id;
    end if;
    
    -- Check if there's a soft-deleted pick we can reactivate
    select id into v_add_pick_id
    from public.draft_picks
    where league_id = p_league_id
      and team_id = v_team_id
      and player_id = p_add_player_id
      and deleted_at is not null
    limit 1;
    
    if v_add_pick_id is not null then
      -- Reactivate the existing draft_pick (it was already for this team)
      update public.draft_picks
      set deleted_at = null,
          picked_at = now()
      where id = v_add_pick_id;
    else
      -- Create new draft_pick record
      -- For add/drop transactions, we'll use round 999 and calculate pick number
      -- Get the active draft_session_id for this league (or create a new one if none exists)
      select draft_session_id into v_draft_session_id
      from public.draft_picks
      where league_id = p_league_id
        and deleted_at is null
      limit 1;
      
      -- If no active session exists, generate a new one
      if v_draft_session_id is null then
        v_draft_session_id := gen_random_uuid();
      end if;
      
      -- Calculate next pick number
      select coalesce(max(pick_number), 0) + 1 into v_max_pick_number
      from public.draft_picks
      where league_id = p_league_id;
      
      -- Insert new draft_pick
      insert into public.draft_picks (
        league_id,
        team_id,
        player_id,
        round_number,
        pick_number,
        draft_session_id
      ) values (
        p_league_id,
        v_team_id,
        p_add_player_id,
        999, -- High round number to indicate post-draft add
        v_max_pick_number,
        v_draft_session_id
      )
      returning id into v_add_pick_id;
    end if;
    
    -- Add player to team_lineups bench array
    -- Get current lineup or create if doesn't exist (with league_id check for isolation)
    select starters, bench, ir, slot_assignments
    into v_starters, v_bench, v_ir, v_slot_assignments
    from public.team_lineups
    where team_id = v_team_id
      and league_id = p_league_id;
    
    if v_starters is null and v_bench is null and v_ir is null then
      -- Create new lineup entry (with league_id for isolation)
      insert into public.team_lineups (
        league_id,
        team_id,
        starters,
        bench,
        ir,
        slot_assignments
      ) values (
        p_league_id,
        v_team_id,
        '[]'::jsonb,
        jsonb_build_array(p_add_player_id),
        '[]'::jsonb,
        '{}'::jsonb
      );
    else
      -- Initialize arrays if null
      if v_starters is null then v_starters := '[]'::jsonb; end if;
      if v_bench is null then v_bench := '[]'::jsonb; end if;
      if v_ir is null then v_ir := '[]'::jsonb; end if;
      if v_slot_assignments is null then v_slot_assignments := '{}'::jsonb; end if;
      
      -- Add to bench if not already present in any array
      if not (v_starters ? p_add_player_id) 
         and not (v_bench ? p_add_player_id) 
         and not (v_ir ? p_add_player_id) then
        v_bench := v_bench || jsonb_build_array(p_add_player_id);
      end if;
      
      -- Update team_lineups (or insert if doesn't exist, with league_id for isolation)
      insert into public.team_lineups (
        league_id,
        team_id,
        starters,
        bench,
        ir,
        slot_assignments
      ) values (
        p_league_id,
        v_team_id,
        coalesce(v_starters, '[]'::jsonb),
        v_bench,
        coalesce(v_ir, '[]'::jsonb),
        coalesce(v_slot_assignments, '{}'::jsonb)
      )
      on conflict (league_id, team_id) do update
      set starters = coalesce(v_starters, '[]'::jsonb),
          bench = v_bench,
          ir = coalesce(v_ir, '[]'::jsonb),
          slot_assignments = coalesce(v_slot_assignments, '{}'::jsonb),
          updated_at = now();
    end if;
    
    -- Log the add transaction
    insert into public.roster_transactions (
      league_id,
      user_id,
      team_id,
      type,
      player_id,
      source
    ) values (
      p_league_id,
      p_user_id,
      v_team_id,
      'ADD',
      p_add_player_id,
      p_transaction_source
    );
  end if;
  
  -- Return success
  return jsonb_build_object(
    'status', 'success',
    'message', 'Transaction complete'
  );
  
exception
  when others then
    -- Rollback is automatic in plpgsql functions
    return jsonb_build_object(
      'status', 'error',
      'message', sqlerrm
    );
end;
$$;

-- Grant execute permission to authenticated users
grant execute on function public.handle_roster_transaction(uuid, uuid, text, text, text) to authenticated;

