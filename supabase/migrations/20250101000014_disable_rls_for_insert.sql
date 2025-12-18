-- Temporarily disable RLS for INSERT operations on teams
-- This will help us determine if RLS is the issue or something else
-- We'll rely entirely on the trigger for validation

-- First, let's see what policies exist
-- (This is just for reference, we'll drop them all)

-- Drop ALL policies on teams table
do $$
declare
  r record;
begin
  for r in 
    select policyname 
    from pg_policies 
    where schemaname = 'public' 
    and tablename = 'teams'
  loop
    execute format('drop policy if exists %I on public.teams', r.policyname);
  end loop;
end $$;

-- Temporarily disable RLS for INSERT only
-- We'll use a policy that always allows INSERT
-- But keep RLS enabled for SELECT/UPDATE

-- Create the function if it doesn't exist
create or replace function public.is_commissioner_of_league(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select commissioner_id = auth.uid()
  from public.leagues
  where id = p_league_id;
$$;

-- Recreate SELECT policies (keep existing functionality)
create policy "Users can view their own teams"
on public.teams
for select
using (owner_id = auth.uid());

create policy "Commissioners can view all teams in their leagues"
on public.teams
for select
using (
  public.is_commissioner_of_league(league_id)
);

-- Recreate UPDATE policy
create policy "Users can update their own teams"
on public.teams
for update
using (owner_id = auth.uid());

-- For INSERT: Use a policy that bypasses all checks
-- The trigger will handle validation
create policy "Bypass RLS for INSERT - trigger validates"
on public.teams
for insert
to authenticated
with check (true);

-- Make sure the trigger function exists and is correct
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
    raise exception 'Only the league commissioner can create teams. User: %, Commissioner: %', auth.uid(), league_commissioner_id;
  end if;
  
  return new;
end;
$$;

-- Ensure trigger exists
drop trigger if exists validate_team_commissioner on public.teams;

create trigger validate_team_commissioner
  before insert on public.teams
  for each row
  execute function public.validate_team_insert();

