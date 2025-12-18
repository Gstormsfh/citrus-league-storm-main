-- Create matchup_status enum
create type matchup_status as enum ('scheduled', 'in_progress', 'completed');

-- Create matchups table
create table if not exists public.matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade not null,
  week_number integer not null,
  team1_id uuid references public.teams(id) on delete cascade not null,
  team2_id uuid references public.teams(id) on delete cascade,
  team1_score numeric default 0 not null,
  team2_score numeric default 0 not null,
  status matchup_status default 'scheduled' not null,
  week_start_date date not null,
  week_end_date date not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  -- Ensure unique matchups per league and week
  unique(league_id, week_number, team1_id),
  unique(league_id, week_number, team2_id),
  -- Ensure team1 and team2 are different
  check (team1_id != team2_id or team2_id is null)
);

-- Enable RLS
alter table public.matchups enable row level security;

-- Matchups: Users can read matchups in their leagues
create policy "Users can view matchups in their leagues"
on public.matchups
for select
using (
  exists (
    select 1 from public.leagues
    where leagues.id = matchups.league_id
    and (
      leagues.commissioner_id = auth.uid() or
      exists (
        select 1 from public.teams
        where teams.league_id = leagues.id
        and teams.owner_id = auth.uid()
      )
    )
  )
);

-- Matchups: Commissioners can insert/update matchups
create policy "Commissioners can manage matchups"
on public.matchups
for all
using (
  exists (
    select 1 from public.leagues
    where leagues.id = matchups.league_id
    and leagues.commissioner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.leagues
    where leagues.id = matchups.league_id
    and leagues.commissioner_id = auth.uid()
  )
);

-- Create indexes
create index if not exists idx_matchups_league_id on public.matchups(league_id);
create index if not exists idx_matchups_week_number on public.matchups(league_id, week_number);
create index if not exists idx_matchups_team1_id on public.matchups(team1_id);
create index if not exists idx_matchups_team2_id on public.matchups(team2_id);
create index if not exists idx_matchups_week_dates on public.matchups(week_start_date, week_end_date);

-- Add trigger to update updated_at
create trigger update_matchups_updated_at
  before update on public.matchups
  for each row
  execute function update_updated_at_column();
