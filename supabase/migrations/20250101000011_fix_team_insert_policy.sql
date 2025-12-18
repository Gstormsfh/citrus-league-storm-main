-- Fix team INSERT policy to allow commissioners to create teams
-- The current policy might not be working correctly

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

-- Create a new INSERT policy that allows authenticated users
-- The trigger will validate that they're the commissioner
create policy "Authenticated users can insert teams"
on public.teams
for insert
with check (
  auth.uid() is not null
);

-- Also ensure the trigger function can access the league data
-- The trigger already uses security definer, so it should work
-- But let's verify the function exists and is correct
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

