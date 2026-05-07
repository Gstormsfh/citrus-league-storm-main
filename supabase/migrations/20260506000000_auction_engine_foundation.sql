-- Phase 4.5 chunk 11g.6 sub-step 6a — auction engine foundation.
--
-- Three concerns shipped together so server (DB) and client (engine)
-- co-design the contract:
--
--   1. `draft_events.event_type` CHECK enum expansion: admit the
--      9 auction event types per ADR-002 §4.1.
--   2. Schema additions per ADR-002 §5.4: new `nomination_event_id`
--      column on `auction_nominations` (links projection back to
--      the durable event log), new partial index for fast auction-
--      specific replay during chunk 11g.7's bootstrap.
--   3. Three new SECURITY DEFINER RPCs that mirror submit_pick_v2's
--      structural pattern: nominate_player_v2 / place_bid_v2 /
--      close_nomination_v2.
--
-- **Trust model (ADR-002 §3.5 + ADR-004 §5):** the auction RPCs
-- accept service_role + actor.kind='user' / 'autopick' /
-- 'commissioner' from the trusted persistent engine, which has
-- already validated the user's identity (chunk 11g.2 step 2 JWT)
-- and team-membership authorization (engine-side
-- verifyTeamAuthorization). Direct user calls (without the engine
-- in front) are not supported for auction — bids and nominations
-- flow through the persistent engine's single-writer queue per
-- chunk 11g.4 Principle 5. The RPCs reject any non-service_role
-- call.
--
-- **Atomicity contract (every RPC):** SECURITY DEFINER PostgreSQL
-- functions run in an implicit transaction (any RAISE EXCEPTION
-- rolls back all writes within the function). The explicit BEGIN /
-- COMMIT comments below mark the atomicity boundaries for future
-- engineers — moving writes out of these blocks (or into a CALL
-- with explicit transaction control) breaks the contract.
--
-- See ADR-002 (auction state machine, ratified 2026-04-30) and
-- ADR-004 (engine-as-trusted-executor, ratified 2026-05-06) for
-- full architectural rationale.

-- ── 1. CHECK enum expansion ────────────────────────────────────────
--
-- Drop the existing constraint added in
-- 20260425130000_draft_engine_v2_foundation.sql:36-48 and replace
-- with the expanded set including the 9 auction event types per
-- ADR-002 §4.1. Forward-compat: `auction_bid_extends_timer`,
-- `auction_auto_nominated`, `auction_paused`, `auction_resumed`,
-- `auction_commissioner_override` are admitted now even though
-- chunks 11g.6 sub-steps 6b/6c emit them.

ALTER TABLE public.draft_events
  DROP CONSTRAINT IF EXISTS draft_events_event_type_chk;

ALTER TABLE public.draft_events
  ADD CONSTRAINT draft_events_event_type_chk CHECK (event_type IN (
    -- Snake/linear (chunk 11g.4 step 5+ ships these)
    'pick',
    'pick_undone',
    'autopick_failed',
    'draft_started',
    'draft_paused',
    'draft_resumed',
    'draft_extended',
    'draft_completed',
    'draft_cancelled',
    'commissioner_override',
    'generation_bumped',
    -- Auction (chunk 11g.6 sub-step 6a ships first 4; 6b/6c the rest)
    'auction_nomination_started',
    'auction_bid_placed',
    'auction_nomination_expired',
    'auction_nomination_closed',
    'auction_bid_extends_timer',
    'auction_auto_nominated',
    'auction_paused',
    'auction_resumed',
    'auction_commissioner_override'
  ));

-- ── 2. Schema additions (ADR-002 §5.4) ─────────────────────────────

-- Link auction_nominations rows back to the auction_nomination_started
-- event in draft_events. Allows traversal from the projection
-- (auction_nominations) to the durable event log (draft_events).
-- NULL until the projection trigger / RPC writes the link.
ALTER TABLE public.auction_nominations
  ADD COLUMN IF NOT EXISTS nomination_event_id BIGINT
  REFERENCES public.draft_events(id) ON DELETE SET NULL;

-- Partial index for auction-specific replay during bootstrap. Keeps
-- snake/linear bootstraps fast (no scan of auction events) and
-- enables auction bootstraps to read only the relevant slice.
CREATE INDEX IF NOT EXISTS idx_draft_events_auction
  ON public.draft_events (league_id, seq)
  WHERE event_type LIKE 'auction_%';

-- ── 3a. nominate_player_v2 ─────────────────────────────────────────
--
-- Atomicity contract:
--   BEGIN
--     INSERT auction_nominations (the active nomination row)
--     INSERT auction_bids        (the initial opening bid)
--     INSERT draft_events        (auction_nomination_started)
--     UPDATE leagues             (counter advance for seq)
--     UPDATE auction_nominations (back-link nomination_event_id)
--   COMMIT
--
-- These five writes are atomic. A partial failure that creates a
-- nomination without an initial bid leaves the system in an
-- inconsistent state where bids appear to start above the opening
-- price. Implicit transaction (PostgreSQL function context) enforces
-- the boundary; the comment block marks it for future engineers.

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
  v_settings           jsonb;
  v_min_bid            numeric;
  v_clock_deadline     timestamptz;
  v_payload            jsonb;
  v_new_seq            bigint;
  v_event_id           bigint;
  v_nomination_id      uuid;
  v_correlation_id     uuid;
  v_session_id         uuid;
  v_player_taken       boolean;
  v_active_nom         uuid;
  v_session_uuid_text  text;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency check (per submit_pick_v2 spec §5.2.1).
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

  -- Step 2: Auth (ADR-002 §3.5 + ADR-004 §5).
  -- Auction RPCs require service_role; the engine is the trusted
  -- caller. Direct user calls are not supported (auction flows
  -- through the LobbyManager's single-writer queue, not direct RPC).
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

  -- Step 3: Preflight checks.
  SELECT draft_state, settings
    INTO v_draft_state, v_settings
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

  -- Validate opening bid >= league minimum.
  v_min_bid := COALESCE((v_settings ->> 'auctionMinBid')::numeric, 1);
  IF p_opening_bid < v_min_bid THEN
    RAISE EXCEPTION 'invalid_event_payload: opening_bid % below auctionMinBid %',
      p_opening_bid, v_min_bid
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validate no active nomination already.
  SELECT id INTO v_active_nom
    FROM public.auction_nominations
   WHERE league_id = p_league_id AND status = 'active'
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'illegal_state: nomination % already active for league %',
      v_active_nom, p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validate player not already drafted in this league.
  SELECT EXISTS (
    SELECT 1 FROM public.draft_picks
     WHERE league_id = p_league_id AND player_id = p_player_id
  ) INTO v_player_taken;

  IF v_player_taken THEN
    RAISE EXCEPTION 'player_taken: player % already drafted in league %',
      p_player_id, p_league_id
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Step 4: Compute clock deadline (matches submit_pick_v2's
  -- +1s pad pattern from migration line 896-898).
  v_clock_deadline := date_trunc('second', now())
                    + make_interval(secs => GREATEST(1, p_clock_seconds))
                    + interval '1 second';

  -- Step 5: Atomic write block.
  --   BEGIN (implicit — function context)
  v_nomination_id  := gen_random_uuid();
  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  --     INSERT auction_nominations (status='active', current_high_bid=opening, current_high_bidder=nominator)
  INSERT INTO public.auction_nominations (
    id, league_id, draft_session_id, nominated_by_team_id,
    player_id, player_name, minimum_bid, current_high_bid,
    current_high_bidder_team_id, status, nomination_number, expires_at
  )
  VALUES (
    v_nomination_id,
    p_league_id,
    p_session_id, -- engine's per-session UUID stands in for draft_session_id
    p_team_id,
    p_player_id,
    p_player_name,
    v_min_bid,
    p_opening_bid,
    p_team_id, -- nominator is implicit opening bidder
    'active',
    -- nomination_number: count of prior nominations in this league + 1
    1 + COALESCE((
      SELECT MAX(nomination_number) FROM public.auction_nominations
       WHERE league_id = p_league_id
    ), 0),
    v_clock_deadline
  );

  --     INSERT auction_bids (the initial opening bid representing the nomination)
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

  --   COMMIT (implicit — function returns successfully)

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
  'ADR-002 §3 / ADR-004 §5 / chunk 11g.6 sub-step 6a: auction nomination. Atomic 5-write block (auction_nominations + auction_bids + draft_events + leagues counter + back-link). Trusted-executor: requires service_role caller; engine validates user identity + team authorization + budget reserve before calling.';

-- ── 3b. place_bid_v2 ───────────────────────────────────────────────
--
-- Atomicity contract:
--   BEGIN
--     INSERT auction_bids
--     UPDATE auction_nominations.current_high_bid + current_high_bidder_team_id
--     INSERT draft_events (auction_bid_placed)
--     UPDATE leagues (counter advance)
--   COMMIT
--
-- These four writes are atomic. A partial failure that records a bid
-- without updating the nomination's current_high_bid would let a
-- subsequent bid succeed at a stale (lower) threshold.

CREATE OR REPLACE FUNCTION public.place_bid_v2(
  p_league_id        uuid,
  p_team_id          uuid,
  p_nomination_id    uuid,
  p_bid_amount       numeric,
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
  v_existing_id        bigint;
  v_existing_seq       bigint;
  v_existing_hash      text;
  v_actor_kind         text;
  v_caller_role        text;
  v_nom_status         text;
  v_current_high_bid   numeric;
  v_nom_expires_at     timestamptz;
  v_payload            jsonb;
  v_new_seq            bigint;
  v_event_id           bigint;
  v_correlation_id     uuid;
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

  -- Step 3: Preflight — load + lock the nomination row.
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
  UPDATE public.auction_nominations
     SET current_high_bid = p_bid_amount,
         current_high_bidder_team_id = p_team_id
   WHERE id = p_nomination_id;

  --     INSERT draft_events (auction_bid_placed)
  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());
  v_payload := jsonb_build_object(
    'nomination_id',  p_nomination_id,
    'team_id',        p_team_id,
    'bid_amount',     p_bid_amount,
    'clock_deadline', v_nom_expires_at,
    'session_id',     p_session_id
  );

  --     UPDATE leagues (counter advance)
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

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',        v_event_id,
    'seq',             v_new_seq,
    'clock_deadline',  v_nom_expires_at,
    'was_duplicate',   false
  );
END;
$$;

COMMENT ON FUNCTION public.place_bid_v2(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,uuid) IS
  'ADR-002 §3 / chunk 11g.6 sub-step 6a: auction bid. Atomic 4-write block (auction_bids + auction_nominations + draft_events + leagues counter). Strict-greater-than-current bid check. Trusted-executor: requires service_role caller; engine validates budget reserve before calling.';

-- ── 3c. close_nomination_v2 ────────────────────────────────────────
--
-- Atomicity contract:
--   BEGIN
--     UPDATE auction_nominations.status = 'sold' (or 'no_sale' for no-bids)
--     UPDATE auction_budgets (decrement remaining_budget, increment players_won)
--     INSERT draft_picks (final ownership)
--     INSERT draft_events (auction_nomination_closed OR auction_nomination_expired)
--     UPDATE leagues (counter advance)
--   COMMIT
--
-- These five writes are atomic. A partial failure that closes the
-- nomination without decrementing the winner's budget desyncs
-- the projection from the event log. Future engineers: do not
-- relax this boundary without an ADR-002 supersession.

CREATE OR REPLACE FUNCTION public.close_nomination_v2(
  p_league_id        uuid,
  p_nomination_id    uuid,
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
  v_existing_id        bigint;
  v_existing_seq       bigint;
  v_existing_hash      text;
  v_actor_kind         text;
  v_caller_role        text;
  v_nom_status         text;
  v_winner_team_id     uuid;
  v_final_bid          numeric;
  v_player_id          text;
  v_player_name        text;
  v_total_bids         int;
  v_payload            jsonb;
  v_event_type         text;
  v_new_seq            bigint;
  v_event_id           bigint;
  v_correlation_id     uuid;
  v_no_sale            boolean;
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

  -- Step 2: Auth — close_nomination is engine-only (timer fire).
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: close_nomination_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by close_nomination_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Step 3: Load + lock the nomination row.
  SELECT status, current_high_bidder_team_id, current_high_bid,
         player_id, player_name
    INTO v_nom_status, v_winner_team_id, v_final_bid,
         v_player_id, v_player_name
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

  -- "No sale": only one bid (the nominator's opening), no follow-ups.
  -- Treat as auction_nomination_expired with the nominator forfeiting
  -- their turn (no player awarded, no budget decrement). For 6a
  -- simplicity, "no sale" is determined by total_bids = 1.
  SELECT count(*) INTO v_total_bids
    FROM public.auction_bids
   WHERE nomination_id = p_nomination_id;

  v_no_sale := v_total_bids = 1;

  -- Step 4: Atomic write block.
  --   BEGIN (implicit)

  IF v_no_sale THEN
    --     UPDATE auction_nominations.status = 'no_sale'
    UPDATE public.auction_nominations
       SET status = 'no_sale'
     WHERE id = p_nomination_id;

    -- No budget decrement, no draft_picks insert. Just emit the
    -- expired event so the engine advances state.
    v_event_type := 'auction_nomination_expired';
    v_payload := jsonb_build_object(
      'nomination_id', p_nomination_id,
      'reason',        'no_bids'
    );
  ELSE
    --     UPDATE auction_nominations.status = 'sold'
    UPDATE public.auction_nominations
       SET status = 'sold'
     WHERE id = p_nomination_id;

    --     UPDATE auction_budgets (decrement remaining + increment players_won)
    UPDATE public.auction_budgets
       SET remaining_budget = remaining_budget - v_final_bid,
           players_won      = players_won + 1,
           updated_at       = now()
     WHERE league_id = p_league_id AND team_id = v_winner_team_id;

    --     INSERT draft_picks (final ownership ledger)
    INSERT INTO public.draft_picks (
      league_id, round_number, pick_number, team_id,
      player_id, picked_at
    )
    VALUES (
      p_league_id,
      -- For auction, round_number / pick_number are nominally tracked
      -- via the nomination_number; using 1 / nomination_number for
      -- compatibility with the existing draft_picks shape. UI
      -- rendering treats auction picks as flat (no rounds).
      1,
      (SELECT nomination_number FROM public.auction_nominations
        WHERE id = p_nomination_id),
      v_winner_team_id,
      v_player_id,
      now()
    );

    v_event_type := 'auction_nomination_closed';
    v_payload := jsonb_build_object(
      'nomination_id',    p_nomination_id,
      'winning_team_id',  v_winner_team_id,
      'final_amount',     v_final_bid,
      'total_bids',       v_total_bids,
      'player_id',        v_player_id,
      'player_name',      v_player_name
    );
  END IF;

  --     INSERT draft_events
  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  --     UPDATE leagues (counter advance)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, v_event_type, v_payload,
    p_payload_hash, p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'event_type',    v_event_type,
    'no_sale',       v_no_sale,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) IS
  'ADR-002 §3 / chunk 11g.6 sub-step 6a: auction nomination close (engine timer fire). Atomic 5-write block (auction_nominations + auction_budgets + draft_picks + draft_events + leagues counter). No-sale variant skips budget decrement + draft_picks insert. Trusted-executor: requires service_role caller; actor.kind must be autopick (engine) or commissioner.';

-- ── 4. Grants ──────────────────────────────────────────────────────
-- Engine calls these via DraftServiceV2's admin client (service_role).
-- No authenticated user paths.

GRANT EXECUTE ON FUNCTION public.nominate_player_v2(uuid,uuid,text,text,numeric,uuid,uuid,text,jsonb,uuid,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.place_bid_v2(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) TO service_role;
