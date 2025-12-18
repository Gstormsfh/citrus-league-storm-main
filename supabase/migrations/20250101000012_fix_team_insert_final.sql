-- Final fix for team INSERT - Use security definer function in RLS policy
-- This bypasses the circular dependency issue

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

-- Create a security definer function to check if user is commissioner
-- This will be used in the RLS policy
create or replace function public.can_insert_team(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- Check if user is the commissioner of this league
  -- Security definer bypasses RLS on leagues table
  select commissioner_id = auth.uid()
  from public.leagues
  where id = p_league_id;
$$;

-- Create INSERT policy that uses the function
-- This allows commissioners to insert teams in their leagues
create policy "Commissioners can insert teams"
on public.teams
for insert
with check (
  public.can_insert_team(league_id)
);

-- Keep the trigger as a backup validation (though RLS should handle it)
-- But make sure it doesn't conflict
drop trigger if exists validate_team_commissioner on public.teams;

create trigger validate_team_commissioner
  before insert on public.teams
  for each row
  execute function public.validate_team_insert();









