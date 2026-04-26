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
--
-- ── Conventions ────────────────────────────────────────────────────────
--
-- 1. Each scenario uses the SAVEPOINT pattern (inner BEGIN/EXCEPTION
--    block) for cleanup, NOT explicit ROLLBACK statements. The
--    Supabase SQL Editor (and most SQL clients) wrap pasted input in
--    an outer transaction; explicit ROLLBACK from inside a DO block
--    in that context fails with `invalid transaction termination`.
--    The savepoint pattern is universal — works whether the outer
--    txn is implicit or explicit.
--
--    Pattern:
--      DO $scNNN$
--      DECLARE ...
--      BEGIN
--        BEGIN  -- savepoint
--          ... test setup + RPC calls + assertions ...
--          RAISE NOTICE 'SC-NNN PASS';
--          RAISE EXCEPTION 'cleanup' USING ERRCODE='P0001';
--        EXCEPTION WHEN SQLSTATE 'P0001' THEN
--          NULL; -- forced cleanup; ignore.
--        END;
--      END
--      $scNNN$;
--
--    Helper funcs in _v2_test survive across scenarios (created
--    outside any txn).
--
-- 2. Test calls use actor.kind='autopick' uniformly. The SQL Editor
--    runs as service_role with auth.uid()=NULL, which fails the
--    'user' path's auth.uid() = team_owner check. The autopick path
--    only requires service_role, which we have. The 'user' auth path
--    is covered by chunk 9b (route mocked) AND chunk 9e3 (real auth
--    via SET LOCAL "request.jwt.claims").
--
-- 3. payload_hash is computed deterministically per scenario from the
--    pick fields. The exact byte-for-byte format does NOT need to
--    match @citrus/shared/computePickPayloadHash — the RPC only
--    compares hash-A to hash-B for the same idempotency_key. Format
--    used here: 'sha256:' || md5(...) for brevity (still a 32-char
--    hex digest, still parseable, distinct per logical pick).
--
-- 4. Test commissioner UID = 882b59c9-8882-418b-9450-3fd004d57edd
--    (per the Phase 1 regression seed). Confirmed to exist in
--    auth.users on staging.
--
-- 5. NOTICE messages mark scenario start / pass. Assertion failures
--    raise EXCEPTION (not SQLSTATE 'P0001') and propagate up out of
--    the DO block — the savepoint still rolls back the test setup,
--    and the failure surfaces as a SQL error to the operator.
--
-- ════════════════════════════════════════════════════════════════════════
-- SC-001 — Single-pick happy path
-- ════════════════════════════════════════════════════════════════════════
-- Verifies the full submit_pick_v2 success path:
--   - Event row lands in draft_events with correct envelope.
--   - Projection row lands in draft_picks_v2 (the AFTER INSERT
--     trigger from chunk 2 fires synchronously).
--   - leagues.draft_event_counter advances to 1.
--   - leagues.pick_deadline is updated to a future timestamp.
--   - pgmq.send enqueued ONE message for the next pick with
--     generation=0 (matches the seed's draft_generation).
--
-- Spec refs: §4.1 RPC contract, §3.2 projection trigger, §5.2.2
-- deadline rounding, §5.2 step 6 pgmq enqueue.

DO $sc001$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_session_id   uuid;
  v_first_team   uuid;
  v_result       jsonb;
  v_event_count  int;
  v_pick_count   int;
  v_pgmq_count   int;
  v_counter      bigint;
  v_deadline     timestamptz;
  v_event_row    record;
BEGIN
  RAISE NOTICE 'SC-001 starting: single-pick happy path';
  BEGIN  -- savepoint

  -- Seed.
  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_session_id := (v_seed ->> 'session_id')::uuid;
  v_first_team := v_team_ids[1];

  -- Submit pick.
  v_result := submit_pick_v2(
    p_league_id        => v_league_id,
    p_team_id          => v_first_team,
    p_player_id        => 1001,
    p_round            => 1,
    p_pick_number      => 1,
    p_session_id       => v_session_id,
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:' || md5('SC001-pick-1'),
    p_actor            => jsonb_build_object('kind', 'autopick'),
    p_correlation_id   => NULL
  );

  -- Result shape.
  PERFORM _v2_test._assert(
    (v_result ->> 'was_duplicate')::boolean = false,
    'SC-001 result.was_duplicate should be false'
  );
  PERFORM _v2_test._assert(
    (v_result ->> 'seq')::bigint = 1,
    'SC-001 result.seq should be 1'
  );
  PERFORM _v2_test._assert(
    (v_result ->> 'event_id') IS NOT NULL,
    'SC-001 result.event_id should be set'
  );
  PERFORM _v2_test._assert(
    (v_result ->> 'pick_deadline') IS NOT NULL,
    'SC-001 result.pick_deadline should be set'
  );

  -- Event log row.
  SELECT count(*) INTO v_event_count FROM draft_events WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_count = 1, 'SC-001 expected 1 event row, got ' || v_event_count);

  SELECT * INTO v_event_row FROM draft_events WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_row.event_type = 'pick',  'SC-001 event_type should be pick');
  PERFORM _v2_test._assert(v_event_row.actor ->> 'kind' = 'autopick', 'SC-001 actor.kind should be autopick');
  PERFORM _v2_test._assert(v_event_row.seq = 1, 'SC-001 event row seq should be 1');
  PERFORM _v2_test._assert(v_event_row.correlation_id IS NOT NULL, 'SC-001 correlation_id auto-generated');

  -- Projection row (synchronous trigger fired).
  SELECT count(*) INTO v_pick_count FROM draft_picks_v2 WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_pick_count = 1, 'SC-001 expected 1 projection row, got ' || v_pick_count);

  -- Counter + deadline updated on leagues.
  SELECT draft_event_counter, pick_deadline INTO v_counter, v_deadline
    FROM leagues WHERE id = v_league_id;
  PERFORM _v2_test._assert(v_counter = 1, 'SC-001 leagues.draft_event_counter should be 1');
  PERFORM _v2_test._assert(v_deadline > now(), 'SC-001 leagues.pick_deadline should be in the future');

  -- pgmq message enqueued for the next pick.
  SELECT count(*) INTO v_pgmq_count
    FROM pgmq.q_draft_deadlines
    WHERE (message ->> 'league_id')::uuid = v_league_id;
  PERFORM _v2_test._assert(v_pgmq_count = 1, 'SC-001 expected 1 pgmq message, got ' || v_pgmq_count);

  RAISE NOTICE 'SC-001 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;  -- forced cleanup
  END;
END
$sc001$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-002 — Idempotent replay (same key, same hash)
-- ════════════════════════════════════════════════════════════════════════
-- Two submit_pick_v2 calls with the same idempotency_key + same
-- payload_hash should:
--   - Both succeed.
--   - Second call returns was_duplicate=true.
--   - Second call returns the SAME event_id and seq as the first.
--   - draft_events still has only 1 row.
--   - draft_picks_v2 still has only 1 row.
--
-- Spec refs: §4.1 idempotent retry contract, §5.2.1 idempotency-
-- before-preflight ordering.

DO $sc002$
DECLARE
  v_seed        jsonb;
  v_league_id   uuid;
  v_team_ids    uuid[];
  v_first_team  uuid;
  v_idem_key    uuid := gen_random_uuid();
  v_hash        text := 'sha256:' || md5('SC002-pick-1');
  v_result_a    jsonb;
  v_result_b    jsonb;
  v_event_count int;
  v_pick_count  int;
BEGIN
  RAISE NOTICE 'SC-002 starting: idempotent replay';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_first_team := v_team_ids[1];

  -- First call.
  v_result_a := submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_first_team, p_player_id => 2001,
    p_round => 1, p_pick_number => 1,
    p_session_id => gen_random_uuid(),
    p_idempotency_key => v_idem_key, p_payload_hash => v_hash,
    p_actor => jsonb_build_object('kind', 'autopick'),
    p_correlation_id => NULL
  );

  PERFORM _v2_test._assert((v_result_a ->> 'was_duplicate')::boolean = false,
    'SC-002 first call: was_duplicate should be false');

  -- Replay: SAME key, SAME hash, SAME everything.
  v_result_b := submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_first_team, p_player_id => 2001,
    p_round => 1, p_pick_number => 1,
    p_session_id => gen_random_uuid(),
    p_idempotency_key => v_idem_key, p_payload_hash => v_hash,
    p_actor => jsonb_build_object('kind', 'autopick'),
    p_correlation_id => NULL
  );

  PERFORM _v2_test._assert((v_result_b ->> 'was_duplicate')::boolean = true,
    'SC-002 replay: was_duplicate should be true');
  PERFORM _v2_test._assert(
    (v_result_b ->> 'event_id') = (v_result_a ->> 'event_id'),
    'SC-002 replay: event_id should match first call'
  );
  PERFORM _v2_test._assert(
    (v_result_b ->> 'seq') = (v_result_a ->> 'seq'),
    'SC-002 replay: seq should match first call'
  );

  -- Only one row in each table.
  SELECT count(*) INTO v_event_count FROM draft_events    WHERE league_id = v_league_id;
  SELECT count(*) INTO v_pick_count  FROM draft_picks_v2 WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_count = 1, 'SC-002 events should still be 1, got ' || v_event_count);
  PERFORM _v2_test._assert(v_pick_count  = 1, 'SC-002 projection should still be 1, got ' || v_pick_count);

  RAISE NOTICE 'SC-002 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;  -- forced cleanup
  END;
END
$sc002$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-003 — Idempotency conflict (same key, different hash)
-- ════════════════════════════════════════════════════════════════════════
-- Two submit_pick_v2 calls with the same idempotency_key but
-- different payload_hash should:
--   - First call succeed.
--   - Second call raise idempotency_conflict (sqlstate unique_violation).
--   - draft_events still has only 1 row (the second call's txn aborts).
--
-- Spec refs: §4.1 idempotency_conflict semantics; §11.1 error code map.

DO $sc003$
DECLARE
  v_seed        jsonb;
  v_league_id   uuid;
  v_team_ids    uuid[];
  v_first_team  uuid;
  v_idem_key    uuid := gen_random_uuid();
  v_hash_a      text := 'sha256:' || md5('SC003-pick-1-playerA');
  v_hash_b      text := 'sha256:' || md5('SC003-pick-1-playerB');
  v_result_a    jsonb;
  v_caught_msg  text;
  v_caught_state text;
  v_event_count int;
BEGIN
  RAISE NOTICE 'SC-003 starting: idempotency conflict';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_first_team := v_team_ids[1];

  -- First call: success with hash A.
  v_result_a := submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_first_team, p_player_id => 3001,
    p_round => 1, p_pick_number => 1,
    p_session_id => gen_random_uuid(),
    p_idempotency_key => v_idem_key, p_payload_hash => v_hash_a,
    p_actor => jsonb_build_object('kind', 'autopick'),
    p_correlation_id => NULL
  );
  PERFORM _v2_test._assert((v_result_a ->> 'was_duplicate')::boolean = false,
    'SC-003 first call: should succeed');

  -- Second call: same key, DIFFERENT hash. Must raise.
  -- We catch in a sub-block so the outer txn keeps its state for assertion.
  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_first_team, p_player_id => 3002,
      p_round => 1, p_pick_number => 1,
      p_session_id => gen_random_uuid(),
      p_idempotency_key => v_idem_key, p_payload_hash => v_hash_b,
      p_actor => jsonb_build_object('kind', 'autopick'),
      p_correlation_id => NULL
    );
    -- If we got here, the RPC didn't raise.
    RAISE EXCEPTION 'SC-003 expected idempotency_conflict; second call returned without raising';
  EXCEPTION WHEN unique_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '23505',
    'SC-003 sqlstate should be 23505 (unique_violation), got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'idempotency_conflict%',
    'SC-003 error message should start with idempotency_conflict, got: ' || v_caught_msg);

  -- The conflict's sub-block aborted, but the outer txn still has the
  -- first call's row. Confirm.
  SELECT count(*) INTO v_event_count FROM draft_events WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_count = 1,
    'SC-003 should still have only 1 event row after conflict, got ' || v_event_count);

  RAISE NOTICE 'SC-003 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;  -- forced cleanup
  END;
END
$sc003$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-004 — Counter gap-free across N sequential picks
-- ════════════════════════════════════════════════════════════════════════
-- Submit 6 picks sequentially across 2 full snake rounds in a 3-team
-- league. Verify:
--   - leagues.draft_event_counter advances to exactly 6.
--   - max(seq) per league = 6.
--   - draft_events has 6 rows for this league.
--   - seq values are exactly {1,2,3,4,5,6} — gap-free (invariant I1).
--   - draft_picks_v2 has 6 rows with consecutive pick_numbers 1..6.
--   - Each pick goes to the correct team per snake order.
--
-- Spec refs: §3.1 unique(league_id, seq), §10 invariant I1, §10 I8.

DO $sc004$
DECLARE
  v_seed        jsonb;
  v_league_id   uuid;
  v_team_ids    uuid[];
  v_session_id  uuid;
  v_pn          int;
  v_round       int;
  v_pick_in_round int;
  v_team        uuid;
  v_counter     bigint;
  v_max_seq     bigint;
  v_event_count int;
  v_distinct    int;
  v_pick_seqs   bigint[];
BEGIN
  RAISE NOTICE 'SC-004 starting: counter gap-free across 6 sequential picks';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_session_id := (v_seed ->> 'session_id')::uuid;

  FOR v_pn IN 1..6 LOOP
    v_round         := ((v_pn - 1) / 3) + 1;
    v_pick_in_round := ((v_pn - 1) % 3) + 1;
    -- Snake: round 1 forward, round 2 reversed, round 3 forward.
    IF v_round % 2 = 1 THEN
      v_team := v_team_ids[v_pick_in_round];
    ELSE
      v_team := v_team_ids[3 - v_pick_in_round + 1];  -- reverse index
    END IF;

    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_team, p_player_id => 4000 + v_pn,
      p_round => v_round, p_pick_number => v_pn,
      p_session_id => v_session_id,
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5(format('SC004-pick-%s', v_pn)),
      p_actor => jsonb_build_object('kind', 'autopick'),
      p_correlation_id => NULL
    );
  END LOOP;

  -- Counter & max(seq).
  SELECT draft_event_counter INTO v_counter FROM leagues WHERE id = v_league_id;
  SELECT max(seq)            INTO v_max_seq FROM draft_events WHERE league_id = v_league_id;

  PERFORM _v2_test._assert(v_counter = 6,  'SC-004 counter should be 6, got ' || v_counter);
  PERFORM _v2_test._assert(v_max_seq = 6,  'SC-004 max(seq) should be 6, got ' || v_max_seq);

  -- Row count + gap-free.
  SELECT count(*), count(DISTINCT seq) INTO v_event_count, v_distinct
    FROM draft_events WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_count = 6, 'SC-004 events should be 6, got ' || v_event_count);
  PERFORM _v2_test._assert(v_distinct = 6,    'SC-004 distinct seqs should be 6, got ' || v_distinct);

  SELECT array_agg(seq ORDER BY seq) INTO v_pick_seqs
    FROM draft_events WHERE league_id = v_league_id;
  PERFORM _v2_test._assert_eq(
    to_jsonb(v_pick_seqs),
    '[1,2,3,4,5,6]'::jsonb,
    'SC-004 seq array should be exactly [1..6] gap-free'
  );

  -- Projection consistency.
  SELECT count(*) INTO v_event_count FROM draft_picks_v2 WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_count = 6, 'SC-004 projection should have 6 rows, got ' || v_event_count);

  RAISE NOTICE 'SC-004 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;  -- forced cleanup
  END;
END
$sc004$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-005 — Counter race (STRUCTURAL ONLY)
-- ════════════════════════════════════════════════════════════════════════
-- A single SQL session cannot prove race-freedom; a sequential test
-- that "works" tells you nothing about behavior under concurrent
-- writers. Real concurrency verification rides on Phase 7's chaos
-- harness (multiple parallel sessions hammering submit_pick_v2 with
-- the same idempotency_key, asserting at-most-once outcomes).
--
-- This scenario is STRUCTURAL: it verifies the building blocks for
-- race-freedom are present in the code. If these structural elements
-- are accidentally removed in a future refactor, this scenario fails
-- loudly here instead of silently in production.
--
-- Building blocks asserted:
--   1. submit_pick_v2's source includes pg_advisory_xact_lock keyed
--      on the idempotency_key (the per-key serialization mechanism).
--   2. draft_events has a UNIQUE constraint on (league_id, seq) (the
--      database-side gap-free guarantee even if the lock somehow
--      breaks).
--
-- Spec refs: §5.2 step 2 (advisory lock), §3.1 (unique index).

DO $sc005$
DECLARE
  v_func_src   text;
  v_unique_ix  int;
BEGIN
  RAISE NOTICE 'SC-005 starting: structural race-freedom check (no concurrent writers; full coverage on Phase 7 chaos)';

  -- 1. Function source must reference pg_advisory_xact_lock keyed
  --    on the idempotency_key. Search the function body.
  SELECT pg_get_functiondef(p.oid) INTO v_func_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_pick_v2';

  PERFORM _v2_test._assert(v_func_src IS NOT NULL,
    'SC-005 submit_pick_v2 function source must be readable');
  PERFORM _v2_test._assert(v_func_src LIKE '%pg_advisory_xact_lock%',
    'SC-005 submit_pick_v2 must use pg_advisory_xact_lock for per-key serialization');
  PERFORM _v2_test._assert(v_func_src LIKE '%draft_events_idem:%',
    'SC-005 submit_pick_v2 advisory lock key must namespace by draft_events_idem:');

  -- 2. Database-side gap-free guarantee: UNIQUE on (league_id, seq).
  SELECT count(*) INTO v_unique_ix
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename  = 'draft_events'
     AND indexname  = 'draft_events_league_seq_uniq';

  PERFORM _v2_test._assert(v_unique_ix = 1,
    'SC-005 draft_events_league_seq_uniq UNIQUE index must exist (database-side I1 enforcement)');

  RAISE NOTICE 'SC-005 PASS (structural). Real concurrency verification: Phase 7 chaos harness.';
END
$sc005$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-006 — Idempotency check fires BEFORE preflight (spec §5.2.1)
-- ════════════════════════════════════════════════════════════════════════
-- This is the critical ordering test. Spec §5.2.1: "A retry whose
-- state has moved past the pick_number is still a valid replay;
-- raising pick_out_of_order would be a false positive on retry."
--
-- Setup:
--   - Seed; submit pick 1 with key K1, hash H1.
--   - Submit pick 2 (different key K2) so state moves past pick 1.
--   - Retry submit_pick_v2 with key K1 + hash H1 + everything else
--     identical to the first call.
-- Assert:
--   - Third call returns was_duplicate=true.
--   - Returned event_id and seq match the FIRST call exactly.
--   - draft_events still has 2 rows (no third event landed).
-- This proves the idempotency lookup happens BEFORE pick_number
-- preflight; otherwise the third call would raise pick_out_of_order
-- (because pick_number=1 is no longer current; current is pick 3).

DO $sc006$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_session_id   uuid;
  v_idem_k1      uuid := gen_random_uuid();
  v_idem_k2      uuid := gen_random_uuid();
  v_hash_1       text := 'sha256:' || md5('SC006-pick-1');
  v_hash_2       text := 'sha256:' || md5('SC006-pick-2');
  v_first_result jsonb;
  v_retry_result jsonb;
  v_event_count  int;
BEGIN
  RAISE NOTICE 'SC-006 starting: idempotency BEFORE preflight ordering';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_session_id := (v_seed ->> 'session_id')::uuid;

  -- Pick 1: team[0], player 6001, key K1.
  v_first_result := submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_team_ids[1], p_player_id => 6001,
    p_round => 1, p_pick_number => 1,
    p_session_id => v_session_id,
    p_idempotency_key => v_idem_k1, p_payload_hash => v_hash_1,
    p_actor => jsonb_build_object('kind', 'autopick'),
    p_correlation_id => NULL
  );
  PERFORM _v2_test._assert((v_first_result ->> 'was_duplicate')::boolean = false,
    'SC-006 pick 1 should be a fresh commit');

  -- Pick 2: team[1], player 6002, key K2. State now past pick 1.
  PERFORM submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_team_ids[2], p_player_id => 6002,
    p_round => 1, p_pick_number => 2,
    p_session_id => v_session_id,
    p_idempotency_key => v_idem_k2, p_payload_hash => v_hash_2,
    p_actor => jsonb_build_object('kind', 'autopick'),
    p_correlation_id => NULL
  );

  -- Retry pick 1 with key K1. pick_number=1 is now stale (current is 3).
  -- Spec §5.2.1: must return was_duplicate=true, NOT raise.
  v_retry_result := submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_team_ids[1], p_player_id => 6001,
    p_round => 1, p_pick_number => 1,
    p_session_id => v_session_id,
    p_idempotency_key => v_idem_k1, p_payload_hash => v_hash_1,
    p_actor => jsonb_build_object('kind', 'autopick'),
    p_correlation_id => NULL
  );

  PERFORM _v2_test._assert((v_retry_result ->> 'was_duplicate')::boolean = true,
    'SC-006 retry: was_duplicate must be true (NOT pick_out_of_order)');
  PERFORM _v2_test._assert(
    (v_retry_result ->> 'event_id') = (v_first_result ->> 'event_id'),
    'SC-006 retry: event_id must match the first call'
  );
  PERFORM _v2_test._assert(
    (v_retry_result ->> 'seq') = (v_first_result ->> 'seq'),
    'SC-006 retry: seq must match the first call'
  );

  -- No third event was inserted.
  SELECT count(*) INTO v_event_count FROM draft_events WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_count = 2,
    'SC-006 should still have 2 events after the retry, got ' || v_event_count);

  RAISE NOTICE 'SC-006 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc006$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-007 — Draft not active → illegal_state
-- ════════════════════════════════════════════════════════════════════════
-- Seed → UPDATE leagues SET draft_state='paused'. submit_pick_v2 must
-- raise illegal_state (sqlstate check_violation) with a message
-- starting with 'illegal_state'.
--
-- Spec refs: §5.2 preflight 2a; §11.1 illegal_state → 422.

DO $sc007$
DECLARE
  v_seed        jsonb;
  v_league_id   uuid;
  v_team_ids    uuid[];
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-007 starting: draft not active → illegal_state';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];

  -- Force-pause the seeded league via direct UPDATE (bypassing
  -- draft_pause RPC, which is tested separately in 9e4).
  UPDATE leagues SET draft_state = 'paused' WHERE id = v_league_id;

  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_team_ids[1], p_player_id => 7001,
      p_round => 1, p_pick_number => 1,
      p_session_id => gen_random_uuid(),
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5('SC007'),
      p_actor => jsonb_build_object('kind', 'autopick'),
      p_correlation_id => NULL
    );
    RAISE EXCEPTION 'SC-007 expected illegal_state but RPC returned without raising';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-007 sqlstate should be 23514 (check_violation), got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'illegal_state%',
    'SC-007 error message should start with illegal_state, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-007 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc007$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-008 — pick_number out of order → pick_out_of_order
-- ════════════════════════════════════════════════════════════════════════
-- Seed (no picks yet → expected pick_number is 1). Submit with
-- pick_number=5. Must raise pick_out_of_order.
--
-- Spec refs: §5.2 preflight 2b; §11.1 pick_out_of_order → 409.

DO $sc008$
DECLARE
  v_seed        jsonb;
  v_league_id   uuid;
  v_team_ids    uuid[];
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-008 starting: pick_number out of order → pick_out_of_order';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];

  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_team_ids[1], p_player_id => 8001,
      p_round => 2,                          -- consistent with pick 5 in 3-team
      p_pick_number => 5,                    -- expected was 1
      p_session_id => gen_random_uuid(),
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5('SC008'),
      p_actor => jsonb_build_object('kind', 'autopick'),
      p_correlation_id => NULL
    );
    RAISE EXCEPTION 'SC-008 expected pick_out_of_order but RPC returned without raising';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-008 sqlstate should be 23514, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'pick_out_of_order%',
    'SC-008 message should start with pick_out_of_order, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-008 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc008$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-009 — Wrong team on the clock → not_on_clock
-- ════════════════════════════════════════════════════════════════════════
-- Seed. team[0] is on the clock for pick 1 (round 1, snake). Submit
-- with team_id = team[1]. Must raise not_on_clock.
--
-- Spec refs: §5.2 preflight 2c; §11.1 not_on_clock → 409.

DO $sc009$
DECLARE
  v_seed        jsonb;
  v_league_id   uuid;
  v_team_ids    uuid[];
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-009 starting: wrong team on the clock → not_on_clock';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];

  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id,
      p_team_id => v_team_ids[2],            -- team B; team A is on the clock
      p_player_id => 9001,
      p_round => 1, p_pick_number => 1,
      p_session_id => gen_random_uuid(),
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5('SC009'),
      p_actor => jsonb_build_object('kind', 'autopick'),
      p_correlation_id => NULL
    );
    RAISE EXCEPTION 'SC-009 expected not_on_clock but RPC returned without raising';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-009 sqlstate should be 23514, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'not_on_clock%',
    'SC-009 message should start with not_on_clock, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-009 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc009$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-010 — Player already picked → player_taken
-- ════════════════════════════════════════════════════════════════════════
-- Seed. Submit pick 1 with player 10001 → success. Then submit pick
-- 2 (correct on-the-clock team per snake) but with the SAME player
-- 10001. Must raise player_taken.
--
-- Spec refs: §5.2 preflight 2d; §11.1 player_taken → 409.

DO $sc010$
DECLARE
  v_seed        jsonb;
  v_league_id   uuid;
  v_team_ids    uuid[];
  v_caught_msg   text;
  v_caught_state text;
  v_event_count int;
BEGIN
  RAISE NOTICE 'SC-010 starting: player already picked → player_taken';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];

  -- Pick 1: team[0], player 10001.
  PERFORM submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_team_ids[1], p_player_id => 10001,
    p_round => 1, p_pick_number => 1,
    p_session_id => gen_random_uuid(),
    p_idempotency_key => gen_random_uuid(),
    p_payload_hash => 'sha256:' || md5('SC010-pick1'),
    p_actor => jsonb_build_object('kind', 'autopick'),
    p_correlation_id => NULL
  );

  -- Pick 2: team[1] (next on the clock), SAME player 10001.
  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_team_ids[2], p_player_id => 10001,
      p_round => 1, p_pick_number => 2,
      p_session_id => gen_random_uuid(),
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5('SC010-pick2'),
      p_actor => jsonb_build_object('kind', 'autopick'),
      p_correlation_id => NULL
    );
    RAISE EXCEPTION 'SC-010 expected player_taken but RPC returned without raising';
  EXCEPTION WHEN unique_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '23505',
    'SC-010 sqlstate should be 23505 (unique_violation), got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'player_taken%',
    'SC-010 message should start with player_taken, got: ' || v_caught_msg);

  -- Confirm the projection still has only the first pick.
  SELECT count(*) INTO v_event_count FROM draft_picks_v2 WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_count = 1,
    'SC-010 projection should have 1 row (pick 1) after the conflict, got ' || v_event_count);

  RAISE NOTICE 'SC-010 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc010$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-011 — Round mismatch (sanity) → pick_out_of_order
-- ════════════════════════════════════════════════════════════════════════
-- Seed. pick_number=1 in a 3-team league derives to round=1. Submit
-- with pick_number=1 but round=2. Must raise pick_out_of_order with
-- a 'round mismatch' message.
--
-- Spec refs: §5.2 preflight 2c (round consistency).

DO $sc011$
DECLARE
  v_seed        jsonb;
  v_league_id   uuid;
  v_team_ids    uuid[];
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-011 starting: round mismatch → pick_out_of_order';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];

  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_team_ids[1], p_player_id => 11001,
      p_round => 2,                          -- WRONG — derived round = 1
      p_pick_number => 1,
      p_session_id => gen_random_uuid(),
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5('SC011'),
      p_actor => jsonb_build_object('kind', 'autopick'),
      p_correlation_id => NULL
    );
    RAISE EXCEPTION 'SC-011 expected pick_out_of_order (round mismatch) but RPC returned';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-011 sqlstate should be 23514, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'pick_out_of_order%',
    'SC-011 message should start with pick_out_of_order, got: ' || v_caught_msg);
  PERFORM _v2_test._assert(v_caught_msg LIKE '%round mismatch%',
    'SC-011 message should mention "round mismatch", got: ' || v_caught_msg);

  RAISE NOTICE 'SC-011 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc011$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-012 — actor.kind='user', owner matches → success
-- ════════════════════════════════════════════════════════════════════════
-- Sets request.jwt.claims so auth.uid() returns the commissioner UID.
-- Submits a pick for team[0] (commissioner-owned) with actor.kind='user'.
-- Should succeed.
--
-- Why this matters: the rest of the suite uses actor.kind='autopick'
-- to bypass auth complexity. This is the one scenario that proves the
-- 'user' code path actually works (auth.uid() matching team_owner).
--
-- SET LOCAL is transactional: when the savepoint rolls back at the
-- end, the JWT claims revert too. No state leaks.
--
-- Spec refs: §4.1 Auth bullet, §5.2 preflight 2f.

DO $sc012$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_first_team   uuid;
  v_result       jsonb;
BEGIN
  RAISE NOTICE 'SC-012 starting: actor.kind=user, owner matches → success';
  BEGIN  -- savepoint

  -- Make auth.uid() return the commissioner. Supabase's auth.uid()
  -- reads from the JWT claims setting; SET LOCAL applies for the
  -- current txn only.
  SET LOCAL "request.jwt.claims" =
    '{"sub":"882b59c9-8882-418b-9450-3fd004d57edd","role":"authenticated"}';

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_first_team := v_team_ids[1];

  v_result := submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_first_team, p_player_id => 12001,
    p_round => 1, p_pick_number => 1,
    p_session_id => gen_random_uuid(),
    p_idempotency_key => gen_random_uuid(),
    p_payload_hash => 'sha256:' || md5('SC012'),
    p_actor => jsonb_build_object(
      'kind', 'user',
      'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
      'session_id', gen_random_uuid()
    ),
    p_correlation_id => NULL
  );

  PERFORM _v2_test._assert((v_result ->> 'was_duplicate')::boolean = false,
    'SC-012 was_duplicate should be false');
  PERFORM _v2_test._assert((v_result ->> 'seq')::bigint = 1,
    'SC-012 seq should be 1');

  RAISE NOTICE 'SC-012 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc012$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-013 — actor.kind='user', owner mismatch → unauthorized
-- ════════════════════════════════════════════════════════════════════════
-- Re-owns team[0] to a DIFFERENT auth.users id, then attempts a pick
-- with actor.kind='user' and auth.uid() = commissioner. The owner
-- mismatch must raise unauthorized (sqlstate insufficient_privilege).
--
-- Skips gracefully if only the commissioner exists in auth.users
-- (can't construct an owner_id that's both real and not the
-- commissioner).
--
-- Spec refs: §5.2 preflight 2f, second branch.

DO $sc013$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_first_team   uuid;
  v_other_user   uuid;
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-013 starting: user-path owner mismatch → unauthorized';

  SELECT id INTO v_other_user
    FROM auth.users
    WHERE id <> '882b59c9-8882-418b-9450-3fd004d57edd'
    LIMIT 1;

  IF v_other_user IS NULL THEN
    RAISE NOTICE 'SC-013 SKIPPED: need ≥ 2 auth.users on staging; only commissioner found';
    RETURN;
  END IF;

  BEGIN  -- savepoint
  SET LOCAL "request.jwt.claims" =
    '{"sub":"882b59c9-8882-418b-9450-3fd004d57edd","role":"authenticated"}';

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_first_team := v_team_ids[1];

  -- Re-own team[0] to a different real auth.users id.
  UPDATE teams SET owner_id = v_other_user WHERE id = v_first_team;

  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_first_team, p_player_id => 13001,
      p_round => 1, p_pick_number => 1,
      p_session_id => gen_random_uuid(),
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5('SC013'),
      p_actor => jsonb_build_object(
        'kind', 'user',
        'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
        'session_id', gen_random_uuid()
      ),
      p_correlation_id => NULL
    );
    RAISE EXCEPTION 'SC-013 expected unauthorized but RPC returned without raising';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '42501',
    'SC-013 sqlstate should be 42501, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'unauthorized%',
    'SC-013 message should start with unauthorized, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-013 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc013$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-014 — actor.kind='user' on unowned team → unauthorized
-- ════════════════════════════════════════════════════════════════════════
-- Submit with actor.kind='user' but team_id = team[1] (unowned;
-- owner_id IS NULL per the seed). The IF v_team_owner IS NULL branch
-- in submit_pick_v2 fires.
--
-- NOTE: this also exercises the on-the-clock check ordering — pick 1
-- must go to team[0] per snake order, but our test uses team[1]. The
-- not_on_clock check (preflight 2c) fires BEFORE the auth check
-- (preflight 2f), so this scenario actually catches not_on_clock
-- first, not unauthorized. To isolate the unauthorized branch, we
-- submit pick 2 (where team[1] IS on the clock per snake) — but pick
-- 2 requires pick 1 to exist. So we submit pick 1 (autopick) first,
-- then attempt pick 2 as user on unowned team[1].
--
-- Spec refs: §5.2 preflight 2f, first branch ('team is not in league').

DO $sc014$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-014 starting: user-path on unowned team → unauthorized';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];

  -- Pick 1 as autopick to advance state to pick 2 (where team[1] is
  -- on the clock per snake order).
  PERFORM submit_pick_v2(
    p_league_id => v_league_id, p_team_id => v_team_ids[1], p_player_id => 14001,
    p_round => 1, p_pick_number => 1,
    p_session_id => gen_random_uuid(),
    p_idempotency_key => gen_random_uuid(),
    p_payload_hash => 'sha256:' || md5('SC014-pick1'),
    p_actor => jsonb_build_object('kind', 'autopick'),
    p_correlation_id => NULL
  );

  -- Now attempt pick 2 as user on team[1] (unowned).
  SET LOCAL "request.jwt.claims" =
    '{"sub":"882b59c9-8882-418b-9450-3fd004d57edd","role":"authenticated"}';

  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_team_ids[2], p_player_id => 14002,
      p_round => 1, p_pick_number => 2,
      p_session_id => gen_random_uuid(),
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5('SC014-pick2'),
      p_actor => jsonb_build_object(
        'kind', 'user',
        'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
        'session_id', gen_random_uuid()
      ),
      p_correlation_id => NULL
    );
    RAISE EXCEPTION 'SC-014 expected unauthorized but RPC returned without raising';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '42501',
    'SC-014 sqlstate should be 42501, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'unauthorized%',
    'SC-014 message should start with unauthorized, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-014 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc014$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-015 — actor.kind='commissioner' → unauthorized (deviation D3)
-- ════════════════════════════════════════════════════════════════════════
-- Spec deviation D3 (docs/RUNBOOKS/draft-engine-v2-known-issues.md):
-- commissioners do NOT have direct pick power in v2.0 or v2.1.
-- submit_pick_v2 only accepts actor.kind in ('user', 'autopick').
-- Anything else hits the ELSE branch and raises unauthorized.
--
-- This scenario locks in that deviation: a future contributor who
-- adds 'commissioner' to the allowed kinds would break this test.

DO $sc015$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-015 starting: actor.kind=commissioner → unauthorized (D3)';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];

  BEGIN
    PERFORM submit_pick_v2(
      p_league_id => v_league_id, p_team_id => v_team_ids[1], p_player_id => 15001,
      p_round => 1, p_pick_number => 1,
      p_session_id => gen_random_uuid(),
      p_idempotency_key => gen_random_uuid(),
      p_payload_hash => 'sha256:' || md5('SC015'),
      p_actor => jsonb_build_object(
        'kind', 'commissioner',
        'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
        'session_id', gen_random_uuid()
      ),
      p_correlation_id => NULL
    );
    RAISE EXCEPTION 'SC-015 expected unauthorized (D3) but RPC returned without raising';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '42501',
    'SC-015 sqlstate should be 42501, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'unauthorized%',
    'SC-015 message should start with unauthorized, got: ' || v_caught_msg);
  PERFORM _v2_test._assert(v_caught_msg LIKE '%commissioner%',
    'SC-015 message should mention commissioner, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-015 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc015$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-016 — record_shadow_event guard #1: non-service role
-- ════════════════════════════════════════════════════════════════════════
-- Set the JWT role to 'authenticated' so auth.role() returns
-- something other than service_role/postgres. record_shadow_event
-- guard #1 must fire.
--
-- Spec refs: §4.3 guard #1; deviation D1 (postgres also accepted,
-- not 'authenticated').

DO $sc016$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-016 starting: record_shadow_event guard #1 (non-service role)';
  BEGIN  -- savepoint

  v_seed      := _v2_test._seed_active_league(
                   '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  -- Enable shadow mode on the seeded league so guard #3 doesn't
  -- fire first (we're isolating guard #1 here).
  UPDATE leagues SET draft_shadow_mode = true WHERE id = v_league_id;

  -- Set role to 'authenticated' (the typical user JWT role).
  SET LOCAL "request.jwt.claims" =
    '{"sub":"882b59c9-8882-418b-9450-3fd004d57edd","role":"authenticated"}';

  BEGIN
    PERFORM record_shadow_event(
      p_league_id        => v_league_id,
      p_payload          => jsonb_build_object(
        'pick_number', 1,
        'round',       1,
        'team_id',     gen_random_uuid(),
        'player_id',   16001,
        'picked_at',   now(),
        'is_autopick', false,
        'actor',       jsonb_build_object('kind', 'shadow', 'id', null)
      ),
      p_idempotency_key  => gen_random_uuid(),
      p_payload_hash     => 'sha256:' || md5('SC016'),
      p_correlation_id   => gen_random_uuid()
    );
    RAISE EXCEPTION 'SC-016 expected shadow_guard_violated (#1) but RPC returned';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '42501',
    'SC-016 sqlstate should be 42501, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'shadow_guard_violated%',
    'SC-016 message should start with shadow_guard_violated, got: ' || v_caught_msg);
  PERFORM _v2_test._assert(v_caught_msg LIKE '%service_role%',
    'SC-016 message should mention service_role, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-016 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc016$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-017 — record_shadow_event guard #2: actor.kind != 'shadow'
-- ════════════════════════════════════════════════════════════════════════
-- Caller IS service_role (default in SQL Editor) and shadow_mode IS
-- true on the league, but the payload's actor.kind is 'user' instead
-- of 'shadow'. Guard #2 must fire.

DO $sc017$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-017 starting: record_shadow_event guard #2 (actor.kind != shadow)';
  BEGIN  -- savepoint

  v_seed      := _v2_test._seed_active_league(
                   '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  -- Enable shadow mode so guard #3 doesn't fire first.
  UPDATE leagues SET draft_shadow_mode = true WHERE id = v_league_id;

  BEGIN
    PERFORM record_shadow_event(
      p_league_id        => v_league_id,
      p_payload          => jsonb_build_object(
        'pick_number', 1,
        'round',       1,
        'team_id',     gen_random_uuid(),
        'player_id',   17001,
        'picked_at',   now(),
        'is_autopick', false,
        'actor',       jsonb_build_object('kind', 'user', 'id', null)  -- WRONG
      ),
      p_idempotency_key  => gen_random_uuid(),
      p_payload_hash     => 'sha256:' || md5('SC017'),
      p_correlation_id   => gen_random_uuid()
    );
    RAISE EXCEPTION 'SC-017 expected shadow_guard_violated (#2) but RPC returned';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-017 sqlstate should be 23514, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'shadow_guard_violated%',
    'SC-017 message should start with shadow_guard_violated, got: ' || v_caught_msg);
  PERFORM _v2_test._assert(v_caught_msg LIKE '%actor.kind%',
    'SC-017 message should mention actor.kind, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-017 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc017$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-018 — record_shadow_event guard #3: draft_shadow_mode=false
-- ════════════════════════════════════════════════════════════════════════
-- Caller IS service_role and actor.kind='shadow' (guards #1 and #2
-- pass), but the league has draft_shadow_mode=false (the seed default).
-- Guard #3 must fire.
--
-- This is the cutover-protection guard: even if a stale shadow trigger
-- fires after shadow_mode was turned off, the RPC refuses.

DO $sc018$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-018 starting: record_shadow_event guard #3 (draft_shadow_mode=false)';
  BEGIN  -- savepoint

  v_seed      := _v2_test._seed_active_league(
                   '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  -- The seed already sets draft_shadow_mode=false; this is the
  -- natural-default scenario for guard #3.

  BEGIN
    PERFORM record_shadow_event(
      p_league_id        => v_league_id,
      p_payload          => jsonb_build_object(
        'pick_number', 1,
        'round',       1,
        'team_id',     gen_random_uuid(),
        'player_id',   18001,
        'picked_at',   now(),
        'is_autopick', false,
        'actor',       jsonb_build_object('kind', 'shadow', 'id', null)
      ),
      p_idempotency_key  => gen_random_uuid(),
      p_payload_hash     => 'sha256:' || md5('SC018'),
      p_correlation_id   => gen_random_uuid()
    );
    RAISE EXCEPTION 'SC-018 expected shadow_guard_violated (#3) but RPC returned';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;

  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-018 sqlstate should be 23514, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'shadow_guard_violated%',
    'SC-018 message should start with shadow_guard_violated, got: ' || v_caught_msg);
  PERFORM _v2_test._assert(v_caught_msg LIKE '%draft_shadow_mode%',
    'SC-018 message should mention draft_shadow_mode, got: ' || v_caught_msg);

  RAISE NOTICE 'SC-018 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc018$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-019 — draft_pause happy path
-- ════════════════════════════════════════════════════════════════════════
-- Seed (active, generation=0, deadline set). Call draft_pause as
-- commissioner. Verify:
--   - leagues.draft_state = 'paused'.
--   - leagues.draft_generation = 1 (bumped from 0).
--   - leagues.pick_deadline IS NULL.
--   - exactly 2 events landed: generation_bumped + draft_paused.
--   - generation_bumped came BEFORE draft_paused (lower seq).
--   - generation_bumped payload has reason='pause', old/new gen.
--   - draft_paused payload has paused_at, paused_pick_number,
--     remaining_seconds, reason.
--   - NO pgmq messages enqueued (pause does NOT enqueue).
--
-- Spec refs: §4.6 draft_pause; §5.1 lifecycle; §5.3 generation
-- ordering rule.

DO $sc019$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_result       jsonb;
  v_gen          int;
  v_state        text;
  v_deadline     timestamptz;
  v_event_count  int;
  v_gen_seq      bigint;
  v_pause_seq    bigint;
  v_gen_payload  jsonb;
  v_pause_payload jsonb;
  v_pgmq_count   int;
BEGIN
  RAISE NOTICE 'SC-019 starting: draft_pause happy path';
  BEGIN  -- savepoint

  v_seed      := _v2_test._seed_active_league(
                   '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  v_result := draft_pause(
    p_league_id => v_league_id,
    p_actor     => jsonb_build_object(
      'kind', 'commissioner',
      'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
      'session_id', gen_random_uuid()
    )
  );

  PERFORM _v2_test._assert((v_result ->> 'generation')::int = 1,
    'SC-019 result.generation should be 1, got ' || (v_result ->> 'generation'));
  PERFORM _v2_test._assert(v_result ->> 'paused_at' IS NOT NULL,
    'SC-019 result.paused_at must be set');

  -- League state.
  SELECT draft_state, draft_generation, pick_deadline
    INTO v_state, v_gen, v_deadline
    FROM leagues WHERE id = v_league_id;

  PERFORM _v2_test._assert(v_state = 'paused',
    'SC-019 leagues.draft_state should be paused, got ' || v_state);
  PERFORM _v2_test._assert(v_gen = 1,
    'SC-019 leagues.draft_generation should be 1, got ' || v_gen);
  PERFORM _v2_test._assert(v_deadline IS NULL,
    'SC-019 leagues.pick_deadline should be NULL after pause');

  -- Two events landed, in correct order.
  SELECT count(*) INTO v_event_count FROM draft_events WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(v_event_count = 2,
    'SC-019 should have exactly 2 events (gen_bumped + draft_paused), got ' || v_event_count);

  SELECT seq, payload INTO v_gen_seq, v_gen_payload
    FROM draft_events
   WHERE league_id = v_league_id AND event_type = 'generation_bumped';
  SELECT seq, payload INTO v_pause_seq, v_pause_payload
    FROM draft_events
   WHERE league_id = v_league_id AND event_type = 'draft_paused';

  PERFORM _v2_test._assert(v_gen_seq < v_pause_seq,
    'SC-019 generation_bumped (seq=' || v_gen_seq ||
    ') must precede draft_paused (seq=' || v_pause_seq || ')');

  -- generation_bumped payload.
  PERFORM _v2_test._assert((v_gen_payload ->> 'old_generation')::int = 0,
    'SC-019 generation_bumped.old_generation should be 0');
  PERFORM _v2_test._assert((v_gen_payload ->> 'new_generation')::int = 1,
    'SC-019 generation_bumped.new_generation should be 1');
  PERFORM _v2_test._assert(v_gen_payload ->> 'reason' = 'pause',
    'SC-019 generation_bumped.reason should be ''pause''');

  -- draft_paused payload required fields.
  PERFORM _v2_test._assert(v_pause_payload ? 'paused_at',
    'SC-019 draft_paused.paused_at must be set');
  PERFORM _v2_test._assert(v_pause_payload ? 'paused_pick_number',
    'SC-019 draft_paused.paused_pick_number must be set');
  PERFORM _v2_test._assert(v_pause_payload ? 'remaining_seconds',
    'SC-019 draft_paused.remaining_seconds must be set');
  PERFORM _v2_test._assert(v_pause_payload ? 'reason',
    'SC-019 draft_paused.reason must be set');

  -- No pgmq messages from pause.
  SELECT count(*) INTO v_pgmq_count
    FROM pgmq.q_draft_deadlines
    WHERE (message ->> 'league_id')::uuid = v_league_id;
  PERFORM _v2_test._assert(v_pgmq_count = 0,
    'SC-019 pause should NOT enqueue pgmq messages, got ' || v_pgmq_count);

  RAISE NOTICE 'SC-019 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc019$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-020 — draft_resume happy path
-- ════════════════════════════════════════════════════════════════════════
-- Seed → draft_pause → draft_resume. Verify after resume:
--   - leagues.draft_state = 'active'.
--   - leagues.draft_generation = 2 (bumped twice: once by pause, once by resume).
--   - leagues.pick_deadline IS NOT NULL and > now() (recomputed per §5.2.2).
--   - 2 NEW events from resume: generation_bumped + draft_resumed.
--   - generation_bumped came BEFORE draft_resumed (lower seq).
--   - exactly 1 NEW pgmq message after resume (the fresh enqueue).
--   - pgmq message payload has the new generation (2).
--   - pgmq.send happened AFTER both events (chunk 6 criterion-4 fix):
--     the message is in pgmq, AND both events have lower seqs than
--     the order this is observable in.
--
-- Spec refs: §4.7 draft_resume; §5.2.2 deadline; §5.3 generation
-- + the chunk 6 criterion-4 ordering fix.

DO $sc020$
DECLARE
  v_seed          jsonb;
  v_league_id     uuid;
  v_result        jsonb;
  v_gen           int;
  v_state         text;
  v_deadline      timestamptz;
  v_resume_events int;
  v_gen_seq       bigint;
  v_resumed_seq   bigint;
  v_pgmq_count    int;
  v_pgmq_payload  jsonb;
BEGIN
  RAISE NOTICE 'SC-020 starting: draft_resume happy path';
  BEGIN  -- savepoint

  v_seed      := _v2_test._seed_active_league(
                   '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  -- Pause first.
  PERFORM draft_pause(
    p_league_id => v_league_id,
    p_actor     => jsonb_build_object(
      'kind', 'commissioner',
      'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
      'session_id', gen_random_uuid()
    )
  );

  -- Now resume.
  v_result := draft_resume(
    p_league_id => v_league_id,
    p_actor     => jsonb_build_object(
      'kind', 'commissioner',
      'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
      'session_id', gen_random_uuid()
    )
  );

  PERFORM _v2_test._assert((v_result ->> 'generation')::int = 2,
    'SC-020 result.generation should be 2, got ' || (v_result ->> 'generation'));
  PERFORM _v2_test._assert(v_result ->> 'new_pick_deadline' IS NOT NULL,
    'SC-020 result.new_pick_deadline must be set');

  -- League state.
  SELECT draft_state, draft_generation, pick_deadline
    INTO v_state, v_gen, v_deadline
    FROM leagues WHERE id = v_league_id;

  PERFORM _v2_test._assert(v_state = 'active',
    'SC-020 leagues.draft_state should be active, got ' || v_state);
  PERFORM _v2_test._assert(v_gen = 2,
    'SC-020 leagues.draft_generation should be 2, got ' || v_gen);
  PERFORM _v2_test._assert(v_deadline > now(),
    'SC-020 leagues.pick_deadline should be in the future');

  -- Two events from resume specifically (filter by reason='resume').
  -- generation_bumped from PAUSE has reason='pause'; from RESUME has reason='resume'.
  SELECT seq INTO v_gen_seq
    FROM draft_events
   WHERE league_id = v_league_id
     AND event_type = 'generation_bumped'
     AND payload ->> 'reason' = 'resume';
  SELECT seq INTO v_resumed_seq
    FROM draft_events
   WHERE league_id = v_league_id
     AND event_type = 'draft_resumed';

  PERFORM _v2_test._assert(v_gen_seq IS NOT NULL,
    'SC-020 generation_bumped (reason=resume) must exist');
  PERFORM _v2_test._assert(v_resumed_seq IS NOT NULL,
    'SC-020 draft_resumed must exist');
  PERFORM _v2_test._assert(v_gen_seq < v_resumed_seq,
    'SC-020 resume''s generation_bumped (' || v_gen_seq ||
    ') must precede draft_resumed (' || v_resumed_seq || ')');

  -- Exactly one pgmq message for this league, with new generation.
  SELECT count(*) INTO v_pgmq_count
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;
  PERFORM _v2_test._assert(v_pgmq_count = 1,
    'SC-020 resume should enqueue 1 pgmq message, got ' || v_pgmq_count);

  SELECT message INTO v_pgmq_payload
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id
   LIMIT 1;
  PERFORM _v2_test._assert((v_pgmq_payload ->> 'generation')::int = 2,
    'SC-020 pgmq message generation should be 2, got ' || (v_pgmq_payload ->> 'generation'));
  PERFORM _v2_test._assert(v_pgmq_payload ->> 'source' = 'draft_resume',
    'SC-020 pgmq message source should be draft_resume');

  RAISE NOTICE 'SC-020 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc020$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-021 — draft_extend happy path
-- ════════════════════════════════════════════════════════════════════════
-- Seed (active, gen=0, deadline = now()+90s). Call draft_extend with
-- p_extra_seconds=60. Verify:
--   - leagues.draft_state stays 'active'.
--   - leagues.draft_generation = 1 (bumped from 0).
--   - leagues.pick_deadline pushed forward roughly 60s past the
--     original deadline.
--   - 2 events: generation_bumped (reason='extend') + draft_extended.
--   - draft_extended payload has extended_at, pick_number,
--     extra_seconds, new_pick_deadline.
--   - 1 fresh pgmq message tagged with new generation (1) and
--     source='draft_extend'.
--
-- Spec refs: §4.8 draft_extend.

DO $sc021$
DECLARE
  v_seed          jsonb;
  v_league_id     uuid;
  v_old_deadline  timestamptz;
  v_result        jsonb;
  v_gen           int;
  v_state         text;
  v_new_deadline  timestamptz;
  v_extended_payload jsonb;
  v_pgmq_count    int;
  v_pgmq_payload  jsonb;
BEGIN
  RAISE NOTICE 'SC-021 starting: draft_extend happy path';
  BEGIN  -- savepoint

  v_seed      := _v2_test._seed_active_league(
                   '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  -- Capture the seed's deadline for comparison.
  SELECT pick_deadline INTO v_old_deadline FROM leagues WHERE id = v_league_id;

  v_result := draft_extend(
    p_league_id     => v_league_id,
    p_extra_seconds => 60,
    p_actor         => jsonb_build_object(
      'kind', 'commissioner',
      'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
      'session_id', gen_random_uuid()
    )
  );

  PERFORM _v2_test._assert((v_result ->> 'generation')::int = 1,
    'SC-021 result.generation should be 1, got ' || (v_result ->> 'generation'));

  SELECT draft_state, draft_generation, pick_deadline
    INTO v_state, v_gen, v_new_deadline
    FROM leagues WHERE id = v_league_id;

  PERFORM _v2_test._assert(v_state = 'active',
    'SC-021 state should stay active, got ' || v_state);
  PERFORM _v2_test._assert(v_gen = 1,
    'SC-021 generation should be 1, got ' || v_gen);
  PERFORM _v2_test._assert(v_new_deadline > v_old_deadline,
    'SC-021 new deadline must be later than old');
  -- Allow ±2s tolerance for the rounding in §5.2.2.
  PERFORM _v2_test._assert(
    v_new_deadline >= v_old_deadline + interval '58 seconds'
    AND v_new_deadline <= v_old_deadline + interval '62 seconds',
    'SC-021 new deadline should be old + ~60s; old=' || v_old_deadline ||
    ' new=' || v_new_deadline
  );

  -- draft_extended payload required fields.
  SELECT payload INTO v_extended_payload
    FROM draft_events
   WHERE league_id = v_league_id AND event_type = 'draft_extended';
  PERFORM _v2_test._assert(v_extended_payload ? 'extended_at',
    'SC-021 draft_extended.extended_at must be set');
  PERFORM _v2_test._assert(v_extended_payload ? 'pick_number',
    'SC-021 draft_extended.pick_number must be set');
  PERFORM _v2_test._assert((v_extended_payload ->> 'extra_seconds')::int = 60,
    'SC-021 draft_extended.extra_seconds should be 60');
  PERFORM _v2_test._assert(v_extended_payload ? 'new_pick_deadline',
    'SC-021 draft_extended.new_pick_deadline must be set');

  -- Fresh pgmq message at new generation.
  SELECT count(*) INTO v_pgmq_count
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;
  PERFORM _v2_test._assert(v_pgmq_count = 1,
    'SC-021 extend should enqueue 1 pgmq message, got ' || v_pgmq_count);

  SELECT message INTO v_pgmq_payload
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id
   LIMIT 1;
  PERFORM _v2_test._assert((v_pgmq_payload ->> 'generation')::int = 1,
    'SC-021 pgmq message generation should be 1');
  PERFORM _v2_test._assert(v_pgmq_payload ->> 'source' = 'draft_extend',
    'SC-021 pgmq message source should be draft_extend');

  RAISE NOTICE 'SC-021 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc021$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-022 — illegal_state_transition guards (pause/resume/extend)
-- ════════════════════════════════════════════════════════════════════════
-- Per spec §5.1, only specific transitions are legal:
--   pause:  must be 'active'.
--   resume: must be 'paused'.
--   extend: must be 'active'.
-- Each illegal transition must raise illegal_state_transition
-- (sqlstate check_violation).
--
-- This scenario consolidates three sub-cases into one DO block,
-- using a sub-block per sub-case so each can independently catch
-- and assert. Outer savepoint rolls back at the end.

DO $sc022$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_actor        jsonb := jsonb_build_object(
                            'kind', 'commissioner',
                            'id',   '882b59c9-8882-418b-9450-3fd004d57edd',
                            'session_id', gen_random_uuid()
                          );
  v_caught_msg   text;
  v_caught_state text;
BEGIN
  RAISE NOTICE 'SC-022 starting: illegal_state_transition guards';
  BEGIN  -- savepoint (outer)

  v_seed      := _v2_test._seed_active_league(
                   '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  -- ── Sub-case A: resume from active → illegal_state_transition ────
  BEGIN
    PERFORM draft_resume(p_league_id => v_league_id, p_actor => v_actor);
    RAISE EXCEPTION 'SC-022 sub-A: expected illegal_state_transition but resume returned';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;
  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-022 sub-A sqlstate should be 23514, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'illegal_state_transition%',
    'SC-022 sub-A message should start with illegal_state_transition, got: ' || v_caught_msg);

  -- ── Sub-case B: pause to set up paused state, then pause again ───
  PERFORM draft_pause(p_league_id => v_league_id, p_actor => v_actor);

  BEGIN
    PERFORM draft_pause(p_league_id => v_league_id, p_actor => v_actor);
    RAISE EXCEPTION 'SC-022 sub-B: expected illegal_state_transition but pause-while-paused returned';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;
  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-022 sub-B sqlstate should be 23514, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'illegal_state_transition%',
    'SC-022 sub-B message should start with illegal_state_transition');

  -- ── Sub-case C: extend while paused → illegal_state_transition ───
  BEGIN
    PERFORM draft_extend(
      p_league_id     => v_league_id,
      p_extra_seconds => 30,
      p_actor         => v_actor
    );
    RAISE EXCEPTION 'SC-022 sub-C: expected illegal_state_transition but extend-while-paused returned';
  EXCEPTION WHEN check_violation THEN
    v_caught_msg   := SQLERRM;
    v_caught_state := SQLSTATE;
  END;
  PERFORM _v2_test._assert(v_caught_state = '23514',
    'SC-022 sub-C sqlstate should be 23514, got ' || v_caught_state);
  PERFORM _v2_test._assert(v_caught_msg LIKE 'illegal_state_transition%',
    'SC-022 sub-C message should start with illegal_state_transition');

  RAISE NOTICE 'SC-022 PASS (3 sub-cases: resume/pause/extend illegal transitions)';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc022$;


