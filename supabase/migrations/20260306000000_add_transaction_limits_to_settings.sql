-- ============================================================================
-- Migration: Add Weekly/Season Transaction Limits to League Settings
-- Date: 2026-03-06
-- Purpose: Industry-standard feature (ESPN/Yahoo/Sleeper) allowing commissioners
--          to cap the number of free agent adds per team per week and per season.
--
-- How it works:
--   - weeklyAddLimit: stored in leagues.settings JSONB (0 = unlimited, default)
--   - seasonAddLimit: stored in leagues.settings JSONB (0 = unlimited, default)
--   - Enforcement: WaiverService.checkTransactionLimits() queries
--     transaction_ledger for ADD-type entries per team.
--   - Checked before: addFreeAgent(), submitWaiverClaim(), submitFAABBid()
--
-- No new columns needed — values live in the existing settings JSONB.
-- This migration backfills defaults (0 = unlimited) for existing leagues
-- that don't already have these keys.
-- ============================================================================

-- Backfill: Ensure all existing fantasy leagues have transaction limit defaults
-- Only update leagues where the keys don't already exist in settings JSONB
UPDATE leagues
SET settings = settings || '{"weeklyAddLimit": 0, "seasonAddLimit": 0}'::jsonb
WHERE settings IS NOT NULL
  AND settings ? 'leagueType'
  AND (settings->>'leagueType') = 'fantasy'
  AND NOT (settings ? 'weeklyAddLimit');

-- Add a comment documenting the settings keys for future reference
COMMENT ON COLUMN leagues.settings IS
  'JSONB league configuration. Includes: leagueType, scoringFormat, draftType, '
  'teamsCount, stats, rosterSlots, faabBudget, keeperEnabled, keeperCount, '
  'bestBallEnabled, tradeReviewType, tradeExpirationDays, tradeVetoThreshold, '
  'weeklyAddLimit (0=unlimited), seasonAddLimit (0=unlimited), and more. '
  'See LeagueFormatSettings type in src/types/leagueTypes.ts for full schema.';

-- Ensure transaction_ledger has an index for efficient limit checks
-- (league_id + team_id + type + created_at) for weekly count queries
CREATE INDEX IF NOT EXISTS idx_transaction_ledger_add_limits
  ON transaction_ledger (league_id, team_id, type, created_at DESC)
  WHERE type = 'ADD';
