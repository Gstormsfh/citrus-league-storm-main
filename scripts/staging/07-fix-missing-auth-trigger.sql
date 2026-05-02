-- ============================================================================
-- Staging repair: install missing handle_new_user() function + on_auth_user_created trigger
-- ============================================================================
--
-- Why this script exists:
--   The staging bootstrap (01-mark-migrations-applied.sql) marks all 276 prod
--   migrations as already-applied in supabase_migrations.schema_migrations,
--   under the assumption that the prod schema was dumped and applied to
--   staging beforehand. The schema dump used during that bootstrap silently
--   dropped DDL that lives in `public` but targets the managed `auth` schema —
--   specifically, the `on_auth_user_created` trigger on `auth.users`. The
--   migration metadata claims this DDL ran, but the actual trigger never
--   landed on staging.
--
--   Symptom: signing up creates a row in `auth.users` but no companion row
--   in `public.profiles`, so any FK that points at profiles (e.g.
--   `leagues.commissioner_id` → `profiles.id`) fails with a 23503 violation.
--   In our case this surfaces as a 400 from POST /api/leagues for new users.
--
-- Why this is a script, not a supabase/migrations/ migration:
--   The migration metadata already claims the upstream migrations ran. We
--   don't want to add a new migration that re-creates state the metadata
--   says is already there — that would just paper over the bootstrap bug
--   and confuse a future operator. This script is a one-shot staging
--   repair, lives alongside the other 0X-* operator scripts, and is
--   idempotent so re-running is safe.
--
-- Affected upstream migrations (the canonical source of this DDL):
--   - supabase/migrations/20250101000000_create_profiles_table.sql  (original
--     function + trigger)
--   - supabase/migrations/20260331000000_fix_handle_new_user_search_path.sql
--     (latest hardened function form with SET search_path = public properly
--     inside the definition)
--
-- Target: staging Supabase project ref jjgspcpvqaiitloglxbb ONLY.
--         DO NOT run against production.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS pattern.
-- Safe to re-run.
-- ============================================================================

-- 1. Function: latest hardened form from 20260331000000.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (new.id, 'user_' || substr(new.id::text, 1, 8));
  RETURN new;
END;
$$;

-- 2. Trigger: original from 20250101000000.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3. Verification — should return exactly one row after this script runs.
SELECT tgname, tgrelid::regclass AS target_table, tgenabled
FROM pg_trigger
WHERE tgname = 'on_auth_user_created'
  AND tgrelid = 'auth.users'::regclass;
