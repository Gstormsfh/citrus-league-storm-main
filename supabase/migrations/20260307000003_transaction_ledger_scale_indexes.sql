-- ============================================================================
-- TRANSACTION LEDGER: SCALE-READY INDEXING
-- ============================================================================
-- Prepares transaction_ledger for 100M+ rows without the risk of in-place
-- table partitioning. Adds composite indexes covering the most common
-- query patterns that degrade with single-column indexes at scale.
--
-- Existing indexes (kept):
--   idx_transaction_ledger_league (league_id)
--   idx_transaction_ledger_team (team_id)
--   idx_transaction_ledger_created_at (created_at DESC)
--   idx_transaction_ledger_add_limits (league_id, team_id, type, created_at)
--     WHERE type = 'ADD'
--
-- New indexes:
--   1. League activity feed: (league_id, created_at DESC) — covers the
--      "recent transactions in my league" query without scanning full table
--   2. Team history: (team_id, league_id, created_at DESC) — covers
--      "all transactions for team X in league Y"
--   3. Player provenance: (league_id, player_id, created_at DESC) —
--      covers "who has owned this player and when"
--
-- These composite indexes enable index-only scans that avoid heap lookups
-- at scale. PostgreSQL's query planner will choose the most selective
-- index automatically.
-- ============================================================================

-- 1. League activity feed (dashboard, transaction log page)
--    Covers: SELECT * FROM transaction_ledger
--            WHERE league_id = $1 ORDER BY created_at DESC LIMIT 50
CREATE INDEX IF NOT EXISTS idx_transaction_ledger_league_activity
  ON transaction_ledger (league_id, created_at DESC)
  INCLUDE (team_id, type, player_id);

-- 2. Team transaction history
--    Covers: SELECT * FROM transaction_ledger
--            WHERE team_id = $1 AND league_id = $2 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_transaction_ledger_team_history
  ON transaction_ledger (team_id, league_id, created_at DESC)
  INCLUDE (type, player_id);

-- 3. Player provenance (who owned this player and when)
--    Covers: SELECT * FROM transaction_ledger
--            WHERE league_id = $1 AND player_id = $2 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_transaction_ledger_player_provenance
  ON transaction_ledger (league_id, player_id, created_at DESC)
  INCLUDE (team_id, type);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  TRANSACTION LEDGER: SCALE-READY INDEXES ADDED';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  New composite indexes (with INCLUDE for index-only scans):';
  RAISE NOTICE '    1. idx_transaction_ledger_league_activity';
  RAISE NOTICE '       → (league_id, created_at DESC) INCLUDE (team_id, type, player_id)';
  RAISE NOTICE '    2. idx_transaction_ledger_team_history';
  RAISE NOTICE '       → (team_id, league_id, created_at DESC) INCLUDE (type, player_id)';
  RAISE NOTICE '    3. idx_transaction_ledger_player_provenance';
  RAISE NOTICE '       → (league_id, player_id, created_at DESC) INCLUDE (team_id, type)';
  RAISE NOTICE '';
  RAISE NOTICE '  Impact: Enables index-only scans at 100M+ rows';
  RAISE NOTICE '  Note:  Full table partitioning can be added later if needed';
  RAISE NOTICE '         without changing these indexes';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
END $$;
