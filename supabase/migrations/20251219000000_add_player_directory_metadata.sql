-- Migration: Add rich metadata fields to player_directory
-- Date: 2025-12-19
-- Description: Add nullable columns for player bios, college, physical attributes, etc.
-- These fields can be manually edited and are preserved across API updates.

-- Add physical attributes
ALTER TABLE public.player_directory
ADD COLUMN IF NOT EXISTS height_in INTEGER,
ADD COLUMN IF NOT EXISTS weight_lb INTEGER,
ADD COLUMN IF NOT EXISTS birthdate DATE,
ADD COLUMN IF NOT EXISTS nationality TEXT;

-- Add career/background information
ALTER TABLE public.player_directory
ADD COLUMN IF NOT EXISTS college_team TEXT,
ADD COLUMN IF NOT EXISTS prior_team TEXT,
ADD COLUMN IF NOT EXISTS bio_summary TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add tracking for API sync
ALTER TABLE public.player_directory
ADD COLUMN IF NOT EXISTS source_last_fetched_at TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON COLUMN public.player_directory.height_in IS 'Player height in inches (preserved from manual edits)';
COMMENT ON COLUMN public.player_directory.weight_lb IS 'Player weight in pounds (preserved from manual edits)';
COMMENT ON COLUMN public.player_directory.birthdate IS 'Player birth date (preserved from manual edits)';
COMMENT ON COLUMN public.player_directory.nationality IS 'Player nationality/country (preserved from manual edits)';
COMMENT ON COLUMN public.player_directory.college_team IS 'College/university team name (preserved from manual edits)';
COMMENT ON COLUMN public.player_directory.prior_team IS 'Previous NHL team abbreviation (preserved from manual edits)';
COMMENT ON COLUMN public.player_directory.bio_summary IS 'Player biography/writeup for player cards (preserved from manual edits)';
COMMENT ON COLUMN public.player_directory.notes IS 'Manual annotations/notes (preserved from manual edits)';
COMMENT ON COLUMN public.player_directory.source_last_fetched_at IS 'Timestamp when NHL API was last queried for this player';
