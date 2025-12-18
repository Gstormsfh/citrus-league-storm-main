-- Create NHL teams table (normalized structure)
-- This is separate from fantasy league teams
create table if not exists public.nhl_teams (
  team_id integer primary key, -- NHL team ID (from NHL API)
  name text not null, -- Full team name (e.g., "Edmonton Oilers")
  abbreviation text not null unique, -- Team abbreviation (e.g., "EDM")
  city text not null, -- City name (e.g., "Edmonton")
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Enable RLS
alter table public.nhl_teams enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Public can view NHL teams" on public.nhl_teams;
drop policy if exists "Public can insert NHL teams" on public.nhl_teams;
drop policy if exists "Public can update NHL teams" on public.nhl_teams;

-- Public read access for NHL teams
create policy "Public can view NHL teams"
on public.nhl_teams
for select
using (true);

-- Allow inserts/updates for NHL teams (for normalization scripts)
-- This is safe since team data is public information
create policy "Public can insert NHL teams"
on public.nhl_teams
for insert
with check (true);

create policy "Public can update NHL teams"
on public.nhl_teams
for update
using (true)
with check (true);

-- Create index for abbreviation lookups
create index if not exists idx_nhl_teams_abbreviation on public.nhl_teams(abbreviation);

-- Add trigger to update updated_at (drop first if exists for idempotency)
drop trigger if exists update_nhl_teams_updated_at on public.nhl_teams;
create trigger update_nhl_teams_updated_at
  before update on public.nhl_teams
  for each row
  execute function update_updated_at_column();

