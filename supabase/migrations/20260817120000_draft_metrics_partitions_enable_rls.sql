-- SWEEP (2026-08-15) — self-caught: the draft_metrics partitions created by
-- 20260813180816 (safety-net fix, partitions through 2027-03 + DEFAULT) were
-- created WITHOUT row level security. Supabase security advisor flags all 9
-- monthly partitions + the DEFAULT partition + two load1_* scratch tables as
-- ERROR "RLS Disabled in Public": each is directly addressable through the
-- Data API, bypassing whatever the parent enforces.
--
-- Contents are engine telemetry (timings, league ids) — low sensitivity, but
-- ERROR-level advisories are exactly what a security-conscious reviewer or
-- customer scans for.
--
-- ⚠️ APPLY MONDAY 2026-08-17 OR LATER — file is future-dated on purpose.
-- The DB is frozen for THE TWELVE (Sun Aug 16). Nothing auto-applies
-- migrations in this repo (verified against .github/workflows 2026-08-15),
-- so committing this file is inert until someone runs it deliberately.
--
-- Service-role writers (the engine, the sweep) bypass RLS by design, so
-- enabling RLS with NO policies = deny anon/authenticated, engine unaffected.
-- Same posture as the parent table.

DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY[
    'draft_metrics_2026_08','draft_metrics_2026_09','draft_metrics_2026_10',
    'draft_metrics_2026_11','draft_metrics_2026_12','draft_metrics_2027_01',
    'draft_metrics_2027_02','draft_metrics_2027_03','draft_metrics_default'
  ] LOOP
    IF to_regclass('public.'||p) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p);
    END IF;
  END LOOP;
END $$;

-- load-test scratch tables: lock down the same way (drop later if unused)
DO $$
BEGIN
  IF to_regclass('public.load1_timings') IS NOT NULL THEN
    ALTER TABLE public.load1_timings ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.load1_leagues') IS NOT NULL THEN
    ALTER TABLE public.load1_leagues ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
