-- Official NHL shift charts (on-ice intervals) from NHL Stats REST shiftcharts endpoint.
-- Source: https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=XXXXXXXXXX
--
-- This table is used for accurate NHL-style +/- computation.

create table if not exists public.player_shifts_official (
  shift_id bigint primary key, -- NHL shiftcharts `id`
  game_id integer not null,
  player_id integer not null,
  team_id integer not null,
  team_abbrev text,
  period integer not null,
  shift_number integer not null,
  start_time text,
  end_time text,
  duration text,
  shift_start_time_seconds integer not null default 0,
  shift_end_time_seconds integer not null default 0,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_player_shifts_official_game_period
  on public.player_shifts_official(game_id, period);

create index if not exists idx_player_shifts_official_player
  on public.player_shifts_official(player_id);

create index if not exists idx_player_shifts_official_team
  on public.player_shifts_official(team_id);

alter table public.player_shifts_official enable row level security;

drop policy if exists "Public can view official player shifts" on public.player_shifts_official;
create policy "Public can view official player shifts"
on public.player_shifts_official
for select
using (true);

comment on table public.player_shifts_official is 'Official shift intervals per player from NHL shiftcharts endpoint (used for accurate +/-).';


