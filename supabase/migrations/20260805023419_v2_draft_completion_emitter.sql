-- =============================================================================
-- F24 / KI-029 — v2 draft-completion emitter
-- =============================================================================
--
-- CONTEXT (from KI-029): `submit_pick_v2` had no completion branch. After the
-- final pick landed, it unconditionally computed and set a next `pick_deadline`
-- for a pick that would never exist. `leagues.draft_status` was never flipped
-- to `'completed'`. No `draft_completed` lifecycle event was emitted. The
-- LobbyManager receiver at server/src/draft/LobbyManager.ts:2833 and :2996
-- had been waiting for an emitter that this v2 stack never built.
--
-- ARCHITECT'S SHARPENED CLASSIFICATION (2026-08-04): "the lobby knows the
-- draft ended; the league is never told." The in-memory half of completion
-- WAS deliberately built (LobbyManager.processSubmitPick:1826-1832 else-
-- branch is intentional teardown: cancelPickTimer + currentTimerDeadline=null).
-- The NEVER-BUILT half is the emitter — DB status flip + lifecycle event.
--
-- COMPENSATING CONTROL (pre-F24): the cleanup cookbook's manual
-- `set-draft-status --to=completed` step. Without that manual step,
-- `leagues.draft_status` stays `'in_progress'` forever on every v2 draft.
--
-- THIS MIGRATION CLOSES THE GAP. On the final pick, `submit_pick_v2` now:
--   1. Detects final-pick condition via `p_pick_number >= v_total_picks`
--      where `v_total_picks = SUM(jsonb_array_length(team_order))` across
--      the league's draft_order rows (D1 architect ruling: source truth
--      is the STRUCTURE the draft actually walks, not the league_size
--      convenience column — league_size is literally what fixture-12
--      mutates, the campaign's standing lesson).
--   2. Flips `leagues.draft_status = 'completed'`.
--   3. Sets `leagues.pick_deadline = NULL` (Amendment 1 architect ruling:
--      completed leagues read honestly — no deadline, because nobody is
--      on the clock. Kills the stale-deadline artifact class from KI-029
--      at the root, not just its symptoms.).
--   4. Emits a `draft_completed` lifecycle event via `append_draft_event`
--      with payload `{completed_at, total_picks}` per §6.8 validator.
--   5. Returns with `pick_deadline: NULL` (no next pick).
-- Non-final picks preserve existing behavior verbatim (compute + set next
-- deadline, RETURN with the new deadline).
--
-- SCOPE: SNAKE/LINEAR ONLY (D5 architect ruling: ship narrow — auction's
-- completion moment is a different CONDITION (nomination exhaustion) in a
-- subsystem with zero field campaigns behind it; auction-completion emitter
-- gets its own chunk with its own acceptance harness. Named residual on
-- the auction ledger, not F24 scope. Same rule that shipped F20's scanner:
-- load-bearing fixes ship narrow).
--
-- AMENDMENT 2 CLOSED — DRAFT_STATE UNTOUCHED (architect prod evidence
-- 2026-08-05): the evidence query `SELECT draft_state FROM leagues WHERE
-- draft_status='completed'` on prod returned `ERROR: column "draft_state"
-- does not exist`. The column is v2-stack-only (added by v2 migrations
-- that never landed on prod — see KI-025's PROD-PORT chunk). v1 has no
-- completed-semantics to mirror; no v2 consumer reads draft_state
-- post-completion. Deliberately not extending semantics here.
--
-- AMENDMENT 3 (2026-08-05, blocking amendment folded in) — SOFT-DELETE
-- FILTER + MIRROR INVARIANT: draft_order has a `deleted_at` column (added
-- by migration 20250116000000_add_draft_session_tracking.sql) and its
-- historical uniqueness constraints were DROPPED in that same migration
-- ("we'll handle uniqueness in application logic with session"). Multiple
-- rows with the same (league_id, round_number) can therefore coexist —
-- one live, others soft-deleted from prior draft attempts.
--
-- FINDING pre-F24: the on-clock `SELECT team_order INTO v_team_order
-- FROM public.draft_order WHERE league_id = X AND round_number = Y` at
-- Step 2 of submit_pick_v2 did NOT filter deleted_at. `SELECT INTO` on
-- multiple candidate rows returns AN arbitrary one — a soft-deleted
-- row's team_order could be returned, making the on-clock check reject
-- the correct team OR accept the wrong one. Latent bug pre-F24 that the
-- fixture-12 test path (which hard-deletes) never exercised.
--
-- F24 FIX (both queries filtered): this migration adds `AND deleted_at
-- IS NULL` to BOTH the on-clock team_order SELECT (Step 2) AND the new
-- v_total_picks SUM (Step 4). The two now mirror EXACTLY, per architect's
-- ruling: "the draft must walk and the completion must count the same
-- set of rows." Absent the mirror, completion could count ghost rows
-- (inflating v_total_picks so completion NEVER fires for a league with
-- soft-deleted order history — silently, forever) OR the on-clock could
-- accept a ghost row's team roster while completion counted only the
-- live rows (two paths disagreeing about the same draft's shape).
--
-- BROADCAST PATH (D6 verification requirement): the `append_draft_event`
-- INSERT into `draft_events` fires the chunk 11g.7-7e AFTER INSERT trigger
-- `draft_events_notify_after_insert` → `pg_notify('draft_events', ...)`.
-- LobbyManager's event subscription (server/src/draft/eventSubscription.ts)
-- receives the NOTIFY → dispatches → applies (line 2833 flip) AND broadcasts
-- to connected WS clients via the existing rail. Acceptance test asserts
-- a connected client OBSERVES the draft_completed frame on the wire, not
-- just that the DB row landed.
--
-- CI REGRESSION COVERAGE PENDS test-DB strategy (KI-017 authenticated-harness
-- chunk). Acceptance verification for this migration is staging-integration
-- only (migration applied → rigged run → assert status flip + draft_completed
-- event row + wire observation + pick_deadline NULL).
--
-- ROLLBACK: pure `CREATE OR REPLACE FUNCTION`. A subsequent migration
-- restoring the prior body reverts. No data migration; nothing to unwind.
-- `pick_deadline` values on already-completed leagues would be NULL post-
-- rollback (harmless — no engine touches them).
-- =============================================================================

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
  -- F24: completion detection
  v_total_picks    int;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Step 1: Idempotency check (spec §5.2.1) ─────────────────────────
  --
  -- F24 note on idempotency + completion interaction: a duplicate retry of
  -- the FINAL pick early-returns HERE with was_duplicate=true and does
  -- NOT re-emit `draft_completed`. This is correct — the completion event
  -- was already emitted on the first (non-duplicate) call and rides that
  -- original insert's exactly-once semantics.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
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

  SELECT draft_state, league_size, settings
    INTO v_draft_state, v_league_size, v_settings
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

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;

  IF p_pick_number <> v_pick_count + 1 THEN
    RAISE EXCEPTION 'pick_out_of_order: expected pick % got %',
      v_pick_count + 1, p_pick_number
      USING ERRCODE = 'check_violation';
  END IF;

  v_expected_round := ((p_pick_number - 1) / v_league_size) + 1;
  IF p_round <> v_expected_round THEN
    RAISE EXCEPTION 'pick_out_of_order: round mismatch (expected % got %)',
      v_expected_round, p_round
      USING ERRCODE = 'check_violation';
  END IF;

  v_pick_in_round := ((p_pick_number - 1) % v_league_size) + 1;

  -- F24 Amendment 3 (2026-08-05): filter deleted_at IS NULL so soft-
  -- deleted rows from prior draft attempts cannot shadow the live row
  -- for this (league, round). Mirrors the completion SUM at Step 4 —
  -- both queries walk the same set. Pre-F24 this SELECT could return
  -- an arbitrary ghost row's team_order; latent bug not exercised by
  -- fixture-12 (hard-deletes) but reachable in prod on re-drafted
  -- leagues.
  SELECT team_order INTO v_team_order
    FROM public.draft_order
   WHERE league_id = p_league_id
     AND round_number = p_round
     AND deleted_at IS NULL;

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

  SELECT EXISTS (
    SELECT 1 FROM public.draft_picks_v2
     WHERE league_id = p_league_id AND player_id = p_player_id
  ) INTO v_player_taken;

  IF v_player_taken THEN
    RAISE EXCEPTION 'player_taken: player % already picked in league %',
      p_player_id, p_league_id
      USING ERRCODE = 'unique_violation';
  END IF;

  v_actor_kind := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind = 'autopick' THEN
    IF v_caller_role NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'unauthorized: actor.kind=autopick requires service_role (got %)',
        v_caller_role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_actor_kind = 'user' THEN
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
    'session_id',  p_session_id
  );

  PERFORM public.validate_draft_event_payload('pick', v_payload);

  -- F24 / D3 architect ruling — placement invariant.
  -- The draft_event_counter UPDATE below acquires the leagues row lock.
  -- All state examined by the completion branch (the pick INSERT below,
  -- and v_total_picks derived from draft_order) is COMMITTED under the
  -- same transaction as the lock. No concurrent submit can interleave
  -- between the pick INSERT and the completion evaluation. If a future
  -- refactor moves the completion branch above this UPDATE, the race
  -- opens: two threads could both observe v_total_picks - 1 picks + a
  -- pending final and both attempt the flip. Keep the branch AFTER the
  -- INSERT, same transaction. The zero-ordering-violations field record
  -- (11g.10 acceptance run + cloud-path 24/24) is the empirical backstop.
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
  -- AFTER INSERT trigger draft_events_notify_after_insert (chunk 11g.7
  -- sub-step 7e) fires HERE, emitting pg_notify('draft_events', ...).

  -- ── Step 4: Completion detection (F24 / KI-029) ─────────────────────
  --
  -- v_total_picks is derived from the STRUCTURE the draft actually walks:
  -- SUM of team_order array lengths across every LIVE draft_order row for
  -- this league. Architect D1 ruling — never trust the convenience field
  -- (league_size) when the structural truth is one SUM away. Handles ×N
  -- rounds correctly regardless of whether team_order arrays are all
  -- exactly league_size long (they should be for snake/linear, but
  -- SUM is safe against future divergence).
  --
  -- Amendment 3 mirror invariant: `AND deleted_at IS NULL` matches the
  -- on-clock team_order SELECT at Step 2 exactly. The two queries walk
  -- the same set of rows — the draft cannot disagree with itself about
  -- its own shape. Without this filter, a league with soft-deleted
  -- order history would inflate v_total_picks, and completion would
  -- NEVER fire — silently, forever, on any league that had prior
  -- draft attempts.
  SELECT COALESCE(SUM(jsonb_array_length(team_order)), 0)
    INTO v_total_picks
    FROM public.draft_order
   WHERE league_id = p_league_id
     AND deleted_at IS NULL;

  -- D2 defense-in-depth guard. Primary protection is the upstream on-
  -- clock validation at Step 2 (which rejects picks against missing
  -- draft_order rows); total=0 is not a reachable-normal state here.
  -- This guard exists so a defect elsewhere doesn't cascade into
  -- flipping the first pick to 'completed' via `p_pick_number >= 0`.
  -- Empty-order drafting is NOT supported; this catches the impossible.
  IF v_total_picks > 0 AND p_pick_number >= v_total_picks THEN
    -- D8 architect ruling — absorb AND announce. The strictly-greater
    -- case (p_pick_number > v_total_picks) is impossible in normal
    -- operation (the pick_out_of_order check at Step 2 rejects it),
    -- but silent absorption of an impossible state is exactly how F20
    -- happened. Fail open (liveness wins — raising after the pick has
    -- committed strands the pick), but emit a WARNING with the
    -- numbers so a future audit can find it.
    IF p_pick_number > v_total_picks THEN
      RAISE WARNING
        'submit_pick_v2 completion branch: p_pick_number % > v_total_picks % for league % — impossible under normal preflight, absorbing (F24 severity-ladder discipline)',
        p_pick_number, v_total_picks, p_league_id;
    END IF;

    -- Final pick. Flip status + clear deadline + emit lifecycle event.
    -- Amendment 1: pick_deadline = NULL alongside the status flip.
    -- Completed leagues read honestly — no deadline, because nobody
    -- is on the clock. Kills the stale-deadline artifact class at
    -- the root (not just symptoms).
    --
    -- draft_state is DELIBERATELY UNTOUCHED here — v1's
    -- complete_draft_and_sync (migration 20260321000000) sets
    -- draft_status='completed' without touching draft_state. Mirroring
    -- that behavior until Amendment 2's prod evidence query lands.
    -- If evidence shows v1 completed leagues carry a specific
    -- draft_state value uniformly, a follow-up migration sets it here.
    UPDATE public.leagues
       SET draft_status = 'completed',
           pick_deadline = NULL
     WHERE id = p_league_id;

    -- Emit draft_completed lifecycle event via append_draft_event.
    -- NULL idempotency_key = single-fire semantics (D3 invariant: this
    -- branch runs exactly once per league in the RPC's serialized
    -- submit path; the row lock at the counter UPDATE covers it).
    -- Actor inherits from the caller (whoever landed the final pick).
    -- correlation_id reuses the pick's correlation to thread the
    -- completion event to the triggering pick in observability.
    PERFORM public.append_draft_event(
      p_league_id,                                                      -- p_league_id
      'draft_completed',                                                -- p_event_type
      jsonb_build_object('completed_at', v_picked_at,
                         'total_picks',  v_total_picks),                -- p_payload (§6.8)
      NULL,                                                             -- p_idempotency_key
      NULL,                                                             -- p_payload_hash
      p_actor,                                                          -- p_actor
      v_correlation_id                                                  -- p_correlation_id
    );

    -- Return with pick_deadline=NULL. Wire event and DB flip both
    -- reflect the fact that there is no next pick.
    RETURN jsonb_build_object(
      'event_id',      v_event_id,
      'seq',           v_new_seq,
      'pick_deadline', NULL,
      'was_duplicate', false
    );
  END IF;

  -- ── Step 5: Non-final pick — compute + set next pick_deadline (§5.2.2) ─
  v_pick_time := COALESCE(
    (v_settings ->> 'pickTimeLimit')::int,
    90
  );

  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  UPDATE public.leagues
     SET pick_deadline = v_new_deadline
   WHERE id = p_league_id;

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'pick_deadline', v_new_deadline,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid) IS
  'Spec §4.5 / §5.2: the pick path. Idempotent (per-key advisory lock); preflight-checked (state, pick_number, round, on-the-clock, player-taken, auth); writes event + projection (via trigger); advances pick_deadline (CEIL + 1s pad). Chunk 11g.8: removed pgmq emission. Chunk 11g.9: removed v_generation leak. F24 (2026-08-05): completion branch added — final pick flips draft_status=completed, clears pick_deadline, emits draft_completed lifecycle event via append_draft_event. F24 Amendment 3 (2026-08-05): both draft_order queries now filter AND deleted_at IS NULL (collateral fix for latent on-clock ghost-row bug pre-dating F24; mirror invariant with completion SUM). Snake/linear only; auction completion is a separate future chunk (KI-029 named residual on auction ledger).';
