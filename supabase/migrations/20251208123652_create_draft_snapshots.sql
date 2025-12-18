-- Create draft_snapshots table to store immutable snapshots of completed drafts
-- This allows users to view draft results even after the draft page is modified

create table if not exists public.draft_snapshots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade not null,
  draft_session_id uuid not null, -- References the draft session
  snapshot_data jsonb not null, -- Stores complete draft state for Draft Board grid
  created_at timestamptz default now() not null,
  created_by uuid references public.profiles(id) on delete set null,
  -- Ensure one snapshot per draft session
  unique(league_id, draft_session_id)
);

-- Enable RLS
alter table public.draft_snapshots enable row level security;

-- Draft snapshots: Users can read snapshots in their leagues
create policy "Users can view snapshots in their leagues"
on public.draft_snapshots
for select
using (
  exists (
    select 1 from public.leagues
    where leagues.id = draft_snapshots.league_id
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

-- Draft snapshots: League members can create snapshots
create policy "League members can create snapshots"
on public.draft_snapshots
for insert
with check (
  exists (
    select 1 from public.leagues
    where leagues.id = draft_snapshots.league_id
    and (
      leagues.commissioner_id = auth.uid() or
      exists (
        select 1 from public.teams
        where teams.league_id = leagues.id
        and teams.owner_id = auth.uid()
      )
    )
  )
  and created_by = auth.uid()
);

-- Create index for efficient lookups
create index if not exists idx_draft_snapshots_league 
on public.draft_snapshots(league_id, created_at desc);

create index if not exists idx_draft_snapshots_session 
on public.draft_snapshots(league_id, draft_session_id);

