-- Fix profiles table - Add missing columns and verify
-- Run this in Supabase SQL Editor

-- First, check what columns currently exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- Add missing columns one by one (this will skip if they already exist)
ALTER TABLE IF EXISTS public.profiles 
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS bio text;

-- Verify all columns now exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- Expected output should show:
-- id, username, first_name, last_name, phone, location, bio, created_at, updated_at

