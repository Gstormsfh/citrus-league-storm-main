-- Track whether downstream fantasy stat extraction has been performed for a raw NHL game payload.
-- We keep this separate from `processed` (xG/raw_shots processing) so the xG pipeline and fantasy stats pipeline
-- can run independently and be re-run independently.

alter table if exists public.raw_nhl_data
  add column if not exists stats_extracted boolean not null default false;

alter table if exists public.raw_nhl_data
  add column if not exists stats_extracted_at timestamptz;

create index if not exists idx_raw_nhl_data_stats_extracted
  on public.raw_nhl_data(stats_extracted);

comment on column public.raw_nhl_data.stats_extracted is 'True when fantasy stat extraction (player_game_stats) has been performed for the final game payload.';
comment on column public.raw_nhl_data.stats_extracted_at is 'Timestamp when stats_extracted was set true.';


