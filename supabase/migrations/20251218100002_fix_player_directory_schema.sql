-- Fix/upgrade an existing public.player_directory table that may have been created earlier
-- without the `season` column. This makes the schema compatible with the new pipeline.

do $$
begin
  -- If the table doesn't exist, nothing to fix (the create migration will create it).
  if to_regclass('public.player_directory') is null then
    return;
  end if;

  -- Ensure required columns exist (safe no-ops if already present)
  alter table public.player_directory add column if not exists season integer;
  alter table public.player_directory add column if not exists player_id integer;
  alter table public.player_directory add column if not exists full_name text;
  alter table public.player_directory add column if not exists team_abbrev text;
  alter table public.player_directory add column if not exists position_code text;
  alter table public.player_directory add column if not exists is_goalie boolean not null default false;
  alter table public.player_directory add column if not exists jersey_number text;
  alter table public.player_directory add column if not exists headshot_url text;
  alter table public.player_directory add column if not exists shoots_catches text;
  alter table public.player_directory add column if not exists created_at timestamptz not null default now();
  alter table public.player_directory add column if not exists updated_at timestamptz not null default now();

  -- Backfill season for any pre-existing rows (assume current season = 2025 for MVP)
  update public.player_directory
    set season = 2025
  where season is null;

  -- Enforce NOT NULL on required columns (only after backfill)
  alter table public.player_directory alter column season set not null;
  alter table public.player_directory alter column player_id set not null;
  alter table public.player_directory alter column full_name set not null;

  -- Ensure composite primary key (season, player_id)
  -- (If an old PK exists, it is almost always named player_directory_pkey in Postgres)
  begin
    alter table public.player_directory drop constraint if exists player_directory_pkey;
  exception when others then
    -- ignore
  end;

  alter table public.player_directory
    add constraint player_directory_pkey primary key (season, player_id);

  create index if not exists idx_player_directory_season on public.player_directory(season);
  create index if not exists idx_player_directory_player_id on public.player_directory(player_id);
  create index if not exists idx_player_directory_team_abbrev on public.player_directory(team_abbrev);
end $$;


