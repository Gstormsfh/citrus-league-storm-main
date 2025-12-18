-- Ensure team_lineups has the unique constraint for ON CONFLICT clause
-- This fixes the error: "there is no unique or exclusion constraint matching the ON CONFLICT specification"

-- Check if the primary key constraint exists on (league_id, team_id), if not create it
do $$
begin
  -- Check if primary key constraint exists (simpler check - just check if constraint name exists)
  -- We'll verify it's on the right columns by trying to create it (will fail if wrong one exists)
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'team_lineups'
      and t.relnamespace = 'public'::regnamespace
      and c.conname = 'team_lineups_pkey'
      and c.contype = 'p'
  ) then
    -- Drop any existing primary key on team_id only
    alter table if exists public.team_lineups 
    drop constraint if exists team_lineups_pkey;
    
    -- Ensure league_id column exists and is NOT NULL
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'team_lineups'
        and column_name = 'league_id'
    ) then
      -- Add league_id column if it doesn't exist
      alter table public.team_lineups
      add column league_id uuid references public.leagues(id) on delete cascade;
      
      -- Migrate existing data
      update public.team_lineups tl
      set league_id = t.league_id
      from public.teams t
      where tl.team_id = t.id
        and tl.league_id is null;
      
      -- Make NOT NULL
      alter table public.team_lineups
      alter column league_id set not null;
    end if;
    
    -- Drop any existing primary key that might be on just team_id
    alter table if exists public.team_lineups 
    drop constraint if exists team_lineups_pkey;
    
    -- Create composite primary key on (league_id, team_id)
    alter table public.team_lineups
    add constraint team_lineups_pkey primary key (league_id, team_id);
    
    raise notice 'Created team_lineups_pkey constraint on (league_id, team_id)';
  else
    raise notice 'Primary key constraint on (league_id, team_id) already exists';
  end if;
end $$;
