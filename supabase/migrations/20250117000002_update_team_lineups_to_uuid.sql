-- Update team_lineups table to use UUID instead of integer
-- This allows it to work with real teams (which use UUID) instead of just demo teams

-- First, drop the existing primary key constraint
alter table if exists public.team_lineups drop constraint if exists team_lineups_pkey;

-- Change team_id column from integer to uuid
alter table if exists public.team_lineups 
  alter column team_id type uuid using team_id::text::uuid;

-- Re-add primary key constraint
alter table if exists public.team_lineups 
  add primary key (team_id);

-- Update the index
drop index if exists idx_team_lineups_team_id;
create index if not exists idx_team_lineups_team_id on public.team_lineups(team_id);
