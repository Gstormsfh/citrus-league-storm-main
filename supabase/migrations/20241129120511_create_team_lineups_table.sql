-- Create team_lineups table to store roster configurations
-- This enables shared league state where all users see the same lineups
create table if not exists public.team_lineups (
  team_id integer primary key,
  starters jsonb not null default '[]'::jsonb, -- Array of player IDs (strings)
  bench jsonb not null default '[]'::jsonb,     -- Array of player IDs (strings)
  ir jsonb not null default '[]'::jsonb,        -- Array of player IDs (strings)
  slot_assignments jsonb not null default '{}'::jsonb, -- Map of player_id -> slot_id
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.team_lineups enable row level security;

-- Allow everyone to read lineups (all users can see all teams' rosters)
create policy "Enable read access for all users"
on public.team_lineups
for select
using (true);

-- Allow authenticated users to update lineups
-- For now, allow all updates (you can restrict later by team_id if needed)
create policy "Enable update access for authenticated users"
on public.team_lineups
for all
using (true)
with check (true);

-- Create index for faster lookups
create index if not exists idx_team_lineups_team_id on public.team_lineups(team_id);
create index if not exists idx_team_lineups_updated_at on public.team_lineups(updated_at);

-- Add trigger to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_team_lineups_updated_at
  before update on public.team_lineups
  for each row
  execute function update_updated_at_column();

