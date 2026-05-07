-- ════════════════════════════════════════════════════════════════════
-- Phase 4.5 chunk 11g.6 sub-step 6b: auction anti-snipe timer
-- extension. Per ADR-002 §3.3 (algorithm) and §4.4 (cascade
-- semantics; NOT §3.5 — §3.5 is the race-condition fix, not
-- anti-snipe). Industry-standard incremental extension: a bid that
-- arrives in the final N seconds of the bid window extends the
-- window by another N seconds. Each subsequent bid in the new
-- final-N window extends again. No cap on cascade depth (commish
-- can configure max-cascade if pacing concerns surface — deferred
-- to v1.1).
--
-- World-class principle: anti-snipe extension is **atomic with the
-- bid write**. A bid that commits without its corresponding
-- extension would let a snipe-attempting bid win because the
-- nomination's `expires_at` would say "10ms remaining" while
-- another bid's INSERT is mid-flight. Same transaction → same
-- atomicity contract → no partial-extension state.
--
-- The 6a migration (20260506000000_auction_engine_foundation.sql)
-- already admits `auction_bid_extends_timer` in the
-- draft_events.event_type CHECK enum (line 70 — forward-compat).
-- 6b does NOT alter the CHECK; it just CREATE OR REPLACEs
-- place_bid_v2 with the extension logic added inline.
-- ════════════════════════════════════════════════════════════════════

-- ── place_bid_v2 (with anti-snipe extension) ────────────────────────
--
-- Atomicity contract:
--   BEGIN
--     -- Standard bid path (unchanged from 6a):
--     INSERT auction_bids                    (the new bid row)
--     UPDATE auction_nominations             (current_high_bid + bidder)
--     UPDATE leagues                         (counter advance, seq N)
--     INSERT draft_events                    (auction_bid_placed, seq N)
--
--     -- Anti-snipe extension path (new in 6b; only when threshold met):
--     IF seconds_remaining < threshold AND threshold > 0:
--       UPDATE auction_nominations           (expires_at = now() + ext)
--       UPDATE leagues                       (counter advance, seq N+1)
--       INSERT draft_events                  (auction_bid_extends_timer, seq N+1)
--   COMMIT
--
-- These 4 (no extension) or 7 (with extension) writes are atomic. A
-- partial failure that extends the deadline without recording the
-- extension event would create event-log/projection drift on
-- bootstrap replay. Same SECURITY DEFINER function context = same
-- implicit transaction = same atomicity boundary.
--
-- Two new parameters:
--   p_anti_snipe_threshold_seconds  — extension fires when
--     seconds_remaining < this value AND value > 0 (zero disables
--     anti-snipe per ADR-002 §4.3 "Range 0-120 (0 disables)")
--   p_anti_snipe_extension_seconds  — extension duration on fire

DROP FUNCTION IF EXISTS public.place_bid_v2(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,uuid);

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

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      -- Retry of an already-committed bid. The original transaction
      -- (if any extension fired) committed both rows atomically; the
      -- caller's resync path replays from the durable log to learn
      -- the post-extension deadline. Return the bid event's seq +
      -- was_duplicate. (Per existing 6a contract; no behavior change.)
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

  -- Step 2: Auth.
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

  -- Step 3: Preflight — load + lock the nomination row. The
  -- FOR UPDATE here serializes against any concurrent bid on the
  -- same nomination at the row-lock level, complementing the
  -- single-writer queue's per-lobby serialization in the engine.
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

  -- Strict-greater bid check (ADR-002 §3.3).
  IF p_bid_amount <= v_current_high_bid THEN
    RAISE EXCEPTION 'bid_too_low: bid % must be greater than current_high_bid %',
      p_bid_amount, v_current_high_bid
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 4: Atomic write block.
  --   BEGIN (implicit)

  --     INSERT auction_bids
  INSERT INTO public.auction_bids (
    league_id, nomination_id, team_id, bid_amount
  )
  VALUES (
    p_league_id, p_nomination_id, p_team_id, p_bid_amount
  );

  --     UPDATE auction_nominations.current_high_bid + current_high_bidder_team_id
  --
  -- Note: the FOR UPDATE lock above means no concurrent bid can
  -- have changed `expires_at` between our SELECT and this UPDATE.
  -- v_nom_expires_at remains the source of truth for the
  -- anti-snipe threshold check below.
  UPDATE public.auction_nominations
     SET current_high_bid = p_bid_amount,
         current_high_bidder_team_id = p_team_id
   WHERE id = p_nomination_id;

  --     INSERT draft_events (auction_bid_placed)
  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  -- Step 5: Anti-snipe threshold check (ADR-002 §3.3 / §4.4).
  -- Strict-less-than: a bid arriving at exactly the threshold
  -- boundary does NOT extend (ADR-002 §4.4 example uses second 29
  -- of a 30s window with threshold=30 → extends; second 30 boundary
  -- → does not extend).
  -- Threshold = 0 disables anti-snipe entirely (ADR-002 §4.3).
  v_seconds_remaining := EXTRACT(EPOCH FROM (v_nom_expires_at - now()));

  IF p_anti_snipe_threshold_seconds > 0
     AND v_seconds_remaining < p_anti_snipe_threshold_seconds
  THEN
    v_was_extended   := true;
    v_new_expires_at := now() + (p_anti_snipe_extension_seconds * interval '1 second');

    --     UPDATE auction_nominations.expires_at (extension)
    UPDATE public.auction_nominations
       SET expires_at = v_new_expires_at
     WHERE id = p_nomination_id;
  ELSE
    v_new_expires_at := v_nom_expires_at;
  END IF;

  -- The auction_bid_placed event's `clock_deadline` carries the
  -- POST-extension deadline (or unchanged original). Clients
  -- consuming the bid broadcast see the new deadline immediately
  -- without needing to wait for the extends_timer event.
  v_payload := jsonb_build_object(
    'nomination_id',  p_nomination_id,
    'team_id',        p_team_id,
    'bid_amount',     p_bid_amount,
    'clock_deadline', v_new_expires_at,
    'session_id',     p_session_id
  );

  --     UPDATE leagues (counter advance for the bid event)
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

  -- Step 6: Anti-snipe extension event (only if threshold met).
  -- Same actor + correlation_id as the parent bid (the extension
  -- is a consequence of the user's bid, not a separate engine
  -- action) — audit trail reads naturally as "User X placed bid Y;
  -- system extended timer Z" sharing actor + correlation. Same
  -- pattern as chunk 11g.4 step 6c's autopick actor flowing through
  -- to its `pick_submitted` event.
  --
  -- Idempotency key for the extends event is derived deterministically
  -- from the parent's via md5 hash. Retries of the same parent bid
  -- exit early at Step 1 (above) without re-firing the extension, so
  -- the derived key is only needed for the unique-constraint distinction
  -- within the original transaction's two draft_events rows.
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

    --     UPDATE leagues (counter advance for the extends event)
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
  'ADR-002 §3.3 / §4.4 / chunk 11g.6 sub-step 6b: auction bid with anti-snipe timer extension. Atomic 4-or-7-write block (auction_bids + auction_nominations + draft_events + leagues counter, plus 3 more writes when extension fires). Strict-greater bid check + strict-less-than threshold check. Trusted-executor: requires service_role caller; engine validates budget reserve + reads anti-snipe config from leagues.settings before calling.';

GRANT EXECUTE ON FUNCTION public.place_bid_v2(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, uuid, int, int
) TO service_role;
