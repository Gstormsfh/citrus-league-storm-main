-- Phase 4.5 chunk 11g.10 sub-step 10b — is_engine_admin column on profiles.
--
-- Separable privilege gate for the new engine-ops admin endpoints
-- (server/src/routes/draftAdmin.ts — force-snapshot, evict, registry
-- diagnostic). Per architect ratification 2026-05-19 (PROJECT_PLAN.md
-- Decision Log): "engine ops privilege escalation should be separable
-- from user-management privilege escalation when the team grows."
--
-- Migration semantics:
--   - Add `is_engine_admin` column with default false.
--   - Backfill: any existing user with `is_admin = true` automatically
--     gets `is_engine_admin = true`. Garrett gets it for free.
--   - Going forward: the two flags are independent. A future "data
--     pipeline admin" or "support admin" can have is_admin without
--     getting engine-ops privileges.
--
-- Same RLS pattern as is_admin (added in 20260302000000):
--   - Default false on insert.
--   - Cannot self-promote via UPDATE (RLS policy blocks).
--   - Only service_role can grant the flag.
--
-- DOWN (manual rollback):
--   ALTER TABLE profiles DROP COLUMN IF EXISTS is_engine_admin;
--   DROP POLICY IF EXISTS "Users cannot modify their own engine admin status" ON profiles;
-- Single column drop + policy drop. <5 lines DDL.

-- 1. Add the column with default false.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_engine_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_engine_admin IS
  'Engine-ops admin flag. Controls access to /api/admin/engine/* routes (force-snapshot, evict, registry). Separable from is_admin per chunk 11g.10 sub-step 10b Decision Log 2026-05-19. Only settable via service role.';

-- 2. Backfill from is_admin so existing admins get engine-ops access by
--    default. New users post-migration default to false on both unless
--    explicitly promoted via the service role.
UPDATE public.profiles
   SET is_engine_admin = true
 WHERE is_admin = true
   AND is_engine_admin = false;

-- 3. RLS — block self-promotion, mirroring the is_admin policy from
--    20260302000000_add_profiles_is_admin.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'profiles'
       AND policyname = 'Users cannot modify their own engine admin status'
  ) THEN
    CREATE POLICY "Users cannot modify their own engine admin status"
      ON public.profiles
      FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (
        is_engine_admin IS NOT DISTINCT FROM (
          SELECT is_engine_admin FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;
END$$;
