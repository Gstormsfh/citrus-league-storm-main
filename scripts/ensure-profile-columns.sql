-- Comprehensive script to ensure ALL profile columns exist
-- Run this in your Supabase SQL Editor
-- This will add any missing columns without affecting existing data

-- Add all profile columns if they don't exist
ALTER TABLE IF EXISTS public.profiles 
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS bio text;

-- Verify all columns exist
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- Expected columns:
-- id (uuid, primary key)
-- username (text, not null, unique)
-- first_name (text, nullable)
-- last_name (text, nullable)
-- phone (text, nullable)
-- location (text, nullable)
-- bio (text, nullable)
-- created_at (timestamptz, not null)
-- updated_at (timestamptz, not null)

