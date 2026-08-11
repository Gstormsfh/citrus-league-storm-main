-- ============================================================================
-- E100 IGNITION-RACE (P0) — start_draft_v2 preflight row lock
-- ============================================================================
--
-- ⚠ P0 platform-grade correctness fix. LOAD-1-NIGHT Phase 3 same-league
-- contention rung (2026-08-11, forensic league `ada00006-…-01`) proved that
-- concurrent `start_draft_v2` calls with DIFFERENT idempotency keys can
-- produce MULTIPLE `draft_started` events AND flip a `completed` league
-- back to `in_progress`. Full ledger receipts in inbox Entry 100.
--
-- ── The race (pre-fix) ─────────────────────────────────────────────────
--   1. Four callers arrive nearly-simultaneously, each with its own
--      idempotency key.
--   2. Step 0's per-key advisory lock (hashtext(':' || key)) does not
--      serialize them — different keys hash to different lock slots.
--   3. All four Step 2 preflight reads are read-committed against a
--      stale 'not_started' snapshot BEFORE any common row lock is held.
--   4. All four pass preflight.
--   5. Step 6's append_draft_event increments leagues.draft_event_counter
--      (which acquires the row lock at last), so the writers serialize
--      HERE — but each still emits its own draft_started event, and
--      Step 7's unconditional UPDATE to draft_status='in_progress' fires
--      LAST-committer-wins, even over 'completed'.
--   6. Final state: seq 1 draft_started + seq 2-13 picks + seq 14
--      draft_completed + seq 15/16/17 THREE MORE draft_starteds committed
--      after the completion; league reads status='in_progress' behind a
--      draft_completed event. Status monotonicity broken.
--
-- ── The fix (Entry 100 fix order item 1, pre-ratified shape) ───────────
--   Acquire the `leagues` row lock at PREFLIGHT — `SELECT … FROM leagues
--   WHERE id = p_league_id FOR UPDATE`. Concurrent ignitions serialize
--   on the row lock; the second caller then re-reads committed state
--   (post first's commit → status='in_progress' or 'completed') and
--   correctly refuses via the existing Rider 1 taxonomy at Steps 2.1/2.2.
--
--   The one-liner change is bounded to Step 2's leagues SELECT. Every
--   other step is byte-identical to 20260807000000_start_draft_v2.sql
--   (F27's original migration) — this file is a targeted CREATE OR
--   REPLACE that swaps the function body in place.
--
-- ── submit_pick_v2 sibling-race AUDIT (Entry 100 fix order item 2) ────
--   Audit finding: submit_pick_v2's same-pick-number double-tap race
--   (two fresh idem keys) IS PROTECTED BY THE STORAGE LAYER. The
--   `draft_picks_v2` table (foundation migration 20260425130000:108)
--   declares `PRIMARY KEY (league_id, pick_number)`. The AFTER INSERT
--   trigger `tg_draft_events_project_pick` writes into draft_picks_v2
--   as part of the pick's transaction; a duplicate pick_number for the
--   same league raises unique_violation atomically, rolling back the
--   whole transaction (draft_events INSERT + counter increment).
--
--   Belt present. Suspenders (row-lock preflight in submit_pick_v2)
--   deferred to a follow-up cycle — cleaner error semantics but not
--   required for correctness. Docket in R93 outbox for architect
--   ratification of the follow-up shape.
--
-- ── Idempotency semantics preserved ────────────────────────────────────
--   Step 0's short-circuit runs BEFORE the row lock, so a genuine retry
--   with the same key still short-circuits on the stored event
--   without waiting on other keys' row locks. That path is unchanged.
--
-- ── Deployment note ────────────────────────────────────────────────────
--   Migration is CREATE OR REPLACE FUNCTION — no downtime, no data
--   change, no lock storm. Apply via the standard apply-migration harness.
--   Rollback is trivial: re-apply 20260807000000_start_draft_v2.sql (the
--   pre-lock body) via the same harness.
--
-- ── Regression tests (Entry 100 fix order item 3) ─────────────────────
--   Offline: dryrun-apply-ignition-race-fix-checks.local.mjs asserts the
--   FOR UPDATE marker is present + every pre-fix structural check from
--   the original F27 dryrun still passes.
--
--   Live (deferred to architect's rig lane per hand-off protocol):
--     - concurrent-ignition: two sessions racing on the same league, 2nd
--       must refuse via draft_already_in_progress
--     - completed-league ignition refusal in the race window: 2nd caller
--       lands after 1st has advanced to draft_completed, must refuse via
--       draft_already_completed
--     - The forensic league `ada00006-…-01` from LOAD-1-NIGHT stays in
--       load1_leagues tracking as the expected-forbidden regression
--       fixture per E100 item 4.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_draft_v2(
  p_league_id        uuid,
  p_actor            jsonb,
  p_idempotency_key  uuid,
  p_correlation_id   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Idempotency short-circuit vars
  v_existing_id       bigint;
  v_existing_seq      bigint;
  v_existing_hash     text;
  v_existing_payload  jsonb;

  -- Preflight vars
  v_draft_state    text;
  v_draft_status   text;
  v_commissioner   uuid;
  v_league_size    int;
  v_settings       jsonb;

  -- draft_order preflight
  v_round1_team_order jsonb;
  v_total_rounds      int;

  -- Auth vars
  v_actor_kind    text;
  v_caller_role   text;

  -- Payload build vars
  v_started_at              timestamptz;
  v_pick_time               int;
  v_first_pick_deadline     timestamptz;
  v_draft_format            text;
  v_payload                 jsonb;
  v_payload_hash            text;

  -- Emit + return vars
  v_correlation_id  uuid;
  v_new_seq         bigint;
  v_event_id        bigint;
BEGIN
  -- ── Step 0: Idempotency short-circuit ────────────────────────────────
  -- Mirror submit_pick_v2:Step 1. Advisory lock keyed on the idem key
  -- serializes concurrent retries with the same key.
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_input: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash, payload
    INTO v_existing_id, v_existing_seq, v_existing_hash, v_existing_payload
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- Key hit. The stored event MUST have a `first_pick_deadline` in its
    -- payload — the cross-event-type reuse guard. Any lifecycle/pick
    -- event that stored under the same key would lack this field and
    -- represent an unrelated action; raise conflict rather than replay-
    -- returning something incoherent.
    IF NOT (v_existing_payload ? 'first_pick_deadline') THEN
      RAISE EXCEPTION 'idempotency_conflict: key % previously used for a non-start event (stored payload has no first_pick_deadline)',
        p_idempotency_key
        USING ERRCODE = 'unique_violation';
    END IF;

    -- Retry-safe replay: return the stored values regardless of when
    -- this call landed relative to the original. No hash comparison —
    -- start_draft_v2's payload contains now()-derived fields that would
    -- diverge across retries; hash-comparison semantics would break
    -- retry-safety across second boundaries. Key match alone is the
    -- idempotency contract (see header note).
    RETURN jsonb_build_object(
      'event_id',            v_existing_id,
      'seq',                 v_existing_seq,
      'first_pick_deadline', v_existing_payload ->> 'first_pick_deadline',
      'was_duplicate',       true
    );
  END IF;

  -- ── Step 1: Authorization ────────────────────────────────────────────
  -- Byte-for-byte the pattern used by draft_pause / draft_resume /
  -- draft_extend at 20260425140000_...:982-1004.

  v_actor_kind := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: start_draft_v2 requires actor.kind=commissioner (got %)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Step 2: Preflight — 5-step Rider 1 ordered taxonomy ──────────────
  --
  -- E100 IGNITION-RACE FIX (2026-08-11): the leagues SELECT is now
  -- FOR UPDATE. Concurrent ignitions with DIFFERENT idempotency keys
  -- serialize on this row lock; the second caller blocks until the
  -- first commits its Step 7 UPDATE (which advances draft_status to
  -- 'in_progress' or the draft_completed emitter has landed status
  -- 'completed'), then re-reads the committed state and refuses via
  -- the existing Rider 1 taxonomy below (draft_already_in_progress or
  -- draft_already_completed).
  --
  -- Pre-fix, this SELECT was a bare read-committed read; the row lock
  -- was only acquired implicitly at Step 6's UPDATE inside
  -- append_draft_event, by which point each racer had already read a
  -- stale 'not_started' snapshot and emitted its own draft_started
  -- event. See migration header for the full forensic ledger.
  SELECT commissioner_id, draft_state, draft_status::text, league_size, settings
    INTO v_commissioner, v_draft_state, v_draft_status, v_league_size, v_settings
    FROM public.leagues
   WHERE id = p_league_id
   FOR UPDATE;

  IF v_commissioner IS NULL THEN
    -- Either the league doesn't exist OR commissioner_id is somehow NULL
    -- (schema says NOT NULL but defense-in-depth).
    IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id) THEN
      RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
        USING ERRCODE = 'no_data_found';
    END IF;
    RAISE EXCEPTION 'illegal_state: league % has no commissioner_id', p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Status check FIRST (KI-034 discipline).

  -- Rider 1 step 1: completed → hard refuse (no restart).
  IF v_draft_status = 'completed' THEN
    RAISE EXCEPTION 'draft_already_completed: league % draft is already completed; restart not permitted',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rider 1 step 2: in_progress → refuse.
  IF v_draft_status = 'in_progress' THEN
    RAISE EXCEPTION 'draft_already_in_progress: league % draft is already in progress',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rider 1 step 3: status IN (not_started, queued) AND state <> 'not_started'
  -- → illegal combo.
  IF v_draft_status IN ('not_started', 'queued')
     AND v_draft_state IS DISTINCT FROM 'not_started'
  THEN
    RAISE EXCEPTION 'draft_state_not_startable: league % draft_status=% but draft_state=% (illegal combo)',
      p_league_id, v_draft_status, COALESCE(v_draft_state, '<null>')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rider 1 step 5: unexpected status value (defense against enum drift).
  IF v_draft_status NOT IN ('not_started', 'queued') THEN
    RAISE EXCEPTION 'draft_state_not_startable: league % has unexpected draft_status=%',
      p_league_id, v_draft_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- draft_order preflight — Amendment 3 filter.
  IF v_league_size IS NULL OR v_league_size <= 0 THEN
    RAISE EXCEPTION 'draft_not_configured: league % has invalid league_size=%',
      p_league_id, COALESCE(v_league_size::text, '<null>')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT team_order
    INTO v_round1_team_order
    FROM public.draft_order
   WHERE league_id = p_league_id
     AND round_number = 1
     AND deleted_at IS NULL;

  IF v_round1_team_order IS NULL THEN
    RAISE EXCEPTION 'draft_not_configured: league % has no round-1 draft_order (deleted_at IS NULL)',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_array_length(v_round1_team_order) = 0 THEN
    RAISE EXCEPTION 'draft_not_configured: league % round-1 team_order is empty',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_array_length(v_round1_team_order) <> v_league_size THEN
    RAISE EXCEPTION 'draft_not_configured: league % round-1 team_order length=% but league_size=%',
      p_league_id, jsonb_array_length(v_round1_team_order), v_league_size
      USING ERRCODE = 'check_violation';
  END IF;

  -- total_rounds: count of live draft_order rows (Amendment 3 filter).
  SELECT count(*)
    INTO v_total_rounds
    FROM public.draft_order
   WHERE league_id = p_league_id
     AND deleted_at IS NULL;

  IF v_total_rounds <= 0 THEN
    RAISE EXCEPTION 'draft_not_configured: league % has no live draft_order rows',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Step 3: Compute first deadline (mirror submit_pick_v2:263-265) ───
  -- date_trunc('second', now()) keeps started_at + first_pick_deadline
  -- stable across within-second retries (Step 0 idempotency semantics).
  v_started_at := date_trunc('second', now());
  v_pick_time := COALESCE(
    (v_settings ->> 'pickTimeLimit')::int,
    90
  );
  v_first_pick_deadline := v_started_at
                        + make_interval(secs => ceil(v_pick_time)::int)
                        + interval '1 second';

  -- ── Step 4: Build payload (all six §6.4 required fields) ─────────────
  -- draft_format extracted from settings. Falls back to 'snake' — the
  -- historical default across every draft in this engine.
  v_draft_format := COALESCE(v_settings ->> 'draftType', 'snake');

  v_payload := jsonb_build_object(
    'started_at',               v_started_at,
    'first_pick_deadline',      v_first_pick_deadline,
    'total_rounds',             v_total_rounds,
    'total_teams',              v_league_size,
    'pick_time_limit_seconds',  v_pick_time,
    'draft_format',             v_draft_format
  );

  PERFORM public.validate_draft_event_payload('draft_started', v_payload);

  -- ── Step 5: Hash payload (Amendment 4) ───────────────────────────────
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  -- ── Step 6: Emit event via append_draft_event ────────────────────────
  -- append_draft_event stamps event_version=1 (default; same as
  -- draft_completed per KI-029 observation). Correlation reused if caller
  -- provided one; else RPC generates for observability threading.
  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  -- append_draft_event returns jsonb: {event_id, seq, was_duplicate}.
  -- Under our Step 0 short-circuit, we only reach here on a fresh key
  -- (was_duplicate=false), but defense-in-depth against a race:
  -- append_draft_event's OWN idempotency check might return replay if
  -- a concurrent call inserted between our Step 0 SELECT and this call.
  -- Since our Step 0's advisory_xact_lock serializes with append's own
  -- lock (same hashtext key), that race is closed — but the code still
  -- handles the jsonb return shape correctly if it happens.
  DECLARE
    v_append_result jsonb;
  BEGIN
    v_append_result := public.append_draft_event(
      p_league_id,
      'draft_started',
      v_payload,
      p_idempotency_key,
      v_payload_hash,
      p_actor,
      v_correlation_id
    );
    v_event_id := (v_append_result ->> 'event_id')::bigint;
    v_new_seq  := (v_append_result ->> 'seq')::bigint;
  END;

  -- ── Step 7: Atomic column writes ─────────────────────────────────────
  -- Single UPDATE, same row lock already held from Step 2's FOR UPDATE
  -- (E100 fix). No race with a concurrent submit — the submit path's
  -- Step 2 draft_state check would see the row after this UPDATE commits.
  UPDATE public.leagues
     SET draft_state    = 'active',
         draft_status   = 'in_progress',
         pick_deadline  = v_first_pick_deadline
   WHERE id = p_league_id;

  -- ── Step 8: Return ───────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'event_id',            v_event_id,
    'seq',                 v_new_seq,
    'first_pick_deadline', v_first_pick_deadline,
    'was_duplicate',       false
  );

END;
$$;

COMMENT ON FUNCTION public.start_draft_v2(uuid,jsonb,uuid,uuid) IS
'E100 IGNITION-RACE fix (2026-08-11): Step 2 leagues SELECT acquires FOR UPDATE row lock at preflight, serializing concurrent ignitions with different idempotency keys. The second caller re-reads committed state post-first-commit and refuses via draft_already_in_progress or draft_already_completed. Prior migration (20260807000000_start_draft_v2.sql) held the row lock only implicitly at Step 6/7, allowing multiple draft_starteds + status regression from ''completed'' back to ''in_progress'' under concurrent ignition. All other steps byte-identical to F27 original per docs/DESIGN_F27_start_draft_v2.md.';
