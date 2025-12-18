-- Fix infinite recursion in RLS policies
-- The issue: teams INSERT policy checks leagues, which checks teams, causing infinite loop
-- Solution: Simplify policies to eliminate circular dependencies

-- Drop ALL existing policies that might cause recursion
drop policy if exists "Users can view leagues they're in" on public.leagues;
drop policy if exists "Users can view teams in their leagues" on public.teams;
drop policy if exists "Commissioners can create teams" on public.teams;

-- Create a security definer function that truly bypasses RLS
-- This function checks commissioner_id directly without triggering RLS
create or replace function public.check_league_commissioner(league_uuid uuid, user_uuid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  is_commissioner boolean;
begin
  -- Temporarily disable RLS for this query to avoid recursion
  set local row_security = off;
  
  -- Use a direct query that bypasses RLS
  select exists (
    select 1 
    from public.leagues 
    where id = league_uuid 
    and commissioner_id = user_uuid
  ) into is_commissioner;
  
  return is_commissioner;
end;
$$;

-- Recreate leagues SELECT policy - simplified to avoid circular dependency
-- Only check direct ownership, not team membership (teams can be checked separately)
create policy "Users can view leagues they're in"
on public.leagues
for select
using (
  commissioner_id = auth.uid()
);

-- Recreate teams SELECT policy - simplified to avoid circular dependency  
-- Check owner directly, and use function for commissioner check
create policy "Users can view teams in their leagues"
on public.teams
for select
using (
  owner_id = auth.uid() or
  public.check_league_commissioner(league_id, auth.uid())
);

-- Recreate teams INSERT policy - use function to avoid circular dependency
-- This is the critical one that was causing the recursion
create policy "Commissioners can create teams"
on public.teams
for insert
with check (
  public.check_league_commissioner(league_id, auth.uid())
);

-- Add a separate policy to allow users to see leagues where they own teams
-- This is separate to avoid circular dependency
create policy "Users can view leagues where they own teams"
on public.leagues
for select
using (
  exists (
    select 1 
    from public.teams 
    where teams.league_id = leagues.id 
    and teams.owner_id = auth.uid()
  )
);

