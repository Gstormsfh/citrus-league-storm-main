-- Comprehensive migration to add all profile columns
-- This ensures all columns exist regardless of previous migrations

-- Add columns one by one to avoid any issues
DO $$
BEGIN
  -- Add first_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND column_name = 'first_name'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN first_name text;
    RAISE NOTICE 'Added first_name column';
  ELSE
    RAISE NOTICE 'first_name column already exists';
  END IF;

  -- Add last_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND column_name = 'last_name'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN last_name text;
    RAISE NOTICE 'Added last_name column';
  ELSE
    RAISE NOTICE 'last_name column already exists';
  END IF;

  -- Add phone
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN phone text;
    RAISE NOTICE 'Added phone column';
  ELSE
    RAISE NOTICE 'phone column already exists';
  END IF;

  -- Add location
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND column_name = 'location'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN location text;
    RAISE NOTICE 'Added location column';
  ELSE
    RAISE NOTICE 'location column already exists';
  END IF;

  -- Add bio (for profile editing later)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND column_name = 'bio'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN bio text;
    RAISE NOTICE 'Added bio column';
  ELSE
    RAISE NOTICE 'bio column already exists';
  END IF;

  RAISE NOTICE 'All profile columns verified/added successfully';
END $$;

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

