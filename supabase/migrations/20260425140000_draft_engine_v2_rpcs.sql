-- Draft Engine v2 — Phase 2 RPCs and projection trigger.
--
-- Builds on Phase 1's foundation (`draft_events`, `draft_picks_v2`,
-- `leagues` column adds). Adds the SECURITY DEFINER RPCs that are the
-- ONLY way anything writes to `draft_events`, plus the AFTER INSERT
-- trigger that synchronously projects pick events into `draft_picks_v2`.
--
-- Spec references (every block below cites a section in
-- `docs/DRAFT_ENGINE_V2_SPEC.md`):
--   §4.1  validate_draft_event_payload
--   §4.2  append_draft_event
--   §4.3  record_shadow_event (hard-guarded shadow path)
--   §4.4  reconstruct_draft_state (rebuild/repair only)
--   §4.5  submit_pick_v2 (the pick path with idempotency + preflight)
--   §4.6  draft_pause / draft_resume / draft_extend (commissioner)
--   §3.2  tg_draft_events_project_pick (synchronous projection)
--   §5.2  pick submission state machine (preflight ordering)
--   §5.2.2  deadline rounding rule (CEIL + 1s pad)
--   §6     event catalog (payload schemas)
--
-- ── Sequencing nudge vs. plan ──────────────────────────────────────────
-- The plan put pgmq install + queue creation in Phase 3. submit_pick_v2
-- (Phase 2 per the plan) calls pgmq.send, which would fail at runtime
-- without the queue. To keep the RPC functional from day one of Phase 2,
-- we install pgmq + create the queue HERE. Phase 3 still adds the sweep,
-- the metrics table, the worker scaffold, and the pg_cron schedule.
--
-- ── Out of scope for Phase 2 ───────────────────────────────────────────
-- - Sweep RPC, pg_cron schedules, worker (Phase 3).
-- - Autopick state machine inside the worker (Phase 4).
-- - draft_metrics table — submit_pick_v2 emits structured RAISE NOTICE
--   logs; metric counters land when Phase 6 wires them.
-- - pick_undone, commissioner_override RPCs (v2.1, deferred).

-- ── 0. pgmq extension + the deadline queue ────────────────────────────
-- The runbook §2.1 verified Postgres is outside the pgmq drop_queue
-- bug window before this migration runs.

CREATE EXTENSION IF NOT EXISTS pgmq;

-- pgmq.create is idempotent: re-running this migration is safe.
SELECT pgmq.create('draft_deadlines');

-- ── 1. validate_draft_event_payload ───────────────────────────────────
-- Spec §4.1, §6 (event catalog).
--
-- Every payload going into draft_events is checked here BEFORE insert.
-- Rejects unknown event types, missing required fields, and
-- (where the spec is closed) unknown fields. Raises
-- `invalid_event_payload` on failure (spec §11.1 error code).
--
-- Called from inside submit_pick_v2 / append_draft_event /
-- record_shadow_event. Returns true on valid; raises otherwise.

CREATE OR REPLACE FUNCTION public.validate_draft_event_payload(
  p_event_type text,
  p_payload    jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_required text[];
  v_field    text;
BEGIN
  -- Spec §6 catalog. Each branch enumerates the REQUIRED fields.
  -- Optional fields are tolerated; unknown fields are rejected by
  -- a final pass that compares JSONB keys to the allowed set.

  CASE p_event_type
    WHEN 'pick' THEN
      -- §6.1
      v_required := ARRAY['pick_number','round','team_id','player_id','picked_at','is_autopick'];

    WHEN 'pick_undone' THEN
      -- §6.2 (reserved v2.1)
      v_required := ARRAY['target_event_id','reason'];

    WHEN 'autopick_failed' THEN
      -- §6.3
      v_required := ARRAY['pick_number','generation','read_ct','last_error','pgmq_msg_id'];

    WHEN 'draft_started' THEN
      -- §6.4
      v_required := ARRAY['started_at','first_pick_deadline','total_rounds','total_teams','pick_time_limit_seconds','draft_format'];

    WHEN 'draft_paused' THEN
      -- §6.5
      v_required := ARRAY['paused_at','paused_pick_number','remaining_seconds','reason'];

    WHEN 'draft_resumed' THEN
      -- §6.6
      v_required := ARRAY['resumed_at','resumed_pick_number','new_pick_deadline'];

    WHEN 'draft_extended' THEN
      -- §6.7
      v_required := ARRAY['extended_at','pick_number','extra_seconds','new_pick_deadline'];

    WHEN 'draft_completed' THEN
      -- §6.8
      v_required := ARRAY['completed_at','total_picks'];

    WHEN 'draft_cancelled' THEN
      -- §6.9 (cancelled_at_pick_number is optional)
      v_required := ARRAY['cancelled_at','reason'];

    WHEN 'commissioner_override' THEN
      -- §6.10 (reserved v2.1; permissive — schema not finalized)
      RETURN true;

    WHEN 'generation_bumped' THEN
      -- §6.11
      v_required := ARRAY['old_generation','new_generation','reason'];

    ELSE
      RAISE EXCEPTION 'invalid_event_payload: unknown event_type %', p_event_type
        USING ERRCODE = 'check_violation';
  END CASE;

  -- Required-fields check.
  FOREACH v_field IN ARRAY v_required LOOP
    IF NOT (p_payload ? v_field) THEN
      RAISE EXCEPTION 'invalid_event_payload: % missing required field "%"',
        p_event_type, v_field
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Spot-check critical types where a wrong type would corrupt the
  -- projection or invariant predicates (spec §10).
  IF p_event_type = 'pick' THEN
    IF jsonb_typeof(p_payload->'pick_number') <> 'number' THEN
      RAISE EXCEPTION 'invalid_event_payload: pick.pick_number must be a number'
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(p_payload->'player_id') <> 'number' THEN
      -- Spec §3.2 deliberately uses int; v1 used text. Hard-fail here so
      -- shadow-mode trigger errors surface in shadow_trigger_errors
      -- instead of corrupting the projection.
      RAISE EXCEPTION 'invalid_event_payload: pick.player_id must be a number'
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(p_payload->'is_autopick') <> 'boolean' THEN
      RAISE EXCEPTION 'invalid_event_payload: pick.is_autopick must be a boolean'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.validate_draft_event_payload(text, jsonb) IS
  'Spec §4.1: payload-shape validator. Called before INSERT into draft_events from every RPC. Raises invalid_event_payload (check_violation) on mismatch.';

-- ── 2. tg_draft_events_project_pick — synchronous projection ─────────
-- Spec §3.2 (projection table), §3.2 final paragraph (this trigger is
-- the SOLE writer to draft_picks_v2), principle P6.
--
-- Fires AFTER INSERT FOR EACH ROW on draft_events, inside the same
-- transaction as the event insert. For event_type='pick', writes a
-- corresponding row into draft_picks_v2. For 'pick_undone' (v2.1),
-- removes the projection row by source_event_id. For all other event
-- types, no-op (lifecycle events don't change the picks projection).
--
-- Invariant I16 (projection ↔ log) is what makes this safe: a
-- standalone pg_cron check verifies the row counts agree per league.
-- If they ever diverge, reconstruct_draft_state (§4.4) is the
-- rebuild/repair tool.

CREATE OR REPLACE FUNCTION public.tg_draft_events_project_pick()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type = 'pick' THEN
    -- Synchronous projection insert. The unique (league_id, pick_number)
    -- on draft_picks_v2 enforces I3 (no duplicate picks) at the
    -- projection layer; combined with the idempotency_key uniqueness
    -- on draft_events (I4), at-most-once pick semantics are guaranteed.
    INSERT INTO public.draft_picks_v2 (
      league_id,
      pick_number,
      round,
      team_id,
      player_id,
      picked_at,
      picked_by_actor,
      source_event_id,
      source_seq
    )
    VALUES (
      NEW.league_id,
      (NEW.payload ->> 'pick_number')::int,
      (NEW.payload ->> 'round')::int,
      (NEW.payload ->> 'team_id')::uuid,
      (NEW.payload ->> 'player_id')::int,
      (NEW.payload ->> 'picked_at')::timestamptz,
      NEW.actor,
      NEW.id,
      NEW.seq
    );
    RETURN NEW;

  ELSIF NEW.event_type = 'pick_undone' THEN
    -- Reserved for v2.1. The pick_undone event identifies the target
    -- pick by its source draft_events.id; remove that projection row.
    -- Spec §6.2: undo is rejected if any subsequent pick exists; the
    -- RPC enforces that. Here we just reflect the deletion.
    DELETE FROM public.draft_picks_v2
     WHERE source_event_id = (NEW.payload ->> 'target_event_id')::bigint;
    RETURN NEW;
  END IF;

  -- All lifecycle events (draft_started, draft_paused, etc.) and
  -- non-pick events (autopick_failed, generation_bumped) are no-ops
  -- for the projection. The event log itself carries the state.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS draft_events_project_pick_trg ON public.draft_events;
CREATE TRIGGER draft_events_project_pick_trg
  AFTER INSERT ON public.draft_events
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_draft_events_project_pick();

COMMENT ON FUNCTION public.tg_draft_events_project_pick() IS
  'Spec §3.2: sole writer to draft_picks_v2. Synchronous projection of pick events; in-txn with the event insert. Invariant I16 verifies consistency.';

-- ── 3a. append_draft_event — generic non-pick event writer ────────────
-- Spec §4.2.
--
-- Used for lifecycle events (draft_started, draft_paused, draft_resumed,
-- draft_extended, draft_completed, draft_cancelled) and worker-emitted
-- events (autopick_failed, generation_bumped). NOT used for picks —
-- those go through submit_pick_v2 which adds the state-machine preflight.
--
-- Concurrency: a transaction-scoped advisory lock keyed on the
-- idempotency_key serializes concurrent submissions of the same key.
-- This eliminates the "two threads pass the existence check, both
-- advance the counter, one's INSERT fails with unique_violation,
-- counter has advanced but no event landed" race that would create
-- a gap and violate invariant I1.
--
-- When p_idempotency_key IS NULL, no advisory lock is taken and no
-- existence check is run — caller accepts that retries may double-write.
-- This is the path lifecycle events use when the caller can guarantee
-- single-fire semantics (e.g. trigger-driven, single-commissioner).

CREATE OR REPLACE FUNCTION public.append_draft_event(
  p_league_id        uuid,
  p_event_type       text,
  p_payload          jsonb,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_actor            jsonb,
  p_correlation_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id    bigint;
  v_existing_seq   bigint;
  v_existing_hash  text;
  v_new_seq        bigint;
  v_event_id       bigint;
  v_correlation_id uuid;
BEGIN
  -- Idempotency replay path: only when caller supplied a key.
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('draft_events_idem:' || p_idempotency_key::text)
    );

    SELECT id, seq, payload_hash
      INTO v_existing_id, v_existing_seq, v_existing_hash
      FROM public.draft_events
     WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      IF v_existing_hash = p_payload_hash THEN
        RETURN jsonb_build_object(
          'event_id',      v_existing_id,
          'seq',           v_existing_seq,
          'was_duplicate', true
        );
      ELSE
        -- Spec §11.1: idempotency_conflict.
        RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
          USING ERRCODE = 'unique_violation';
      END IF;
    END IF;
  END IF;

  -- Validate payload shape against the §6 catalog.
  PERFORM public.validate_draft_event_payload(p_event_type, p_payload);

  -- Advance the per-league gap-free seq.
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  IF v_new_seq IS NULL THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Spec §4.5 step 3: correlation_id := COALESCE(supplied, generated).
  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, p_event_type, p_payload, p_payload_hash,
    p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  RAISE NOTICE 'append_draft_event committed: event_id=%, seq=%, type=%',
    v_event_id, v_new_seq, p_event_type;

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.append_draft_event(uuid,text,jsonb,uuid,text,jsonb,uuid) IS
  'Spec §4.2: writes lifecycle and worker events. Idempotency-keyed callers serialized via per-key advisory lock to keep seq gap-free (invariant I1).';

-- ── 3b. record_shadow_event — shadow-mode-only path ───────────────────
-- Spec §4.3.
--
-- Called EXCLUSIVELY by the Phase 8 v1→v2 trigger that fires on
-- draft_picks INSERT during shadow mode. Records a 'pick' event in
-- draft_events SO THE PROJECTION TRIGGER builds draft_picks_v2 — but
-- skips submit_pick_v2's state-machine preflight by design.
--
-- Why preflight is skipped: in shadow mode v1 is the source of truth.
-- v2 is recording, not validating. submit_pick_v2's preflight (current
-- pick number, on-the-clock check, not-already-picked, auth) would
-- reject any time v1's authoritative state diverged — commissioner SQL
-- fix, error-path retry, batched insert — and shadow mode would break
-- silently the first time v1 did anything atypical. The diff job
-- (Phase 8) catches divergence; this RPC must not.
--
-- ── Three hard guards (see spec §4.3) ──
--   #1: auth.role() must be 'service_role'. The Phase 8 trigger runs
--       as the postgres role; only that role + service_role pass this.
--       Stops anyone from reaching this RPC via PostgREST.
--   #2: payload->'actor'->>'kind' must be 'shadow'. The only legal
--       actor for this RPC. Defends against the trigger being
--       repurposed or a payload being hand-crafted.
--   #3: leagues.draft_shadow_mode must be true for this league.
--       Defends against the trigger firing during the cutover window
--       when shadow mode has been turned off.
-- All three RAISE EXCEPTION on violation.

CREATE OR REPLACE FUNCTION public.record_shadow_event(
  p_league_id        uuid,
  p_payload          jsonb,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_correlation_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor          jsonb;
  v_shadow_mode    boolean;
  v_existing_id    bigint;
  v_existing_seq   bigint;
  v_existing_hash  text;
  v_new_seq        bigint;
  v_event_id       bigint;
  v_correlation_id uuid;
BEGIN
  -- ── Guard #1: service_role only.
  -- auth.role() returns 'service_role' for service-key callers and
  -- 'postgres' for direct DB connections (e.g., a SECURITY DEFINER
  -- trigger). Both are acceptable; anything else (anon, authenticated)
  -- is rejected.
  IF auth.role() NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'shadow_guard_violated: caller role % is not service_role',
      auth.role()
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Guard #2: actor.kind must be 'shadow'.
  v_actor := p_payload -> 'actor';
  IF v_actor IS NULL OR (v_actor ->> 'kind') IS DISTINCT FROM 'shadow' THEN
    RAISE EXCEPTION 'shadow_guard_violated: payload.actor.kind must be ''shadow'' (got %)',
      COALESCE(v_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Guard #3: leagues.draft_shadow_mode must be true.
  SELECT draft_shadow_mode INTO v_shadow_mode
    FROM public.leagues
   WHERE id = p_league_id;

  IF v_shadow_mode IS NULL THEN
    RAISE EXCEPTION 'shadow_guard_violated: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_shadow_mode = false THEN
    RAISE EXCEPTION 'shadow_guard_violated: leagues.draft_shadow_mode is false for league %',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- All three guards passed. Now run the same seq + idempotency
  -- machinery as append_draft_event, but with event_type hardcoded
  -- to 'pick' and NO state-machine preflight.

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'shadow_guard_violated: p_idempotency_key is required'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      -- v1's trigger may re-fire under transaction retry. Same payload
      -- → no-op return. Spec §4.3 final paragraph: "re-fires are no-ops
      -- at record_shadow_event's ON CONFLICT".
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'was_duplicate', true
      );
    ELSE
      -- Different payload under same key. The trigger logs this to
      -- shadow_trigger_errors (Phase 8) and does NOT propagate up to
      -- v1's transaction.
      RAISE EXCEPTION 'idempotency_conflict: same shadow key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- Validate payload shape (event_type = 'pick'; required fields per §6.1).
  PERFORM public.validate_draft_event_payload('pick', p_payload);

  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'pick', p_payload, p_payload_hash,
    p_idempotency_key, v_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  RAISE NOTICE 'record_shadow_event committed: event_id=%, seq=%, league_id=%',
    v_event_id, v_new_seq, p_league_id;

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.record_shadow_event(uuid,jsonb,uuid,text,uuid) IS
  'Spec §4.3: shadow-mode-only path. Three hard guards (service_role, actor.kind=shadow, leagues.draft_shadow_mode=true). Skips state-machine preflight by design — diff job catches divergence in Phase 8.';

