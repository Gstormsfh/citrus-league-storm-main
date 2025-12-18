-- Create NHL games/schedule table
-- Stores all NHL regular season and playoff games
create table if not exists public.nhl_games (
  id uuid primary key default gen_random_uuid(),
  game_id integer unique not null, -- NHL's official game ID
  game_date date not null,
  game_time timestamptz, -- Game start time (can be null if TBD)
  home_team text not null, -- Team abbreviation (e.g., 'EDM', 'TOR')
  away_team text not null, -- Team abbreviation
  home_score integer default 0,
  away_score integer default 0,
  status text default 'scheduled', -- 'scheduled', 'live', 'final', 'postponed'
  period text, -- Current period if live (e.g., '1st', '2nd', '3rd', 'OT', 'SO')
  period_time text, -- Time remaining in period (e.g., '12:45')
  venue text,
  season integer not null, -- Season year (e.g., 2024 for 2024-2025 season)
  game_type text default 'regular', -- 'regular', 'playoff', 'preseason'
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Enable RLS (public read access for schedule data)
alter table public.nhl_games enable row level security;

-- Everyone can read NHL schedule data (it's public information)
create policy "Public can view NHL games"
on public.nhl_games
for select
using (true);

-- Only service role can insert/update (via migrations or scripts)
-- Regular users cannot modify schedule data

-- Create indexes for fast lookups
create index if not exists idx_nhl_games_date on public.nhl_games(game_date);
create index if not exists idx_nhl_games_home_team on public.nhl_games(home_team, game_date);
create index if not exists idx_nhl_games_away_team on public.nhl_games(away_team, game_date);
create index if not exists idx_nhl_games_season on public.nhl_games(season);
create index if not exists idx_nhl_games_status on public.nhl_games(status);
create index if not exists idx_nhl_games_game_id on public.nhl_games(game_id);

-- Add trigger to update updated_at
create trigger update_nhl_games_updated_at
  before update on public.nhl_games
  for each row
  execute function update_updated_at_column();
