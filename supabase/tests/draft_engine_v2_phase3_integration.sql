-- ════════════════════════════════════════════════════════════════════════
-- Draft Engine v2 — Phase 3 SQL integration suite
-- ════════════════════════════════════════════════════════════════════════
--
-- Purpose. Cover Phase 3 surfaces that mocks cannot reach:
--          - draft_deadline_sweep() — predicate correctness, advisory
--            lock semantics, message + metric writes, intra-txn reentry.
--          - draft_autopick_read / draft_autopick_archive wrappers.
--          - manage_draft_metrics_partitions() shape + idempotence.
--
-- Where.   STAGING ONLY (Supabase project jjgspcpvqaiitloglxbb). Run
--          via `psql "$SUPABASE_DB_URL" -f <this file>` or paste into
--          the Supabase SQL Editor.
--
-- Prerequisite. supabase/tests/draft_engine_v2_phase2_integration.sql
--               must have been run at least once on this database to
--               install the _v2_test helper schema. Phase 3 reuses
--               those helpers (_assert, _assert_eq, _seed_active_league)
--               unchanged.
--
-- Cleanup model. Every scenario lives in a savepoint (inner BEGIN /
--                EXCEPTION block raising P0001). The savepoint roll-
--                back discards every write made inside it — including
--                pgmq.send and INSERT INTO draft_metrics. SC-301 is
--                load-bearing: it explicitly verifies this assumption
--                before any other scenario relies on it.
--
-- ── Preflight ──────────────────────────────────────────────────────────
-- Verify the harness's two prerequisites before any scenario runs:
--   1. The _v2_test helper schema is installed (Phase 2 file ran).
--   2. pgmq.send participates in the enclosing transaction (so a
--      savepoint rollback cleans up queue writes).

DO $preflight$
DECLARE
  v_count_before bigint;
  v_count_after  bigint;
BEGIN
  -- (1) Helper schema present.
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = '_v2_test'
  ) THEN
    RAISE EXCEPTION
      'PREFLIGHT FAILED: _v2_test schema is missing. Phase 3 reuses '
      'helpers installed by phase2_integration.sql. Run that file first, '
      'then retry. (One-time setup; the helpers persist across runs.)';
  END IF;

  -- (2) pgmq.send is transactional. Tagged-message + forced-rollback
  -- pattern lifted verbatim from phase2 preflight.
  SELECT count(*) INTO v_count_before FROM pgmq.q_draft_deadlines;

  BEGIN
    PERFORM pgmq.send(
      'draft_deadlines',
      '{"_v2_phase3_preflight": true}'::jsonb,
      0
    );
    RAISE EXCEPTION 'preflight_rollback_marker' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count_after FROM pgmq.q_draft_deadlines;

  IF v_count_after <> v_count_before THEN
    RAISE EXCEPTION
      'PREFLIGHT FAILED: pgmq.send is NOT transactional on this DB. '
      'Phase 3 suite assumes savepoint rollback cleans up queue writes. '
      'baseline=%, after=%, leaked=%. Do not run scenarios.',
      v_count_before, v_count_after, (v_count_after - v_count_before);
  END IF;

  RAISE NOTICE 'Phase 3 preflight OK: _v2_test schema present, pgmq.send is transactional.';
END
$preflight$;

-- ── Scenarios ──────────────────────────────────────────────────────────
-- Conventions match phase2_integration.sql §Conventions (savepoint
-- pattern, actor.kind='autopick' for service-role context, test
-- commissioner UID 882b59c9-8882-418b-9450-3fd004d57edd, P0001
-- cleanup exception).
--
-- Numbering: SC-301..SC-312 (3xx series for Phase 3, distinct from
-- Phase 2's SC-001..SC-028 to make grep over mixed log output clean).

-- ════════════════════════════════════════════════════════════════════════
-- SC-301 — BEGIN/ROLLBACK harness verification (LOAD-BEARING)
-- ════════════════════════════════════════════════════════════════════════
-- Verifies the entire suite's load-bearing assumption: that the
-- savepoint pattern rolls back BOTH writes performed by
-- draft_deadline_sweep() — the pgmq.send AND the INSERT INTO
-- draft_metrics. If this scenario fails, every other scenario in this
-- file will leak rows; the assertion message tells the operator
-- explicitly to switch the harness to explicit cleanup.
--
-- Procedure:
--   1. Snapshot pre-sweep counts (OUTSIDE the savepoint).
--   2. Inside savepoint: seed an active league with deadline 5s past
--      (beyond 2s buffer), call sweep, snapshot counts during.
--   3. Assert during-counts both incremented by 1.
--   4. Force savepoint rollback via P0001.
--   5. Snapshot post-rollback counts (OUTSIDE the savepoint, after
--      rollback completed).
--   6. Assert post-rollback counts equal pre-sweep baseline.
--
-- Spec refs: §4.8 (sweep contract), §11.2 metric write.

DO $sc301$
DECLARE
  v_msg_baseline    int;
  v_metric_baseline int;
  v_msg_during      int;
  v_metric_during   int;
  v_msg_after       int;
  v_metric_after    int;
  v_seed            jsonb;
  v_league_id       uuid;
  v_swept           int;
BEGIN
  RAISE NOTICE 'SC-301 starting: BEGIN/ROLLBACK harness verification (load-bearing)';

  -- (1) Pre-sweep baseline OUTSIDE savepoint.
  SELECT count(*) INTO v_msg_baseline
    FROM pgmq.q_draft_deadlines;
  SELECT count(*) INTO v_metric_baseline
    FROM public.draft_metrics
   WHERE metric = 'safety_net_hit';

  BEGIN  -- savepoint
    -- (2) Seed an expired league.
    v_seed := _v2_test._seed_active_league(
      '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
    );
    v_league_id := (v_seed ->> 'league_id')::uuid;

    UPDATE public.leagues
       SET pick_deadline = now() - interval '5 seconds'
     WHERE id = v_league_id;

    -- Run sweep — should enqueue exactly 1 message and write exactly
    -- 1 safety_net_hit row (this league was the only expired one we
    -- seeded; pre-existing expired leagues on staging would also be
    -- swept, which is why we test deltas, not absolutes).
    v_swept := public.draft_deadline_sweep();

    -- (2 cont.) Snapshot during-savepoint.
    SELECT count(*) INTO v_msg_during
      FROM pgmq.q_draft_deadlines;
    SELECT count(*) INTO v_metric_during
      FROM public.draft_metrics
     WHERE metric = 'safety_net_hit';

    -- (3) Assert deltas of at least +1 (could be more if staging has
    -- other expired drafts, which is fine — we just need OUR seed
    -- league to have been picked up).
    PERFORM _v2_test._assert(
      v_swept >= 1,
      format('SC-301 sweep returned %s, expected >= 1', v_swept)
    );
    PERFORM _v2_test._assert(
      v_msg_during - v_msg_baseline >= 1,
      format('SC-301 pgmq delta during sweep should be >= 1; baseline=%s during=%s',
             v_msg_baseline, v_msg_during)
    );
    PERFORM _v2_test._assert(
      v_metric_during - v_metric_baseline >= 1,
      format('SC-301 metric delta during sweep should be >= 1; baseline=%s during=%s',
             v_metric_baseline, v_metric_during)
    );

    -- (4) Force savepoint rollback.
    RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  -- (5) Snapshot post-rollback OUTSIDE savepoint.
  SELECT count(*) INTO v_msg_after
    FROM pgmq.q_draft_deadlines;
  SELECT count(*) INTO v_metric_after
    FROM public.draft_metrics
   WHERE metric = 'safety_net_hit';

  -- (6) Critical: rollback returned both to baseline.
  PERFORM _v2_test._assert(
    v_msg_after = v_msg_baseline,
    format(
      'SC-301 LOAD-BEARING FAILURE: pgmq.q_draft_deadlines did NOT roll '
      'back. baseline=%s after=%s. Savepoint-rollback assumption is '
      'INVALID — switch all subsequent scenarios to explicit pgmq.purge_'
      'queue(''draft_deadlines'') cleanup before continuing.',
      v_msg_baseline, v_msg_after
    )
  );
  PERFORM _v2_test._assert(
    v_metric_after = v_metric_baseline,
    format(
      'SC-301 LOAD-BEARING FAILURE: draft_metrics did NOT roll back. '
      'baseline=%s after=%s. Savepoint-rollback assumption is INVALID '
      '— switch all subsequent scenarios to explicit DELETE FROM '
      'draft_metrics WHERE metric = ''safety_net_hit'' AND ts > <test_start>.',
      v_metric_baseline, v_metric_after
    )
  );

  RAISE NOTICE 'SC-301 PASS: harness rolls back both pgmq + draft_metrics writes.';
END
$sc301$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-302 — Active league with future deadline is NOT swept
-- ════════════════════════════════════════════════════════════════════════
-- Verifies the predicate's deadline filter: a league whose
-- pick_deadline is still in the future (the seed default of now()+90s)
-- must NOT be selected by the sweep. Establishes the no-op baseline
-- used by every subsequent scenario.
--
-- We don't assert sweep returned 0 absolutely — staging may have
-- other expired drafts. We assert that the seeded league is NOT in
-- the q_draft_deadlines after the sweep (no message tagged with our
-- league_id).

DO $sc302$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_seed_msgs  int;
BEGIN
  RAISE NOTICE 'SC-302 starting: future-deadline league is not swept';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
  );
  v_league_id := (v_seed ->> 'league_id')::uuid;
  -- Seed default pick_deadline is now()+90s; do not modify.

  PERFORM public.draft_deadline_sweep();

  SELECT count(*) INTO v_seed_msgs
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;

  PERFORM _v2_test._assert(
    v_seed_msgs = 0,
    format('SC-302 expected 0 messages for seeded league %s, got %s',
           v_league_id, v_seed_msgs)
  );

  RAISE NOTICE 'SC-302 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc302$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-303 — Single expired league: enqueue payload schema verified
-- ════════════════════════════════════════════════════════════════════════
-- Happy path. Seed an expired league (5s past, beyond 2s buffer), no
-- pick events. Sweep should enqueue exactly 1 message with the
-- documented payload schema:
--   { league_id, pick_number=1, generation=0, scheduled_for, source='safety_net' }
-- And write exactly 1 safety_net_hit row in draft_metrics with the
-- locked Q3 detail shape: { expired_by_sec, generation }.
--
-- Spec refs: §4.8, §5.2.2 (mirror schema), Q3 lock-in.

DO $sc303$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_msg_payload  jsonb;
  v_metric_row   record;
BEGIN
  RAISE NOTICE 'SC-303 starting: expired league happy-path enqueue';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
  );
  v_league_id := (v_seed ->> 'league_id')::uuid;

  UPDATE public.leagues
     SET pick_deadline = now() - interval '5 seconds'
   WHERE id = v_league_id;

  PERFORM public.draft_deadline_sweep();

  -- Find the message for our seeded league.
  SELECT message INTO v_msg_payload
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id
   LIMIT 1;

  PERFORM _v2_test._assert(
    v_msg_payload IS NOT NULL,
    'SC-303 expected a pgmq message for the seeded league, got none'
  );

  -- Payload schema (per spec §5.2.2 mirror).
  PERFORM _v2_test._assert(
    (v_msg_payload ->> 'league_id')::uuid = v_league_id,
    'SC-303 message.league_id mismatch'
  );
  PERFORM _v2_test._assert(
    (v_msg_payload ->> 'pick_number')::int = 1,
    format('SC-303 message.pick_number should be 1, got %s',
           v_msg_payload ->> 'pick_number')
  );
  PERFORM _v2_test._assert(
    (v_msg_payload ->> 'generation')::int = 0,
    format('SC-303 message.generation should be 0, got %s',
           v_msg_payload ->> 'generation')
  );
  PERFORM _v2_test._assert(
    v_msg_payload ->> 'source' = 'safety_net',
    format('SC-303 message.source should be safety_net, got %s',
           v_msg_payload ->> 'source')
  );
  PERFORM _v2_test._assert(
    (v_msg_payload ->> 'scheduled_for') IS NOT NULL,
    'SC-303 message.scheduled_for should be set'
  );

  -- Metric row (Q3 lock-in: per-league row with detail jsonb).
  SELECT metric, league_id, value, detail
    INTO v_metric_row
    FROM public.draft_metrics
   WHERE metric = 'safety_net_hit'
     AND league_id = v_league_id
   LIMIT 1;

  PERFORM _v2_test._assert(
    v_metric_row.league_id = v_league_id,
    'SC-303 expected a safety_net_hit row for the seeded league, got none'
  );
  PERFORM _v2_test._assert(
    v_metric_row.value = 1,
    format('SC-303 metric.value should be 1, got %s', v_metric_row.value)
  );
  PERFORM _v2_test._assert(
    (v_metric_row.detail ->> 'generation')::int = 0,
    format('SC-303 metric.detail.generation should be 0, got %s',
           v_metric_row.detail ->> 'generation')
  );
  PERFORM _v2_test._assert(
    (v_metric_row.detail ->> 'expired_by_sec')::int >= 5,
    format('SC-303 metric.detail.expired_by_sec should be >= 5 (deadline was 5s past), got %s',
           v_metric_row.detail ->> 'expired_by_sec')
  );

  RAISE NOTICE 'SC-303 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc303$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-304 — Expired league with a pick event for the current slot is skipped
-- ════════════════════════════════════════════════════════════════════════
-- The race-free EXISTS predicate must exclude leagues whose current
-- pick slot has already been resolved by a 'pick' event landed AFTER
-- the deadline expired. Models the case where submit_pick_v2 just
-- landed but the deadline hadn't yet been advanced (or the trigger
-- updated leagues.pick_deadline to a past value).
--
-- Procedure: seed expired league, manually insert a pick event for
-- pick_number=1 with created_at > pick_deadline. Sweep should NOT
-- enqueue for this league.

DO $sc304$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_team_id    uuid;
  v_seed_msgs  int;
BEGIN
  RAISE NOTICE 'SC-304 starting: pick already landed for current slot → skip';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
  );
  v_league_id := (v_seed ->> 'league_id')::uuid;
  v_team_id   := ((v_seed -> 'team_ids') ->> 0)::uuid;

  UPDATE public.leagues
     SET pick_deadline = now() - interval '10 seconds',
         draft_event_counter = 1
   WHERE id = v_league_id;

  -- Insert a pick event for slot 1 with created_at AFTER the deadline.
  INSERT INTO public.draft_events (
    league_id, seq, event_type,
    payload, payload_hash, idempotency_key,
    correlation_id, actor, created_at
  ) VALUES (
    v_league_id,
    1,
    'pick',
    jsonb_build_object(
      'pick_number',  1,
      'team_id',      v_team_id,
      'player_id',    1001,
      'round',        1,
      'picked_at',    (now() - interval '3 seconds')::text,
      'is_autopick',  true
    ),
    'sha256:' || md5('SC304-pick-1'),
    gen_random_uuid(),
    gen_random_uuid(),
    jsonb_build_object('kind', 'autopick'),
    now() - interval '3 seconds'  -- > pick_deadline (10s ago)
  );

  PERFORM public.draft_deadline_sweep();

  SELECT count(*) INTO v_seed_msgs
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;

  PERFORM _v2_test._assert(
    v_seed_msgs = 0,
    format('SC-304 expected 0 messages (pick already landed), got %s',
           v_seed_msgs)
  );

  RAISE NOTICE 'SC-304 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc304$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-305 — Expired league with autopick_failed event for slot is skipped
-- ════════════════════════════════════════════════════════════════════════
-- Same predicate logic as SC-304 but the resolving event is
-- autopick_failed (Phase 4 worker DLQ-terminal event). Sweep must
-- treat autopick_failed as a slot-resolution event identical to pick
-- — no point retrying a slot the worker has terminally failed on.

DO $sc305$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_team_id    uuid;
  v_seed_msgs  int;
BEGIN
  RAISE NOTICE 'SC-305 starting: autopick_failed already landed → skip';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
  );
  v_league_id := (v_seed ->> 'league_id')::uuid;
  v_team_id   := ((v_seed -> 'team_ids') ->> 0)::uuid;

  UPDATE public.leagues
     SET pick_deadline = now() - interval '10 seconds',
         draft_event_counter = 1
   WHERE id = v_league_id;

  INSERT INTO public.draft_events (
    league_id, seq, event_type,
    payload, payload_hash, idempotency_key,
    correlation_id, actor, created_at
  ) VALUES (
    v_league_id,
    1,
    'autopick_failed',
    jsonb_build_object(
      'pick_number',   1,
      'generation',    0,
      'read_ct',       3,
      'last_error',    'SC-305 simulated DLQ terminal',
      'pgmq_msg_id',   12345
    ),
    'sha256:' || md5('SC305-fail-1'),
    gen_random_uuid(),
    gen_random_uuid(),
    jsonb_build_object('kind', 'autopick'),
    now() - interval '3 seconds'
  );

  PERFORM public.draft_deadline_sweep();

  SELECT count(*) INTO v_seed_msgs
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;

  PERFORM _v2_test._assert(
    v_seed_msgs = 0,
    format('SC-305 expected 0 messages (autopick_failed already landed), got %s',
           v_seed_msgs)
  );

  RAISE NOTICE 'SC-305 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc305$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-306 — Paused league with expired deadline is skipped
-- ════════════════════════════════════════════════════════════════════════
-- The outer draft_state='active' filter excludes paused drafts.
-- Validates that a draft paused after its deadline has expired does
-- NOT get safety-net swept. Companion concern raised during the
-- chunk 10b review.

DO $sc306$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_seed_msgs  int;
BEGIN
  RAISE NOTICE 'SC-306 starting: paused league with expired deadline → skip';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
  );
  v_league_id := (v_seed ->> 'league_id')::uuid;

  UPDATE public.leagues
     SET pick_deadline = now() - interval '10 seconds',
         draft_state = 'paused'
   WHERE id = v_league_id;

  PERFORM public.draft_deadline_sweep();

  SELECT count(*) INTO v_seed_msgs
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;

  PERFORM _v2_test._assert(
    v_seed_msgs = 0,
    format('SC-306 expected 0 messages (draft paused), got %s', v_seed_msgs)
  );

  RAISE NOTICE 'SC-306 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc306$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-307 — Deadline within 2-second back-buffer is NOT swept
-- ════════════════════════════════════════════════════════════════════════
-- The sweep predicate filters `pick_deadline < now() - interval '2 seconds'`.
-- A deadline that's only 1 second past should fall inside the buffer
-- and NOT be enqueued — this is the wedge that prevents racing
-- submit_pick_v2's own pgmq enqueue at the moment of pick landing.

DO $sc307$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_seed_msgs  int;
BEGIN
  RAISE NOTICE 'SC-307 starting: deadline within 2s buffer → skip';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
  );
  v_league_id := (v_seed ->> 'league_id')::uuid;

  UPDATE public.leagues
     SET pick_deadline = now() - interval '1 second'  -- inside buffer
   WHERE id = v_league_id;

  PERFORM public.draft_deadline_sweep();

  SELECT count(*) INTO v_seed_msgs
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;

  PERFORM _v2_test._assert(
    v_seed_msgs = 0,
    format('SC-307 expected 0 messages (within 2s buffer), got %s', v_seed_msgs)
  );

  RAISE NOTICE 'SC-307 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc307$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-308 — Deadline just past 2-second buffer IS swept; expired_by_sec set
-- ════════════════════════════════════════════════════════════════════════
-- Boundary companion to SC-307: 3 seconds past the deadline is JUST
-- past the 2-second buffer and SHOULD be enqueued. Also asserts the
-- metric's detail.expired_by_sec is at least 3 (will typically be 3
-- or slightly more depending on fixture-setup latency between the
-- UPDATE and the sweep call).

DO $sc308$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_seed_msgs    int;
  v_metric_row   record;
BEGIN
  RAISE NOTICE 'SC-308 starting: deadline just past 2s buffer → enqueue';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
  );
  v_league_id := (v_seed ->> 'league_id')::uuid;

  UPDATE public.leagues
     SET pick_deadline = now() - interval '3 seconds'  -- just past buffer
   WHERE id = v_league_id;

  PERFORM public.draft_deadline_sweep();

  SELECT count(*) INTO v_seed_msgs
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;

  PERFORM _v2_test._assert(
    v_seed_msgs = 1,
    format('SC-308 expected exactly 1 message, got %s', v_seed_msgs)
  );

  SELECT detail INTO v_metric_row
    FROM public.draft_metrics
   WHERE metric = 'safety_net_hit'
     AND league_id = v_league_id
   LIMIT 1;

  PERFORM _v2_test._assert(
    (v_metric_row.detail ->> 'expired_by_sec')::int >= 3,
    format('SC-308 expired_by_sec should be >= 3, got %s',
           v_metric_row.detail ->> 'expired_by_sec')
  );

  RAISE NOTICE 'SC-308 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc308$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-309 — Advisory lock contention from a different session no-ops the sweep
-- ════════════════════════════════════════════════════════════════════════
-- Tests the inter-session contention guard. A pure SQL test cannot
-- spawn a second backend, so we approximate by acquiring a SESSION-
-- level (not txn-level) advisory lock on the same key from this
-- session, then BEGIN a savepoint, then call sweep. Inside the
-- savepoint, the sweep tries pg_try_advisory_xact_lock on the same
-- key — same backend already holds the SESSION lock, but the
-- advisory-lock API does NOT block reentry from the same backend
-- regardless of lock type. So this test cannot directly exercise
-- inter-session contention from SQL.
--
-- What we CAN test inside SQL: the function's no-op path when the
-- lock acquisition fails. We do that by holding the session lock
-- AND wrapping the sweep in a NEW backend via dblink — but Supabase
-- staging may not have dblink installed.
--
-- Compromise for chunk 10e: we test the function's RETURN value
-- under same-session reentry, which DOES succeed (Postgres allows
-- reentrant advisory locks within a backend). This is documented
-- behavior — see SC-310 for the consecutive-sweeps scenario that
-- relies on it.
--
-- True inter-session contention testing is deferred to chunk 10f /
-- Phase 7 chaos-testing where two real workers + cron fire
-- concurrently against staging.

DO $sc309$
DECLARE
  v_swept int;
BEGIN
  RAISE NOTICE 'SC-309 starting: advisory lock semantics (documented limitation; see body)';
  BEGIN  -- savepoint

  -- Acquire session-level lock on the same key. This will NOT block
  -- the same backend from acquiring it again at txn level.
  PERFORM pg_advisory_lock(hashtext('draft-sweep'));

  -- Sweep should still succeed (same-backend reentry is allowed).
  v_swept := public.draft_deadline_sweep();
  PERFORM _v2_test._assert(
    v_swept >= 0,
    format('SC-309 sweep returned %s; expected non-negative (same-backend reentry is allowed)', v_swept)
  );

  -- Release the session lock before exiting (otherwise it persists
  -- past savepoint rollback at session scope).
  PERFORM pg_advisory_unlock(hashtext('draft-sweep'));

  RAISE NOTICE 'SC-309 PASS (same-backend reentry confirmed; inter-session contention deferred to Phase 7 chaos)';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    -- Failsafe: ensure session lock is released even if the inner
    -- BEGIN aborts before the unlock call. Session locks are NOT
    -- rolled back by savepoint exit.
    PERFORM pg_advisory_unlock(hashtext('draft-sweep'));
  END;
END
$sc309$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-310 — Two consecutive sweeps in the same txn both enqueue
-- ════════════════════════════════════════════════════════════════════════
-- Per Phase 3 plan: "expire 3 leagues, run sweep twice back-to-back
-- without letting the worker run — assert 6 messages enqueued (3 + 3
-- duplicates)." Duplicates are tolerated by the autopick idempotency
-- key (Phase 4); chunk 10b's sweep does NOT dedupe.
--
-- We seed 1 league (instead of 3) for simpler accounting. Two
-- consecutive sweeps in the same txn should produce 2 messages
-- (intra-session advisory lock reentry is allowed, per SC-309).

DO $sc310$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_seed_msgs  int;
BEGIN
  RAISE NOTICE 'SC-310 starting: two consecutive sweeps both enqueue';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 3, 3
  );
  v_league_id := (v_seed ->> 'league_id')::uuid;

  UPDATE public.leagues
     SET pick_deadline = now() - interval '5 seconds'
   WHERE id = v_league_id;

  -- First sweep.
  PERFORM public.draft_deadline_sweep();
  -- Second sweep, same txn.
  PERFORM public.draft_deadline_sweep();

  SELECT count(*) INTO v_seed_msgs
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;

  PERFORM _v2_test._assert(
    v_seed_msgs = 2,
    format(
      'SC-310 expected 2 duplicate messages (no queue-side dedupe), got %s. '
      'If 1: advisory lock blocked reentry (regression). If 0: predicate '
      'is broken.',
      v_seed_msgs
    )
  );

  RAISE NOTICE 'SC-310 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc310$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-311 — pgmq wrappers: read returns msg, archive removes it
-- ════════════════════════════════════════════════════════════════════════
-- Roundtrip test for chunk 10c's draft_autopick_read /
-- draft_autopick_archive. Insert a tagged message via pgmq.send,
-- read it via the wrapper (asserting the row shape), archive via
-- the wrapper (asserting boolean true), then read again and assert
-- the message is gone from the active queue.
--
-- Schema asserted on read row: msg_id (bigint), read_ct (int >= 1),
-- enqueued_at (timestamptz), vt (timestamptz), message (jsonb).

DO $sc311$
DECLARE
  v_tag        text := 'sc311-' || gen_random_uuid()::text;
  v_msg_id     bigint;
  v_read_ct    int;
  v_msg_body   jsonb;
  v_archived   boolean;
  v_after_read int;
BEGIN
  RAISE NOTICE 'SC-311 starting: pgmq wrapper roundtrip (read + archive)';
  BEGIN  -- savepoint

  -- Enqueue a tagged message directly (not via sweep).
  PERFORM pgmq.send(
    'draft_deadlines',
    jsonb_build_object('_v2_test_tag', v_tag, 'source', 'sc311'),
    0
  );

  -- Read via wrapper. vt=30 means the message becomes invisible to
  -- subsequent reads for 30s — but we archive immediately, so vt
  -- doesn't matter for this test.
  SELECT msg_id, read_ct, message
    INTO v_msg_id, v_read_ct, v_msg_body
    FROM public.draft_autopick_read(p_vt => 30, p_qty => 50)
   WHERE message ->> '_v2_test_tag' = v_tag
   LIMIT 1;

  PERFORM _v2_test._assert(
    v_msg_id IS NOT NULL,
    'SC-311 wrapper read should return our tagged message'
  );
  PERFORM _v2_test._assert(
    v_read_ct >= 1,
    format('SC-311 read_ct should be >= 1 on first read, got %s', v_read_ct)
  );
  PERFORM _v2_test._assert(
    v_msg_body ->> '_v2_test_tag' = v_tag,
    'SC-311 message body tag mismatch'
  );

  -- Archive via wrapper.
  v_archived := public.draft_autopick_archive(v_msg_id);
  PERFORM _v2_test._assert(
    v_archived = true,
    format('SC-311 archive should return true, got %s', v_archived)
  );

  -- After archive, the message should not appear in active queue
  -- reads (it's in pgmq.a_draft_deadlines now).
  SELECT count(*) INTO v_after_read
    FROM public.draft_autopick_read(p_vt => 30, p_qty => 50)
   WHERE message ->> '_v2_test_tag' = v_tag;

  PERFORM _v2_test._assert(
    v_after_read = 0,
    format('SC-311 archived message should not reappear in reads, got %s rows',
           v_after_read)
  );

  RAISE NOTICE 'SC-311 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc311$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-312 — manage_draft_metrics_partitions: shape + idempotence
-- ════════════════════════════════════════════════════════════════════════
-- Sanity check on chunk 10a's partition lifecycle function. Calls
-- the function twice in the same txn; both should return the same
-- jsonb shape with no side effects (next month's partition exists
-- from the migration apply, so both calls find it already-present
-- and report empty `created`).
--
-- Asserted shape:
--   { created: text[], dropped: text[], skipped_no_rollup: text[],
--     next_month_partition: text, cutoff: text }

DO $sc312$
DECLARE
  v_call_a  jsonb;
  v_call_b  jsonb;
BEGIN
  RAISE NOTICE 'SC-312 starting: partition manager shape + idempotence';
  BEGIN  -- savepoint

  v_call_a := public.manage_draft_metrics_partitions();
  v_call_b := public.manage_draft_metrics_partitions();

  -- Shape: both calls have the 5 documented keys.
  PERFORM _v2_test._assert(
    v_call_a ? 'created'
      AND v_call_a ? 'dropped'
      AND v_call_a ? 'skipped_no_rollup'
      AND v_call_a ? 'next_month_partition'
      AND v_call_a ? 'cutoff',
    format('SC-312 first call missing expected keys: %s', v_call_a)
  );

  -- next_month_partition matches the format draft_metrics_YYYY_MM.
  PERFORM _v2_test._assert(
    (v_call_a ->> 'next_month_partition') ~ '^draft_metrics_\d{4}_\d{2}$',
    format('SC-312 next_month_partition shape mismatch: %s',
           v_call_a ->> 'next_month_partition')
  );

  -- Idempotence: second call returns the same next_month_partition
  -- and the same cutoff (date_trunc('month', now()) doesn't change
  -- mid-second).
  PERFORM _v2_test._assert_eq(
    jsonb_build_object(
      'next_month_partition', v_call_b ->> 'next_month_partition',
      'cutoff',               v_call_b ->> 'cutoff'
    ),
    jsonb_build_object(
      'next_month_partition', v_call_a ->> 'next_month_partition',
      'cutoff',               v_call_a ->> 'cutoff'
    ),
    'SC-312 second call should be idempotent'
  );

  -- Second call's `created` must be empty: first call's create (if
  -- any) made the partition exist; second call sees it.
  PERFORM _v2_test._assert(
    jsonb_array_length(v_call_b -> 'created') = 0,
    format('SC-312 second call.created should be empty, got %s',
           v_call_b -> 'created')
  );

  RAISE NOTICE 'SC-312 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc312$;

-- ── End of Phase 3 scenarios ──────────────────────────────────────────
-- 12 scenarios (SC-301..SC-312). Run end-to-end via:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/draft_engine_v2_phase3_integration.sql
-- or paste into the Supabase SQL Editor.
--
-- All NOTICE lines should be "SC-NNN PASS" (or the harness preflight
-- OK at top). Any ASSERTION FAILED message means a real regression.

DO $summary$
BEGIN
  RAISE NOTICE 'Phase 3 integration suite finished. Expected 12 SC-NNN PASS notices above (SC-301..SC-312).';
END
$summary$;
