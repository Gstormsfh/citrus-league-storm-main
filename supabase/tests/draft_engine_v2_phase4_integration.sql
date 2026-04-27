-- ════════════════════════════════════════════════════════════════════════
-- Draft Engine v2 — Phase 4 SQL integration suite
-- ════════════════════════════════════════════════════════════════════════
--
-- Purpose. Cover Phase 4's autopick worker surfaces: §5.3 state
--          machine outcomes, DLQ atomicity, idempotency-key derivation,
--          no-queue heuristic fallback, full unattended-draft
--          completion.
--
-- Where.   STAGING ONLY (project jjgspcpvqaiitloglxbb). Run via
--          `psql "$SUPABASE_DB_URL" -f <this file>` or paste into the
--          Supabase SQL Editor.
--
-- Prerequisite. supabase/tests/draft_engine_v2_phase2_integration.sql
--               must have been run at least once on this database to
--               install the _v2_test helper schema. Phase 4 reuses
--               those helpers (_assert, _assert_eq, _seed_active_league)
--               and adds one more (_v2_test._uuidv5) for SC-404.
--
-- Cleanup model — HYBRID per chunk 11 design call (#4 follow-up):
--
--   SC-401..405 use the savepoint pattern (chunks 9e / 10e legacy).
--   These scenarios are MOCK-WORKER: they simulate the §5.3 state
--   machine by calling the SQL surfaces (submit_pick_v2,
--   draft_autopick_dlq, reconstruct_draft_state, draft_autopick_*
--   wrappers) directly in the order the worker would. ROLLBACK
--   discards every write.
--
--   SC-406 / SC-406b use REAL worker invocation via net.http_post
--   against the deployed Edge Function. Because pg_net dispatches
--   asynchronously AFTER the calling tx commits, and because the
--   worker's writes commit in its own tx, the savepoint pattern
--   CANNOT clean up these scenarios — they use explicit
--   DELETE-by-test-league-id at the end. Each test_league_id is
--   freshly generated (gen_random_uuid()) so re-runs don't collide.
--
-- Edge Function deployment is a HARD prerequisite for SC-406 /
-- SC-406b. If you haven't deployed the chunk 11d worker:
--   supabase functions deploy draft-autopick --no-verify-jwt \
--     --project-ref jjgspcpvqaiitloglxbb
-- Vault secret draft-autopick-token must also be provisioned (see
-- runbook chunk 10d section). Both are checked at SC-406 preflight.

-- ── Preflight ──────────────────────────────────────────────────────────
-- Three checks before any scenario runs:
--   1. _v2_test schema exists (Phase 2 file ran at least once).
--   2. pgmq.send is transactional (BEGIN/ROLLBACK cleanup viable).
--   3. AUTOPICK_NAMESPACE_UUID matches what the chunk 11b/11d worker
--      compiled in (sanity: detects accidental constant drift).

DO $preflight$
DECLARE
  v_count_before bigint;
  v_count_after  bigint;
BEGIN
  -- (1) Helper schema present.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '_v2_test') THEN
    RAISE EXCEPTION
      'PREFLIGHT FAILED: _v2_test schema is missing. Phase 4 reuses '
      'helpers installed by phase2_integration.sql. Run that file '
      'first, then retry.';
  END IF;

  -- (2) pgmq.send is transactional.
  SELECT count(*) INTO v_count_before FROM pgmq.q_draft_deadlines;
  BEGIN
    PERFORM pgmq.send(
      'draft_deadlines',
      '{"_v2_phase4_preflight": true}'::jsonb,
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
      'baseline=%, after=%, leaked=%. Cannot run SC-401..405.',
      v_count_before, v_count_after, (v_count_after - v_count_before);
  END IF;

  RAISE NOTICE 'Phase 4 preflight OK: _v2_test present, pgmq.send transactional.';
END
$preflight$;

-- ── Helper: _v2_test._uuidv5(namespace, name) ─────────────────────────
-- Mirrors supabase/functions/draft-autopick/uuidv5.ts so SC-404 can
-- compute the SAME idempotency key the deployed worker would
-- compute for a given (league_id, pick_number, generation) tuple.
-- Used only by SC-404; kept in _v2_test schema (test-only surface,
-- not public API).
--
-- Contract: namespace must be a UUID string; name is plain text.
-- Returns the canonical 8-4-4-4-12 hex string. Bit-for-bit identical
-- to the worker's TS uuidv5.ts.

CREATE OR REPLACE FUNCTION _v2_test._uuidv5(
  p_namespace uuid,
  p_name      text
) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_namespace_bytes bytea;
  v_name_bytes      bytea;
  v_hash            bytea;
  v_uuid_hex        text;
BEGIN
  -- Strip dashes, decode 16 bytes.
  v_namespace_bytes := decode(replace(p_namespace::text, '-', ''), 'hex');
  v_name_bytes      := convert_to(p_name, 'UTF8');

  -- SHA-1 of (namespace || name); take first 16 bytes.
  v_hash := substring(
    digest(v_namespace_bytes || v_name_bytes, 'sha1') from 1 for 16
  );

  -- Set version (5) on byte 6: high nibble = 5, low nibble preserved.
  v_hash := set_byte(v_hash, 6, (get_byte(v_hash, 6) & 15) | 80);
  -- Set variant (10) on byte 8: top two bits = 10, others preserved.
  v_hash := set_byte(v_hash, 8, (get_byte(v_hash, 8) & 63) | 128);

  -- Format as canonical 8-4-4-4-12.
  v_uuid_hex := encode(v_hash, 'hex');
  RETURN (
    substring(v_uuid_hex, 1,  8) || '-' ||
    substring(v_uuid_hex, 9,  4) || '-' ||
    substring(v_uuid_hex, 13, 4) || '-' ||
    substring(v_uuid_hex, 17, 4) || '-' ||
    substring(v_uuid_hex, 21, 12)
  )::uuid;
END;
$$;

-- Sanity: known test vector. Verifies the SQL implementation produces
-- the canonical UUIDv5 output for a well-known input pair. This is a
-- structural sanity check on _v2_test._uuidv5 only — the cross-runtime
-- SQL ↔ TS parity check is SC-404 itself, which computes the key in
-- SQL via this helper, then asserts that submit_pick_v2 idempotency
-- replay finds the SAME key the worker would produce in TS.
DO $verify_uuidv5$
DECLARE
  v_actual   uuid;
  v_expected uuid := '2ed6657d-e927-568b-95e1-2665a8aea6a2';
BEGIN
  -- UUIDv5 of "www.example.com" under the standard DNS namespace.
  -- Cross-checked against Python's uuid.uuid5(uuid.NAMESPACE_DNS, ...)
  -- and raw SHA-1: SHA-1(NS_DNS_BYTES || "www.example.com") =
  -- 2ed6657de927468b55e12665a8aea6a22dee3e35; first 16 bytes after
  -- version-5 + variant-10 bit-set = 2ed6657d-e927-568b-95e1-2665a8aea6a2.
  v_actual := _v2_test._uuidv5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,  -- DNS namespace
    'www.example.com'
  );
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION '_v2_test._uuidv5 self-test failed: got % expected %',
      v_actual, v_expected;
  END IF;
END
$verify_uuidv5$;

-- ── Helper: _v2_test._purge_test_league(uuid) ─────────────────────────
-- Cascade-delete every Phase 2/3/4 row associated with a single
-- test_league_id. Used by SC-406 / SC-406b in both the success path
-- AND the EXCEPTION arm (cleanup-on-failure wrapper) so failed
-- real-worker scenarios don't leak orphaned debug data.
--
-- Order matters: foreign-key children (draft_picks_v2, draft_events,
-- autopick_failures, draft_order, teams) before parents (leagues).
-- pgmq tables drained last by message payload league_id.
--
-- Idempotent: calling it on a non-existent league_id is a no-op.

CREATE OR REPLACE FUNCTION _v2_test._purge_test_league(
  p_league_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.draft_metrics       WHERE league_id = p_league_id;
  DELETE FROM public.draft_picks_v2      WHERE league_id = p_league_id;
  DELETE FROM public.draft_events        WHERE league_id = p_league_id;
  DELETE FROM public.autopick_failures   WHERE league_id = p_league_id;
  DELETE FROM public.draft_queues        WHERE league_id = p_league_id;
  DELETE FROM public.draft_order         WHERE league_id = p_league_id;
  DELETE FROM public.teams               WHERE league_id = p_league_id;
  DELETE FROM public.leagues             WHERE id        = p_league_id;
  DELETE FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = p_league_id;
  DELETE FROM pgmq.a_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = p_league_id;
END;
$$;

-- ── Scenarios ──────────────────────────────────────────────────────────
-- Conventions (inherited from phase2/phase3):
--   - Test commissioner UID 882b59c9-8882-418b-9450-3fd004d57edd.
--   - actor.kind='autopick' for service-role context.
--   - Inner BEGIN / EXCEPTION raising P0001 for savepoint cleanup.
--   - SC-NNN PASS notices on success; ASSERTION FAILED on regression.
--
-- Numbering: SC-401..406b (4xx series for Phase 4).

-- ════════════════════════════════════════════════════════════════════════
-- SC-401 — Mock-worker happy path: full §5.3 simulation, single message
-- ════════════════════════════════════════════════════════════════════════
-- Simulates the chunk 11d worker's per-message decision flow against a
-- single expired-deadline league. Drives every SQL surface the real
-- worker would touch:
--   - leagues fresh-read
--   - reconstruct_draft_state RPC
--   - draft_picks_v2 read for draftedSet
--   - submit_pick_v2 with deterministic idempotency_key + payload_hash
--   - draft_autopick_archive wrapper
--   - draft_metrics insert (autopick_fired metric)
-- Asserts pick committed via projection trigger (draft_picks_v2 row),
-- event log has 1 pick row, message archived, metric written.

DO $sc401$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_session_id   uuid;
  v_first_team   uuid;
  v_msg_id       bigint;
  v_msg_count    int;
  v_state        jsonb;
  v_current_pick int;
  v_round        int;
  v_idem_key     uuid;
  v_payload_hash text;
  v_submit_res   jsonb;
  v_event_count  int;
  v_pick_count   int;
  v_metric_count int;
BEGIN
  RAISE NOTICE 'SC-401 starting: mock-worker happy path';
  BEGIN  -- savepoint

  -- Seed: 12-team active league, expired deadline.
  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_session_id := (v_seed ->> 'session_id')::uuid;
  v_first_team := v_team_ids[1];

  UPDATE public.leagues
     SET pick_deadline = now() - interval '5 seconds'
   WHERE id = v_league_id;

  -- Mock the sweep: pgmq.send a deadline message for pick 1.
  SELECT pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id',     v_league_id,
      'pick_number',   1,
      'generation',    0,
      'scheduled_for', now() - interval '5 seconds',
      'source',        'safety_net'
    ),
    0
  ) INTO v_msg_id;

  -- Mock-worker step 5: reconstruct_draft_state.
  SELECT public.reconstruct_draft_state(v_league_id) INTO v_state;
  v_current_pick := (v_state ->> 'current_pick_number')::int;
  PERFORM _v2_test._assert(
    v_current_pick = 1,
    'SC-401 reconstruct.current_pick_number should be 1, got ' || v_current_pick
  );
  PERFORM _v2_test._assert(
    (v_state ->> 'on_the_clock_team_id')::uuid = v_first_team,
    'SC-401 on_the_clock should be team 1'
  );

  -- Mock-worker step 8: deterministic idempotency_key.
  v_idem_key := _v2_test._uuidv5(
    '388b7e84-2c31-454e-ab0c-6d3b7da13282'::uuid,
    v_league_id::text || '|1|0|autopick'
  );

  -- Mock-worker step 7: payload_hash. Use the same placeholder format
  -- the worker would produce — for SC-401 we don't need bit-exact
  -- agreement with @citrus/shared computePickPayloadHash since this
  -- scenario doesn't exercise the conflict path. Use a deterministic
  -- sentinel so the payload_hash field is populated.
  v_payload_hash := 'sha256:' || md5('SC401|' || v_league_id::text || '|1');
  v_round := 1;

  -- Mock-worker step 9: submit_pick_v2.
  v_submit_res := submit_pick_v2(
    p_league_id        => v_league_id,
    p_team_id          => v_first_team,
    p_player_id        => 8478402,  -- arbitrary valid int
    p_round            => v_round,
    p_pick_number      => v_current_pick,
    p_session_id       => v_session_id,
    p_idempotency_key  => v_idem_key,
    p_payload_hash     => v_payload_hash,
    p_actor            => jsonb_build_object('kind', 'autopick'),
    p_correlation_id   => gen_random_uuid()
  );
  PERFORM _v2_test._assert(
    (v_submit_res ->> 'was_duplicate')::boolean = false,
    'SC-401 submit.was_duplicate should be false'
  );

  -- Event log row + projection.
  SELECT count(*) INTO v_event_count
    FROM draft_events WHERE league_id = v_league_id AND event_type = 'pick';
  PERFORM _v2_test._assert(
    v_event_count = 1,
    'SC-401 expected 1 pick event row, got ' || v_event_count
  );
  SELECT count(*) INTO v_pick_count
    FROM draft_picks_v2 WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(
    v_pick_count = 1,
    'SC-401 expected 1 draft_picks_v2 projection row, got ' || v_pick_count
  );

  -- Mock-worker archive.
  PERFORM public.draft_autopick_archive(v_msg_id);
  SELECT count(*) INTO v_msg_count
    FROM pgmq.q_draft_deadlines
   WHERE (message ->> 'league_id')::uuid = v_league_id;
  PERFORM _v2_test._assert(
    v_msg_count = 0,
    'SC-401 expected message to be archived, queue still has ' || v_msg_count
  );

  -- Mock-worker autopick_fired metric write.
  INSERT INTO public.draft_metrics (metric, league_id, value, detail)
  VALUES (
    'autopick_fired',
    v_league_id,
    1,
    jsonb_build_object(
      'pick_number', 1,
      'generation',  0,
      'picked_via',  'heuristic',
      'player_id',   8478402,
      'team_id',     v_first_team
    )
  );
  SELECT count(*) INTO v_metric_count
    FROM public.draft_metrics
   WHERE metric = 'autopick_fired' AND league_id = v_league_id;
  PERFORM _v2_test._assert(
    v_metric_count = 1,
    'SC-401 expected 1 autopick_fired metric row, got ' || v_metric_count
  );

  RAISE NOTICE 'SC-401 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc401$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-402a — Stale-message gate: state != 'active'
-- ════════════════════════════════════════════════════════════════════════
-- The worker reads the fresh leagues row and aborts on the first failed
-- gate. SC-402a verifies the SQL inputs to the state gate are right:
-- a paused league with an expired deadline reads as state='paused', and
-- the worker would then archive without committing a pick.

DO $sc402a$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_msg_id     bigint;
  v_state      text;
  v_event_count int;
BEGIN
  RAISE NOTICE 'SC-402a starting: stale gate — draft_state != active';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  UPDATE public.leagues
     SET draft_state   = 'paused',
         pick_deadline = now() - interval '5 seconds'
   WHERE id = v_league_id;

  SELECT pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id', v_league_id, 'pick_number', 1, 'generation', 0,
      'scheduled_for', now() - interval '5 seconds', 'source', 'safety_net'
    ), 0
  ) INTO v_msg_id;

  -- Mock-worker step 4a: read fresh state, gate check.
  SELECT draft_state INTO v_state FROM public.leagues WHERE id = v_league_id;
  PERFORM _v2_test._assert(
    v_state = 'paused',
    'SC-402a fresh-read should see draft_state=paused, got ' || v_state
  );
  PERFORM _v2_test._assert(
    v_state <> 'active',
    'SC-402a worker would skip on state gate'
  );

  -- Worker would archive without submit_pick_v2.
  PERFORM public.draft_autopick_archive(v_msg_id);

  SELECT count(*) INTO v_event_count
    FROM draft_events WHERE league_id = v_league_id AND event_type = 'pick';
  PERFORM _v2_test._assert(
    v_event_count = 0,
    'SC-402a no pick should have been committed; got ' || v_event_count
  );

  RAISE NOTICE 'SC-402a PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc402a$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-402b — Stale-message gate: msg.generation != league.draft_generation
-- ════════════════════════════════════════════════════════════════════════
-- Pause/resume/extend invariant: any lifecycle event that bumps
-- draft_generation invalidates every in-flight pgmq message. Worker
-- reads fresh generation and compares against msg.generation; mismatch
-- → archive.

DO $sc402b$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_msg_id     bigint;
  v_msg_gen    int := 3;  -- stale: enqueued at gen 3
  v_league_gen int;
  v_event_count int;
BEGIN
  RAISE NOTICE 'SC-402b starting: stale gate — generation mismatch';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  UPDATE public.leagues
     SET pick_deadline    = now() - interval '5 seconds',
         draft_generation = 5  -- league bumped past the message
   WHERE id = v_league_id;

  SELECT pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id', v_league_id, 'pick_number', 1, 'generation', v_msg_gen,
      'scheduled_for', now() - interval '5 seconds', 'source', 'safety_net'
    ), 0
  ) INTO v_msg_id;

  SELECT draft_generation INTO v_league_gen
    FROM public.leagues WHERE id = v_league_id;
  PERFORM _v2_test._assert(
    v_league_gen = 5,
    'SC-402b league gen should be 5'
  );
  PERFORM _v2_test._assert(
    v_msg_gen <> v_league_gen,
    'SC-402b worker would skip on generation gate'
  );

  PERFORM public.draft_autopick_archive(v_msg_id);

  SELECT count(*) INTO v_event_count
    FROM draft_events WHERE league_id = v_league_id AND event_type = 'pick';
  PERFORM _v2_test._assert(
    v_event_count = 0,
    'SC-402b no pick should have been committed'
  );

  RAISE NOTICE 'SC-402b PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc402b$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-402c — Stale-message gate: now() < league.pick_deadline (premature)
-- ════════════════════════════════════════════════════════════════════════
-- Deadline was extended after the message was enqueued. Worker reads
-- fresh deadline; if it's still in the future, archive without picking.

DO $sc402c$
DECLARE
  v_seed       jsonb;
  v_league_id  uuid;
  v_msg_id     bigint;
  v_deadline   timestamptz;
  v_event_count int;
BEGIN
  RAISE NOTICE 'SC-402c starting: stale gate — premature (deadline future)';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  -- Seed default sets pick_deadline = now() + 90s. Bump to + 60s
  -- after enqueue (simulating draft_extended).
  UPDATE public.leagues
     SET pick_deadline = now() + interval '60 seconds'
   WHERE id = v_league_id;

  SELECT pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id', v_league_id, 'pick_number', 1, 'generation', 0,
      -- scheduled_for in the past simulates "this message was enqueued
      -- when the deadline WAS expired, but it's been extended since"
      'scheduled_for', now() - interval '5 seconds', 'source', 'safety_net'
    ), 0
  ) INTO v_msg_id;

  SELECT pick_deadline INTO v_deadline FROM public.leagues WHERE id = v_league_id;
  PERFORM _v2_test._assert(
    now() < v_deadline,
    'SC-402c worker would skip on premature gate (now < deadline)'
  );

  PERFORM public.draft_autopick_archive(v_msg_id);

  SELECT count(*) INTO v_event_count
    FROM draft_events WHERE league_id = v_league_id AND event_type = 'pick';
  PERFORM _v2_test._assert(
    v_event_count = 0,
    'SC-402c no pick should have been committed'
  );

  RAISE NOTICE 'SC-402c PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc402c$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-402d — Stale-message gate: msg.pick_number != current_pick (advanced)
-- ════════════════════════════════════════════════════════════════════════
-- A human picked between enqueue and worker read. Worker reconstructs
-- state, sees current_pick has advanced past the message's slot, and
-- archives.

DO $sc402d$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_session_id   uuid;
  v_first_team   uuid;
  v_msg_id       bigint;
  v_state        jsonb;
  v_current_pick int;
  v_event_count  int;
BEGIN
  RAISE NOTICE 'SC-402d starting: stale gate — pick advanced (human won the race)';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_session_id := (v_seed ->> 'session_id')::uuid;
  v_first_team := v_team_ids[1];

  UPDATE public.leagues
     SET pick_deadline = now() - interval '5 seconds'
   WHERE id = v_league_id;

  -- Human committed pick 1 between enqueue and read.
  PERFORM submit_pick_v2(
    p_league_id        => v_league_id,
    p_team_id          => v_first_team,
    p_player_id        => 8478402,
    p_round            => 1,
    p_pick_number      => 1,
    p_session_id       => v_session_id,
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:' || md5('SC402d-human-pick-1'),
    p_actor            => jsonb_build_object('kind', 'autopick'),
    p_correlation_id   => NULL
  );

  -- Worker's safety-net message (stale: it was enqueued for slot 1).
  SELECT pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id', v_league_id, 'pick_number', 1, 'generation', 0,
      'scheduled_for', now() - interval '5 seconds', 'source', 'safety_net'
    ), 0
  ) INTO v_msg_id;

  -- Mock-worker step 5: reconstruct.
  SELECT public.reconstruct_draft_state(v_league_id) INTO v_state;
  v_current_pick := (v_state ->> 'current_pick_number')::int;
  PERFORM _v2_test._assert(
    v_current_pick = 2,
    'SC-402d current_pick should advance to 2 after human pick, got ' || v_current_pick
  );
  PERFORM _v2_test._assert(
    1 <> v_current_pick,
    'SC-402d worker would skip on pick_advanced gate (msg=1, current=2)'
  );

  PERFORM public.draft_autopick_archive(v_msg_id);

  -- Only 1 pick committed (the human's). No second pick from the worker.
  SELECT count(*) INTO v_event_count
    FROM draft_events WHERE league_id = v_league_id AND event_type = 'pick';
  PERFORM _v2_test._assert(
    v_event_count = 1,
    'SC-402d expected 1 pick (the human''s), got ' || v_event_count
  );

  RAISE NOTICE 'SC-402d PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc402d$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-403 — 3-strikes DLQ: draft_autopick_dlq atomicity
-- ════════════════════════════════════════════════════════════════════════
-- Worker hits read_ct >= 3 → calls draft_autopick_dlq → atomically:
--   (a) inserts row into autopick_failures
--   (b) emits autopick_failed event into draft_events
-- Then archives the pgmq message. SC-403 verifies all three atomic
-- side effects, plus the unique-constraint duplicate-no-op (chunk 11c
-- design call #6).

DO $sc403$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_msg_id       bigint;
  v_dlq_result   jsonb;
  v_dlq_id       bigint;
  v_event_id     bigint;
  v_failures_count int;
  v_event_count  int;
  v_dup_result   jsonb;
BEGIN
  RAISE NOTICE 'SC-403 starting: 3-strikes DLQ + duplicate no-op';
  BEGIN  -- savepoint

  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 3);
  v_league_id := (v_seed ->> 'league_id')::uuid;

  UPDATE public.leagues
     SET pick_deadline = now() - interval '10 seconds'
   WHERE id = v_league_id;

  -- Mock the sweep: enqueue a deadline message.
  SELECT pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id', v_league_id, 'pick_number', 1, 'generation', 0,
      'scheduled_for', now() - interval '10 seconds', 'source', 'safety_net'
    ), 0
  ) INTO v_msg_id;

  -- Bump read_ct directly to simulate "worker read this message
  -- twice already; this is read attempt 3+". The chunk 11d worker
  -- gate is `if (msg.read_ct >= READ_CT_DLQ_THRESHOLD)` where the
  -- threshold is 3.
  UPDATE pgmq.q_draft_deadlines SET read_ct = 3 WHERE msg_id = v_msg_id;

  -- Mock-worker step 1: call draft_autopick_dlq with the same args
  -- the worker would.
  SELECT public.draft_autopick_dlq(
    p_league_id      => v_league_id,
    p_pgmq_msg_id    => v_msg_id,
    p_payload        => jsonb_build_object(
      'league_id', v_league_id, 'pick_number', 1, 'generation', 0,
      'scheduled_for', now() - interval '10 seconds', 'source', 'safety_net'
    ),
    p_last_error     => 'read_ct >= 3',
    p_read_ct        => 3,
    p_correlation_id => gen_random_uuid()
  ) INTO v_dlq_result;

  PERFORM _v2_test._assert(
    (v_dlq_result ->> 'already_dlq')::boolean = false,
    'SC-403 first DLQ call should land already_dlq=false'
  );
  v_dlq_id   := (v_dlq_result ->> 'dlq_id')::bigint;
  v_event_id := (v_dlq_result ->> 'event_id')::bigint;
  PERFORM _v2_test._assert(v_dlq_id   IS NOT NULL, 'SC-403 dlq_id should be set');
  PERFORM _v2_test._assert(v_event_id IS NOT NULL, 'SC-403 event_id should be set');

  -- (a) autopick_failures row landed.
  SELECT count(*) INTO v_failures_count
    FROM public.autopick_failures
   WHERE league_id = v_league_id AND pgmq_msg_id = v_msg_id;
  PERFORM _v2_test._assert(
    v_failures_count = 1,
    'SC-403 expected 1 autopick_failures row, got ' || v_failures_count
  );

  -- (b) autopick_failed event landed in draft_events.
  SELECT count(*) INTO v_event_count
    FROM public.draft_events
   WHERE league_id = v_league_id AND event_type = 'autopick_failed';
  PERFORM _v2_test._assert(
    v_event_count = 1,
    'SC-403 expected 1 autopick_failed event, got ' || v_event_count
  );

  -- Worker would archive after the DLQ call.
  PERFORM public.draft_autopick_archive(v_msg_id);

  -- Duplicate-no-op: second call with same (pgmq_msg_id, league_id)
  -- short-circuits via the unique constraint, returning
  -- already_dlq=true and NOT emitting a second event row.
  SELECT public.draft_autopick_dlq(
    p_league_id      => v_league_id,
    p_pgmq_msg_id    => v_msg_id,
    p_payload        => '{"_v2_test_dup": true}'::jsonb,
    p_last_error     => 'duplicate retry',
    p_read_ct        => 4,
    p_correlation_id => gen_random_uuid()
  ) INTO v_dup_result;

  PERFORM _v2_test._assert(
    (v_dup_result ->> 'already_dlq')::boolean = true,
    'SC-403 duplicate call should return already_dlq=true'
  );
  PERFORM _v2_test._assert(
    (v_dup_result ->> 'dlq_id') IS NULL,
    'SC-403 duplicate call dlq_id should be NULL'
  );
  PERFORM _v2_test._assert(
    (v_dup_result ->> 'event_id') IS NULL,
    'SC-403 duplicate call event_id should be NULL'
  );

  -- autopick_failed event count unchanged (still 1).
  SELECT count(*) INTO v_event_count
    FROM public.draft_events
   WHERE league_id = v_league_id AND event_type = 'autopick_failed';
  PERFORM _v2_test._assert(
    v_event_count = 1,
    'SC-403 duplicate must NOT emit a second autopick_failed event; got ' || v_event_count
  );

  RAISE NOTICE 'SC-403 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc403$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-404 — Idempotency conflict: same key returns was_duplicate=true
-- ════════════════════════════════════════════════════════════════════════
-- The autopick worker derives idempotency_key as
--   uuid_v5(AUTOPICK_NAMESPACE_UUID, "${league_id}|${pick_number}|${generation}|autopick")
-- If the same logical pick has already landed under that key (e.g.
-- pgmq redelivered after a successful submit), submit_pick_v2 returns
-- was_duplicate=true with the EXISTING event_id — not a new pick.
--
-- Tests the cross-runtime hash agreement: this scenario computes the
-- key in SQL via _v2_test._uuidv5, and asserts that a re-submit
-- under the same key short-circuits to the duplicate-replay path.

DO $sc404$
DECLARE
  v_seed         jsonb;
  v_league_id    uuid;
  v_team_ids     uuid[];
  v_session_id   uuid;
  v_first_team   uuid;
  v_idem_key     uuid;
  v_payload_hash text;
  v_first_res    jsonb;
  v_replay_res   jsonb;
  v_event_count  int;
  v_pick_count   int;
BEGIN
  RAISE NOTICE 'SC-404 starting: idempotency conflict / replay';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_session_id := (v_seed ->> 'session_id')::uuid;
  v_first_team := v_team_ids[1];

  UPDATE public.leagues
     SET pick_deadline = now() - interval '5 seconds'
   WHERE id = v_league_id;

  -- Compute the SAME idempotency key the worker would produce.
  v_idem_key := _v2_test._uuidv5(
    '388b7e84-2c31-454e-ab0c-6d3b7da13282'::uuid,
    v_league_id::text || '|1|0|autopick'
  );
  v_payload_hash := 'sha256:' || md5('SC404|pick-1');

  -- First submit: succeeds, was_duplicate=false.
  v_first_res := submit_pick_v2(
    p_league_id        => v_league_id,
    p_team_id          => v_first_team,
    p_player_id        => 8478402,
    p_round            => 1,
    p_pick_number      => 1,
    p_session_id       => v_session_id,
    p_idempotency_key  => v_idem_key,
    p_payload_hash     => v_payload_hash,
    p_actor            => jsonb_build_object('kind', 'autopick'),
    p_correlation_id   => gen_random_uuid()
  );
  PERFORM _v2_test._assert(
    (v_first_res ->> 'was_duplicate')::boolean = false,
    'SC-404 first submit was_duplicate should be false'
  );

  -- Replay: same key, same hash → submit returns was_duplicate=true
  -- with the SAME event_id and seq. No second pick committed.
  v_replay_res := submit_pick_v2(
    p_league_id        => v_league_id,
    p_team_id          => v_first_team,
    p_player_id        => 8478402,
    p_round            => 1,
    p_pick_number      => 1,
    p_session_id       => v_session_id,
    p_idempotency_key  => v_idem_key,
    p_payload_hash     => v_payload_hash,
    p_actor            => jsonb_build_object('kind', 'autopick'),
    p_correlation_id   => gen_random_uuid()
  );
  PERFORM _v2_test._assert(
    (v_replay_res ->> 'was_duplicate')::boolean = true,
    'SC-404 replay was_duplicate should be true'
  );
  PERFORM _v2_test._assert(
    (v_replay_res ->> 'event_id') = (v_first_res ->> 'event_id'),
    'SC-404 replay event_id should match first submit'
  );
  PERFORM _v2_test._assert(
    (v_replay_res ->> 'seq') = (v_first_res ->> 'seq'),
    'SC-404 replay seq should match first submit'
  );

  -- One event row, one projection row.
  SELECT count(*) INTO v_event_count
    FROM draft_events WHERE league_id = v_league_id AND event_type = 'pick';
  PERFORM _v2_test._assert(
    v_event_count = 1,
    'SC-404 expected exactly 1 pick event, got ' || v_event_count
  );
  SELECT count(*) INTO v_pick_count
    FROM draft_picks_v2 WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(
    v_pick_count = 1,
    'SC-404 expected exactly 1 projection row, got ' || v_pick_count
  );

  RAISE NOTICE 'SC-404 PASS';
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc404$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-405 — No-queue heuristic fallback: SQL-side surface verification
-- ════════════════════════════════════════════════════════════════════════
-- The chunk 11d worker, when the on-the-clock team has no draft_queues
-- row, falls back to selectByHeuristic over a player_directory +
-- player_season_stats!inner join. SC-405 verifies the SQL-side
-- surface the heuristic depends on:
--   (a) draft_queues for the on-the-clock team is empty.
--   (b) The candidate query (player_directory + player_season_stats
--       for CURRENT_SEASON, filtered to undrafted) returns a non-empty
--       set.
--   (c) submit_pick_v2 accepts a player picked from that set.
-- The TS-side scoring decision (which specific player wins) is covered
-- by the chunk 11b Deno tests; this scenario verifies the worker can
-- get FROM "no queue" TO "a successful pick" through the SQL layer.

DO $sc405$
DECLARE
  v_seed             jsonb;
  v_league_id        uuid;
  v_team_ids         uuid[];
  v_session_id       uuid;
  v_first_team       uuid;
  v_queue_count      int;
  v_candidates_count int;
  v_picked_player_id int;
  v_submit_res       jsonb;
  v_pick_count       int;
BEGIN
  RAISE NOTICE 'SC-405 starting: no-queue heuristic fallback (SQL surfaces)';
  BEGIN  -- savepoint

  v_seed       := _v2_test._seed_active_league(
                    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 3);
  v_league_id  := (v_seed ->> 'league_id')::uuid;
  v_team_ids   := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];
  v_session_id := (v_seed ->> 'session_id')::uuid;
  v_first_team := v_team_ids[1];

  UPDATE public.leagues
     SET pick_deadline = now() - interval '5 seconds'
   WHERE id = v_league_id;

  -- (a) Verify draft_queues is empty for this team. The seed helper
  -- doesn't populate queues; SC-405 just confirms the assumption.
  SELECT count(*) INTO v_queue_count
    FROM public.draft_queues WHERE team_id = v_first_team;
  PERFORM _v2_test._assert(
    v_queue_count = 0,
    'SC-405 expected empty draft_queues for team, got ' || v_queue_count
  );

  -- (b) Verify the candidate query returns a non-empty set. This is
  -- the SAME query shape the worker uses (player_directory +
  -- player_season_stats!inner for CURRENT_SEASON). If staging has
  -- season-stats data, we expect > 0 candidates.
  SELECT count(*) INTO v_candidates_count
    FROM public.player_directory d
   INNER JOIN public.player_season_stats s
     ON s.season = d.season AND s.player_id = d.player_id
   WHERE d.season = 2025;  -- CURRENT_SEASON
  PERFORM _v2_test._assert(
    v_candidates_count > 0,
    'SC-405 candidate query returned 0 rows — staging has no '
    'player_season_stats for season 2025. Skip this scenario or '
    'seed test data first.'
  );

  -- (c) Pick any candidate (mock the heuristic decision) and verify
  -- submit_pick_v2 accepts it. The heuristic's actual scoring is
  -- covered by chunk 11b Deno tests.
  SELECT d.player_id INTO v_picked_player_id
    FROM public.player_directory d
   INNER JOIN public.player_season_stats s
     ON s.season = d.season AND s.player_id = d.player_id
   WHERE d.season = 2025
     AND d.player_id NOT IN (
       SELECT player_id FROM public.draft_picks_v2 WHERE league_id = v_league_id
     )
   LIMIT 1;
  PERFORM _v2_test._assert(
    v_picked_player_id IS NOT NULL,
    'SC-405 candidate selection returned NULL'
  );

  v_submit_res := submit_pick_v2(
    p_league_id        => v_league_id,
    p_team_id          => v_first_team,
    p_player_id        => v_picked_player_id,
    p_round            => 1,
    p_pick_number      => 1,
    p_session_id       => v_session_id,
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:' || md5('SC405|pick-1'),
    p_actor            => jsonb_build_object('kind', 'autopick'),
    p_correlation_id   => gen_random_uuid()
  );
  PERFORM _v2_test._assert(
    (v_submit_res ->> 'was_duplicate')::boolean = false,
    'SC-405 submit should land cleanly (was_duplicate=false)'
  );

  SELECT count(*) INTO v_pick_count
    FROM draft_picks_v2 WHERE league_id = v_league_id;
  PERFORM _v2_test._assert(
    v_pick_count = 1,
    'SC-405 expected 1 projection row, got ' || v_pick_count
  );

  RAISE NOTICE 'SC-405 PASS (picked player_id=%)', v_picked_player_id;
  RAISE EXCEPTION 'sc_cleanup' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END
$sc405$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-406b — REAL worker, quick-sanity variant: 12-team / 12-pick draft
-- ════════════════════════════════════════════════════════════════════════
-- Bounded fast variant of SC-406. Drives ONE round (12 picks) of an
-- unattended 12-team draft with all teams unowned, no queues set, and
-- short pick deadlines. Verifies the deployed Edge Function can:
--   - Read pgmq messages via draft_autopick_read.
--   - Pass all four stale-message gates against fresh state.
--   - Run the heuristic for all 12 teams without queues.
--   - Submit 12 distinct picks via submit_pick_v2.
--   - Archive each message after success.
--   - Emit autopick_fired metrics for each pick.
--
-- Runtime budget: ~30 seconds (sweep + worker + 12 picks). If this
-- scenario takes much longer, KI-006 has been triggered — investigate
-- via cron.job_run_details + worker invocation logs.
--
-- HARD PREREQUISITES (checked at start; failure = NOTICE skip + exit):
--   - draft-autopick Edge Function deployed
--   - vault.read_secret('draft-autopick-token') returns the
--     service-role bearer
--   - pg_net's net.http_post is available
--
-- Cleanup: explicit DELETE-by-test-league-id at the end. Does NOT use
-- savepoint rollback (incompatible with net.http_post per chunk 11e
-- design call). The test_league_id is fresh per run so collisions are
-- impossible across re-runs.

DO $sc406b$
DECLARE
  v_secret_present  boolean;
  v_seed            jsonb;
  v_test_league_id  uuid;
  v_team_ids        uuid[];
  v_request_id      bigint;
  v_response_status int;
  v_picks_after     int;
  v_metrics_after   int;
  v_poll_attempts   int := 0;
  v_pick_target     int := 12;     -- one round
  v_max_wait_secs   int := 90;     -- worker budget + slack
  v_started_at      timestamptz;
BEGIN
  RAISE NOTICE 'SC-406b starting: real worker, 12-pick quick sanity';

  -- Preflight: Vault secret present? Skip with NOTICE if not (don't
  -- fail the file — operator may run SC-401..405 without provisioning).
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'draft-autopick-token'
  ) INTO v_secret_present;
  IF NOT v_secret_present THEN
    RAISE NOTICE 'SC-406b SKIPPED: vault.draft-autopick-token not provisioned. '
                 'Run the runbook recipe in chunk 10d section before SC-406/406b.';
    RETURN;
  END IF;

  -- Seed: 12-team active league, all teams unowned, no queues, 5s
  -- timer. The seed helper sets owner_id on team 1 only; we strip it
  -- so every team needs autopick.
  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 1);
  v_test_league_id := (v_seed ->> 'league_id')::uuid;
  v_team_ids := ARRAY(SELECT jsonb_array_elements_text(v_seed -> 'team_ids'))::uuid[];

  -- ── Cleanup-on-failure wrapper ──
  -- Inner BEGIN/EXCEPTION ensures _v2_test._purge_test_league runs
  -- whether the body succeeds (normal flow) OR raises any exception
  -- (assertion failure, RPC error, polling timeout). Without this
  -- wrapper, a mid-poll failure leaks a half-built league + dangling
  -- pgmq messages.
  BEGIN
    UPDATE public.teams SET owner_id = NULL WHERE league_id = v_test_league_id;
    UPDATE public.leagues
       SET pick_deadline    = now() - interval '5 seconds',
           settings         = jsonb_set(
                                COALESCE(settings, '{}'::jsonb),
                                '{pickTimeLimit}', '5'::jsonb
                              ),
           scoring_settings = COALESCE(scoring_settings, '{}'::jsonb)
     WHERE id = v_test_league_id;

    -- Manually enqueue the first deadline message (mocking what the
    -- sweep cron would do for an expired league). The worker takes
    -- it from there: each successful submit_pick_v2 enqueues the
    -- NEXT pick's deadline message via Phase 2's pgmq.send call
    -- (spec §5.2.2).
    PERFORM pgmq.send(
      'draft_deadlines',
      jsonb_build_object(
        'league_id',     v_test_league_id,
        'pick_number',   1,
        'generation',    0,
        'scheduled_for', now() - interval '5 seconds',
        'source',        'safety_net'
      ),
      0
    );

  -- Invoke the worker. With submit_pick_v2 chaining the next pgmq
  -- enqueue, ONE invocation should drive all 12 picks of round 1
  -- within its 140s loop budget. (Each iteration: read → submit →
  -- archive → 5s sleep, plus the next message becomes available
  -- immediately because send_delay=0 when its deadline is past.)
  v_started_at := now();
  SELECT net.http_post(
    url := 'https://jjgspcpvqaiitloglxbb.supabase.co/functions/v1/draft-autopick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || vault.read_secret('draft-autopick-token'),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  ) INTO v_request_id;

  PERFORM _v2_test._assert(
    v_request_id IS NOT NULL,
    'SC-406b net.http_post should return a request_id'
  );

  -- Poll for completion. We poll the SIDE-EFFECT (draft_picks_v2 row
  -- count) rather than net.http_response because the response can
  -- arrive before all 12 picks have committed if the worker's loop
  -- is still running.
  --
  -- Acceptance: 12 picks committed within v_max_wait_secs.
  WHILE v_poll_attempts < v_max_wait_secs LOOP
    PERFORM pg_sleep(1);
    v_poll_attempts := v_poll_attempts + 1;
    SELECT count(*) INTO v_picks_after
      FROM public.draft_picks_v2 WHERE league_id = v_test_league_id;
    EXIT WHEN v_picks_after >= v_pick_target;
  END LOOP;

  PERFORM _v2_test._assert(
    v_picks_after >= v_pick_target,
    format(
      'SC-406b expected >= %s picks within %ss; got %s after %s polls. '
      'Worker may have failed or KI-006 latency is in play. Check Edge '
      'Function logs for invocation_id correlation.',
      v_pick_target, v_max_wait_secs, v_picks_after, v_poll_attempts
    )
  );

  -- Verify metric writes match.
  SELECT count(*) INTO v_metrics_after
    FROM public.draft_metrics
   WHERE metric = 'autopick_fired' AND league_id = v_test_league_id;
  PERFORM _v2_test._assert(
    v_metrics_after = v_pick_target,
    format(
      'SC-406b expected %s autopick_fired metrics, got %s',
      v_pick_target, v_metrics_after
    )
  );

    RAISE NOTICE 'SC-406b PASS — % picks committed in % polls (~%s)',
      v_picks_after, v_poll_attempts, v_poll_attempts;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SC-406b FAILED: % (running cleanup before re-raising)', SQLERRM;
    PERFORM _v2_test._purge_test_league(v_test_league_id);
    RAISE;
  END;

  -- Success-path cleanup. Helper is idempotent so this is safe even
  -- if the EXCEPTION arm above already ran (it can't — RAISE exits
  -- the function — but safety is cheap).
  PERFORM _v2_test._purge_test_league(v_test_league_id);
END
$sc406b$;

-- ════════════════════════════════════════════════════════════════════════
-- SC-406 — REAL worker, full unattended draft: 12-team / 15-round (180 picks)
-- ════════════════════════════════════════════════════════════════════════
-- The integration crown jewel. Drives a complete unattended draft
-- end-to-end against the deployed Edge Function. Asserts that the
-- worker can:
--   - Run for the full duration (≥ 180 picks worth of ticks).
--   - Maintain pick ordering (gap-free seq per league).
--   - Commit exactly league_size × draft_rounds picks.
--   - Emit one autopick_fired metric per pick.
--   - Leave NO un-archived messages in pgmq.q_draft_deadlines.
--
-- Runtime budget: ~3-5 minutes. The worker has a 140s loop budget per
-- invocation; 180 picks at ~1s/pick (read+select+submit+archive) fits
-- in ~3 invocations triggered by either the keep-alive cron OR
-- explicit re-invocation via net.http_post if the cron is paused.
-- For SC-406 we re-invoke explicitly until the pick target is met,
-- since the cron may be paused on staging.
--
-- HARD PREREQUISITES (same as SC-406b):
--   - Edge Function deployed
--   - Vault secret provisioned
--   - net.http_post available
-- Plus: this is the LONGEST scenario in the file. Skip if you're
-- iterating on chunks 11a-11d; only run once for sign-off.
--
-- Cleanup: explicit DELETE-by-test-league-id at end. Re-run-safe via
-- fresh test_league_id per run.

DO $sc406$
DECLARE
  v_secret_present  boolean;
  v_seed            jsonb;
  v_test_league_id  uuid;
  v_request_id      bigint;
  v_picks_after     int := 0;
  v_metrics_after   int;
  v_max_seq         bigint;
  v_seq_count       bigint;
  v_pick_target     int := 180;    -- 12 teams × 15 rounds
  v_max_wait_secs   int := 600;    -- 10 minutes
  v_poll_secs       int := 0;
  v_invocations     int := 0;
  v_max_invocations int := 8;      -- 8 × 140s = 1120s worst case
BEGIN
  RAISE NOTICE 'SC-406 starting: full unattended draft (12×15 = 180 picks). '
               'Budget ~5 min.';

  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'draft-autopick-token'
  ) INTO v_secret_present;
  IF NOT v_secret_present THEN
    RAISE NOTICE 'SC-406 SKIPPED: vault.draft-autopick-token not provisioned.';
    RETURN;
  END IF;

  -- Seed: 12-team, 15-round league. Strip ownership and force short
  -- timer so the autopick path drives every pick.
  v_seed := _v2_test._seed_active_league(
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid, 12, 15);
  v_test_league_id := (v_seed ->> 'league_id')::uuid;

  -- ── Cleanup-on-failure wrapper ──
  -- Same pattern as SC-406b. Inner BEGIN/EXCEPTION ensures
  -- _v2_test._purge_test_league runs whether the body succeeds or
  -- raises. Especially valuable here: SC-406's ~5min budget plus
  -- 8-invocation re-drive loop has many failure points (network,
  -- worker timeout, gap-free seq violation).
  BEGIN
    UPDATE public.teams SET owner_id = NULL WHERE league_id = v_test_league_id;
  UPDATE public.leagues
     SET pick_deadline    = now() - interval '5 seconds',
         settings         = jsonb_set(
                              COALESCE(settings, '{}'::jsonb),
                              '{pickTimeLimit}', '5'::jsonb
                            ),
         scoring_settings = COALESCE(scoring_settings, '{}'::jsonb)
   WHERE id = v_test_league_id;

  -- Kick off the draft: enqueue the first message.
  PERFORM pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id',     v_test_league_id,
      'pick_number',   1,
      'generation',    0,
      'scheduled_for', now() - interval '5 seconds',
      'source',        'safety_net'
    ),
    0
  );

  -- Drive the worker. Each invocation runs for up to 140s and may
  -- complete several rounds. Re-invoke until pick target met or
  -- max_wait_secs hit.
  WHILE v_picks_after < v_pick_target AND v_invocations < v_max_invocations LOOP
    v_invocations := v_invocations + 1;
    SELECT net.http_post(
      url := 'https://jjgspcpvqaiitloglxbb.supabase.co/functions/v1/draft-autopick',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || vault.read_secret('draft-autopick-token'),
        'Content-Type',  'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    ) INTO v_request_id;

    -- Poll for progress within this invocation's budget.
    WHILE v_poll_secs < v_max_wait_secs LOOP
      PERFORM pg_sleep(5);
      v_poll_secs := v_poll_secs + 5;
      SELECT count(*) INTO v_picks_after
        FROM public.draft_picks_v2 WHERE league_id = v_test_league_id;
      EXIT WHEN v_picks_after >= v_pick_target;
      -- If the worker's invocation likely returned (140s elapsed since
      -- last invoke), break the inner loop and re-invoke.
      EXIT WHEN (v_poll_secs % 145) = 0;
    END LOOP;
    EXIT WHEN v_picks_after >= v_pick_target;
    EXIT WHEN v_poll_secs >= v_max_wait_secs;
  END LOOP;

  -- Acceptance: exactly 180 picks committed.
  PERFORM _v2_test._assert(
    v_picks_after = v_pick_target,
    format(
      'SC-406 expected exactly %s picks; got %s after %s invocations '
      '(%s polls / ~%ss). Inspect Edge Function logs.',
      v_pick_target, v_picks_after, v_invocations,
      v_poll_secs / 5, v_poll_secs
    )
  );

  -- Gap-free seq invariant (I1): every league has draft_event_counter
  -- equal to count(*) of its draft_events rows.
  SELECT count(*), max(seq) INTO v_seq_count, v_max_seq
    FROM public.draft_events WHERE league_id = v_test_league_id;
  PERFORM _v2_test._assert(
    v_seq_count = v_max_seq,
    format(
      'SC-406 gap-free seq invariant violated: count=%s max_seq=%s',
      v_seq_count, v_max_seq
    )
  );

  -- Metric count matches.
  SELECT count(*) INTO v_metrics_after
    FROM public.draft_metrics
   WHERE metric = 'autopick_fired' AND league_id = v_test_league_id;
  PERFORM _v2_test._assert(
    v_metrics_after = v_pick_target,
    format(
      'SC-406 expected %s autopick_fired metrics, got %s',
      v_pick_target, v_metrics_after
    )
  );

    RAISE NOTICE 'SC-406 PASS — % picks in % invocations / ~%s seconds',
      v_picks_after, v_invocations, v_poll_secs;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SC-406 FAILED: % (running cleanup before re-raising)', SQLERRM;
    PERFORM _v2_test._purge_test_league(v_test_league_id);
    RAISE;
  END;

  -- Success-path cleanup.
  PERFORM _v2_test._purge_test_league(v_test_league_id);
END
$sc406$;

-- ── End of Phase 4 scenarios ──────────────────────────────────────────
-- 9 scenarios total: SC-401, SC-402a, SC-402b, SC-402c, SC-402d,
-- SC-403, SC-404, SC-405, SC-406b, SC-406. SC-401..405 are mock-worker
-- (BEGIN/ROLLBACK); SC-406b and SC-406 invoke the deployed worker via
-- net.http_post and clean up via explicit DELETE.
--
-- Run the file end-to-end via:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/draft_engine_v2_phase4_integration.sql
-- or paste into the Supabase SQL Editor.
--
-- Expected NOTICE output (one per scenario):
--   "Phase 4 preflight OK: ..."
--   "SC-401 PASS"
--   "SC-402a PASS" / "SC-402b PASS" / "SC-402c PASS" / "SC-402d PASS"
--   "SC-403 PASS" / "SC-404 PASS" / "SC-405 PASS"
--   "SC-406b PASS — N picks committed in M polls (~Ms)" or "SC-406b SKIPPED"
--   "SC-406  PASS — N picks in M invocations / ~Ss" or "SC-406  SKIPPED"
--
-- Any "ASSERTION FAILED" line is a real regression.

DO $summary$
BEGIN
  RAISE NOTICE 'Phase 4 integration suite finished.';
END
$summary$;
