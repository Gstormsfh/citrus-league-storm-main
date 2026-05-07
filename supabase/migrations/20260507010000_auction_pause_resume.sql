-- ════════════════════════════════════════════════════════════════════
-- Phase 4.5 chunk 11g.6 sub-step 6c1: auction pause/resume.
--
-- Per ADR-002 §4.4: a commissioner pause "suspends" the bid window;
-- resume restores the captured remaining time, NOT a fresh full
-- window. This is intentional and divergent from snake/linear
-- `draft_resume` (which gives a fresh full clock per
-- `20260425140000_draft_engine_v2_rpcs.sql:1136-1141`). The auction
-- bid window represents all teams' opportunity to react to the
-- current high bid; restoring remaining-time is fairness-correct.
--
-- State storage (ADR-002 §4.4 + Path B per 6c1 recon):
--   - `leagues.draft_state` is the canonical pause indicator:
--     `'active'` ↔ `'paused'`. Engine reads on bootstrap +
--     mirrors via in-memory `pauseState`. RPCs gate writes on
--     `draft_state='active'` (defense-in-depth alongside engine
--     fail-fast in `LobbyManager.processPlaceBid` /
--     `processNominate`).
--   - `auction_nominations.status` STAYS `'active'` while paused —
--     no schema change. The status enum remains
--     `('active', 'sold', 'no_sale')`; "paused" is a
--     league-level state, not a nomination-level state.
--   - `auction_nominations.expires_at` is LEFT UNTOUCHED during
--     pause (becomes informational/stale until resume overwrites).
--     Canonical truth for "how long was left when we paused"
--     lives in the `auction_paused` event payload's
--     `captured_remaining_seconds` field.
--
-- No `generation_bumped` events for auction RPCs (the snake/linear
-- pattern's pgmq message-staleness coordinator is being retired in
-- chunk 11g.9). Auction RPCs emit just the lifecycle events.
--
-- Migration scope (4 functions touched):
--   1. NEW: auction_pause_v2     — atomic transition + auction_paused
--   2. NEW: auction_resume_v2    — atomic transition + auction_resumed
--   3. CREATE OR REPLACE: nominate_player_v2 — adds draft_state gate
--   4. CREATE OR REPLACE: place_bid_v2       — adds draft_state gate
-- ════════════════════════════════════════════════════════════════════

-- ── 1. auction_pause_v2 ─────────────────────────────────────────────
--
-- Atomicity contract:
--   BEGIN
--     SELECT auction_nominations FOR UPDATE  (lock active nomination, if any)
--     UPDATE leagues.draft_state = 'paused'
--     UPDATE leagues.draft_event_counter += 1
--     INSERT draft_events (auction_paused) — payload carries
--       captured_remaining_seconds + paused_nomination_id (both NULL
--       when no active nomination)
--   COMMIT
--
-- These 4 writes are atomic. A partial commit that flipped
-- `draft_state` without recording the captured remaining seconds
-- would orphan the resume path — `auction_resume_v2` reads the
-- most recent `auction_paused` event payload to recover the
-- remaining time.

CREATE OR REPLACE FUNCTION public.auction_pause_v2(
  p_league_id        uuid,
  p_actor            jsonb,
  p_reason           text,
  p_idempotency_key  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id          bigint;
  v_existing_seq         bigint;
  v_commissioner         uuid;
  v_state                text;
  v_caller_role          text;
  v_actor_kind           text;
  v_active_nom_id        uuid;
  v_active_expires_at    timestamptz;
  v_remaining_seconds    int;
  v_paused_at            timestamptz;
  v_payload              jsonb;
  v_payload_hash         text;
  v_new_seq              bigint;
  v_event_id             bigint;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq
    INTO v_existing_id, v_existing_seq
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'event_id',      v_existing_id,
      'seq',           v_existing_seq,
      'was_duplicate', true
    );
  END IF;

  -- Step 2: Auth.
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: auction_pause_v2 requires actor.kind=commissioner (got %)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state
    INTO v_commissioner, v_state
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- State-machine guard: pause is only legal from 'active' (matches
  -- snake/linear `draft_pause` precedent at migration line 1010-1013).
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot pause auction from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 3: Lock + read the active nomination row, if any. The
  -- FOR UPDATE here serializes against any concurrent
  -- place_bid_v2 / close_nomination_v2 on the same nomination —
  -- the pause atomically captures the deadline at the moment of
  -- the lock acquisition.
  SELECT id, expires_at
    INTO v_active_nom_id, v_active_expires_at
    FROM public.auction_nominations
   WHERE league_id = p_league_id
     AND status = 'active'
   ORDER BY id DESC
   LIMIT 1
   FOR UPDATE;

  -- Compute captured_remaining_seconds (ceil to give the resumer a
  -- generous floor; matches snake/linear `draft_pause` line 1025-1028
  -- precedent). NULL when no active nomination.
  IF v_active_nom_id IS NOT NULL THEN
    v_remaining_seconds := GREATEST(
      0,
      ceil(EXTRACT(EPOCH FROM (v_active_expires_at - now())))::int
    );
  END IF;

  v_paused_at := now();

  -- Step 4: Atomic write block.
  --   BEGIN (implicit)

  --     UPDATE leagues.draft_state -> 'paused'
  UPDATE public.leagues
     SET draft_state = 'paused'
   WHERE id = p_league_id;

  --     UPDATE leagues counter (counter advance for the event)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  --     INSERT draft_events (auction_paused)
  -- Payload carries paused_nomination_id + captured_remaining_seconds
  -- when there's an active nomination; both NULL when paused
  -- between nominations.
  v_payload := jsonb_build_object(
    'commissioner_user_id', auth.uid(),
    'reason',               p_reason,
    'paused_at',            v_paused_at,
    'paused_nomination_id', v_active_nom_id,
    'captured_remaining_seconds', v_remaining_seconds
  );
  v_payload_hash := 'sha256:server-generated';

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_paused', v_payload,
    v_payload_hash, p_idempotency_key, p_actor, NULL
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',                   v_event_id,
    'seq',                        v_new_seq,
    'paused_at',                  v_paused_at,
    'paused_nomination_id',       v_active_nom_id,
    'captured_remaining_seconds', v_remaining_seconds,
    'was_duplicate',              false
  );
END;
$$;

COMMENT ON FUNCTION public.auction_pause_v2(uuid, jsonb, text, uuid) IS
  'ADR-002 §4.4 / chunk 11g.6 sub-step 6c1: auction pause. Atomic 4-write block (auction_nominations row-lock + leagues.draft_state + leagues counter + draft_events). Captures remaining_seconds in event payload for resume-restore. Trusted-executor: requires service_role caller AND actor.kind=commissioner AND auth.uid() matches league commissioner.';

GRANT EXECUTE ON FUNCTION public.auction_pause_v2(uuid, jsonb, text, uuid) TO service_role;

-- ── 2. auction_resume_v2 ────────────────────────────────────────────
--
-- Atomicity contract:
--   BEGIN
--     SELECT prior auction_paused event FOR UPDATE
--       (race-protection: locks the source-of-truth row so two
--        simultaneous commissioner clicks cannot both succeed)
--     UPDATE auction_nominations.expires_at = now() + remaining
--       (only when the prior pause captured a paused_nomination_id)
--     UPDATE leagues.draft_state = 'active'
--     UPDATE leagues.draft_event_counter += 1
--     INSERT draft_events (auction_resumed)
--   COMMIT
--
-- The SELECT ... FOR UPDATE on the prior pause event is the
-- world-class detail. Without it, two simultaneous resume calls
-- could both read the same paused event row, both pass the state
-- check, and both INSERT resume events — producing two
-- `auction_resumed` rows for one `auction_paused`. The
-- idempotency_key parameter handles user-initiated retries (same
-- key → same response); the row-level lock handles the
-- simultaneous-different-commissioners-clicks race. Two layers,
-- different concerns.

CREATE OR REPLACE FUNCTION public.auction_resume_v2(
  p_league_id        uuid,
  p_actor            jsonb,
  p_idempotency_key  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id              bigint;
  v_existing_seq             bigint;
  v_commissioner             uuid;
  v_state                    text;
  v_caller_role              text;
  v_actor_kind               text;
  v_prior_pause_event_id     bigint;
  v_prior_pause_payload      jsonb;
  v_paused_nom_id            uuid;
  v_captured_remaining       int;
  v_resumed_at               timestamptz;
  v_new_expires_at           timestamptz;
  v_payload                  jsonb;
  v_payload_hash             text;
  v_new_seq                  bigint;
  v_event_id                 bigint;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq
    INTO v_existing_id, v_existing_seq
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'event_id',      v_existing_id,
      'seq',           v_existing_seq,
      'was_duplicate', true
    );
  END IF;

  -- Step 2: Auth (same model as auction_pause_v2).
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: auction_resume_v2 requires actor.kind=commissioner (got %)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state
    INTO v_commissioner, v_state
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- State-machine guard: resume is only legal from 'paused'.
  IF v_state <> 'paused' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot resume auction from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 3: Locate + LOCK the most recent prior auction_paused
  -- event for this league. The FOR UPDATE here is the world-class
  -- race-protection: locks the source-of-truth pause-event row so
  -- a simultaneous concurrent resume call blocks until this
  -- transaction completes (and then sees draft_state='active' and
  -- fails the state-machine guard above).
  --
  -- Locks the prior pause event row to prevent concurrent resume
  -- calls from both reading and writing — atomic under contention.
  SELECT id, payload
    INTO v_prior_pause_event_id, v_prior_pause_payload
    FROM public.draft_events
   WHERE league_id = p_league_id
     AND event_type = 'auction_paused'
   ORDER BY seq DESC
   LIMIT 1
   FOR UPDATE;

  IF v_prior_pause_event_id IS NULL THEN
    -- Should be unreachable: draft_state='paused' implies a prior
    -- pause event. Defensive raise.
    RAISE EXCEPTION 'illegal_state: draft_state=paused but no prior auction_paused event found for league %',
      p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_paused_nom_id      := (v_prior_pause_payload ->> 'paused_nomination_id')::uuid;
  v_captured_remaining := (v_prior_pause_payload ->> 'captured_remaining_seconds')::int;

  v_resumed_at := now();

  -- Step 4: Atomic write block.
  --   BEGIN (implicit)

  --     UPDATE auction_nominations.expires_at — only when there
  --     was an active nomination at pause time. ADR-002 §4.4:
  --     resume restores the captured remaining time, NOT a fresh
  --     full window. Divergent from snake/linear `draft_resume`.
  IF v_paused_nom_id IS NOT NULL AND v_captured_remaining IS NOT NULL THEN
    v_new_expires_at := v_resumed_at + (v_captured_remaining * interval '1 second');
    UPDATE public.auction_nominations
       SET expires_at = v_new_expires_at
     WHERE id = v_paused_nom_id;
  END IF;

  --     UPDATE leagues.draft_state -> 'active'
  UPDATE public.leagues
     SET draft_state = 'active'
   WHERE id = p_league_id;

  --     UPDATE leagues counter (counter advance for the event)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  --     INSERT draft_events (auction_resumed)
  v_payload := jsonb_build_object(
    'commissioner_user_id',  auth.uid(),
    'resumed_at',            v_resumed_at,
    'prior_pause_event_id',  v_prior_pause_event_id,
    'restored_nomination_id', v_paused_nom_id,
    'new_expires_at',        v_new_expires_at
  );
  v_payload_hash := 'sha256:server-generated';

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_resumed', v_payload,
    v_payload_hash, p_idempotency_key, p_actor, NULL
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',               v_event_id,
    'seq',                    v_new_seq,
    'resumed_at',             v_resumed_at,
    'prior_pause_event_id',   v_prior_pause_event_id,
    'restored_nomination_id', v_paused_nom_id,
    'new_expires_at',         v_new_expires_at,
    'was_duplicate',          false
  );
END;
$$;

COMMENT ON FUNCTION public.auction_resume_v2(uuid, jsonb, uuid) IS
  'ADR-002 §4.4 / chunk 11g.6 sub-step 6c1: auction resume. Atomic 4-or-5-write block (prior pause-event row-lock + optional auction_nominations.expires_at + leagues.draft_state + leagues counter + draft_events). Restores captured remaining_seconds (NOT fresh full window — divergent from snake/linear). Race-safe via SELECT FOR UPDATE on the prior pause-event row. Trusted-executor: same auth model as auction_pause_v2.';

GRANT EXECUTE ON FUNCTION public.auction_resume_v2(uuid, jsonb, uuid) TO service_role;

-- ── 3. nominate_player_v2 — add draft_state='paused' rejection ──────
--
-- Defense-in-depth alongside engine fail-fast in
-- `LobbyManager.processNominate`. Future code paths that bypass the
-- engine (admin tools, batch scripts, manual psql) cannot accidentally
-- write nominations against a paused league.
--
-- Atomicity contract: unchanged from chunk 11g.6 sub-step 6a. The
-- new SELECT/check happens INSIDE the existing transaction, between
-- the auth gate and the existing auction_nominations conflict check.
-- Five-write atomic block preserved.

CREATE OR REPLACE FUNCTION public.nominate_player_v2(
  p_league_id        uuid,
  p_team_id          uuid,
  p_player_id        text,
  p_player_name      text,
  p_opening_bid      numeric,
  p_session_id       uuid,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_actor            jsonb,
  p_correlation_id   uuid,
  p_clock_seconds    int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id        bigint;
  v_existing_seq       bigint;
  v_existing_hash      text;
  v_actor_kind         text;
  v_caller_role        text;
  v_draft_state        text;
  v_active_count       int;
  v_clock_deadline     timestamptz;
  v_correlation_id     uuid;
  v_payload            jsonb;
  v_new_seq            bigint;
  v_event_id           bigint;
  v_nomination_id      uuid;
  v_nomination_number  int;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
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
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: nominate_player_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('user', 'autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by nominate_player_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Chunk 11g.6 sub-step 6c1: defense-in-depth rejection of
  -- nominations during paused state. Engine ALSO checks; the RPC
  -- gate protects against direct callers (admin tools, manual
  -- psql, future code paths).
  SELECT draft_state INTO v_draft_state
    FROM public.leagues
   WHERE id = p_league_id;

  IF v_draft_state = 'paused' THEN
    RAISE EXCEPTION 'illegal_state: cannot nominate while auction is paused (league %)',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reject if there's already an active nomination (UNIQUE
  -- constraint at the DB layer + state-machine check here).
  SELECT count(*) INTO v_active_count
    FROM public.auction_nominations
   WHERE league_id = p_league_id
     AND status = 'active';

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'illegal_state: nomination already active in league %',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Compute clock deadline. RPC adds +1s pad to align with
  -- `submit_pick_v2` precedent (engine-side timer fires AFTER
  -- the user-visible countdown reaches zero).
  v_clock_deadline := date_trunc('second', now())
                    + make_interval(secs => p_clock_seconds)
                    + interval '1 second';

  -- Compute the next nomination_number (1-indexed monotonic).
  SELECT COALESCE(MAX(nomination_number), 0) + 1
    INTO v_nomination_number
    FROM public.auction_nominations
   WHERE league_id = p_league_id;

  -- Atomic 5-write block (unchanged from 6a).
  --   BEGIN (implicit)

  --     INSERT auction_nominations (the active nomination row)
  -- The draft_session_id is not used for the engine flow but the
  -- v1 schema requires it; copy the league_id as a placeholder
  -- (matching the 6a behavior). nominated_by_team_id, minimum_bid,
  -- current_high_bid all flow from the parameters.
  INSERT INTO public.auction_nominations (
    league_id, draft_session_id, nominated_by_team_id,
    player_id, player_name, minimum_bid, current_high_bid,
    current_high_bidder_team_id, status, nomination_number,
    expires_at
  )
  VALUES (
    p_league_id, p_league_id, p_team_id,
    p_player_id, p_player_name, p_opening_bid, p_opening_bid,
    p_team_id, 'active', v_nomination_number,
    v_clock_deadline
  )
  RETURNING id INTO v_nomination_id;

  --     INSERT auction_bids (the initial opening bid)
  INSERT INTO public.auction_bids (
    league_id, nomination_id, team_id, bid_amount
  )
  VALUES (
    p_league_id, v_nomination_id, p_team_id, p_opening_bid
  );

  --     INSERT draft_events (auction_nomination_started)
  v_payload := jsonb_build_object(
    'nomination_id',     v_nomination_id,
    'player_id',         p_player_id,
    'player_name',       p_player_name,
    'opening_bid',       p_opening_bid,
    'nominator_team_id', p_team_id,
    'expires_at',        v_clock_deadline,
    'session_id',        p_session_id
  );

  --     UPDATE leagues (advance event counter; row lock serializes writers)
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
    p_league_id, v_new_seq, 'auction_nomination_started', v_payload,
    p_payload_hash, p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  --     UPDATE auction_nominations (back-link the event id)
  UPDATE public.auction_nominations
     SET nomination_event_id = v_event_id
   WHERE id = v_nomination_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',        v_event_id,
    'seq',             v_new_seq,
    'nomination_id',   v_nomination_id,
    'clock_deadline',  v_clock_deadline,
    'was_duplicate',   false
  );
END;
$$;

COMMENT ON FUNCTION public.nominate_player_v2(uuid,uuid,text,text,numeric,uuid,uuid,text,jsonb,uuid,int) IS
  'ADR-002 §3 / ADR-004 §5 / chunk 11g.6 sub-step 6a + 6c1: auction nomination. Atomic 5-write block (auction_nominations + auction_bids + draft_events + leagues counter + back-link). 6c1 added draft_state=paused rejection gate (defense-in-depth). Trusted-executor: requires service_role caller; engine validates user identity + team authorization + budget reserve before calling.';

GRANT EXECUTE ON FUNCTION public.nominate_player_v2(uuid,uuid,text,text,numeric,uuid,uuid,text,jsonb,uuid,int) TO service_role;

-- ── 4. place_bid_v2 — add draft_state='paused' rejection ────────────
--
-- Same defense-in-depth treatment as nominate_player_v2. Also
-- preserves the 6b anti-snipe parameters and atomic 4-or-7-write
-- block.

DROP FUNCTION IF EXISTS public.place_bid_v2(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,uuid,int,int);

CREATE OR REPLACE FUNCTION public.place_bid_v2(
  p_league_id                       uuid,
  p_team_id                         uuid,
  p_nomination_id                   uuid,
  p_bid_amount                      numeric,
  p_session_id                      uuid,
  p_idempotency_key                 uuid,
  p_payload_hash                    text,
  p_actor                           jsonb,
  p_correlation_id                  uuid,
  p_anti_snipe_threshold_seconds    int,
  p_anti_snipe_extension_seconds    int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id              bigint;
  v_existing_seq             bigint;
  v_existing_hash            text;
  v_actor_kind               text;
  v_caller_role              text;
  v_draft_state              text;
  v_nom_status               text;
  v_current_high_bid         numeric;
  v_nom_expires_at           timestamptz;
  v_payload                  jsonb;
  v_new_seq                  bigint;
  v_event_id                 bigint;
  v_correlation_id           uuid;
  v_seconds_remaining        numeric;
  v_was_extended             boolean := false;
  v_new_expires_at           timestamptz;
  v_extends_idempotency_key  uuid;
  v_extends_seq              bigint;
  v_extends_event_id         bigint;
  v_extends_payload          jsonb;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
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
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: place_bid_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('user', 'autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by place_bid_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Chunk 11g.6 sub-step 6c1: defense-in-depth rejection of bids
  -- during paused state.
  SELECT draft_state INTO v_draft_state
    FROM public.leagues
   WHERE id = p_league_id;

  IF v_draft_state = 'paused' THEN
    RAISE EXCEPTION 'illegal_state: cannot bid while auction is paused (league %)',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status, current_high_bid, expires_at
    INTO v_nom_status, v_current_high_bid, v_nom_expires_at
    FROM public.auction_nominations
   WHERE id = p_nomination_id AND league_id = p_league_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: nomination % not found in league %',
      p_nomination_id, p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_nom_status <> 'active' THEN
    RAISE EXCEPTION 'illegal_state: nomination % is % (expected active)',
      p_nomination_id, v_nom_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_bid_amount <= v_current_high_bid THEN
    RAISE EXCEPTION 'bid_too_low: bid % must be greater than current_high_bid %',
      p_bid_amount, v_current_high_bid
      USING ERRCODE = 'check_violation';
  END IF;

  --   BEGIN (implicit)

  INSERT INTO public.auction_bids (
    league_id, nomination_id, team_id, bid_amount
  )
  VALUES (
    p_league_id, p_nomination_id, p_team_id, p_bid_amount
  );

  UPDATE public.auction_nominations
     SET current_high_bid = p_bid_amount,
         current_high_bidder_team_id = p_team_id
   WHERE id = p_nomination_id;

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  -- Anti-snipe threshold check (chunk 11g.6 sub-step 6b — unchanged).
  v_seconds_remaining := EXTRACT(EPOCH FROM (v_nom_expires_at - now()));

  IF p_anti_snipe_threshold_seconds > 0
     AND v_seconds_remaining < p_anti_snipe_threshold_seconds
  THEN
    v_was_extended   := true;
    v_new_expires_at := now() + (p_anti_snipe_extension_seconds * interval '1 second');

    UPDATE public.auction_nominations
       SET expires_at = v_new_expires_at
     WHERE id = p_nomination_id;
  ELSE
    v_new_expires_at := v_nom_expires_at;
  END IF;

  v_payload := jsonb_build_object(
    'nomination_id',  p_nomination_id,
    'team_id',        p_team_id,
    'bid_amount',     p_bid_amount,
    'clock_deadline', v_new_expires_at,
    'session_id',     p_session_id
  );

  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_bid_placed', v_payload,
    p_payload_hash, p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  IF v_was_extended THEN
    v_extends_idempotency_key :=
      md5('extends:' || p_idempotency_key::text)::uuid;

    v_extends_payload := jsonb_build_object(
      'nomination_id',         p_nomination_id,
      'prior_expires_at',      v_nom_expires_at,
      'new_expires_at',        v_new_expires_at,
      'triggering_bid_id',     v_event_id,
      'triggering_team_id',    p_team_id,
      'triggering_bid_amount', p_bid_amount
    );

    UPDATE public.leagues
       SET draft_event_counter = draft_event_counter + 1
     WHERE id = p_league_id
    RETURNING draft_event_counter INTO v_extends_seq;

    INSERT INTO public.draft_events (
      league_id, seq, event_type, payload, payload_hash,
      idempotency_key, actor, correlation_id
    )
    VALUES (
      p_league_id, v_extends_seq, 'auction_bid_extends_timer',
      v_extends_payload, p_payload_hash,
      v_extends_idempotency_key, p_actor, v_correlation_id
    )
    RETURNING id INTO v_extends_event_id;
  END IF;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',         v_event_id,
    'seq',              v_new_seq,
    'clock_deadline',   v_new_expires_at,
    'was_duplicate',    false,
    'was_extended',     v_was_extended,
    'extends_event_seq', v_extends_seq
  );
END;
$$;

COMMENT ON FUNCTION public.place_bid_v2(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, uuid, int, int
) IS
  'ADR-002 §3.3 / §4.4 / chunk 11g.6 sub-step 6a + 6b + 6c1: auction bid with anti-snipe timer extension. Atomic 4-or-7-write block. Strict-greater bid check + strict-less-than threshold check + draft_state=paused rejection (defense-in-depth). Trusted-executor: requires service_role caller; engine validates budget reserve + reads anti-snipe config from leagues.settings before calling.';

GRANT EXECUTE ON FUNCTION public.place_bid_v2(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, uuid, int, int
) TO service_role;
