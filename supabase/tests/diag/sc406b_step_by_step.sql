-- ════════════════════════════════════════════════════════════════════════
-- Phase 4 SC-406b cross-transaction diagnostic — runnable step-by-step
-- ════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS PROVES (or disproves):
--
--   Hypothesis: SC-406b's seed + net.http_post + polling all live in
--   one DO block (one transaction). The deployed worker runs in its
--   OWN transaction and can't see the test session's uncommitted
--   seed data, so its messages_processed comes back as 0 and the
--   polling assertion fails. After the assertion's RAISE, the test
--   tx rolls back, taking the seed and pgmq message with it.
--
--   This file separates seed, invoke, poll, and cleanup into FOUR
--   top-level statements. Each commits independently. If picks land
--   in Step 5 with this structure, the hypothesis is confirmed and
--   SC-406b/SC-406 in the integration suite need to be restructured.
--   If no picks land, the bug is elsewhere and we keep digging.
--
-- ── HOW TO RUN ──────────────────────────────────────────────────────────
--
-- 1. Generate a fresh UUID outside the SQL Editor (any UUID source —
--    your shell, an online generator, `python -c 'import uuid; print(uuid.uuid4())'`).
--
-- 2. Search-and-replace EVERY occurrence of <TEST_LEAGUE_ID> in this
--    file with that UUID. The placeholder appears in Steps 2, 3, 5,
--    and 6. Quotes are already in place — substitute the bare UUID
--    only.
--
-- 3. Paste the file into the Supabase SQL Editor and execute steps in
--    order. The Editor commits each top-level statement as its own
--    transaction by default — that's the whole point of this layout.
--    Wait for each step's result before running the next.
--
-- 4. After Step 5, check the Edge Function logs (Supabase Dashboard →
--    Edge Functions → draft-autopick → Logs). Look for the
--    invocation_id correlation between the worker_started log and
--    your test run.
--
-- 5. Step 6 (cleanup) MUST run regardless of outcome to leave staging
--    clean for the next attempt.
--
-- ── PREREQS ─────────────────────────────────────────────────────────────
--
--   - Edge Function deployed (chunk 11d).
--   - Vault secret 'draft-autopick-token' provisioned with the
--     service-role JWT.
--   - _v2_test helper schema present (Phase 2 file ran at least once).
--   - The two Phase 4 chunks 11a + 11c migrations applied
--     (draft_queues table + draft_autopick_dlq RPC).

-- ════════════════════════════════════════════════════════════════════════
-- STEP 1 — Sanity: confirm the test_league_id namespace is fresh.
-- ════════════════════════════════════════════════════════════════════════
-- Quick check that no prior diag run left rows for this UUID. If this
-- returns any nonzero count, you picked a UUID that already exists —
-- pick a different one.

SELECT
  (SELECT count(*) FROM public.leagues       WHERE id        = '<TEST_LEAGUE_ID>'::uuid) AS leagues_count,
  (SELECT count(*) FROM public.draft_picks_v2 WHERE league_id = '<TEST_LEAGUE_ID>'::uuid) AS picks_count,
  (SELECT count(*) FROM public.draft_metrics  WHERE league_id = '<TEST_LEAGUE_ID>'::uuid) AS metrics_count,
  (SELECT count(*) FROM pgmq.q_draft_deadlines
    WHERE (message ->> 'league_id')::uuid = '<TEST_LEAGUE_ID>'::uuid) AS pgmq_count;
-- Expect all zeros. If any are non-zero, pick a different UUID and
-- substitute again.

-- ════════════════════════════════════════════════════════════════════════
-- STEP 2 — Seed: create the league + 12 unowned teams + draft_order.
-- ════════════════════════════════════════════════════════════════════════
-- Wraps _v2_test._seed_active_league to use OUR pre-chosen UUID rather
-- than gen_random_uuid(). Done as a single DO block; commits when the
-- block exits. Strips team ownership so all picks go through autopick.
-- Sets pick_deadline 5s in the past so the deadline is already expired.

DO $step2$
DECLARE
  v_league_id  uuid := '<TEST_LEAGUE_ID>'::uuid;
  v_team_id    uuid;
  v_team_ids   uuid[] := ARRAY[]::uuid[];
  v_round      int;
  v_ordered    jsonb;
  v_session_id uuid := gen_random_uuid();
  i            int;
BEGIN
  -- League row (active, expired deadline, 12 teams, 1 round to keep
  -- the diag fast — extend later if needed).
  INSERT INTO public.leagues (
    id, name, commissioner_id,
    draft_state, league_size, draft_rounds, draft_event_counter,
    draft_generation, draft_shadow_mode, feature_flags,
    settings, scoring_settings, pick_deadline,
    join_code
  ) VALUES (
    v_league_id,
    format('SC406b diag %s', v_league_id),
    '882b59c9-8882-418b-9450-3fd004d57edd'::uuid,
    'active',
    12, 1, 0, 0, false, '{}'::jsonb,
    jsonb_build_object('pickTimeLimit', 5),
    '{}'::jsonb,
    now() - interval '5 seconds',
    'DIAG' || substring(replace(v_league_id::text, '-', ''), 1, 10)
  );

  -- 12 teams, all UNOWNED so every pick goes through autopick.
  FOR i IN 1..12 LOOP
    v_team_id := uuid_generate_v5(v_league_id, format('seed-team-%s', i));
    INSERT INTO public.teams (id, league_id, team_name, owner_id)
    VALUES (
      v_team_id,
      v_league_id,
      format('Diag Team %s', lpad(i::text, 2, '0')),
      NULL
    );
    v_team_ids := v_team_ids || v_team_id;
  END LOOP;

  -- One round of draft_order (round 1 forward).
  v_ordered := to_jsonb(v_team_ids);
  INSERT INTO public.draft_order (
    league_id, round_number, team_order, draft_session_id
  ) VALUES (
    v_league_id, 1, v_ordered, v_session_id
  );

  RAISE NOTICE 'Step 2 OK — league % seeded with 12 unowned teams + round 1 draft_order', v_league_id;
END
$step2$;
-- After this commits, the worker (when invoked in Step 4) will be
-- able to see the league, teams, and draft_order. That's the point.

-- ════════════════════════════════════════════════════════════════════════
-- STEP 3 — Enqueue a deadline message for pick 1.
-- ════════════════════════════════════════════════════════════════════════
-- Mocks what the sweep cron would have done for an expired league.
-- Single statement; commits immediately.

SELECT pgmq.send(
  'draft_deadlines',
  jsonb_build_object(
    'league_id',     '<TEST_LEAGUE_ID>'::uuid,
    'pick_number',   1,
    'generation',    0,
    'scheduled_for', now() - interval '5 seconds',
    'source',        'safety_net'
  ),
  0
) AS msg_id;
-- Returns msg_id; note it for log correlation later.

-- ── Verify the message landed and is committed (visible from this
-- session AND any other transaction). ──────────────────────────────────

SELECT msg_id, read_ct, enqueued_at, vt, message
  FROM pgmq.q_draft_deadlines
 WHERE (message ->> 'league_id')::uuid = '<TEST_LEAGUE_ID>'::uuid;
-- Expect 1 row. If 0 rows, Step 3's pgmq.send didn't commit (would be
-- a deeper bug than the cross-tx hypothesis predicts — surface
-- immediately).

-- ════════════════════════════════════════════════════════════════════════
-- STEP 4 — Invoke the worker.
-- ════════════════════════════════════════════════════════════════════════
-- Single net.http_post call; commits immediately. pg_net's background
-- worker dispatches the HTTPS request once this commits — that's when
-- the Edge Function actually boots and starts reading pgmq.

SELECT net.http_post(
  url := 'https://jjgspcpvqaiitloglxbb.supabase.co/functions/v1/draft-autopick',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'draft-autopick-token'),
    'Content-Type',  'application/json'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 150000
) AS request_id;
-- Returns a bigint request_id. Note it for cross-referencing
-- net.http_response in Step 5b.

-- ════════════════════════════════════════════════════════════════════════
-- STEP 5 — Wait for the worker to drain the queue and commit picks.
-- ════════════════════════════════════════════════════════════════════════
-- The Edge Function's loop reads the pgmq message, runs the §5.3 state
-- machine, and calls submit_pick_v2 for the on-the-clock team. Each
-- successful pick re-enqueues the next deadline message via Phase 2's
-- pgmq.send (spec §5.2.2), so ONE invocation drives the full round.

-- Sleep 30s, then check picks. (The Edge Function's loop has 5s tick
-- cadence + per-pick processing latency. 30s is generous for 12 picks.)
SELECT pg_sleep(30);

-- ── Step 5a — picks committed for this league? ────────────────────────
SELECT
  count(*)            AS picks_committed,
  array_agg(pick_number ORDER BY pick_number) AS pick_numbers,
  array_agg(team_id   ORDER BY pick_number)   AS team_ids,
  array_agg(player_id ORDER BY pick_number)   AS player_ids
  FROM public.draft_picks_v2
 WHERE league_id = '<TEST_LEAGUE_ID>'::uuid;
-- Expect picks_committed = 12 (one round of 12 teams) if cross-tx
-- hypothesis is correct.
-- Expect 0 if hypothesis is wrong — keep digging.

-- ── Step 5b — pg_net dispatch result for the request_id from Step 4 ──
-- Substitute <STEP4_REQUEST_ID> with the bigint returned by Step 4.
-- (If you forget, the most recent row by id is almost certainly it.)
SELECT id, status_code, content::text, created
  FROM net.http_response
 ORDER BY id DESC
 LIMIT 3;
-- Expect status_code = 200 with a JSON body containing
-- "messages_processed":12 and "early_exit":"loop_budget" or
-- "idle_timeout".
-- If status_code = 401 → auth still failing (different bug).
-- If no rows → pg_net hasn't dispatched yet; wait another 30s.

-- ── Step 5c — pgmq queue state ─────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pgmq.q_draft_deadlines
    WHERE (message ->> 'league_id')::uuid = '<TEST_LEAGUE_ID>'::uuid) AS active_msgs,
  (SELECT count(*) FROM pgmq.a_draft_deadlines
    WHERE (message ->> 'league_id')::uuid = '<TEST_LEAGUE_ID>'::uuid) AS archived_msgs;
-- Expect active_msgs = 0 (worker drained), archived_msgs = 12 (one
-- per pick that committed; each successful submit_pick_v2 enqueues
-- the NEXT pick's message which the worker also archives).

-- ── Step 5d — autopick_fired metrics ───────────────────────────────────
SELECT
  count(*)                                    AS metrics_count,
  array_agg(detail ->> 'picked_via' ORDER BY ts) AS picked_via_array
  FROM public.draft_metrics
 WHERE metric = 'autopick_fired'
   AND league_id = '<TEST_LEAGUE_ID>'::uuid;
-- Expect metrics_count = 12, picked_via_array filled with 'heuristic'
-- (since no draft_queues rows for this test).

-- ════════════════════════════════════════════════════════════════════════
-- STEP 6 — Cleanup. RUN THIS regardless of Step 5 outcome.
-- ════════════════════════════════════════════════════════════════════════

SELECT _v2_test._purge_test_league('<TEST_LEAGUE_ID>'::uuid);
-- Returns void. After this commits, every row tagged with the test
-- league_id (leagues, teams, draft_order, draft_events, draft_picks_v2,
-- draft_metrics, autopick_failures, draft_queues, q_draft_deadlines,
-- a_draft_deadlines) is deleted.

-- ── Verify cleanup ────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.leagues       WHERE id        = '<TEST_LEAGUE_ID>'::uuid) AS leagues_count,
  (SELECT count(*) FROM public.draft_picks_v2 WHERE league_id = '<TEST_LEAGUE_ID>'::uuid) AS picks_count,
  (SELECT count(*) FROM public.draft_metrics  WHERE league_id = '<TEST_LEAGUE_ID>'::uuid) AS metrics_count,
  (SELECT count(*) FROM pgmq.q_draft_deadlines
    WHERE (message ->> 'league_id')::uuid = '<TEST_LEAGUE_ID>'::uuid) AS pgmq_active_count,
  (SELECT count(*) FROM pgmq.a_draft_deadlines
    WHERE (message ->> 'league_id')::uuid = '<TEST_LEAGUE_ID>'::uuid) AS pgmq_archived_count;
-- Expect all zeros.

-- ════════════════════════════════════════════════════════════════════════
-- INTERPRETATION
-- ════════════════════════════════════════════════════════════════════════
--
-- Step 5a = 12 picks → cross-transaction hypothesis CONFIRMED.
--   Restructure SC-406b/SC-406 into 4 top-level statements (seed,
--   invoke, poll, cleanup) per the chunk 11e architectural fix.
--
-- Step 5a = 0 picks AND Step 5b shows status_code=200 →
--   Worker IS running but isn't processing the queue. Check Step 5b's
--   response body (messages_processed field). Could be: stale-gate
--   firing (state/generation/premature/pick_advanced), candidate
--   query failing (player_directory empty for season 2025), or an
--   unhandled error in the §5.3 state machine.
--
-- Step 5a = 0 picks AND Step 5b shows non-200 OR no rows →
--   Worker isn't even being invoked or auth is failing again.
--   Different bug; we re-investigate.
--
-- Step 5a = 12 picks AND Step 5c shows active_msgs > 0 →
--   Worker is mid-processing; wait another 30s and re-check.
