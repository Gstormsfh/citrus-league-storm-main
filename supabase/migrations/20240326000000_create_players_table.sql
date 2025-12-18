
-- Create players table
create table public.players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  position text not null,
  team text not null,
  jersey_number text,
  status text check (status in ('active', 'injured', 'ir', 'suspended', 'na')) default 'active',
  
  -- Stats (simplified for now)
  goals integer default 0,
  assists integer default 0,
  points integer default 0,
  plus_minus integer default 0,
  shots integer default 0,
  hits integer default 0,
  blocks integer default 0,
  
  -- Goalie stats (nullable)
  wins integer,
  losses integer,
  ot_losses integer,
  saves integer,
  goals_against_average numeric,
  save_percentage numeric,
  
  -- Metadata
  headshot_url text,
  last_updated timestamptz default now()
);

-- Enable RLS
alter table public.players enable row level security;

-- Create policy to allow public read access
create policy "Enable read access for all users" on public.players
  for select using (true);

