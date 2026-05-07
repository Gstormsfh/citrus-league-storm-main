-- Phase 0 / 0d-pre #1: Drop the three vestigial defender-geometry columns from raw_shots.
--
-- Background: these columns were added by migration 20250122000000_add_moneypuck_features.sql
-- with the intent of carrying MoneyPuck-style defender geometry. Investigation 2026-05-07
-- (recorded in apps/web/docs/HOCKEY_ANALYTICS_LANDSCAPE_2026.md "What we don't have and why")
-- established three independent facts:
--
--   1. NHL public PBP feed (api-web.nhle.com) carries no per-event on-ice player IDs and no
--      defender coordinates. Only shooter + goalie + situationCode. Verified across multiple
--      games and play types.
--   2. NHL EDGE granular tracking is not exposed in the public API for per-event consumption
--      (only aggregate skating distance / speed / zone time per skater per season).
--   3. MoneyPuck themselves do not publish positional defender geometry — their `shots_*.csv`
--      files contain TOI/composition features only (defendingTeamForwardsOnIce, etc.).
--
-- The columns have been NULL on every row (99,394 / 99,394 in prod) since they were added.
-- No model, UI, scoring, projection, or query references them. They are pure schema cruft.
--
-- Defender positional geometry remains a v2 capability — see
-- apps/web/docs/GAPS_AND_FUTURE_CAPABILITIES.md for the three unlock paths
-- (NHL EDGE licensing / SPORTLOGiQ partnership / internal CV pipeline) and their cost +
-- timeline estimates.
--
-- Reverting this migration: re-adding the columns is a one-line ALTER TABLE if a future
-- v2 capability ships. Data is not lost (the columns held only NULL).

ALTER TABLE public.raw_shots
  DROP COLUMN IF EXISTS distance_to_nearest_defender,
  DROP COLUMN IF EXISTS skaters_in_screening_box,
  DROP COLUMN IF EXISTS nearest_defender_to_net_distance;
