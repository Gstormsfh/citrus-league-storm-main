-- ============================================================================
-- CLEANUP STALE PLAYER IDS FROM TEAM_LINEUPS
-- ============================================================================
-- Problem: team_lineups may contain player IDs from players that were dropped
-- Solution: Filter each lineup array to only include players in draft_picks (deleted_at IS NULL)
-- Run this script when: You see warnings about "stale player IDs" in console logs
-- ============================================================================

BEGIN;

-- Show current state before cleanup
SELECT 
  tl.league_id,
  tl.team_id,
  t.team_name,
  jsonb_array_length(tl.starters) as starters_count,
  jsonb_array_length(tl.bench) as bench_count,
  jsonb_array_length(tl.ir) as ir_count,
  (
    SELECT COUNT(*)
    FROM jsonb_array_elements_text(tl.starters || tl.bench || tl.ir) player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM draft_picks dp
      WHERE dp.team_id = tl.team_id
        AND dp.league_id = tl.league_id
        AND dp.player_id = player_id::text
        AND dp.deleted_at IS NULL
    )
  ) as stale_players_count
FROM team_lineups tl
JOIN teams t ON t.id = tl.team_id
WHERE (
  SELECT COUNT(*)
  FROM jsonb_array_elements_text(tl.starters || tl.bench || tl.ir) player_id
  WHERE NOT EXISTS (
    SELECT 1 FROM draft_picks dp
    WHERE dp.team_id = tl.team_id
      AND dp.league_id = tl.league_id
      AND dp.player_id = player_id::text
      AND dp.deleted_at IS NULL
  )
) > 0
ORDER BY tl.league_id, t.team_name;

-- Update team_lineups to remove stale player IDs
UPDATE team_lineups tl
SET 
  starters = (
    SELECT COALESCE(jsonb_agg(player_id), '[]'::jsonb)
    FROM jsonb_array_elements_text(tl.starters) player_id
    WHERE EXISTS (
      SELECT 1 FROM draft_picks dp
      WHERE dp.team_id = tl.team_id
        AND dp.league_id = tl.league_id
        AND dp.player_id = player_id::text
        AND dp.deleted_at IS NULL
    )
  ),
  bench = (
    SELECT COALESCE(jsonb_agg(player_id), '[]'::jsonb)
    FROM jsonb_array_elements_text(tl.bench) player_id
    WHERE EXISTS (
      SELECT 1 FROM draft_picks dp
      WHERE dp.team_id = tl.team_id
        AND dp.league_id = tl.league_id
        AND dp.player_id = player_id::text
        AND dp.deleted_at IS NULL
    )
  ),
  ir = (
    SELECT COALESCE(jsonb_agg(player_id), '[]'::jsonb)
    FROM jsonb_array_elements_text(tl.ir) player_id
    WHERE EXISTS (
      SELECT 1 FROM draft_picks dp
      WHERE dp.team_id = tl.team_id
        AND dp.league_id = tl.league_id
        AND dp.player_id = player_id::text
        AND dp.deleted_at IS NULL
    )
  ),
  slot_assignments = (
    SELECT COALESCE(
      jsonb_object_agg(key, value),
      '{}'::jsonb
    )
    FROM jsonb_each(tl.slot_assignments)
    WHERE EXISTS (
      SELECT 1 FROM draft_picks dp
      WHERE dp.team_id = tl.team_id
        AND dp.league_id = tl.league_id
        AND dp.player_id = key::text
        AND dp.deleted_at IS NULL
    )
  ),
  updated_at = NOW()
WHERE EXISTS (
  -- Only update rows that have stale player IDs
  SELECT 1
  FROM jsonb_array_elements_text(tl.starters || tl.bench || tl.ir) player_id
  WHERE NOT EXISTS (
    SELECT 1 FROM draft_picks dp
    WHERE dp.team_id = tl.team_id
      AND dp.league_id = tl.league_id
      AND dp.player_id = player_id::text
      AND dp.deleted_at IS NULL
  )
);

-- Show results after cleanup
SELECT 
  tl.league_id,
  tl.team_id,
  t.team_name,
  jsonb_array_length(tl.starters) as starters_count_after,
  jsonb_array_length(tl.bench) as bench_count_after,
  jsonb_array_length(tl.ir) as ir_count_after,
  (
    SELECT COUNT(*)
    FROM jsonb_array_elements_text(tl.starters || tl.bench || tl.ir) player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM draft_picks dp
      WHERE dp.team_id = tl.team_id
        AND dp.league_id = tl.league_id
        AND dp.player_id = player_id::text
        AND dp.deleted_at IS NULL
    )
  ) as stale_players_remaining
FROM team_lineups tl
JOIN teams t ON t.id = tl.team_id
ORDER BY tl.league_id, t.team_name;

-- Verify: Should return 0 rows (no stale players remaining)
SELECT 
  tl.team_id,
  t.team_name,
  COUNT(*) as stale_count
FROM team_lineups tl
JOIN teams t ON t.id = tl.team_id
CROSS JOIN LATERAL (
  SELECT player_id
  FROM jsonb_array_elements_text(tl.starters || tl.bench || tl.ir) player_id
  WHERE NOT EXISTS (
    SELECT 1 FROM draft_picks dp
    WHERE dp.team_id = tl.team_id
      AND dp.league_id = tl.league_id
      AND dp.player_id = player_id::text
      AND dp.deleted_at IS NULL
  )
) stale
GROUP BY tl.team_id, t.team_name;

COMMIT;

-- ============================================================================
-- EXPECTED RESULTS:
-- - "stale_players_count" column should show how many dropped players were in each team's lineup
-- - "stale_players_remaining" should be 0 for all teams after cleanup
-- - Final verification query should return 0 rows
-- ============================================================================
