-- ============================================================================
-- TEAM STANDINGS MATERIALIZED VIEW (Performance Cache)
-- ============================================================================
-- Problem: FAAB waiver processing uses a LATERAL subquery that scans the
--   entire matchups table per team per bid to derive win/loss records.
--   At O(players × bids × matchups), this is fine for <1K leagues but
--   will timeout at scale.
--
-- Solution: Materialized view pre-computes standings per team per league.
--   Refreshed once at the start of each FAAB processing run (not on every
--   matchup update — standings only need to be current at processing time).
--
-- Impact: Replaces LATERAL scan with a single indexed lookup per team.
--   FAAB tiebreaker query drops from O(matchups) to O(1) per team.
-- ============================================================================

-- 1. Create the materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS team_standings AS
SELECT
  t.league_id,
  t.id AS team_id,
  COUNT(*) FILTER (WHERE
    (m.team1_id = t.id AND m.team1_score > m.team2_score) OR
    (m.team2_id = t.id AND m.team2_score > m.team1_score)
  ) AS wins,
  COUNT(*) FILTER (WHERE
    (m.team1_id = t.id AND m.team1_score < m.team2_score) OR
    (m.team2_id = t.id AND m.team2_score < m.team1_score)
  ) AS losses,
  COUNT(*) FILTER (WHERE
    m.status = 'completed'
    AND m.team2_id IS NOT NULL
    AND m.team1_score = m.team2_score
    AND (m.team1_id = t.id OR m.team2_id = t.id)
  ) AS ties,
  COALESCE(
    COUNT(*) FILTER (WHERE
      (m.team1_id = t.id AND m.team1_score > m.team2_score) OR
      (m.team2_id = t.id AND m.team2_score > m.team1_score)
    )::NUMERIC /
    GREATEST(1,
      COUNT(*) FILTER (WHERE
        (m.team1_id = t.id AND m.team1_score > m.team2_score) OR
        (m.team2_id = t.id AND m.team2_score > m.team1_score)
      ) +
      COUNT(*) FILTER (WHERE
        (m.team1_id = t.id AND m.team1_score < m.team2_score) OR
        (m.team2_id = t.id AND m.team2_score < m.team1_score)
      )
    ),
    0
  ) AS win_pct
FROM teams t
LEFT JOIN matchups m ON
  m.league_id = t.league_id
  AND m.status = 'completed'
  AND (m.team1_id = t.id OR m.team2_id = t.id)
GROUP BY t.league_id, t.id;

-- 2. Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
--    Also serves as the primary lookup index for FAAB tiebreakers
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_standings_league_team
  ON team_standings (league_id, team_id);

-- 3. Index for inverse standings lookups (worst team wins ties)
CREATE INDEX IF NOT EXISTS idx_team_standings_win_pct
  ON team_standings (league_id, win_pct ASC);

-- 4. Helper function to refresh standings (used by FAAB processing)
--    CONCURRENTLY allows reads during refresh — no lock contention
CREATE OR REPLACE FUNCTION public.refresh_team_standings()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY team_standings;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.refresh_team_standings() TO authenticated;

-- 5. Auto-refresh trigger when matchup results are finalized
--    Only fires on status change to 'completed' to avoid unnecessary refreshes
CREATE OR REPLACE FUNCTION public.trigger_refresh_standings()
RETURNS TRIGGER AS $$
BEGIN
  -- Only refresh when a matchup is marked completed
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    PERFORM public.refresh_team_standings();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS trg_refresh_standings_on_matchup ON matchups;
CREATE TRIGGER trg_refresh_standings_on_matchup
  AFTER UPDATE OF status ON matchups
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.trigger_refresh_standings();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  TEAM STANDINGS CACHE — CREATED';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  Materialized view: team_standings';
  RAISE NOTICE '    Columns: league_id, team_id, wins, losses, ties, win_pct';
  RAISE NOTICE '    Unique index: (league_id, team_id) — enables CONCURRENTLY';
  RAISE NOTICE '';
  RAISE NOTICE '  Auto-refresh: trigger on matchups.status → completed';
  RAISE NOTICE '  Manual refresh: SELECT refresh_team_standings();';
  RAISE NOTICE '';
  RAISE NOTICE '  Performance: FAAB tiebreaker goes from O(matchups) to O(1)';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
END $$;
