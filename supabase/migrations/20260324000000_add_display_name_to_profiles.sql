-- Add display_name column to profiles table
-- Allows users to set a custom display name independent of first/last name
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text;

-- Backfill: set display_name from first_name + last_name for existing profiles
UPDATE public.profiles
SET display_name = TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
WHERE display_name IS NULL
  AND (first_name IS NOT NULL OR last_name IS NOT NULL)
  AND TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) <> '';
