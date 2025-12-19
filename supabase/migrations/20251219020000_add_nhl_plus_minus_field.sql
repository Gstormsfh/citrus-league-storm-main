-- Add nhl_plus_minus field to player_season_stats for NHL.com official plus/minus (display only)
-- Our calculated plus_minus is kept for internal calculations

alter table public.player_season_stats
add column if not exists nhl_plus_minus integer not null default 0;

comment on column public.player_season_stats.nhl_plus_minus is 'Official NHL.com plus/minus (for display on player cards). Our calculated plus_minus is kept for internal use.';
