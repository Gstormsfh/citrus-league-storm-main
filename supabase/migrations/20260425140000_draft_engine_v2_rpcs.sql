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

-- ── 4. reconstruct_draft_state — rebuild/repair tool ──────────────────
-- Spec §4.4. Reads draft_events ONLY. Returns the full derived state
-- of a league as JSON.
--
-- This is NOT the hot-path read. The hot-path read is
-- SELECT FROM draft_picks_v2 (the synchronous projection maintained
-- by tg_draft_events_project_pick). This function exists for:
--   - Seeding draft_picks_v2 from scratch on migration / re-bootstrap.
--   - Diagnosing invariant I16 violations (projection ↔ log drift).
--   - Recovery after a corrupted projection.
--   - Phase 8 shadow-mode diff scripts.
--
-- The function is idempotent and side-effect-free: same league →
-- same JSON output, with only `now()`-derived fields varying.

CREATE OR REPLACE FUNCTION public.reconstruct_draft_state(
  p_league_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_size       int;
  v_draft_state       text;
  v_generation        int;
  v_pick_count        int;
  v_picks_jsonb       jsonb;
  v_current_pick      int;
  v_round             int;
  v_pick_in_round     int;
  v_team_order        jsonb;
  v_on_the_clock      uuid;
  v_completed_rounds  int;
BEGIN
  -- League header — needed for size, state, generation.
  SELECT league_size, draft_state, draft_generation
    INTO v_league_size, v_draft_state, v_generation
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Reconstruct the picks array from events.
  -- We count `pick` events and subtract any subsequent `pick_undone`
  -- events that target them. Spec §6.2: undo is rejected if a later
  -- pick exists, so the undone targets are always at the tail. We
  -- materialize the survivors here.
  WITH
    pick_events AS (
      SELECT id, payload, actor, seq
        FROM public.draft_events
       WHERE league_id = p_league_id
         AND event_type = 'pick'
    ),
    undone_ids AS (
      SELECT (payload ->> 'target_event_id')::bigint AS target_id
        FROM public.draft_events
       WHERE league_id = p_league_id
         AND event_type = 'pick_undone'
    ),
    surviving AS (
      SELECT *
        FROM pick_events
       WHERE id NOT IN (SELECT target_id FROM undone_ids)
       ORDER BY (payload ->> 'pick_number')::int
    )
  SELECT
    count(*),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'pick_number', (payload ->> 'pick_number')::int,
          'round',       (payload ->> 'round')::int,
          'team_id',     (payload ->> 'team_id')::uuid,
          'player_id',   (payload ->> 'player_id')::int,
          'picked_at',   (payload ->> 'picked_at')::timestamptz,
          'is_autopick', (payload ->> 'is_autopick')::boolean,
          'actor_kind',  actor ->> 'kind'
        )
        ORDER BY (payload ->> 'pick_number')::int
      ),
      '[]'::jsonb
    )
    INTO v_pick_count, v_picks_jsonb
    FROM surviving;

  -- Derive the position pointers.
  v_current_pick := v_pick_count + 1;

  IF v_league_size IS NULL OR v_league_size <= 0 THEN
    -- Without league_size we can't compute on-the-clock or completed
    -- rounds. Surface what we have; caller decides how to handle.
    v_on_the_clock     := NULL;
    v_completed_rounds := NULL;
  ELSE
    v_completed_rounds := v_pick_count / v_league_size;  -- integer division
    v_round            := ((v_current_pick - 1) / v_league_size) + 1;
    v_pick_in_round    := ((v_current_pick - 1) % v_league_size) + 1;

    -- on-the-clock is read from draft_order (v1's table; v2 reuses it).
    -- Snake reversal is BAKED INTO team_order per round, so we can read
    -- the team_id at index (pick_in_round - 1) directly.
    SELECT team_order
      INTO v_team_order
      FROM public.draft_order
     WHERE league_id = p_league_id
       AND round_number = v_round;

    IF v_team_order IS NOT NULL THEN
      v_on_the_clock := (v_team_order ->> (v_pick_in_round - 1))::uuid;
    ELSE
      v_on_the_clock := NULL;  -- draft_order not yet populated for this round
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'picks',                v_picks_jsonb,
    'pick_count',           v_pick_count,
    'current_pick_number',  v_current_pick,
    'on_the_clock_team_id', v_on_the_clock,
    'completed_rounds',     v_completed_rounds,
    'draft_state',          v_draft_state,
    'generation',           v_generation
  );
END;
$$;

COMMENT ON FUNCTION public.reconstruct_draft_state(uuid) IS
  'Spec §4.4: rebuild/repair tool. Reads draft_events only; returns derived draft state as JSON. NOT the hot-path read — use draft_picks_v2 for that.';

-- ── 5. submit_pick_v2 — the centerpiece pick RPC ──────────────────────
-- Spec §4.5, §5.2 (state machine), §5.2.2 (deadline rounding).
--
-- One transaction. Steps in order:
--   1. Idempotency check (BEFORE preflight, per §5.2.1).
--   2. Preflight: league active, pick_number matches, round sanity,
--      team on the clock, player not taken, caller authorized.
--   3. Counter advance + event insert (trigger projects to v2 picks).
--   4. Compute next pick_deadline (CEIL + 1s pad).
--   5. UPDATE leagues.pick_deadline.
--   6. pgmq.send the deadline message with send_delay.
--   7. Return {event_id, seq, pick_deadline, was_duplicate}.
--
-- Auth: actor.kind must be 'user' or 'autopick'.
--   - 'user'     → auth.uid() must own teams.id = p_team_id.
--   - 'autopick' → caller role must be service_role / postgres.
--   - everything else → unauthorized.
-- Commissioners do NOT have direct pick power in v2; they use the
-- lifecycle RPCs (draft_pause / draft_resume / draft_extend). Pick
-- override is reserved for v2.1 (commissioner_override event).
--
-- Per-key advisory lock at the top serializes concurrent retries of
-- the SAME idempotency_key. Different keys serialize on the leagues
-- row UPDATE (counter advance), preserving gap-free seq (I1).

CREATE OR REPLACE FUNCTION public.submit_pick_v2(
  p_league_id        uuid,
  p_team_id          uuid,
  p_player_id        int,
  p_round            int,
  p_pick_number      int,
  p_session_id       uuid,
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
  v_current_dl     timestamptz;
  v_draft_state    text;
  v_league_size    int;
  v_settings       jsonb;
  v_generation     int;
  v_pick_count     int;
  v_expected_round int;
  v_pick_in_round  int;
  v_team_order     jsonb;
  v_expected_team  uuid;
  v_actor_kind     text;
  v_team_owner     uuid;
  v_caller_role    text;
  v_player_taken   boolean;
  v_picked_at      timestamptz;
  v_payload        jsonb;
  v_new_seq        bigint;
  v_event_id       bigint;
  v_correlation_id uuid;
  v_pick_time      int;
  v_new_deadline   timestamptz;
  v_send_delay     int;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Step 1: Idempotency check (spec §5.2.1) ─────────────────────────
  -- Runs BEFORE preflight. A retry whose state has moved past the
  -- pick_number is still a valid replay; raising pick_out_of_order on
  -- a successful original would be a false positive.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      -- Idempotent replay. Return the LIVE pick_deadline so the client
      -- (which may be retrying after a network blip) sees current state.
      SELECT pick_deadline INTO v_current_dl
        FROM public.leagues WHERE id = p_league_id;
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'pick_deadline', v_current_dl,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- ── Step 2: Preflight (spec §5.2) ───────────────────────────────────

  -- 2a. League exists + state = 'active'.
  SELECT draft_state, league_size, settings, draft_generation
    INTO v_draft_state, v_league_size, v_settings, v_generation
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_draft_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state: draft_state is % (expected active)',
      v_draft_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_league_size IS NULL OR v_league_size <= 0 THEN
    RAISE EXCEPTION 'illegal_state: league_size not configured'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2b. pick_number must equal current_pick_number (count of v2 picks
  --     for this league + 1). Hot-path read against the projection
  --     (P6: draft_picks_v2 is the synchronous trigger-maintained cache).
  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;

  IF p_pick_number <> v_pick_count + 1 THEN
    RAISE EXCEPTION 'pick_out_of_order: expected pick % got %',
      v_pick_count + 1, p_pick_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2c. round consistency check (sanity vs. derivable round).
  v_expected_round := ((p_pick_number - 1) / v_league_size) + 1;
  IF p_round <> v_expected_round THEN
    RAISE EXCEPTION 'pick_out_of_order: round mismatch (expected % got %)',
      v_expected_round, p_round
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2d. team on the clock — read draft_order for the round.
  --     Snake reversal is baked into team_order; direct array index works.
  v_pick_in_round := ((p_pick_number - 1) % v_league_size) + 1;

  SELECT team_order INTO v_team_order
    FROM public.draft_order
   WHERE league_id = p_league_id AND round_number = p_round;

  IF v_team_order IS NULL THEN
    RAISE EXCEPTION 'illegal_state: draft_order missing for round %', p_round
      USING ERRCODE = 'no_data_found';
  END IF;

  v_expected_team := (v_team_order ->> (v_pick_in_round - 1))::uuid;
  IF v_expected_team IS DISTINCT FROM p_team_id THEN
    RAISE EXCEPTION 'not_on_clock: expected team % got %',
      v_expected_team, p_team_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2e. player not already picked in this league.
  SELECT EXISTS (
    SELECT 1 FROM public.draft_picks_v2
     WHERE league_id = p_league_id AND player_id = p_player_id
  ) INTO v_player_taken;

  IF v_player_taken THEN
    RAISE EXCEPTION 'player_taken: player % already picked in league %',
      p_player_id, p_league_id
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 2f. caller authorization based on actor.kind.
  v_actor_kind := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind = 'autopick' THEN
    -- Workers run as service_role; the Phase 4 worker calls this RPC.
    -- Direct SECURITY DEFINER triggers (rare) execute as postgres.
    IF v_caller_role NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'unauthorized: actor.kind=autopick requires service_role (got %)',
        v_caller_role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_actor_kind = 'user' THEN
    -- Standard user pick. auth.uid() must own the team.
    SELECT owner_id INTO v_team_owner
      FROM public.teams
     WHERE id = p_team_id AND league_id = p_league_id;

    IF v_team_owner IS NULL THEN
      RAISE EXCEPTION 'unauthorized: team % is not in league %',
        p_team_id, p_league_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_team_owner IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'unauthorized: caller % is not owner of team %',
        auth.uid(), p_team_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    -- shadow / commissioner / system — not allowed via submit_pick_v2.
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by submit_pick_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Step 3: Build payload, advance counter, insert event ────────────
  v_picked_at := now();
  v_payload := jsonb_build_object(
    'pick_number', p_pick_number,
    'round',       p_round,
    'team_id',     p_team_id,
    'player_id',   p_player_id,
    'picked_at',   v_picked_at,
    'is_autopick', (v_actor_kind = 'autopick'),
    'session_id',  p_session_id  -- optional: client/worker session for tracing
  );

  -- Defense in depth: payload shape must validate even though we built
  -- it ourselves. Catches bugs in this RPC if someone edits later.
  PERFORM public.validate_draft_event_payload('pick', v_payload);

  -- UPDATE leagues row → row lock serializes all writers for this league.
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
    p_league_id, v_new_seq, 'pick', v_payload, p_payload_hash,
    p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  -- AFTER INSERT trigger tg_draft_events_project_pick fires HERE,
  -- writing the corresponding row into draft_picks_v2.

  -- ── Step 4: Compute next pick_deadline (spec §5.2.2) ────────────────
  -- Round to whole seconds via CEIL, then pad +1s. Guarantees the
  -- deadline matches pgmq's integer-second send_delay resolution AND
  -- that autopick fires AFTER the user-visible timer hits zero.
  v_pick_time := COALESCE(
    (v_settings ->> 'pickTimeLimit')::int,
    90  -- v1 default
  );

  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  UPDATE public.leagues
     SET pick_deadline = v_new_deadline
   WHERE id = p_league_id;

  -- ── Step 5: Enqueue deadline message (spec §5.2 step 6) ─────────────
  -- send_delay (NOT visibility timeout) is what schedules the message
  -- for future delivery. Worker sets vt=30s when reading; that's
  -- the redelivery window only.
  v_send_delay := GREATEST(
    0,
    ceil(EXTRACT(EPOCH FROM (v_new_deadline - now())))::int
  );

  PERFORM pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id',     p_league_id,
      'pick_number',   p_pick_number + 1,
      'generation',    v_generation,
      'scheduled_for', v_new_deadline,
      'source',        'submit_pick_v2'
    ),
    v_send_delay
  );

  RAISE NOTICE 'submit_pick_v2 committed: event_id=%, seq=%, pick_number=%, next_deadline=%',
    v_event_id, v_new_seq, p_pick_number, v_new_deadline;

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'pick_deadline', v_new_deadline,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid) IS
  'Spec §4.5 / §5.2: the pick path. Idempotent (per-key advisory lock); preflight-checked (state, pick_number, round, on-the-clock, player-taken, auth); writes event + projection (via trigger); advances pick_deadline (CEIL + 1s pad); enqueues pgmq deadline message.';

-- ── 6. Commissioner lifecycle RPCs ────────────────────────────────────
-- Spec §4.6 (draft_pause), §4.7 (draft_resume), §4.8 (draft_extend).
--
-- Shared design (spec §5.1, §5.3):
--   - All three bump leagues.draft_generation.
--   - Each emits TWO events in order: `generation_bumped` then the
--     lifecycle event (`draft_paused` / `draft_resumed` / `draft_extended`).
--   - Auth: caller must be the league commissioner OR service_role/postgres.
--   - p_actor.kind must be 'commissioner'.
--   - No queue-side cancellation: stale pgmq messages from before the
--     bump are no-ops at worker read time (Phase 4 worker checks
--     msg.generation vs leagues.draft_generation).
--
-- Events use append_draft_event (chunk 3) with idempotency_key =
-- gen_random_uuid() per call. Double-click protection comes from the
-- state-machine guards (e.g. pause-while-paused fails).

-- Helper: assert caller is the league commissioner OR service_role.
-- Inlined per-RPC rather than extracted because the failure messages
-- carry context-specific details we want at the point of failure.

-- ── 6a. draft_pause ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft_pause(
  p_league_id  uuid,
  p_actor      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_old_gen        int;
  v_new_gen        int;
  v_old_deadline   timestamptz;
  v_pick_count     int;
  v_remaining      int;
  v_paused_pick    int;
  v_paused_at      timestamptz;
  v_reason         text;
  v_caller_role    text;
BEGIN
  -- Auth: actor.kind must be 'commissioner'.
  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_pause requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Auth: caller must be commissioner OR service_role/postgres.
  SELECT commissioner_id, draft_state, draft_generation, pick_deadline
    INTO v_commissioner, v_state, v_old_gen, v_old_deadline
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- State-machine guard: pause is only legal from 'active' (spec §5.1).
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot pause from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Bump generation + clear deadline + transition state, all in this txn.
  v_new_gen   := v_old_gen + 1;
  v_paused_at := now();
  v_reason    := COALESCE(p_actor ->> 'reason', 'commissioner');

  -- Compute paused_pick_number + remaining_seconds for the event payload.
  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_paused_pick := v_pick_count + 1;
  v_remaining := GREATEST(
    0,
    COALESCE(ceil(EXTRACT(EPOCH FROM (v_old_deadline - now())))::int, 0)
  );

  UPDATE public.leagues
     SET draft_generation = v_new_gen,
         draft_state      = 'paused',
         pick_deadline    = NULL
   WHERE id = p_league_id;

  -- Event 1: generation_bumped (spec §5.1: emit before lifecycle event).
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'generation_bumped',
    p_payload          => jsonb_build_object(
      'old_generation', v_old_gen,
      'new_generation', v_new_gen,
      'reason',         'pause'
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  -- Event 2: draft_paused.
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_paused',
    p_payload          => jsonb_build_object(
      'paused_at',          v_paused_at,
      'paused_pick_number', v_paused_pick,
      'remaining_seconds',  v_remaining,
      'reason',             v_reason
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  RAISE NOTICE 'draft_pause: league=%, gen %→%, remaining=%s',
    p_league_id, v_old_gen, v_new_gen, v_remaining;

  RETURN jsonb_build_object(
    'generation', v_new_gen,
    'paused_at',  v_paused_at
  );
END;
$$;

COMMENT ON FUNCTION public.draft_pause(uuid, jsonb) IS
  'Spec §4.6: bumps generation, clears pick_deadline, transitions to paused. Emits generation_bumped then draft_paused. Stale pgmq messages no-op at worker read time.';

-- ── 6b. draft_resume ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft_resume(
  p_league_id  uuid,
  p_actor      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_old_gen        int;
  v_new_gen        int;
  v_settings       jsonb;
  v_pick_time      int;
  v_pick_count     int;
  v_resumed_pick   int;
  v_new_deadline   timestamptz;
  v_resumed_at     timestamptz;
  v_send_delay     int;
  v_caller_role    text;
BEGIN
  -- Auth: actor.kind must be 'commissioner'.
  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_resume requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state, draft_generation, settings
    INTO v_commissioner, v_state, v_old_gen, v_settings
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Resume is only legal from 'paused' (spec §5.1).
  IF v_state <> 'paused' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot resume from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_gen     := v_old_gen + 1;
  v_resumed_at  := now();
  v_pick_time   := COALESCE((v_settings ->> 'pickTimeLimit')::int, 90);

  -- Recompute deadline (CEIL + 1s pad, spec §5.2.2).
  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_resumed_pick := v_pick_count + 1;

  UPDATE public.leagues
     SET draft_generation = v_new_gen,
         draft_state      = 'active',
         pick_deadline    = v_new_deadline
   WHERE id = p_league_id;

  -- Event 1: generation_bumped (spec §5.1: emit before lifecycle event).
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'generation_bumped',
    p_payload          => jsonb_build_object(
      'old_generation', v_old_gen,
      'new_generation', v_new_gen,
      'reason',         'resume'
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  -- Event 2: draft_resumed.
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_resumed',
    p_payload          => jsonb_build_object(
      'resumed_at',          v_resumed_at,
      'resumed_pick_number', v_resumed_pick,
      'new_pick_deadline',   v_new_deadline
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  -- Enqueue a fresh deadline message for the new generation, AFTER the
  -- two events are appended (spec criterion: pgmq.send happens with the
  -- NEW generation in the payload, after both events are committed).
  -- Any pre-pause pgmq messages still in flight will hit the worker's
  -- generation check and no-op.
  v_send_delay := GREATEST(
    0,
    ceil(EXTRACT(EPOCH FROM (v_new_deadline - now())))::int
  );

  PERFORM pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id',     p_league_id,
      'pick_number',   v_resumed_pick,
      'generation',    v_new_gen,
      'scheduled_for', v_new_deadline,
      'source',        'draft_resume'
    ),
    v_send_delay
  );

  RAISE NOTICE 'draft_resume: league=%, gen %→%, new_deadline=%',
    p_league_id, v_old_gen, v_new_gen, v_new_deadline;

  RETURN jsonb_build_object(
    'generation',        v_new_gen,
    'new_pick_deadline', v_new_deadline
  );
END;
$$;

COMMENT ON FUNCTION public.draft_resume(uuid, jsonb) IS
  'Spec §4.7: bumps generation, recomputes pick_deadline, transitions to active, enqueues fresh pgmq message tagged with new generation. Pre-pause queue messages no-op at worker.';

-- ── 6c. draft_extend ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft_extend(
  p_league_id      uuid,
  p_extra_seconds  int,
  p_actor          jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_old_gen        int;
  v_new_gen        int;
  v_old_deadline   timestamptz;
  v_new_deadline   timestamptz;
  v_extended_at    timestamptz;
  v_pick_count     int;
  v_pick_number    int;
  v_send_delay     int;
  v_caller_role    text;
BEGIN
  IF p_extra_seconds IS NULL OR p_extra_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid_event_payload: p_extra_seconds must be a positive int (got %)',
      p_extra_seconds
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_extend requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state, draft_generation, pick_deadline
    INTO v_commissioner, v_state, v_old_gen, v_old_deadline
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Extend is only legal from 'active' (spec §5.1).
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot extend from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_old_deadline IS NULL THEN
    -- Active-but-no-deadline shouldn't happen; surface as illegal_state.
    RAISE EXCEPTION 'illegal_state: active draft has no pick_deadline (data corruption?)'
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_gen     := v_old_gen + 1;
  v_extended_at := now();

  -- Push the deadline forward by p_extra_seconds, re-rounded per §5.2.2.
  v_new_deadline := date_trunc('second', v_old_deadline)
                  + make_interval(secs => p_extra_seconds);

  -- Determine the pick the extension applies to.
  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_pick_number := v_pick_count + 1;

  UPDATE public.leagues
     SET draft_generation = v_new_gen,
         pick_deadline    = v_new_deadline
   WHERE id = p_league_id;

  -- Event 1: generation_bumped (spec §5.1: emit before lifecycle event).
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'generation_bumped',
    p_payload          => jsonb_build_object(
      'old_generation', v_old_gen,
      'new_generation', v_new_gen,
      'reason',         'extend'
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  -- Event 2: draft_extended.
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_extended',
    p_payload          => jsonb_build_object(
      'extended_at',       v_extended_at,
      'pick_number',       v_pick_number,
      'extra_seconds',     p_extra_seconds,
      'new_pick_deadline', v_new_deadline
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  -- Enqueue a fresh message tagged with the new generation, AFTER the
  -- two events are appended (spec criterion: pgmq.send with NEW
  -- generation, after both events committed). The previously queued
  -- message becomes a no-op when the worker reads it (mismatched
  -- generation).
  v_send_delay := GREATEST(
    0,
    ceil(EXTRACT(EPOCH FROM (v_new_deadline - now())))::int
  );

  PERFORM pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id',     p_league_id,
      'pick_number',   v_pick_number,
      'generation',    v_new_gen,
      'scheduled_for', v_new_deadline,
      'source',        'draft_extend'
    ),
    v_send_delay
  );

  RAISE NOTICE 'draft_extend: league=%, gen %→%, +%s, new_deadline=%',
    p_league_id, v_old_gen, v_new_gen, p_extra_seconds, v_new_deadline;

  RETURN jsonb_build_object(
    'generation',        v_new_gen,
    'new_pick_deadline', v_new_deadline
  );
END;
$$;

COMMENT ON FUNCTION public.draft_extend(uuid, int, jsonb) IS
  'Spec §4.8: bumps generation, extends pick_deadline by p_extra_seconds, enqueues fresh pgmq message. Old queued message no-ops at worker (mismatched generation).';


