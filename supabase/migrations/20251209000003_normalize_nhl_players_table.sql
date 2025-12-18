-- Normalize players table to use team_id foreign key
-- First, add team_id column (nullable initially)
alter table if exists public.players 
  add column if not exists team_id integer references public.nhl_teams(team_id) on delete set null;

-- Create index for team_id lookups
create index if not exists idx_players_team_id on public.players(team_id);

-- Allow updates to players table (for normalization script)
-- Drop existing policy if it exists
drop policy if exists "Public can update players" on public.players;

create policy "Public can update players"
on public.players
for update
using (true)
with check (true);

-- Note: We'll need a script to populate nhl_teams and link players to teams
-- This migration just sets up the structure

