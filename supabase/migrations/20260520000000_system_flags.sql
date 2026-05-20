-- Phase 4.5 chunk 11g.10 sub-step 10b — system_flags table.
--
-- Operational kill-switch surface for the persistent draft engine.
-- The initial flag `no_new_drafts` is the Tier-1 incident bridging
-- action documented in:
--   - docs/RUNBOOKS/draft-engine-v2-operations.md §2.4
--   - docs/RUNBOOKS/draft-engine-v2-rollback-playbook.md §3
--   - docs/PHASE_4_5_PROJECT_PLAN.md Decision Log 2026-05-19
--     ("Discovery-flag mechanism design ratified: Option D").
--
-- Two enforcement points read this table (defense in depth):
--   1. Main API /api/drafts/:draftId/server discovery endpoint
--      (server/src/routes/drafts.ts). 5s in-memory cache.
--   2. GCE engine's LobbyRegistry.getOrCreate on new-lobby creation
--      (server/src/draft/LobbyRegistry.ts). Same 5s cache.
--
-- Toggle procedure (lands in runbook §3):
--   UPDATE system_flags
--      SET flag_value = true,
--          updated_at = now(),
--          updated_by = '<garrett-user-id>'::uuid,
--          reason = '<incident-id-or-description>'
--    WHERE flag_name = 'no_new_drafts';
-- Takes effect within ~5s (the cache TTL on the read side).
--
-- DOWN (manual rollback):
--   DROP TABLE public.system_flags CASCADE;
-- Applies the criteria from rollback playbook scenario #1 step 4:
-- (a) single table add, (b) no data migrated, (c) <5 lines of DDL.
-- This migration IS "obviously revertable."

CREATE TABLE IF NOT EXISTS public.system_flags (
  flag_name   TEXT PRIMARY KEY,
  flag_value  BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES public.profiles(id),
  reason      TEXT
);

COMMENT ON TABLE public.system_flags IS
  'Operational kill-switches for the persistent draft engine. Read by the discovery endpoint + LobbyRegistry. Per chunk 11g.10 sub-step 10b.';
COMMENT ON COLUMN public.system_flags.flag_name IS 'Globally-unique flag identifier. Add new rows for new flags rather than reusing values.';
COMMENT ON COLUMN public.system_flags.flag_value IS 'Current boolean value. Read with a short cache TTL on the application side.';
COMMENT ON COLUMN public.system_flags.updated_at IS 'When the flag was last toggled. Useful for incident-timeline reconstruction.';
COMMENT ON COLUMN public.system_flags.updated_by IS 'Profile id of the user who toggled the flag (nullable for system-initiated changes).';
COMMENT ON COLUMN public.system_flags.reason IS 'Human-readable reason for the toggle (incident id, ticket id, brief description).';

-- RLS: only service_role and admins (is_admin or is_engine_admin) write.
-- Everyone reads (the discovery endpoint runs under user-scoped clients
-- but every authenticated user needs to be able to observe whether
-- discovery returns 503 because of a flag — the row is not sensitive).
ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read system_flags"
  ON public.system_flags
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only service_role writes system_flags"
  ON public.system_flags
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Initial flag — no_new_drafts. Default off. Toggle via SQL UPDATE per
-- the operations runbook.
INSERT INTO public.system_flags (flag_name, flag_value, reason)
VALUES ('no_new_drafts', false, 'Initial value at chunk 11g.10 sub-step 10b deploy.')
ON CONFLICT (flag_name) DO NOTHING;
