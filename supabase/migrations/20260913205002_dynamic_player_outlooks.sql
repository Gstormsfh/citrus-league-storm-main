-- Additive provenance for generated public content. Existing public SELECT
-- and service-role-only writes remain unchanged; no user/league data involved.
ALTER TABLE public.citrus_news
  ADD COLUMN IF NOT EXISTS editorial_version text,
  ADD COLUMN IF NOT EXISTS content_revision text,
  ADD COLUMN IF NOT EXISTS source_context jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.citrus_news.updated_at IS
  'Last material generated-content revision, separate from original publication and source report dates.';
