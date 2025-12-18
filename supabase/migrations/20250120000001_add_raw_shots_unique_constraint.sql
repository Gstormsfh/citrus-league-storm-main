-- Add unique constraint to raw_shots table to enable upsert operations
-- This prevents duplicate shot records and allows safe re-processing of games
--
-- PREREQUISITE: This migration requires the raw_shots table to exist.
-- Run migration 20250120000000_create_raw_shots_table.sql first if you get an error.

-- Check if table exists (PostgreSQL doesn't have IF EXISTS for ALTER TABLE, so we use DO block)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'raw_shots'
    ) THEN
        RAISE EXCEPTION 'Table raw_shots does not exist. Please run migration 20250120000000_create_raw_shots_table.sql first.';
    END IF;
END $$;

-- Drop existing constraint and index if they exist (in case migration is re-run)
ALTER TABLE raw_shots DROP CONSTRAINT IF EXISTS raw_shots_unique_shot;
DROP INDEX IF EXISTS idx_raw_shots_unique_shot;

-- Create unique constraint on combination of fields that identify a unique shot
-- A shot is unique by: game_id, player_id, shot location (x, y), and shot type code
-- This allows the same player to take multiple shots from the same location if they're different types
-- Using UNIQUE CONSTRAINT (not just index) ensures proper ON CONFLICT handling
-- Note: PostgreSQL automatically creates an index for UNIQUE constraints, so we don't need a separate index
ALTER TABLE raw_shots 
ADD CONSTRAINT raw_shots_unique_shot 
UNIQUE (game_id, player_id, shot_x, shot_y, shot_type_code);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT raw_shots_unique_shot ON raw_shots IS 'Unique constraint to prevent duplicate shot records. Enables upsert operations for safe re-processing of games. A shot is uniquely identified by game_id, player_id, shot coordinates (x, y), and shot_type_code.';

