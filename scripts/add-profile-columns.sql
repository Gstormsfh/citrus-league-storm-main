-- CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
-- CATEGORY: UTILITY
-- Purpose:     Pre-migration: add columns to profiles (idempotent ADD COLUMN IF NOT EXISTS)
-- Last active: 2025-12-17
-- Invoked:     manual via Supabase SQL Editor
-- Reads:       profiles
-- Writes:      profiles (DDL: ADD COLUMN)
-- ────────────────────────────────────────────────────────────
-- Run this in your Supabase SQL Editor to add all profile columns
-- This will safely add columns only if they don't already exist

ALTER TABLE IF EXISTS public.profiles 
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS bio text;

-- Verify the columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
ORDER BY ordinal_position;

