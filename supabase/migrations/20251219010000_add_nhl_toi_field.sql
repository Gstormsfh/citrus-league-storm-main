-- Add nhl_toi_seconds field to player_season_stats for NHL.com official TOI (display only)
-- Our calculated icetime_seconds is kept for GAR calculations (uses player_toi_by_situation)

alter table public.player_season_stats
add column if not exists nhl_toi_seconds integer not null default 0;

comment on column public.player_season_stats.nhl_toi_seconds is 'Official NHL.com TOI in seconds (for display on player cards). GAR uses player_toi_by_situation instead.';
