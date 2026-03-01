-- Migration: Add eligible_positions to player_directory for multi-position tracking
-- Date: 2026-03-01
-- Description: Stores comma-separated eligible positions (e.g., "C,LW" or "RW,LW")
--              derived from game-level position data in player_game_stats.
--              Players with 3+ games at a secondary position gain eligibility.

ALTER TABLE public.player_directory
ADD COLUMN IF NOT EXISTS eligible_positions TEXT;

COMMENT ON COLUMN public.player_directory.eligible_positions IS
  'Comma-separated eligible positions derived from game stats (e.g., "C,LW"). '
  'Primary position listed first. Updated by sync_rosters.py.';

-- Index for position-based filtering
CREATE INDEX IF NOT EXISTS idx_player_directory_eligible_positions
ON public.player_directory(eligible_positions);
