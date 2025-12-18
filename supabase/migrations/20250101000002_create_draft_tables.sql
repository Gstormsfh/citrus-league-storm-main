-- Create draft_picks table to track all draft selections
create table if not exists public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade not null,
  round_number integer not null,
  pick_number integer not null, -- Overall pick number (1, 2, 3, ...)
  team_id uuid references public.teams(id) on delete cascade not null,
  player_id text not null, -- References player ID from staging files
  picked_at timestamptz default now() not null,
  -- Ensure unique picks per league
  unique(league_id, round_number, pick_number),
  unique(league_id, player_id) -- A player can only be drafted once per league
);

-- Create draft_order table to store the draft order for each round
-- This allows for snake draft (alternating order) or linear draft
create table if not exists public.draft_order (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade not null,
  round_number integer not null,
  team_order jsonb not null, -- Array of team IDs in order for this round
  created_at timestamptz default now() not null,
  unique(league_id, round_number)
);

-- Enable RLS
alter table public.draft_picks enable row level security;
alter table public.draft_order enable row level security;

-- Draft picks: Users can read picks in their leagues
create policy "Users can view picks in their leagues"
on public.draft_picks
for select
using (
  exists (
    select 1 from public.leagues
    where leagues.id = draft_picks.league_id
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

-- Draft picks: Team owners can insert picks for their teams
create policy "Team owners can make picks"
on public.draft_picks
for insert
with check (
  exists (
    select 1 from public.teams
    where teams.id = draft_picks.team_id
    and teams.owner_id = auth.uid()
  )
);

-- Draft picks: Commissioners can insert picks (for simulated teams)
create policy "Commissioners can make picks for any team"
on public.draft_picks
for insert
with check (
  exists (
    select 1 from public.leagues
    where leagues.id = draft_picks.league_id
    and leagues.commissioner_id = auth.uid()
  )
);

-- Draft order: Users can read draft order in their leagues
create policy "Users can view draft order in their leagues"
on public.draft_order
for select
using (
  exists (
    select 1 from public.leagues
    where leagues.id = draft_order.league_id
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

-- Draft order: Commissioners can manage draft order
create policy "Commissioners can manage draft order"
on public.draft_order
for all
using (
  exists (
    select 1 from public.leagues
    where leagues.id = draft_order.league_id
    and leagues.commissioner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.leagues
    where leagues.id = draft_order.league_id
    and leagues.commissioner_id = auth.uid()
  )
);

-- Create indexes
create index if not exists idx_draft_picks_league_id on public.draft_picks(league_id);
create index if not exists idx_draft_picks_team_id on public.draft_picks(team_id);
create index if not exists idx_draft_picks_round_pick on public.draft_picks(league_id, round_number, pick_number);
create index if not exists idx_draft_order_league_round on public.draft_order(league_id, round_number);

