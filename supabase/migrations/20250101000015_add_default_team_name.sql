-- Add default_team_name field to profiles table
alter table if exists public.profiles
add column if not exists default_team_name text;









