-- Draft Engine v2 — Phase 1 smoke tests (manual / staging-side).
--
-- Run AGAINST STAGING ONLY (Supabase project ref jjgspcpvqaiitloglxbb)
-- after `supabase db push` has applied the Phase 1 foundation migration.
-- These tests use the synthetic test league seeded via the staging
-- preflight runbook (docs/RUNBOOKS/draft-engine-v2-staging-preflight.md §3).
--
-- DO NOT run on production. Asserts use plain SELECT + RAISE EXCEPTION
-- so failures are visible in psql output and stop the script.
--
-- Spec references:
--   §3.1 — draft_events shape and indexes
--   §3.2 — draft_picks_v2 projection
--   §3.3 — leagues column additions
--   §10  — invariants I1, I3, I4, I8 covered conceptually below.

\echo '── Phase 1 smoke tests starting ──'

BEGIN;

-- 1. Tables exist with the expected columns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'draft_events'
  ) THEN RAISE EXCEPTION 'draft_events table missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'draft_picks_v2'
  ) THEN RAISE EXCEPTION 'draft_picks_v2 table missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leagues' AND column_name = 'draft_event_counter'
  ) THEN RAISE EXCEPTION 'leagues.draft_event_counter missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leagues' AND column_name = 'draft_state'
  ) THEN RAISE EXCEPTION 'leagues.draft_state missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leagues' AND column_name = 'draft_generation'
  ) THEN RAISE EXCEPTION 'leagues.draft_generation missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leagues' AND column_name = 'pick_deadline'
  ) THEN RAISE EXCEPTION 'leagues.pick_deadline missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leagues' AND column_name = 'draft_shadow_mode'
  ) THEN RAISE EXCEPTION 'leagues.draft_shadow_mode missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leagues' AND column_name = 'feature_flags'
  ) THEN RAISE EXCEPTION 'leagues.feature_flags missing'; END IF;
END$$;
\echo 'OK — schema present.'

-- 2. Indexes exist (the load-bearing ones for spec invariants).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'draft_events_league_seq_uniq'
  ) THEN RAISE EXCEPTION 'unique (league_id, seq) index missing — invariant I1 cannot hold'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'draft_events_idem_key_uniq'
  ) THEN RAISE EXCEPTION 'partial unique idempotency_key index missing — invariant I4 cannot hold'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'draft_events_correlation_idx'
  ) THEN RAISE EXCEPTION 'correlation_id index missing — observability/trace queries will scan'; END IF;
END$$;
\echo 'OK — indexes present.'

-- 3. RLS is enabled on the new tables.
DO $$
DECLARE rls_enabled boolean;
BEGIN
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class WHERE relname = 'draft_events';
  IF NOT rls_enabled THEN RAISE EXCEPTION 'RLS not enabled on draft_events'; END IF;

  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class WHERE relname = 'draft_picks_v2';
  IF NOT rls_enabled THEN RAISE EXCEPTION 'RLS not enabled on draft_picks_v2'; END IF;
END$$;
\echo 'OK — RLS enabled on new tables.'

-- 4. CHECK constraints reject illegal event_type and actor.kind.
DO $$
DECLARE bogus_league uuid := gen_random_uuid();
BEGIN
  -- We need a league row for the FK; insert a throwaway and roll back.
  INSERT INTO leagues (id, name, commissioner_id)
    VALUES (bogus_league, 'phase1-smoke-tmp', auth.uid())
    ON CONFLICT DO NOTHING;

  BEGIN
    -- Illegal event_type should fail.
    INSERT INTO draft_events (
      league_id, seq, event_type, payload, payload_hash,
      actor, correlation_id
    ) VALUES (
      bogus_league, 1, 'totally_made_up',
      '{}'::jsonb, 'x', '{"kind":"system"}'::jsonb, gen_random_uuid()
    );
    RAISE EXCEPTION 'CHECK on event_type did not fire';
  EXCEPTION WHEN check_violation THEN
    -- expected
  END;

  BEGIN
    INSERT INTO draft_events (
      league_id, seq, event_type, payload, payload_hash,
      actor, correlation_id
    ) VALUES (
      bogus_league, 1, 'pick',
      '{}'::jsonb, 'x', '{"kind":"hacker"}'::jsonb, gen_random_uuid()
    );
    RAISE EXCEPTION 'CHECK on actor.kind did not fire';
  EXCEPTION WHEN check_violation THEN
    -- expected
  END;
END$$;
\echo 'OK — CHECK constraints reject illegal event_type and actor.kind.'

ROLLBACK;
\echo 'Phase 1 smoke tests complete.'

-- ── Plan §Phase 1 verify step (manual): seq gap-free across leagues ──
--
-- Run AFTER Phase 2 lands (when submit_pick_v2 exists to advance seq).
-- Quoted here for easy reference but commented out — has no effect in
-- Phase 1 because the table is empty.
--
-- WITH g AS (
--   SELECT league_id, seq,
--          seq - row_number() OVER (PARTITION BY league_id ORDER BY seq) AS gap
--   FROM draft_events
-- )
-- SELECT league_id, count(*) AS rows, count(DISTINCT gap) AS gap_buckets
-- FROM g GROUP BY league_id;
-- -- Healthy: every row has gap_buckets = 1 (= seq is a pure
-- -- gap-free arithmetic progression starting at 1 per league).
