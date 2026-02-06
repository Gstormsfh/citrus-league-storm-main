-- Add scheduled_draft_time to leagues table
-- Allows commissioners to set a specific time for the draft to begin
-- When set, a draft room instance is created at that time for league members to join
alter table public.leagues
  add column if not exists scheduled_draft_time timestamptz default null;

-- Add queued to draft_status enum if not already present
-- The 'queued' status is used when a draft is prepared but not yet started
do $$
begin
  -- Check if 'queued' already exists in the enum
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'queued'
    and enumtypid = (select oid from pg_type where typname = 'draft_status')
  ) then
    alter type draft_status add value 'queued' after 'not_started';
  end if;
end$$;
