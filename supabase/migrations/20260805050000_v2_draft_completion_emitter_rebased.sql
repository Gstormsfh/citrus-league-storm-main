-- =============================================================================
-- F24 / KI-029 — v2 draft-completion emitter (REBASED ON CHUNK 10c-2 BATCH 2)
-- =============================================================================
--
-- SUPERSEDES: 20260805023419_v2_draft_completion_emitter.sql
--
-- The superseded file was authored against the 20260512 pgmq-removal body of
-- submit_pick_v2 and missed the chunk 10c-2 batch 2 update
-- (`20260727010000_pick_event_carries_pick_deadline.sql`, ratified 2026-07-27)
-- which grew the 'pick' event's required payload fields to include
-- `pick_deadline`. Applying the superseded migration to staging left every
-- pick failing `PERFORM public.validate_draft_event_payload('pick', v_payload)`
-- with `check_violation: pick.pick_deadline missing`. Rolls-back cleanly on
-- exception; zero rows written; counter unchanged.
--
-- F25 (NEW, 2026-08-05, first machine-found defect on the campaign ledger):
-- "F24 rebase — CREATE OR REPLACE authored against a stale base body."
-- Standing rules NOW in force (folded into COOKBOOK.md next commit):
--   1. CAPTURE-BEFORE-REPLACE. Before authoring a CREATE OR REPLACE FUNCTION
--      migration, the commit MUST include `pg_get_functiondef` output for
--      the target function as of the same day. The file is a claim; the
--      captured live body is the truth.
--   2. REAL SQL IN DIRECT-APPLY HISTORY ROWS. When applying a migration via
--      `psql -f` (bypassing supabase CLI), the corresponding
--      `supabase_migrations.schema_migrations` INSERT MUST carry the full
--      migration SQL in the `statements` array via dollar-quoting — NOT a
--      placeholder string. History-row content is what future rebuilds run.
--
-- THIS MIGRATION rebuilds `submit_pick_v2` from the batch-2 body verbatim,
-- then grafts F24 on top with all ratified elements preserved:
--   - D1..D8 rulings (structural SUM, defense-in-depth guard, race invariant,
--     idempotency preservation, snake/linear scope, broadcast-path trust,
--     fail-open with WARNING).
--   - Amendment 1: leagues.pick_deadline = NULL in the completion UPDATE.
--   - Amendment 2 (evidence-closed): draft_state deliberately UNTOUCHED.
--   - Amendment 3: `AND deleted_at IS NULL` filter on BOTH draft_order
--     queries (on-clock team_order SELECT + completion v_total_picks SUM);
--     mirror invariant preserved.
--   - Amendment 4 (2026-08-05, second machine-found defect this rebase):
--     draft_events.payload_hash is NOT NULL (live column read tonight);
--     append_draft_event forwards p_payload_hash verbatim into the
--     INSERT. Original completion append passed NULL — would have
--     rolled back the ENTIRE final-pick transaction (pick INSERT +
--     counter increment + leagues UPDATE), stranding the draft one
--     pick short of complete with no completion event ever emitted.
--     Fix: hoist v_completion_payload := jsonb_build_object(...) so it
--     can be hashed once, sha256 via core pg (no pgcrypto dependency),
--     hex-encoded, passed as p_payload_hash. Event lands at
--     event_version=1 (append_draft_event default; same as draft_started)
--     vs picks at event_version=2 (batch-2 bump) — expected, listed in
--     acceptance-run observations.
--
-- KEY BATCH-2 ELEMENTS PRESERVED (do not remove without a paired paired
-- validator downgrade — see the verify block at the end of batch 2's file):
--   (a) `pick_deadline` in the pick event payload (validator §6.1 requires it).
--   (b) event_version = 2 in the pick INSERT (`chunk 10c-2 batch 2 bump`).
--   (c) Deadline computed BEFORE the payload build (was Step 3-restructure in
--       batch 2). F24's completion branch appears AFTER the pick INSERT and
--       BEFORE the leagues.pick_deadline UPDATE — the ordering is load-bearing
--       for D3's placement invariant.
--
-- ON THE COMPLETION EVENT'S PICK_DEADLINE (per architect ruling this session):
-- The FINAL pick's event payload still carries `pick_deadline` as a string —
-- validator type-checks it; engine teardown (LobbyManager.processSubmitPick
-- else-branch, line 1826-1832) cancels the timer regardless of what the
-- payload says. Pre-F24 field-proven behavior. Only `leagues.pick_deadline`
-- (the column) and the RPC RETURN's `pick_deadline` field go NULL.
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
  v_total_picks       int;
  -- F24 Amendment 4 (2026-08-05): completion event payload hoisted so
  -- it can be hashed once and passed to append_draft_event as
  -- p_payload_hash. draft_events.payload_hash is NOT NULL (live column
  -- read 2026-08-05); passing NULL rolls back the entire final-pick
  -- transaction, stranding the pick AND the completion.
  v_completion_payload jsonb;
  v_completion_hash    text;
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
  -- for this (league, round). Mirrors the completion SUM below —
  -- both queries walk the same set. Pre-F24 this SELECT could return
  -- an arbitrary ghost row's team_order; latent bug not exercised by
  -- fixture-12 (hard-deletes) but reachable in prod on re-drafted
  -- leagues (draft_order lost its uniqueness constraints in migration
  -- 20250116000000_add_draft_session_tracking.sql).
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

  -- ── Step 3: Compute next pick_deadline + build payload (batch 2 order) ─
  --
  -- Chunk 10c-2 batch 2 (2026-07-27) moved deadline computation up here
  -- from a later step so pick_deadline can be embedded in the event
  -- payload. Do NOT reorder without a paired validator downgrade — the
  -- validate_draft_event_payload check at line ~end-of-Step-3 will
  -- reject any pick payload without pick_deadline (§6.1 required set,
  -- migration 20260727010000). The value is written twice (identically):
  --   (a) into the event payload as `pick_deadline` (for engine re-arm)
  --   (b) into leagues.pick_deadline in Step 5 (for bootstrap + RPC return)
  -- Both writes happen inside the same transaction; they cannot diverge.

  v_picked_at := now();
  v_pick_time := COALESCE(
    (v_settings ->> 'pickTimeLimit')::int,
    90
  );
  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  v_payload := jsonb_build_object(
    'pick_number',   p_pick_number,
    'round',         p_round,
    'team_id',       p_team_id,
    'player_id',     p_player_id,
    'picked_at',     v_picked_at,
    'is_autopick',   (v_actor_kind = 'autopick'),
    'session_id',    p_session_id,
    -- 10c-2 batch 2: pick_deadline embedded here.
    'pick_deadline', v_new_deadline
  );

  PERFORM public.validate_draft_event_payload('pick', v_payload);

  -- ── Step 4: Advance seq counter + INSERT event (event_version=2) ────
  --
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
    league_id, seq, event_type, event_version, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'pick', 2, v_payload, p_payload_hash,
    p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  -- AFTER INSERT trigger tg_draft_events_project_pick fires HERE,
  -- writing the corresponding row into draft_picks_v2.
  -- AFTER INSERT trigger draft_events_notify_after_insert (chunk 11g.7
  -- sub-step 7e) fires HERE, emitting pg_notify('draft_events', ...).

  -- ── Step 4.5: Completion detection (F24 / KI-029) ───────────────────
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
    -- draft_state is DELIBERATELY UNTOUCHED here (Amendment 2 evidence-
    -- closed 2026-08-05: architect prod query returned ERROR: column
    -- "draft_state" does not exist — column is v2-stack-only, no v2
    -- consumer reads draft_state post-completion, deliberately not
    -- extending semantics here).
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
    --
    -- F24 Amendment 4 (2026-08-05): append_draft_event forwards
    -- p_payload_hash into draft_events.payload_hash verbatim. That
    -- column is NOT NULL (live schema read 2026-08-05). Passing NULL
    -- here would surface as a not-null constraint violation on the
    -- INSERT and roll back the ENTIRE final-pick transaction — the
    -- pick INSERT above, the counter increment, and the leagues UPDATE
    -- would all vanish. Build the payload once, hash it with core
    -- pg_catalog.sha256 (no pgcrypto dependency), pass hex-encoded.
    --
    -- NOTE ON EVENT_VERSION: append_draft_event's default is event_version=1
    -- (per §4.2 header). draft_completed events therefore land at version=1,
    -- while pick events land at version=2 (batch-2 bump, migration
    -- 20260727010000). This is the correct current state — draft_started
    -- also lands at 1 via the same append_draft_event default. Listed in
    -- F24 acceptance-run observations for the ratification package.
    v_completion_payload := jsonb_build_object(
      'completed_at', v_picked_at,
      'total_picks',  v_total_picks
    );
    v_completion_hash := encode(
      sha256(convert_to(v_completion_payload::text, 'UTF8')),
      'hex'
    );

    PERFORM public.append_draft_event(
      p_league_id,                     -- p_league_id
      'draft_completed',               -- p_event_type
      v_completion_payload,            -- p_payload (§6.8)
      NULL,                            -- p_idempotency_key (single-fire; D3 lock covers)
      v_completion_hash,               -- p_payload_hash (Amendment 4: sha256 hex)
      p_actor,                         -- p_actor (inherited from final-pick caller)
      v_correlation_id                 -- p_correlation_id (threads to triggering pick)
    );

    -- Return with pick_deadline=NULL. Wire event and DB flip both
    -- reflect the fact that there is no next pick. NOTE: the pick
    -- event payload STILL carries pick_deadline as its ISO string
    -- (built above at Step 3, required by validator §6.1). Engine
    -- teardown (LobbyManager.processSubmitPick else-branch,
    -- server/src/draft/LobbyManager.ts:1826-1832) cancels the timer
    -- regardless — pre-F24 field-proven behavior. Only the DB column
    -- and this RPC RETURN go NULL.
    RETURN jsonb_build_object(
      'event_id',      v_event_id,
      'seq',           v_new_seq,
      'pick_deadline', NULL,
      'was_duplicate', false
    );
  END IF;

  -- ── Step 5: Non-final pick — persist next pick_deadline into leagues ─
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
  'Spec §4.5 / §5.2: the pick path. Chunk 10c-2 batch 2 (2026-07-27): pick event payload carries pick_deadline for engine external-apply timer re-arm; event_version=2. F24 (2026-08-05, rebased from stale base per F25): completion branch added — final pick flips draft_status=completed, clears leagues.pick_deadline (Amendment 1), emits draft_completed lifecycle event via append_draft_event. Amendment 3: both draft_order queries filter AND deleted_at IS NULL (collateral fix for latent on-clock ghost-row bug; mirror invariant with completion SUM). Snake/linear only; auction completion is a separate future chunk (KI-029 named residual on auction ledger).';
