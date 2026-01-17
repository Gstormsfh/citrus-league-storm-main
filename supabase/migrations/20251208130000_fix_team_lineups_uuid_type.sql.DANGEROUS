-- Fix team_lineups.team_id type mismatch (integer vs uuid)
-- This ensures team_lineups.team_id is UUID to match teams.id
-- Run this BEFORE applying the roster_transactions migration
-- Run this if you get "operator does not exist: integer = uuid" error

-- Check if team_lineups exists and convert team_id to UUID if needed
do $$
begin
  -- Check if team_lineups table exists
  if exists (
    select 1 from information_schema.tables 
    where table_schema = 'public' 
    and table_name = 'team_lineups'
  ) then
    -- Check if team_id column exists and is not UUID
    if exists (
      select 1 from information_schema.columns 
      where table_schema = 'public' 
      and table_name = 'team_lineups' 
      and column_name = 'team_id'
      and data_type != 'uuid'
    ) then
      -- Drop primary key constraint if it exists
      alter table if exists public.team_lineups drop constraint if exists team_lineups_pkey;
      
      -- Delete all rows (these are old demo data with integer IDs)
      -- Real league lineups will be recreated automatically with proper UUIDs
      truncate table public.team_lineups;
      
      -- Drop and recreate team_id column as UUID
      -- This avoids the "cannot be cast automatically" error
      alter table if exists public.team_lineups drop column if exists team_id;
      alter table if exists public.team_lineups add column team_id uuid primary key;
      
      -- Recreate index
      drop index if exists idx_team_lineups_team_id;
      create index if not exists idx_team_lineups_team_id on public.team_lineups(team_id);
      
      raise notice 'Converted team_lineups.team_id from integer to uuid (cleared old demo data)';
    else
      raise notice 'team_lineups.team_id is already uuid, no conversion needed';
    end if;
  else
    raise notice 'team_lineups table does not exist, skipping conversion';
  end if;
end $$;

