-- Add policy to allow commissioners to view all teams in their leagues
-- This allows simulated teams (with owner_id = null) to be visible

-- Create a security definer function to check if user is commissioner of a league
-- This only queries leagues table, no circular dependency
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

-- Add policy for commissioners to view all teams in their leagues
create policy "Commissioners can view all teams in their leagues"
on public.teams
for select
using (
  public.is_commissioner_of_league(league_id)
);

-- Also add policy for users to see leagues where they own teams
-- This uses a function that only queries teams table
create or replace function public.user_owns_team_in_league_simple(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.teams
    where league_id = p_league_id
    and owner_id = auth.uid()
  );
$$;

create policy "Users can view leagues where they own teams"
on public.leagues
for select
using (
  public.user_owns_team_in_league_simple(id)
);









