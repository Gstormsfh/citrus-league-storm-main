-- Season rollup table: one row per player per season for fast UI loads.
-- Built by build_player_season_stats.py from player_game_stats.

create table if not exists public.player_season_stats (
  season integer not null,
  player_id integer not null,

  team_abbrev text,
  position_code text,
  is_goalie boolean not null default false,

  games_played integer not null default 0,
  icetime_seconds integer not null default 0,

  -- Skater totals
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

  -- xG totals (optional; populated from raw_shots if available)
  x_goals numeric not null default 0,
  x_assists numeric not null default 0,

  -- Goalie totals
  goalie_gp integer not null default 0,
  wins integer not null default 0,
  saves integer not null default 0,
  shots_faced integer not null default 0,
  goals_against integer not null default 0,
  shutouts integer not null default 0,
  save_pct numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (season, player_id)
);

create index if not exists idx_player_season_stats_season on public.player_season_stats(season);
create index if not exists idx_player_season_stats_player_id on public.player_season_stats(player_id);
create index if not exists idx_player_season_stats_team_abbrev on public.player_season_stats(team_abbrev);

alter table public.player_season_stats enable row level security;

drop policy if exists "Public can view player season stats" on public.player_season_stats;
create policy "Public can view player season stats"
on public.player_season_stats
for select
using (true);

comment on table public.player_season_stats is 'Season rollup of player_game_stats. Primary UI source for season totals (no staging).';


