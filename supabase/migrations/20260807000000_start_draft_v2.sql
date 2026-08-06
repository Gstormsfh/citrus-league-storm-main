-- ============================================================================
-- F27 — start_draft_v2 (Commissioner Start)
-- ============================================================================
--
-- New RPC — replaces the ops flip script (scripts/proof/set-draft-status.local.mjs,
-- renamed to BREAK-GLASS in same PR). Signed-off design:
-- docs/DESIGN_F27_start_draft_v2.md (commit c8aabe32).
--
-- ── Idempotency note (implementation detail; design §5 Step 0 semantics) ────
--   submit_pick_v2 takes p_payload_hash from the caller; start_draft_v2's
--   payload is entirely SERVER-DETERMINED (now()-derived started_at,
--   settings-derived first_pick_deadline). Hash comparison on retry would
--   fail across second boundaries (started_at moves), so start_draft_v2's
--   Step 0 short-circuits on idempotency-key match ALONE, without hash
--   comparison. Semantics: same key → replay-safe return of stored
--   {event_id, seq, first_pick_deadline} regardless of when the retry
--   lands. Rider 3's "same click-session → replay" holds across any
--   time boundary. Guard against cross-event-type key reuse: Step 0
--   verifies stored payload has `first_pick_deadline` (i.e. it IS a
--   start event, not a pick or a lifecycle event that happened to reuse
--   the key by accident) — if not, raise `idempotency_conflict`.
--
--   started_at STILL uses `date_trunc('second', now())` for wire-clean
--   timestamps (matches submit_pick_v2's pick_deadline convention). The
--   truncation is not for hash-stability; it's for ISO-string cleanliness.
--
-- ── Property preservation (architect flag; parity with siblings) ─────────
--   SECURITY DEFINER + SET search_path = public. Consistent with
--   submit_pick_v2, draft_pause, draft_resume, draft_extend. STEP 3 of the
--   apply harness asserts these post-apply.
--
-- ── KI-034 discipline (design §4.1 Rider 1) ─────────────────────────────
--   Completed leagues carry draft_state='active' (F24 completion path
--   deliberately unwritten per Amendment 2). Status check must fire FIRST
--   so a completed league is refused via draft_already_completed, never
--   passed through to the state check where state='active' would mask
--   it as startable.
--
-- ── Amendment 3 discipline ──────────────────────────────────────────────
--   draft_order preflight filters AND deleted_at IS NULL — mirrors the
--   on-clock team_order SELECT at submit_pick_v2:Step 2. Same discipline,
--   same reason.
--
-- ── Amendment 4 discipline ──────────────────────────────────────────────
--   draft_events.payload_hash is NOT NULL. Server-computed sha256 of the
--   payload text. append_draft_event forwards this into the INSERT verbatim.
--
-- ── Acceptance ─────────────────────────────────────────────────────────
--   Lifecycle acceptance run (Rider 4): button-to-banner. Asserts A/B/C/D/E
--   pre-registered. Zero-client acceptance run (Rider 2): 5-step scenario.
--   Both required for F27 close. Engine deploy pairs F26 + F27 switch cases
--   in the same PR — first deploy since 527ceb38.
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

  SELECT commissioner_id, draft_state, draft_status::text, league_size, settings
    INTO v_commissioner, v_draft_state, v_draft_status, v_league_size, v_settings
    FROM public.leagues
   WHERE id = p_league_id;

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

  -- ── Step 2: Preflight — 5-step Rider 1 ordered taxonomy ──────────────
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
  -- Single UPDATE, same row lock as the counter increment inside
  -- append_draft_event (which acquired the leagues row lock). No race
  -- with a concurrent submit — the submit path's Step 2 draft_state check
  -- would see the row after this UPDATE commits.
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
'Spec §4.5-analog / §6.4 emitter — commissioner-authored draft ignition. Three atomic column writes (draft_state=active, draft_status=in_progress, pick_deadline) + draft_started event emission. Rider 1 ordered preflight taxonomy: completed→refuse, in_progress→refuse, illegal combo→refuse, startable→proceed. Rider 3 idempotency: caller-supplied per click-session; server-computed sha256 hash; date_trunc(second, now()) keeps within-second retries replay-safe. See docs/DESIGN_F27_start_draft_v2.md (commit c8aabe32) for full design + Riders 1-4.';
