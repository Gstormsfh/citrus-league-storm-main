-- A+ Audit: Performance indexes and audit log rotation
-- Addresses: Database & Migration (B+ → A+), Security (audit log rotation)

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  1. Performance Indexes for Hot Paths                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Matchup scoring: fast lookup by week + league
CREATE INDEX IF NOT EXISTS idx_matchups_league_week
  ON matchups (league_id, week) WHERE league_id IS NOT NULL;

-- Player game stats: fast lookup by date for live scoring
CREATE INDEX IF NOT EXISTS idx_player_game_stats_date
  ON player_game_stats (game_date DESC) WHERE game_date IS NOT NULL;

-- Projections cache: fast lookup by version + date
CREATE INDEX IF NOT EXISTS idx_projection_cache_version_date
  ON projection_cache (cache_version, projection_date DESC)
  WHERE cache_version IS NOT NULL;

-- Waiver claims: ordering by priority within league
CREATE INDEX IF NOT EXISTS idx_waiver_claims_league_priority
  ON waiver_claims (league_id, priority ASC, created_at ASC)
  WHERE status = 'pending';

-- Transaction ledger: audit trail lookups by league
CREATE INDEX IF NOT EXISTS idx_transaction_ledger_league_date
  ON transaction_ledger (league_id, created_at DESC)
  WHERE league_id IS NOT NULL;

-- Draft picks: fast lookup by league + round
CREATE INDEX IF NOT EXISTS idx_draft_picks_league_round
  ON draft_picks (league_id, round, pick_number)
  WHERE league_id IS NOT NULL;

-- Fantasy daily rosters: lookups by team + date
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_team_date
  ON fantasy_daily_rosters (fantasy_team_id, roster_date DESC)
  WHERE fantasy_team_id IS NOT NULL;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  2. Audit Log Rotation Policy                                       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Automatic cleanup of old audit logs (>90 days) to prevent unbounded growth.
-- Runs as a scheduled function or can be called manually.
CREATE OR REPLACE FUNCTION rotate_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM security_audit_log
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Index on audit log timestamp for efficient rotation
CREATE INDEX IF NOT EXISTS idx_security_audit_log_created_at
  ON security_audit_log (created_at)
  WHERE created_at IS NOT NULL;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  3. Data Freshness Tracking View                                    ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Observability: quick check on data pipeline freshness
CREATE OR REPLACE VIEW data_freshness_status AS
SELECT
  'player_game_stats' AS source,
  MAX(updated_at) AS last_updated,
  COUNT(*) AS total_rows,
  EXTRACT(EPOCH FROM (NOW() - MAX(updated_at))) / 60 AS minutes_stale
FROM player_game_stats
UNION ALL
SELECT
  'projection_cache' AS source,
  MAX(created_at) AS last_updated,
  COUNT(*) AS total_rows,
  EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 60 AS minutes_stale
FROM projection_cache;
