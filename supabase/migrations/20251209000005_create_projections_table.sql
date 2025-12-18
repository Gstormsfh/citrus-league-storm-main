-- Create projections table for game-level player projections
create table if not exists public.projections (
  projection_id uuid primary key default gen_random_uuid(),
  game_id integer references public.nhl_games(game_id) on delete cascade not null,
  player_id uuid references public.players(id) on delete cascade not null,
  projected_points numeric, -- Projected fantasy points for this game
  notes text, -- Additional notes or context
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  -- Ensure one projection per player per game
  unique(game_id, player_id)
);

-- Enable RLS
alter table public.projections enable row level security;

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Public can view projections" on public.projections;
drop policy if exists "Authenticated users can manage projections" on public.projections;

-- Public read access for projections
create policy "Public can view projections"
on public.projections
for select
using (true);

-- Authenticated users can insert/update projections (for now - can restrict later)
create policy "Authenticated users can manage projections"
on public.projections
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

-- Create indexes for efficient queries
create index if not exists idx_projections_game_id on public.projections(game_id);
create index if not exists idx_projections_player_id on public.projections(player_id);
create index if not exists idx_projections_game_player on public.projections(game_id, player_id);

-- Add trigger to update updated_at (drop first if exists for idempotency)
drop trigger if exists update_projections_updated_at on public.projections;
create trigger update_projections_updated_at
  before update on public.projections
  for each row
  execute function update_updated_at_column();

