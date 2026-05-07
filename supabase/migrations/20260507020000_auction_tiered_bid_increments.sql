-- ════════════════════════════════════════════════════════════════════
-- Phase 4.5 chunk 11g.6 sub-step 6c2: auction tiered bid increments.
--
-- Per ADR-002 §4.3 + §4.5: minimum bid increments come from a
-- per-league JSONB tier table. The tier of the LEADING BID
-- determines the next-bid increment (industry-standard, anti-gaming
-- — leading bidder cannot trickle-up by $1 in a tier where the
-- spec calls for $10 jumps).
--
-- Spec-honoring decisions (chunk 11g.6 sub-step 6c2 recon, all
-- ratified):
--   - Tier shape is `{below: int, increment: int}` (NOT
--     `{maxBid, increment}` — `below` is exclusive upper bound).
--   - Default tier = flat $1 per ADR-002 §4.3
--     `[{below: Number.MAX_SAFE_INTEGER, increment: 1}]`.
--     Preserves v1 behavior; commissioners opt-in to tiered.
--   - Strict-less-than boundary (`leading_bid < tier.below`). A
--     bid at exactly `below: 10` drops to the next tier.
--   - Path A gracious fallback: when no tier matches (leading bid
--     ≥ all `below` values), use the last tier's increment. Robust
--     against misconfiguration where a high-budget league
--     out-bids the configured `below` ceilings.
--
-- Migration scope:
--   1. NEW STABLE function: compute_min_next_bid(numeric, jsonb)
--      Pure deterministic computation; testable in isolation;
--      callable from chunk 11g.6 sub-step 6c4's commissioner
--      override RPC if it needs to adjust bids.
--   2. CREATE OR REPLACE place_bid_v2 with new
--      p_min_bid_increment_tiers jsonb parameter. Increment check
--      sits inside the existing atomic transaction alongside the
--      strict-greater bid check. Defense-in-depth (engine ALSO
--      checks).
--
-- No schema changes to leagues.settings (JSONB is permissive).
-- No new draft_events event_type values (no new event variants).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. compute_min_next_bid (STABLE helper) ─────────────────────────
--
-- Tier-application examples (verify these in tests; locking behavior
-- documented inline to prevent future off-by-one regressions):
--
-- Example tier table:
--   [{"below": 10, "increment": 1},
--    {"below": 50, "increment": 5},
--    {"below": 999, "increment": 10}]
--
-- Leading $5    → tier (below 10)  → +$1  → returns $6
-- Leading $9    → tier (below 10)  → +$1  → returns $10
--                                 (boundary: $9 < 10 strictly)
-- Leading $10   → tier (below 50)  → +$5  → returns $15
--                                 (boundary: $10 NOT < 10, drops
--                                  to next tier per strict-less-than)
-- Leading $50   → tier (below 999) → +$10 → returns $60
-- Leading $1000 → no tier matches  → +$10 → returns $1010
--                                 (Path A gracious fallback: uses
--                                  last tier's increment when leading
--                                  bid exceeds all `below` values)

CREATE OR REPLACE FUNCTION public.compute_min_next_bid(
  p_leading_bid numeric,
  p_tier_table  jsonb
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_tier            jsonb;
  v_below           numeric;
  v_increment       numeric;
  v_last_increment  numeric;
BEGIN
  IF p_tier_table IS NULL OR jsonb_array_length(p_tier_table) = 0 THEN
    RAISE EXCEPTION 'invalid_tier_table: empty or null tier table'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Walk the tier table in declared order. First tier whose `below`
  -- (strictly) exceeds the leading bid wins. Track the last tier's
  -- increment for the Path A fallback.
  FOR v_tier IN SELECT * FROM jsonb_array_elements(p_tier_table)
  LOOP
    v_below     := (v_tier ->> 'below')::numeric;
    v_increment := (v_tier ->> 'increment')::numeric;

    IF v_increment <= 0 THEN
      RAISE EXCEPTION 'invalid_tier_table: tier increment must be positive (got %)',
        v_increment
        USING ERRCODE = 'check_violation';
    END IF;

    v_last_increment := v_increment;

    IF p_leading_bid < v_below THEN
      RETURN p_leading_bid + v_increment;
    END IF;
  END LOOP;

  -- Path A gracious fallback: leading bid exceeds all `below`
  -- ceilings. Use the last tier's increment so absurd-but-legal
  -- bids (e.g., $1000 in a league with `below: 999` ceiling) still
  -- get a deterministic minimum.
  RETURN p_leading_bid + v_last_increment;
END;
$$;

COMMENT ON FUNCTION public.compute_min_next_bid(numeric, jsonb) IS
  'ADR-002 §4.3 / chunk 11g.6 sub-step 6c2: deterministic tier-based minimum-next-bid computation. STABLE. Strict-less-than boundary; Path A gracious fallback uses the last tier''s increment when leading bid exceeds all `below` ceilings.';

GRANT EXECUTE ON FUNCTION public.compute_min_next_bid(numeric, jsonb) TO service_role;

-- ── 2. place_bid_v2 — add tiered-increment validation ───────────────
--
-- Atomicity contract: unchanged from 6c1. The new
-- compute_min_next_bid() call happens INSIDE the existing
-- transaction, between the strict-greater bid check and the
-- INSERT auction_bids step. Five-or-eight-write atomic block
-- preserved (4 baseline + 3 anti-snipe extension).
--
-- New parameter: p_min_bid_increment_tiers jsonb. Engine threads
-- the per-league tier table from leagues.settings (matches 6b's
-- per-RPC-pass pattern with anti-snipe params).
--
-- Defense-in-depth: engine ALSO computes minimum-next-bid via
-- `server/src/draft/auctionBidIncrement.ts` for fail-fast rejection.
-- The RPC layer protects future code paths that bypass the engine.

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
  p_anti_snipe_extension_seconds    int,
  p_min_bid_increment_tiers         jsonb
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
  v_min_next_bid             numeric;
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

  -- Chunk 11g.6 sub-step 6c1: defense-in-depth pause gate.
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

  -- Chunk 11g.6 sub-step 6c2: tiered-increment validation (defense-
  -- in-depth alongside engine fail-fast in
  -- LobbyManager.processPlaceBid). Per ADR-002 §4.3, the tier of
  -- the LEADING bid determines the increment for the next bid.
  v_min_next_bid := public.compute_min_next_bid(
    v_current_high_bid, p_min_bid_increment_tiers
  );

  IF p_bid_amount < v_min_next_bid THEN
    RAISE EXCEPTION 'bid_increment_violation: bid % below tier minimum % (current_high_bid %)',
      p_bid_amount, v_min_next_bid, v_current_high_bid
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
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, uuid, int, int, jsonb
) IS
  'ADR-002 §3.3 / §4.3 / §4.4 / chunk 11g.6 sub-step 6a + 6b + 6c1 + 6c2: auction bid with tiered-increment validation, anti-snipe timer extension, and pause gate. Atomic 5-or-8-write block. Strict-greater bid check + tier-based minimum-next-bid check (via compute_min_next_bid) + strict-less-than anti-snipe threshold + draft_state=paused rejection. Trusted-executor: requires service_role caller; engine validates budget reserve + reads anti-snipe + tier config from leagues.settings before calling.';

GRANT EXECUTE ON FUNCTION public.place_bid_v2(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, uuid, int, int, jsonb
) TO service_role;
