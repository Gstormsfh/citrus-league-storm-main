-- Add INSERT/UPDATE policies for nhl_games table
-- Since schedule data is public, we can allow inserts/updates from any source
-- (In production, you might want to restrict this to service role only)

-- Drop existing policies if they exist (for idempotency)
drop policy if exists "Public can insert NHL games" on public.nhl_games;
drop policy if exists "Public can update NHL games" on public.nhl_games;

-- Allow anyone to insert NHL games (for schedule imports)
-- This is safe since schedule data is public information
create policy "Public can insert NHL games"
on public.nhl_games
for insert
with check (true);

-- Allow anyone to update NHL games (for score updates, etc.)
create policy "Public can update NHL games"
on public.nhl_games
for update
using (true)
with check (true);

