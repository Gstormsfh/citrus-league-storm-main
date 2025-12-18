-- Ultra-simple fix: Remove ALL cross-table dependencies from RLS
-- This is the nuclear option - minimal RLS, maximum trigger/application-level validation

-- Drop ALL policies on leagues and teams tables
-- Use DO block to dynamically drop all policies
do $$
declare
  r record;
begin
  -- Drop all policies on leagues table
  for r in 
    select policyname 
    from pg_policies 
    where schemaname = 'public' 
    and tablename = 'leagues'
  loop
    execute format('drop policy if exists %I on public.leagues', r.policyname);
  end loop;
  
  -- Drop all policies on teams table
  for r in 
    select policyname 
    from pg_policies 
    where schemaname = 'public' 
    and tablename = 'teams'
  loop
    execute format('drop policy if exists %I on public.teams', r.policyname);
  end loop;
end $$;

drop function if exists public.check_league_commissioner(uuid, uuid);
drop function if exists public.is_league_commissioner(uuid);
drop function if exists public.user_owns_team_in_league(uuid);
drop function if exists public.is_user_league_commissioner(uuid);
drop function if exists public.user_has_team_in_league(uuid);
drop function if exists public.check_commissioner_simple(uuid);
drop function if exists public.check_team_owner_simple(uuid);

drop trigger if exists validate_team_commissioner on public.teams;
drop function if exists public.validate_team_insert();

-- Create trigger function for validation (this is the ONLY place we check commissioner)
create or replace function public.validate_team_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  league_commissioner_id uuid;
begin
  -- Direct query - security definer should bypass RLS
  select commissioner_id into league_commissioner_id
  from public.leagues
  where id = new.league_id;
  
  if league_commissioner_id is null then
    raise exception 'League does not exist';
  end if;
  
  if league_commissioner_id != auth.uid() then
    raise exception 'Only the league commissioner can create teams';
  end if;
  
  return new;
end;
$$;

-- Create trigger
create trigger validate_team_commissioner
  before insert on public.teams
  for each row
  execute function public.validate_team_insert();

-- MINIMAL RLS POLICIES - NO CROSS-TABLE CHECKS AT ALL

-- Leagues: Users can only see leagues they directly commission
-- NO checking of teams table
create policy "Commissioners can view their leagues"
on public.leagues
for select
using (commissioner_id = auth.uid());

-- Teams: Users can only see teams they directly own
-- NO checking of leagues table
create policy "Users can view their own teams"
on public.teams
for select
using (owner_id = auth.uid());

-- Teams: Allow INSERT for authenticated users
-- Validation happens in trigger, not RLS
create policy "Authenticated users can insert teams"
on public.teams
for insert
with check (auth.uid() is not null);

-- Teams: Users can update their own teams
create policy "Users can update their own teams"
on public.teams
for update
using (owner_id = auth.uid());

-- Leagues: Users can create leagues (they become commissioner)
create policy "Users can create leagues"
on public.leagues
for insert
with check (auth.uid() = commissioner_id);

-- Leagues: Commissioners can update their leagues
create policy "Commissioners can update their leagues"
on public.leagues
for update
using (commissioner_id = auth.uid());

