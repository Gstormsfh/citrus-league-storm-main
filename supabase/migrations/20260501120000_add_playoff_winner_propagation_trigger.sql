-- ============================================================================
-- Add round-winner propagation trigger to nhl_playoff_series
-- ============================================================================
-- When a series finalizes (winner_team_id is set), automatically populate the
-- child series' high_seed_team_id or low_seed_team_id with that winner. The
-- bracket tree is fixed by parent_slot_a/parent_slot_b (see migration
-- 20260421120000_populate_parent_slots.sql).
--
-- Why a DB trigger instead of relying on the data pipeline:
--   data-pipeline/acquisition/sync_playoff_results.py claims (in its
--   docstring) to "Cascade winners into next-round series" but its
--   implementation only reads R2+ team IDs from the NHL bracket API,
--   which has a multi-day delay between R1 finalizing and R2 being
--   populated upstream. Combined with the cron being silent for 14
--   days (nhl_pipeline_meta.last_refresh = 2026-04-17 on prod), this
--   left R2 series with NULL team IDs while R1 winners were known.
--
-- The trigger is the source-of-truth for round propagation. The pipeline
-- script can be fixed separately; this trigger will keep working regardless.
--
-- NULL guard: the trigger only writes when the destination slot is
-- currently NULL. Manual overrides (e.g., a commissioner correcting
-- bad data) are preserved.
--
-- Multi-round cascade: when an R2 series finalizes later, that UPDATE on
-- its winner_team_id fires the trigger again, propagating into R3.
-- R3 final → R4 same way. No special handling needed; the trigger is
-- self-cascading by virtue of firing on every winner_team_id UPDATE.
-- ============================================================================

CREATE OR REPLACE FUNCTION propagate_playoff_series_winner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.winner_team_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.nhl_playoff_series
  SET high_seed_team_id = NEW.winner_team_id,
      updated_at = NOW()
  WHERE season = NEW.season
    AND parent_slot_a = NEW.bracket_slot
    AND high_seed_team_id IS NULL;

  UPDATE public.nhl_playoff_series
  SET low_seed_team_id = NEW.winner_team_id,
      updated_at = NOW()
  WHERE season = NEW.season
    AND parent_slot_b = NEW.bracket_slot
    AND low_seed_team_id IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_playoff_winner ON public.nhl_playoff_series;

CREATE TRIGGER trg_propagate_playoff_winner
AFTER UPDATE OF winner_team_id ON public.nhl_playoff_series
FOR EACH ROW
WHEN (NEW.winner_team_id IS NOT NULL)
EXECUTE FUNCTION propagate_playoff_series_winner();

-- ============================================================================
-- Backfill: propagate winners from existing finalized series to their children.
-- Idempotent — NULL guard on the destination preserves manual overrides.
-- ============================================================================

UPDATE public.nhl_playoff_series child
SET high_seed_team_id = parent.winner_team_id,
    updated_at = NOW()
FROM public.nhl_playoff_series parent
WHERE child.parent_slot_a = parent.bracket_slot
  AND child.season = parent.season
  AND parent.winner_team_id IS NOT NULL
  AND child.high_seed_team_id IS NULL;

UPDATE public.nhl_playoff_series child
SET low_seed_team_id = parent.winner_team_id,
    updated_at = NOW()
FROM public.nhl_playoff_series parent
WHERE child.parent_slot_b = parent.bracket_slot
  AND child.season = parent.season
  AND parent.winner_team_id IS NOT NULL
  AND child.low_seed_team_id IS NULL;
