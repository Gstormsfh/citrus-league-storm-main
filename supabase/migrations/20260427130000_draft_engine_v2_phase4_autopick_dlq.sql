-- Draft Engine v2 — Phase 4 chunk 11c: draft_autopick_dlq RPC + dedupe.
--
-- Two surfaces in one migration:
--
--   (1) UNIQUE constraint on autopick_failures (pgmq_msg_id, league_id)
--       so a duplicate DLQ insert no-ops cleanly via ON CONFLICT DO
--       NOTHING. Per chunk 11 design call: enables crash-and-retry
--       recovery — if a worker commits the DLQ row + autopick_failed
--       event but then fails to archive the pgmq message, the message
--       gets redelivered, the worker re-reaches read_ct >= 3, and the
--       second DLQ call short-circuits without producing a duplicate
--       event row.
--
--   (2) public.draft_autopick_dlq() RPC. Atomic helper that inserts
--       the DLQ row AND emits the autopick_failed event in a single
--       transaction. Worker calls this from chunk 11d when
--       msg.read_ct >= 3.
--
-- Atomicity contract:
--   The whole RPC body is one transaction (SECURITY DEFINER doesn't
--   change tx scope). If either step fails, both roll back —
--   autopick_failures stays consistent with the autopick_failed event
--   in draft_events. The sweep predicate from chunk 10b looks for
--   autopick_failed events (NOT autopick_failures rows), so the
--   atomic pairing is what makes the predicate skip the league after
--   a DLQ.
--
-- Paging is NOT wired here. Per KI-005 (target Phase 8a), DLQ inserts
-- are silent until the prod cutover defines the alerting surface.
-- Operators must inspect autopick_failures during incidents.

-- ── 1. Unique constraint for duplicate DLQ no-op ──────────────────────
-- Safe to add unconditionally: chunk 10a created autopick_failures
-- empty, and Phase 3's archive-only worker never inserts. So no
-- existing row would violate the new constraint.

ALTER TABLE public.autopick_failures
  ADD CONSTRAINT autopick_failures_msg_league_uniq
  UNIQUE (pgmq_msg_id, league_id);

COMMENT ON CONSTRAINT autopick_failures_msg_league_uniq ON public.autopick_failures IS
  'Phase 4 chunk 11c: prevents duplicate DLQ rows for the same pgmq message (within a league). draft_autopick_dlq uses ON CONFLICT DO NOTHING to short-circuit duplicate calls — the second caller returns {already_dlq: true} without re-emitting the autopick_failed event.';

-- ── 2. draft_autopick_dlq RPC ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.draft_autopick_dlq(
  p_league_id      uuid,
  p_pgmq_msg_id    bigint,
  p_payload        jsonb,
  p_last_error     text,
  p_read_ct        int,
  p_correlation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role   text;
  v_dlq_id        bigint;
  v_event_payload jsonb;
  v_event_result  jsonb;
  v_event_id      bigint;
BEGIN
  -- ── Auth (same gate as chunk 10b/10c; spec §4.8 silence → fill). ──
  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: draft_autopick_dlq requires service_role/postgres (got %)',
      COALESCE(v_caller_role, 'NULL')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Step 1: DLQ row insert. ──
  -- ON CONFLICT DO NOTHING + RETURNING means v_dlq_id is the new row
  -- ID on first call, NULL on duplicate.
  INSERT INTO public.autopick_failures (
    league_id, pgmq_msg_id, payload, last_error, read_ct
  ) VALUES (
    p_league_id, p_pgmq_msg_id, p_payload, p_last_error, p_read_ct
  )
  ON CONFLICT (pgmq_msg_id, league_id) DO NOTHING
  RETURNING id INTO v_dlq_id;

  IF v_dlq_id IS NULL THEN
    -- Duplicate call. The original DLQ + event landed earlier; skip
    -- emitting a second autopick_failed event (would clutter the log
    -- and inflate metric counts).
    RETURN jsonb_build_object(
      'already_dlq', true,
      'dlq_id',      NULL,
      'event_id',    NULL
    );
  END IF;

  -- ── Step 2: emit autopick_failed event per spec §6.3. ──
  -- Required payload fields (per validate_draft_event_payload):
  --   pick_number, generation, read_ct, last_error, pgmq_msg_id.
  -- pick_number + generation are extracted from the original pgmq
  -- message payload that the caller passed in p_payload.
  v_event_payload := jsonb_build_object(
    'pick_number',  (p_payload ->> 'pick_number')::int,
    'generation',   (p_payload ->> 'generation')::int,
    'read_ct',      p_read_ct,
    'last_error',   p_last_error,
    'pgmq_msg_id',  p_pgmq_msg_id
  );

  -- 'sha256:server-generated' placeholder matches the pattern used by
  -- the Phase 2 lifecycle RPCs (draft_pause, draft_resume, etc.) for
  -- system-emitted events. Idempotency-key is fresh per call —
  -- duplicate protection comes from the autopick_failures unique
  -- constraint above, not from the event-side idempotency.
  v_event_result := public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'autopick_failed',
    p_payload          => v_event_payload,
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => jsonb_build_object('kind', 'autopick'),
    p_correlation_id   => p_correlation_id
  );

  v_event_id := (v_event_result ->> 'event_id')::bigint;

  RETURN jsonb_build_object(
    'already_dlq', false,
    'dlq_id',      v_dlq_id,
    'event_id',    v_event_id
  );
END;
$$;

COMMENT ON FUNCTION public.draft_autopick_dlq(uuid, bigint, jsonb, text, int, uuid) IS
  'Phase 4 chunk 11c: atomic DLQ helper for the autopick worker. Inserts into autopick_failures + emits autopick_failed event in one transaction. Duplicate calls (same pgmq_msg_id+league_id) short-circuit via the unique constraint, returning {already_dlq: true} without re-emitting the event. service_role/postgres only. Paging (KI-005) deferred to Phase 8a.';

-- ── 3. Verify ─────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_constraint_count int;
  v_function_exists  boolean;
BEGIN
  -- (a) Unique constraint present.
  SELECT count(*) INTO v_constraint_count
    FROM pg_constraint
   WHERE conrelid = 'public.autopick_failures'::regclass
     AND contype  = 'u'
     AND conname  = 'autopick_failures_msg_league_uniq';

  IF v_constraint_count <> 1 THEN
    RAISE EXCEPTION
      'expected unique constraint autopick_failures_msg_league_uniq, got % matches',
      v_constraint_count;
  END IF;

  -- (b) Function exists with the expected signature.
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'draft_autopick_dlq'
       AND pg_get_function_result(p.oid) = 'jsonb'
  ) INTO v_function_exists;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'draft_autopick_dlq() was not created with the expected signature (RETURNS jsonb)';
  END IF;
END
$verify$;
