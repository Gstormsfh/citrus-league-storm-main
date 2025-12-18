-- Add personal information fields to profiles table
-- This migration adds fields that may not exist if the initial migration was run before these fields were added

alter table if exists public.profiles 
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists location text,
  add column if not exists bio text;

