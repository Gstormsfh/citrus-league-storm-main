-- Simple fix: Allow all authenticated users to insert, trigger validates
-- This is the simplest approach - RLS just checks auth, trigger checks commissioner

-- Drop ALL existing INSERT policies on teams
do $$
declare
  r record;
begin
  for r in 
    select policyname 
    from pg_policies 
    where schemaname = 'public' 
    and tablename = 'teams'
    and cmd = 'INSERT'
  loop
    execute format('drop policy if exists %I on public.teams', r.policyname);
  end loop;
end $$;

-- Drop the function-based policy approach
drop function if exists public.can_insert_team(uuid);

-- Create the simplest possible INSERT policy
-- Just check if user is authenticated - trigger will validate commissioner
create policy "Allow authenticated users to insert teams"
on public.teams
for insert
to authenticated
with check (true);

-- Ensure the trigger is set up correctly
drop trigger if exists validate_team_commissioner on public.teams;

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

create trigger validate_team_commissioner
  before insert on public.teams
  for each row
  execute function public.validate_team_insert();









