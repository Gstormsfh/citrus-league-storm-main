-- Phase 0c full-staging-run addition: per-game coord_warn count.
-- Pairs with coord delta in (10, 15] pass the tolerance gate (default 15)
-- but are diagnostic warnings — MoneyPuck's arena adjustment applied a
-- larger correction than the typical 0-3 unit range. Kept as a column
-- (not stuffed into error_detail) because error_detail is reserved for
-- fail states and coord_warn happens on complete games; also lets us
-- write per-season census queries without JSON parsing.
--
-- Threshold (10) is fixed; --tolerance (default 15) is configurable.

ALTER TABLE phase0c_progress
  ADD COLUMN IF NOT EXISTS coord_warn_count int;

COMMENT ON COLUMN phase0c_progress.coord_warn_count IS
  'Count of matched pairs with abs-coord delta in (10, tolerance]. Games with high counts warrant a look but are not fails.';
