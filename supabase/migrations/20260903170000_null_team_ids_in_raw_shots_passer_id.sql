-- ============================================================================
-- raw_shots.passer_id: replace team ids with NULL
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED
--   Every non-null value in public.raw_shots.passer_id is set to NULL where
--   the value is below 8,000,000. That is every non-null value the column has
--   ever held.
--
-- (b) WHY NOW
--   passer_id is a player-keyed column that has never once held a player.
--   Measured on production 2026-09-03 (read-only, this session):
--
--     non_null_passer_rows      63,069
--     below_player_id_floor     63,069   (100%)
--     plausible_player_ids           0
--     equals event_owner_team_id 63,069  (100%)
--     min / max                  1 / 68
--     distinct values               34
--     seasons                 2017-2025
--
--   The 34 distinct values map one-to-one onto NHL team ids (1=NJD, 2=NYI,
--   3=NYR ... 52=WPG, 54=VGK, 55=SEA, 68=UTA). Cause: data_acquisition.py's
--   find_pass_before_shot read prev_details['playerId'], which api-web only
--   sets for giveaway/takeaway events, and fell back to eventOwnerTeamId
--   (a TEAM id) on every miss. The primary branch never once succeeded.
--   The writer is fixed in the same change set (data_acquisition.py:321-345);
--   this migration cleans what it already wrote. A wrong id is worse than no
--   id because it looks like data: the daily player-directory job discovered
--   these values as "players" and asked the NHL API for /v1/player/1/landing
--   thirty-two times a night until it died on an unrelated NOT NULL.
--
--   Staging shows the same defect via a different road (53,022 rows, values
--   1-59, 2017-2024, copied in as a "companion column" by the historical CSV
--   loaders; event_owner_team_id is NULL on all 904,859 staging rows, so the
--   equality above cannot be used there). The predicate below does not rely
--   on that column.
--
--   Blast radius, verified before writing this file:
--     DB side: pg_views, pg_matviews, pg_proc (prokind='f'), pg_constraint
--       (FK) and pg_trigger on raw_shots contain NO reference to passer_id.
--       One btree index (idx_raw_shots_passer_id) exists and simply gets
--       sparser.
--     Code side: 10 xG / model training scripts reference passer_id ZERO
--       times (train_xg_v3/v4, model_trainer, xa_model_trainer, calibration,
--       validate_xg_accuracy, process_xg_stats, rescore_xg_2025, heatmap,
--       rebuild drill). The 7 MOAT pass features and has_pass_before_shot are
--       gated on pass_play, never on passer_id. No feature vector changes; no
--       retrain is implied. simulate_matchups.py filters passer_id = <player
--       id> and matches zero rows today; after this migration it matches zero
--       rows. Behaviour is identical everywhere.
--
--   Reversibility: on production every affected value equals
--   event_owner_team_id on the same row, so the prior state is recoverable
--   with UPDATE ... SET passer_id = event_owner_team_id WHERE passer_id IS
--   NULL AND <same row set>, should anyone ever want team ids back in a
--   player column. Nobody should.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep. Applied staging-first via
--   Supabase MCP apply_migration; production on Garrett's explicit go.
--
-- Idempotent: a second run affects 0 rows and passes the post-condition.
-- ============================================================================

BEGIN;

-- Pre-flight: record what we are about to change, so the ledger has the
-- number even if the NOTICE is lost.
DO $$
DECLARE v_before bigint;
BEGIN
  SELECT count(*) INTO v_before FROM public.raw_shots
   WHERE passer_id IS NOT NULL AND passer_id < 8000000;
  RAISE NOTICE 'raw_shots.passer_id team-id rows before: %', v_before;
END $$;

UPDATE public.raw_shots
   SET passer_id = NULL
 WHERE passer_id IS NOT NULL
   AND passer_id < 8000000;

-- Post-condition: refuse to commit if any sub-floor value survives.
DO $$
DECLARE v_after bigint; v_real bigint;
BEGIN
  SELECT count(*) INTO v_after FROM public.raw_shots
   WHERE passer_id IS NOT NULL AND passer_id < 8000000;
  IF v_after <> 0 THEN
    RAISE EXCEPTION 'raw_shots.passer_id still holds % sub-floor values after cleanup', v_after;
  END IF;
  SELECT count(*) INTO v_real FROM public.raw_shots
   WHERE passer_id IS NOT NULL;
  RAISE NOTICE 'raw_shots.passer_id team-id rows after: 0; remaining non-null (real ids, if any): %', v_real;
END $$;

COMMIT;
