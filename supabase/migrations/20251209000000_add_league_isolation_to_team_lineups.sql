-- Add league_id to team_lineups and enforce league isolation
-- This ensures rosters are properly scoped to their league

-- Step 1: Add league_id column (nullable initially for migration)
alter table if exists public.team_lineups 
add column if not exists league_id uuid references public.leagues(id) on delete cascade;

-- Step 2: Migrate existing data - link team_lineups to league via teams table
update public.team_lineups tl
set league_id = t.league_id
from public.teams t
where tl.team_id = t.id
  and tl.league_id is null;

-- Step 3: Make league_id NOT NULL after migration
-- First, delete any orphaned lineups (teams that don't exist or have no league)
delete from public.team_lineups
where league_id is null
  and not exists (
    select 1 from public.teams t
    where t.id = team_lineups.team_id
  );

-- Now set NOT NULL constraint
alter table public.team_lineups
alter column league_id set not null;

-- Step 4: Add composite unique constraint to ensure one lineup per team per league
-- Drop existing primary key if it exists
alter table if exists public.team_lineups drop constraint if exists team_lineups_pkey;

-- Add composite primary key (league_id, team_id)
alter table public.team_lineups
add constraint team_lineups_pkey primary key (league_id, team_id);

-- Step 5: Create index on league_id for faster queries
create index if not exists idx_team_lineups_league_id on public.team_lineups(league_id);

-- Step 6: Drop old permissive RLS policies
drop policy if exists "Enable read access for all users" on public.team_lineups;
drop policy if exists "Enable update access for authenticated users" on public.team_lineups;

-- Step 7: Create new league-isolated RLS policies

-- Users can view lineups in their leagues
create policy "Users can view lineups in their leagues"
on public.team_lineups
for select
using (
  exists (
    select 1 from public.leagues l
    where l.id = team_lineups.league_id
    and (
      l.commissioner_id = auth.uid() or
      exists (
        select 1 from public.teams t
        where t.league_id = l.id
        and t.owner_id = auth.uid()
      )
    )
  )
);

-- Users can update lineups for their own teams
create policy "Users can update their own team lineups"
on public.team_lineups
for update
using (
  exists (
    select 1 from public.teams t
    join public.leagues l on t.league_id = l.id
    where t.id = team_lineups.team_id
    and t.league_id = team_lineups.league_id
    and t.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.teams t
    join public.leagues l on t.league_id = l.id
    where t.id = team_lineups.team_id
    and t.league_id = team_lineups.league_id
    and t.owner_id = auth.uid()
  )
);

-- Users can insert lineups for their own teams
create policy "Users can insert their own team lineups"
on public.team_lineups
for insert
with check (
  exists (
    select 1 from public.teams t
    join public.leagues l on t.league_id = l.id
    where t.id = team_lineups.team_id
    and t.league_id = team_lineups.league_id
    and t.owner_id = auth.uid()
  )
);

-- Commissioners can manage all lineups in their leagues
create policy "Commissioners can manage all lineups in their leagues"
on public.team_lineups
for all
using (
  exists (
    select 1 from public.leagues l
    where l.id = team_lineups.league_id
    and l.commissioner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.leagues l
    where l.id = team_lineups.league_id
    and l.commissioner_id = auth.uid()
  )
);

