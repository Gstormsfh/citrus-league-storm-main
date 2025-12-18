-- Add timezone column to profiles table
alter table if exists public.profiles
  add column if not exists timezone text default 'America/Denver'; -- Mountain Time as default

-- Create index for timezone lookups (if needed)
create index if not exists idx_profiles_timezone on public.profiles(timezone);

-- Update existing profiles to have Mountain Time as default
update public.profiles
set timezone = 'America/Denver'
where timezone is null;

