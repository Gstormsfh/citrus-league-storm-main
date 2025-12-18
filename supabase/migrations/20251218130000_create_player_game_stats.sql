-- Per-player per-game fantasy/boxscore stats extracted from raw NHL play-by-play.
-- This is the atomic fact table for our fantasy scoring and season rollups.

create table if not exists public.player_game_stats (
  season integer not null,
  game_id integer not null,
  game_date date not null,
  player_id integer not null,

  team_abbrev text,
  position_code text,
  is_goalie boolean not null default false,

  -- Skater boxscore / fantasy cats
  goals integer not null default 0,
  primary_assists integer not null default 0,
  secondary_assists integer not null default 0,
  points integer not null default 0,
  shots_on_goal integer not null default 0,
  hits integer not null default 0,
  blocks integer not null default 0,
  pim integer not null default 0,
  ppp integer not null default 0,
  shp integer not null default 0,
  plus_minus integer not null default 0,
  icetime_seconds integer not null default 0,

  -- Goalie stats (only populated when is_goalie=true)
  goalie_gp integer not null default 0,
  wins integer not null default 0,
  saves integer not null default 0,
  shots_faced integer not null default 0,
  goals_against integer not null default 0,
  shutouts integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (season, game_id, player_id)
);

create index if not exists idx_player_game_stats_player_id on public.player_game_stats(player_id);
create index if not exists idx_player_game_stats_game_date on public.player_game_stats(game_date);
create index if not exists idx_player_game_stats_season on public.player_game_stats(season);

alter table public.player_game_stats enable row level security;

drop policy if exists "Public can view player game stats" on public.player_game_stats;
create policy "Public can view player game stats"
on public.player_game_stats
for select
using (true);

comment on table public.player_game_stats is 'Atomic per-player per-game stats extracted from raw_nhl_data (no staging).';


