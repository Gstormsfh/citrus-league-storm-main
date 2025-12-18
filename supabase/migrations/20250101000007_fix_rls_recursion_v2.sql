-- Fix infinite recursion in RLS policies - Version 2
-- Complete rewrite to eliminate all circular dependencies

-- Drop ALL existing policies
drop policy if exists "Users can view leagues they're in" on public.leagues;
drop policy if exists "Users can view leagues where they own teams" on public.leagues;
drop policy if exists "Users can view teams in their leagues" on public.teams;
drop policy if exists "Commissioners can create teams" on public.teams;

-- Drop old functions if they exist
drop function if exists public.check_league_commissioner(uuid, uuid);
drop function if exists public.is_league_commissioner(uuid);
drop function if exists public.user_owns_team_in_league(uuid);

-- Create security definer functions that bypass RLS completely
-- These use direct table access without any RLS checks

-- Check if user is commissioner of a league
create or replace function public.is_user_league_commissioner(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- Direct query with RLS bypassed via security definer
  select commissioner_id = auth.uid()
  from public.leagues
  where id = p_league_id;
$$;

-- Check if user owns a team in a league (bypasses RLS)
create or replace function public.user_has_team_in_league(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- Direct query with RLS bypassed via security definer
  select exists (
    select 1
    from public.teams
    where league_id = p_league_id
    and owner_id = auth.uid()
  );
$$;

-- Recreate leagues SELECT policy - NO circular dependency
-- Users can see leagues where they are commissioner
create policy "Users can view leagues they commission"
on public.leagues
for select
using (commissioner_id = auth.uid());

-- Recreate teams SELECT policy - NO circular dependency
-- Users can see teams they own OR teams in leagues they commission
create policy "Users can view teams"
on public.teams
for select
using (
  owner_id = auth.uid() or
  public.is_user_league_commissioner(league_id)
);

-- Recreate teams INSERT policy - NO circular dependency
-- Use the function which bypasses RLS
create policy "Commissioners can create teams"
on public.teams
for insert
with check (
  public.is_user_league_commissioner(league_id)
);

-- Add policy for users to see leagues where they own a team
-- Use function to avoid circular dependency (function bypasses RLS)
create policy "Users can view leagues with their teams"
on public.leagues
for select
using (
  public.user_has_team_in_league(id)
);

