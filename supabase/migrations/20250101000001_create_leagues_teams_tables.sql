-- Create draft_status enum
create type draft_status as enum ('not_started', 'in_progress', 'completed');

-- Create leagues table
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  commissioner_id uuid references public.profiles(id) on delete cascade not null,
  draft_status draft_status default 'not_started' not null,
  join_code text unique not null default gen_random_uuid()::text,
  roster_size integer default 21 not null,
  draft_rounds integer default 21 not null,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Create teams table
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade not null,
  owner_id uuid references public.profiles(id) on delete set null,
  team_name text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  -- Ensure a user can only own one team per league
  unique(league_id, owner_id)
);

-- Enable RLS
alter table public.leagues enable row level security;
alter table public.teams enable row level security;

-- Leagues: Users can read leagues they're in (as commissioner or team owner)
create policy "Users can view leagues they're in"
on public.leagues
for select
using (
  commissioner_id = auth.uid() or
  exists (
    select 1 from public.teams
    where teams.league_id = leagues.id
    and teams.owner_id = auth.uid()
  )
);

-- Leagues: Commissioners can update their leagues
create policy "Commissioners can update their leagues"
on public.leagues
for update
using (commissioner_id = auth.uid());

-- Leagues: Authenticated users can create leagues
create policy "Authenticated users can create leagues"
on public.leagues
for insert
with check (auth.uid() = commissioner_id);

-- Teams: Users can read teams in their leagues
create policy "Users can view teams in their leagues"
on public.teams
for select
using (
  owner_id = auth.uid() or
  exists (
    select 1 from public.leagues
    where leagues.id = teams.league_id
    and (
      leagues.commissioner_id = auth.uid() or
      exists (
        select 1 from public.teams t2
        where t2.league_id = leagues.id
        and t2.owner_id = auth.uid()
      )
    )
  )
);

-- Teams: Users can update their own teams
create policy "Users can update own teams"
on public.teams
for update
using (owner_id = auth.uid());

-- Teams: Commissioners can create teams in their leagues
create policy "Commissioners can create teams"
on public.teams
for insert
with check (
  exists (
    select 1 from public.leagues
    where leagues.id = teams.league_id
    and leagues.commissioner_id = auth.uid()
  )
);

-- Create indexes
create index if not exists idx_leagues_commissioner on public.leagues(commissioner_id);
create index if not exists idx_leagues_join_code on public.leagues(join_code);
create index if not exists idx_teams_league_id on public.teams(league_id);
create index if not exists idx_teams_owner_id on public.teams(owner_id);

-- Add triggers to update updated_at
create trigger update_leagues_updated_at
  before update on public.leagues
  for each row
  execute function update_updated_at_column();

create trigger update_teams_updated_at
  before update on public.teams
  for each row
  execute function update_updated_at_column();

