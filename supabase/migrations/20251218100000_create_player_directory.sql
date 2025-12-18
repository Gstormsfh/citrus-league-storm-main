-- Player directory: canonical player identity + metadata used by the app.
-- This replaces any reliance on staging tables for names/teams/positions.

create table if not exists public.player_directory (
  season integer not null,
  player_id integer not null,
  full_name text not null,
  team_abbrev text,
  position_code text,
  is_goalie boolean not null default false,
  jersey_number text,
  headshot_url text,
  shoots_catches text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season, player_id)
);

create index if not exists idx_player_directory_season on public.player_directory(season);
create index if not exists idx_player_directory_player_id on public.player_directory(player_id);
create index if not exists idx_player_directory_team_abbrev on public.player_directory(team_abbrev);

alter table public.player_directory enable row level security;

drop policy if exists "Public can view player directory" on public.player_directory;
create policy "Public can view player directory"
on public.player_directory
for select
using (true);

comment on table public.player_directory is 'Canonical player identity + metadata per season. Source of truth for app player names/teams/positions (no staging).';


