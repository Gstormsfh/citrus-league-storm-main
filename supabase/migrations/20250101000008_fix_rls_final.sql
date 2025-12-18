-- Final fix for infinite recursion - Use trigger-based validation instead of RLS
-- This completely eliminates the circular dependency by removing RLS checks from INSERT

-- Drop ALL existing policies and functions
drop policy if exists "Users can view leagues they're in" on public.leagues;
drop policy if exists "Users can view leagues they commission" on public.leagues;
drop policy if exists "Users can view leagues with their teams" on public.leagues;
drop policy if exists "Users can view teams in their leagues" on public.teams;
drop policy if exists "Users can view teams" on public.teams;
drop policy if exists "Commissioners can create teams" on public.teams;

-- Drop old functions
drop function if exists public.check_league_commissioner(uuid, uuid);
drop function if exists public.is_league_commissioner(uuid);
drop function if exists public.user_owns_team_in_league(uuid);
drop function if exists public.is_user_league_commissioner(uuid);
drop function if exists public.user_has_team_in_league(uuid);

-- Drop trigger if it exists
drop trigger if exists validate_team_commissioner on public.teams;
drop function if exists public.validate_team_insert();

-- Create a trigger function to validate team creation
-- This runs AFTER the INSERT, so it doesn't interfere with RLS
create or replace function public.validate_team_insert()
returns trigger
language plpgsql
security definer
as $$
declare
  league_commissioner_id uuid;
begin
  -- Get the commissioner_id directly from leagues table (bypasses RLS via security definer)
  select commissioner_id into league_commissioner_id
  from public.leagues
  where id = new.league_id;
  
  -- If league doesn't exist or user is not commissioner, raise error
  if league_commissioner_id is null then
    raise exception 'League does not exist';
  end if;
  
  if league_commissioner_id != auth.uid() then
    raise exception 'Only the league commissioner can create teams';
  end if;
  
  return new;
end;
$$;

-- Create trigger to validate team creation
create trigger validate_team_commissioner
  before insert on public.teams
  for each row
  execute function public.validate_team_insert();

-- Recreate simple SELECT policies (no circular dependencies)
-- Leagues: Users can see leagues they commission
create policy "Users can view leagues they commission"
on public.leagues
for select
using (commissioner_id = auth.uid());

-- Teams: Users can see teams they own
create policy "Users can view their own teams"
on public.teams
for select
using (owner_id = auth.uid());

-- Teams: Allow INSERT for authenticated users (validation happens in trigger)
-- This avoids the RLS circular dependency entirely
create policy "Authenticated users can create teams"
on public.teams
for insert
with check (auth.uid() is not null);

-- Add policy for users to see teams in leagues they commission
-- Use a simple function that only checks leagues table
create or replace function public.check_commissioner_simple(p_league_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select commissioner_id = auth.uid()
  from public.leagues
  where id = p_league_id;
$$;

create policy "Users can view teams in their leagues"
on public.teams
for select
using (
  owner_id = auth.uid() or
  public.check_commissioner_simple(league_id)
);

-- Add policy for users to see leagues where they own teams
-- Use a simple function that only checks teams table
create or replace function public.check_team_owner_simple(p_league_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.teams
    where league_id = p_league_id
    and owner_id = auth.uid()
  );
$$;

create policy "Users can view leagues with their teams"
on public.leagues
for select
using (
  public.check_team_owner_simple(id)
);









