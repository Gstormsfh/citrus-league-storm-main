-- Drop the legacy table named literally `public.players` (with a dot in the
-- name) that lives inside the public schema, hence appearing as
-- `public.public.players` when referenced fully-qualified.
--
-- This table was discovered during the R5 data organization audit
-- (apps/web/docs/DATA_ORGANIZATION_AUDIT.md §7.3). It is vestigial:
-- - 2 columns only (id bigint, created_at timestamptz)
-- - 0 rows (estimated via pg_class; verified empty by R5 investigation)
-- - No triggers, no FK references, no migration explicitly creates it
-- - Likely artifact of an early-era migration that mishandled
--   schema-qualification (e.g., CREATE TABLE "public.players" instead
--   of CREATE TABLE public.players). The canonical players table is
--   public.player_directory.
--
-- Self-defending verification: the migration refuses to drop the table
-- if it has rows. This guards against a scenario where the table was
-- repurposed without the audit catching it. If the count check fails,
-- investigate before bypassing.

DO $$
DECLARE
  table_exists BOOLEAN;
  row_count INTEGER;
BEGIN
  -- Only run the drop if the table actually exists. Idempotent — running
  -- this migration twice is safe.
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'public.players'
      AND c.relkind = 'r'
  ) INTO table_exists;

  IF NOT table_exists THEN
    RAISE NOTICE 'public."public.players" not found — already dropped or never existed. Skipping.';
    RETURN;
  END IF;

  EXECUTE 'SELECT COUNT(*) FROM public."public.players"' INTO row_count;
  IF row_count > 0 THEN
    RAISE EXCEPTION 'public.public.players has % rows — refusing to drop. Investigate before bypassing.', row_count;
  END IF;

  RAISE NOTICE 'public."public.players" verified empty (0 rows). Proceeding with DROP TABLE CASCADE.';
END $$;

-- The CASCADE handles the implicit primary-key index `public.players_pkey`
-- and the sequence `public.players_id_seq` that pg_class showed alongside.
DROP TABLE IF EXISTS public."public.players" CASCADE;
