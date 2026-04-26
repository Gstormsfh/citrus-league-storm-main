-- ════════════════════════════════════════════════════════════════════════
-- Draft Engine v2 — Phase 2 SQL integration suite
-- ════════════════════════════════════════════════════════════════════════
--
-- Purpose. Cover the failure modes that mocks (chunks 9a / 9b / 9c)
--          cannot reach: actual RPC behavior, projection trigger
--          firing, idempotency-key uniqueness, preflight ordering,
--          state-machine guards, schema CHECK enforcement, invariant
--          consistency, pgmq enqueue semantics.
--
-- Where.   STAGING ONLY (Supabase project jjgspcpvqaiitloglxbb). Run
--          via `psql "$SUPABASE_DB_URL" -f <this file>` or paste into
--          the Supabase SQL Editor. Idempotent: every scenario lives
--          in a BEGIN ... ROLLBACK block, leaving staging in exactly
--          the state it started.
--
-- Lifecycle. Append-only. As 9e2-9e5 land, scenarios accumulate at
--            the bottom of this file under the `── Scenarios ──`
--            section. Helpers at the top do NOT change between
--            chunks — if they need to evolve, that's its own commit
--            with explicit cross-chunk review.
--
-- ── Preflight ──────────────────────────────────────────────────────────
-- Self-validating. Every run re-asserts the framework's load-bearing
-- assumption: pgmq.send participates in the enclosing transaction
-- (so ROLLBACK cleans up the queue write). If this assumption ever
-- breaks (extension upgrade, config change), the file aborts at the
-- top with a clear error and a remediation path.
--
-- DO NOT remove this preflight. The whole BEGIN/ROLLBACK strategy
-- depends on it.

DO $preflight$
DECLARE
  v_count_before bigint;
  v_count_after  bigint;
BEGIN
  SELECT count(*) INTO v_count_before FROM pgmq.q_draft_deadlines;

  -- Inner block: send a tagged message, then force a rollback by
  -- raising a custom-coded exception that the outer EXCEPTION arm
  -- catches and ignores. Net effect: the pgmq.send happened inside a
  -- subtransaction that rolled back.
  BEGIN
    PERFORM pgmq.send(
      'draft_deadlines',
      '{"_v2_test_preflight": true}'::jsonb,
      0
    );
    RAISE EXCEPTION 'preflight_rollback_marker' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    -- Expected. We forced the rollback. The pgmq.send above either
    -- rolled back with us (good) or it didn't (bad — assertion below
    -- will catch).
    NULL;
  END;

  SELECT count(*) INTO v_count_after FROM pgmq.q_draft_deadlines;

  IF v_count_after <> v_count_before THEN
    RAISE EXCEPTION
      'PREFLIGHT FAILED: pgmq writes are NOT transactional on this Postgres. '
      'Suite assumes they are (every scenario uses BEGIN ... ROLLBACK to clean up). '
      'Got count_before=%, count_after=% — leaked % message(s) from rolled-back tx. '
      'REMEDIATION: either (a) reconfigure pgmq install to use plain table-INSERT '
      'semantics, OR (b) rewrite the suite to use pgmq.purge_queue('
      '''draft_deadlines'') AFTER each scenario instead of relying on ROLLBACK. '
      'Do not run the rest of this file until resolved.',
      v_count_before, v_count_after, (v_count_after - v_count_before);
  END IF;

  RAISE NOTICE 'Preflight OK: pgmq.send is transactional. Suite will trust ROLLBACK for cleanup.';
END
$preflight$;

-- ── Helper schema ──────────────────────────────────────────────────────
-- Helpers persist across runs and across BEGIN/ROLLBACK boundaries
-- (CREATE FUNCTION runs in its own implicit txn here). Cleanup if you
-- want a clean slate later: DROP SCHEMA IF EXISTS _v2_test CASCADE.

CREATE SCHEMA IF NOT EXISTS _v2_test;

-- ── _v2_test._assert(condition, label) ─────────────────────────────────
-- Basic boolean assertion. Raises with a useful label on failure.
CREATE OR REPLACE FUNCTION _v2_test._assert(
  p_condition boolean,
  p_label     text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', p_label;
  END IF;
END;
$$;

-- ── _v2_test._assert_eq(actual, expected, label) ───────────────────────
-- Equality assertion for jsonb. Most fixture comparisons use jsonb.
CREATE OR REPLACE FUNCTION _v2_test._assert_eq(
  p_actual   jsonb,
  p_expected jsonb,
  p_label    text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ASSERTION FAILED [%]: actual=% expected=%',
      p_label, p_actual, p_expected;
  END IF;
END;
$$;

-- ── _v2_test._seed_active_league(commissioner, team_count, rounds) ─────
-- Bootstraps an active draft-ready league with deterministic IDs.
-- Returns the new league_id. Called inside each scenario's BEGIN block;
-- ROLLBACK at the scenario end discards everything this seeded.
--
-- Layout:
--   - 1 league: draft_state='active', league_size=p_team_count,
--     settings.pickTimeLimit=90, draft_event_counter=0,
--     draft_generation=0, pick_deadline = now()+90s.
--   - p_team_count teams. Team 1 owner_id = p_commissioner; teams 2..N
--     unowned (NULL). Constraint: teams.unique(league_id, owner_id)
--     prevents one user owning multiple teams in one league, so this
--     is the only legal layout for a single test commissioner.
--   - p_draft_rounds rounds of draft_order with snake/serpentine
--     team_order baked into each row's JSONB (round 1 forward, 2
--     reversed, etc.). Suffices for submit_pick_v2's draft_order read.
--
-- Returns: jsonb { league_id, team_ids: [uuid...], session_id }
--   so scenarios can reference deterministic team UUIDs without
--   re-querying.

CREATE OR REPLACE FUNCTION _v2_test._seed_active_league(
  p_commissioner uuid,
  p_team_count   int  DEFAULT 12,
  p_draft_rounds int  DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_league_id   uuid := gen_random_uuid();
  v_session_id  uuid := gen_random_uuid();
  v_team_ids    uuid[] := ARRAY[]::uuid[];
  v_team_id     uuid;
  v_owner       uuid;
  v_round       int;
  v_ordered     jsonb;
  i             int;
BEGIN
  -- Verify the commissioner exists in auth.users — fail fast if not.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_commissioner) THEN
    RAISE EXCEPTION 'seed: commissioner UID % not found in auth.users', p_commissioner;
  END IF;

  -- League row, immediately active.
  INSERT INTO public.leagues (
    id, name, commissioner_id,
    draft_state, league_size, draft_rounds, draft_event_counter,
    draft_generation, draft_shadow_mode, feature_flags,
    settings, pick_deadline,
    join_code
  ) VALUES (
    v_league_id,
    format('_v2_test seed %s', v_league_id),
    p_commissioner,
    'active',
    p_team_count,
    p_draft_rounds,
    0,
    0,
    false,                        -- shadow off — we're testing v2 directly
    '{}'::jsonb,
    jsonb_build_object('pickTimeLimit', 90),
    now() + interval '90 seconds',
    'V2TEST' || substring(replace(v_league_id::text, '-', ''), 1, 10)
  );

  -- Teams. Deterministic IDs derived from league_id + slot.
  FOR i IN 1..p_team_count LOOP
    v_team_id := uuid_generate_v5(v_league_id, format('seed-team-%s', i));
    v_owner   := CASE WHEN i = 1 THEN p_commissioner ELSE NULL END;

    INSERT INTO public.teams (id, league_id, team_name, owner_id)
    VALUES (
      v_team_id,
      v_league_id,
      format('Seed Team %s', lpad(i::text, 2, '0')),
      v_owner
    );

    v_team_ids := v_team_ids || v_team_id;
  END LOOP;

  -- draft_order rows: snake/serpentine. submit_pick_v2 reads
  -- team_order[(pick_in_round - 1)] directly, so the snake reversal
  -- is baked into the row, not derived at read time.
  FOR v_round IN 1..p_draft_rounds LOOP
    IF v_round % 2 = 1 THEN
      v_ordered := to_jsonb(v_team_ids);
    ELSE
      v_ordered := to_jsonb(
        ARRAY(
          SELECT t
          FROM unnest(v_team_ids) WITH ORDINALITY AS x(t, ord)
          ORDER BY ord DESC
        )
      );
    END IF;

    INSERT INTO public.draft_order (
      league_id, round_number, team_order, draft_session_id
    ) VALUES (
      v_league_id, v_round, v_ordered, v_session_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'league_id',  v_league_id,
    'team_ids',   to_jsonb(v_team_ids),
    'session_id', v_session_id
  );
END;
$$;

-- Verify the helper schema is reachable from outside (sanity check that
-- doesn't require any scenario to run).
DO $verify$
BEGIN
  PERFORM _v2_test._assert(true, 'helper schema is callable');
  RAISE NOTICE 'Framework loaded: _v2_test schema ready, helpers callable.';
END
$verify$;

-- ── Scenarios ──────────────────────────────────────────────────────────
-- (Chunks 9e1b through 9e5 append BEGIN/ROLLBACK blocks below this line.
-- Each scenario must be self-contained, idempotent, and leave staging
-- exactly as it started.)
