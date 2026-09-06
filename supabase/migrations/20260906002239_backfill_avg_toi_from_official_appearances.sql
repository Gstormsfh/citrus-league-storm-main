-- ============================================================================
-- Backfill player_talent_metrics.avg_toi_per_game from official appearances
-- ============================================================================
-- Purpose: Fill the season-2025 deployment metric from the NHL.com season
--          total and the official appearance count already published in
--          player_season_stats. A zero-minute appearance remains in GP.
-- Impact:  Updates only avg_toi_per_game on existing season-2025 skater rows.
-- Risk:    MEDIUM (bounded UPDATE of a derived, previously-null column).
-- Apply:   UNAPPLIED. Capture the current table schema and test in staging
--          before production, per docs/MIGRATION_SAFETY_GUIDE.md.
-- Backup: no persistent backup table is required for this medium-risk derived
--         field because the guarded baseline is all NULL and the source-of-
--         truth inputs remain unchanged in player_season_stats.
-- Rollback: baseline was all NULL, verified 2026-09-05. Run:
--   UPDATE public.player_talent_metrics ptm
--      SET avg_toi_per_game = NULL
--     FROM public.player_season_stats pss
--    WHERE ptm.player_id = pss.player_id AND ptm.season = pss.season
--      AND ptm.season = 2025 AND NOT pss.is_goalie
--      AND ptm.avg_toi_per_game = round(
--            pss.nhl_toi_seconds::numeric / pss.games_played / 60.0, 2);
-- ============================================================================

BEGIN;

-- This artifact is intentionally pinned to the measured baseline. If another
-- writer has begun populating the field, stop and reconcile ownership rather
-- than overwriting it with a stale assumption.
DO $$
DECLARE
  v_existing bigint;
  v_conflicts bigint;
  v_candidates bigint;
BEGIN
  SELECT count(*) INTO v_existing
    FROM public.player_talent_metrics
   WHERE season = 2025 AND avg_toi_per_game IS NOT NULL;

  SELECT count(*) INTO v_conflicts
    FROM public.player_talent_metrics ptm
    JOIN public.player_season_stats pss
      ON pss.player_id = ptm.player_id AND pss.season = ptm.season
   WHERE ptm.season = 2025
     AND NOT pss.is_goalie
     AND pss.games_played > 0
     AND pss.nhl_toi_seconds >= 0
     AND ptm.avg_toi_per_game IS NOT NULL
     AND ptm.avg_toi_per_game IS DISTINCT FROM round(
           pss.nhl_toi_seconds::numeric / pss.games_played / 60.0,
           2
         );
  IF v_conflicts <> 0 THEN
    RAISE EXCEPTION
      'avg TOI backfill refused: % populated rows disagree with official totals',
      v_conflicts;
  END IF;

  SELECT count(*) INTO v_candidates
    FROM public.player_talent_metrics ptm
    JOIN public.player_season_stats pss
      ON pss.player_id = ptm.player_id AND pss.season = ptm.season
   WHERE ptm.season = 2025
     AND NOT pss.is_goalie
     AND pss.games_played > 0
     AND pss.nhl_toi_seconds >= 0;
  IF v_candidates = 0 THEN
    RAISE EXCEPTION 'avg TOI backfill refused: no official-appearance candidates';
  END IF;
  RAISE NOTICE
    'BEFORE: % candidate skaters, % already populated, % conflicts',
    v_candidates, v_existing, v_conflicts;
END
$$;

UPDATE public.player_talent_metrics ptm
   SET avg_toi_per_game = round(
         pss.nhl_toi_seconds::numeric / pss.games_played / 60.0,
         2
       )
  FROM public.player_season_stats pss
 WHERE ptm.player_id = pss.player_id
   AND ptm.season = pss.season
   AND ptm.season = 2025
   AND ptm.avg_toi_per_game IS NULL
   AND NOT pss.is_goalie
   AND pss.games_played > 0
   AND pss.nhl_toi_seconds >= 0;

DO $$
DECLARE
  v_candidates bigint;
  v_populated bigint;
  v_mismatches bigint;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE ptm.avg_toi_per_game IS NOT NULL),
         count(*) FILTER (
           WHERE ptm.avg_toi_per_game IS DISTINCT FROM round(
             pss.nhl_toi_seconds::numeric / pss.games_played / 60.0,
             2
           )
         )
    INTO v_candidates, v_populated, v_mismatches
    FROM public.player_talent_metrics ptm
    JOIN public.player_season_stats pss
      ON pss.player_id = ptm.player_id AND pss.season = ptm.season
   WHERE ptm.season = 2025
     AND NOT pss.is_goalie
     AND pss.games_played > 0
     AND pss.nhl_toi_seconds >= 0;

  IF v_populated <> v_candidates OR v_mismatches <> 0 THEN
    RAISE EXCEPTION
      'avg TOI verification failed: candidates %, populated %, mismatches %',
      v_candidates, v_populated, v_mismatches;
  END IF;
  RAISE NOTICE
    'AFTER: %/% candidate skaters populated; % formula mismatches',
    v_populated, v_candidates, v_mismatches;
END
$$;

COMMIT;
