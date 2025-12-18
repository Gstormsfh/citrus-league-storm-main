-- Normalize nhl_games table to use team_id foreign keys
-- Add home_team_id and away_team_id columns
alter table if exists public.nhl_games
  add column if not exists home_team_id integer references public.nhl_teams(team_id) on delete restrict,
  add column if not exists away_team_id integer references public.nhl_teams(team_id) on delete restrict;

-- Create indexes for team lookups
create index if not exists idx_nhl_games_home_team_id on public.nhl_games(home_team_id, game_date);
create index if not exists idx_nhl_games_away_team_id on public.nhl_games(away_team_id, game_date);

-- Note: We'll need a script to populate team_id values from the existing abbreviation columns
-- Keep the abbreviation columns for now as they're still used in the app

