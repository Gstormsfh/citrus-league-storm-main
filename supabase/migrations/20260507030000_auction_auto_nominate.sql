-- ════════════════════════════════════════════════════════════════════
-- Phase 4.5 chunk 11g.6 sub-step 6c3: auction auto-nominate +
-- nomination-window timer + force-skip cascade.
--
-- Per ADR-002 §3.4 + §4.2: when a nomination window expires without
-- the on-clock nominator submitting a player, the engine
-- auto-nominates server-side via the chain-of-strategies in
-- `server/src/draft/auctionAutoNominateStrategy.ts`. The result
-- flows through the existing `nominate_player_v2` RPC with
-- `actor.kind='autopick'` (no RPC schema change — the existing RPC
-- already accepts this actor kind per the 6a trusted-executor
-- contract).
--
-- **Path Y extension of ADR-002** (Decision Log 2026-05-07): when
-- the auto-nominator can't afford even `auctionMinBid + reserve`,
-- the engine emits `auction_nomination_skipped` and cascades to
-- the next nominator rather than pausing the entire draft. Spec
-- silence on this case + better UX = engine ships with the skip
-- behavior; commissioner can override (6c4) if they want a
-- different outcome.
--
-- Migration scope:
--   1. NEW: auction_nomination_skip_v2(p_league_id, p_team_id,
--      p_actor, p_reason, p_idempotency_key) — atomic event-write
--      for the skip case. No row state mutation beyond the event
--      (engine's in-memory `nominationsCompleted` advances on
--      bootstrap replay of the event).
--
-- No changes to nominate_player_v2 (existing RPC handles
-- actor.kind='autopick' already from 6a). No changes to other
-- auction RPCs. No new draft_events.event_type CHECK enum values
-- needed (`auction_auto_nominated` is admitted by the 6a CHECK
-- enum forward-compat; `auction_nomination_skipped` was NOT in
-- the 6a forward-compat list — needs to be added).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Add `auction_nomination_skipped` to event_type CHECK enum ────
--
-- The 6a foundation migration's CHECK enum (line 52-75 of
-- `20260506000000_auction_engine_foundation.sql`) admitted nine
-- auction event types as forward-compat. `auction_nomination_skipped`
-- is the first 6c-introduced event variant; the 6a enum did NOT
-- include it (because Path Y was an unspec'd extension at 6a time).
-- Add it now.

ALTER TABLE public.draft_events
  DROP CONSTRAINT IF EXISTS draft_events_event_type_chk;

ALTER TABLE public.draft_events
  ADD CONSTRAINT draft_events_event_type_chk CHECK (event_type IN (
    -- Snake/linear (chunk 11g.4 step 5+)
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
    -- Auction (chunks 11g.6 sub-steps 6a + 6b + 6c1)
    'auction_nomination_started',
    'auction_bid_placed',
    'auction_nomination_expired',
    'auction_nomination_closed',
    'auction_bid_extends_timer',
    'auction_auto_nominated',
    'auction_paused',
    'auction_resumed',
    'auction_commissioner_override',
    -- Auction (chunk 11g.6 sub-step 6c3 — Path Y extension)
    'auction_nomination_skipped'
  ));

-- ── 2. auction_nomination_skip_v2 ────────────────────────────────────
--
-- Atomicity contract:
--   BEGIN
--     UPDATE leagues (counter advance for seq)
--     INSERT draft_events (auction_nomination_skipped)
--   COMMIT
--
-- Two writes. No projection-table mutations — engine's in-memory
-- `nominationsCompleted` advances on bootstrap replay or on the
-- live-event broadcast. The skip event is the source of truth for
-- "this nominator forfeited their turn"; ledger-style.
--
-- Auth (per ADR-004 §5):
--   - Engine path (cascade after timer fire): `actor.kind='autopick'`
--     + service_role caller. Engine has independently verified the
--     skip condition (insufficient budget OR no eligible players).
--   - Commissioner path (manual force-skip): NOT exposed in 6c3 —
--     commissioner override RPCs land in 6c4. The function admits
--     `actor.kind='commissioner'` only as forward-compat.

CREATE OR REPLACE FUNCTION public.auction_nomination_skip_v2(
  p_league_id        uuid,
  p_team_id          uuid,
  p_actor            jsonb,
  p_reason           text,
  p_idempotency_key  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id      bigint;
  v_existing_seq     bigint;
  v_actor_kind       text;
  v_caller_role      text;
  v_payload          jsonb;
  v_new_seq          bigint;
  v_event_id         bigint;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_reason NOT IN ('insufficient_budget', 'no_eligible_players') THEN
    RAISE EXCEPTION 'invalid_event_payload: p_reason must be one of (insufficient_budget, no_eligible_players); got %',
      p_reason
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

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: auction_nomination_skip_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by auction_nomination_skip_v2 (engine fires autopick; commissioner override path lands in 6c4)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Step 3: Atomic write block.
  --   BEGIN (implicit)

  v_payload := jsonb_build_object(
    'skipped_team_id', p_team_id,
    'reason',          p_reason
  );

  --     UPDATE leagues (counter advance for seq)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  --     INSERT draft_events (auction_nomination_skipped)
  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_nomination_skipped', v_payload,
    'sha256:server-generated', p_idempotency_key, p_actor, NULL
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'skipped_team_id', p_team_id,
    'reason',        p_reason,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.auction_nomination_skip_v2(uuid, uuid, jsonb, text, uuid) IS
  'ADR-002 §4.2 + Path Y extension / chunk 11g.6 sub-step 6c3: auction nomination skip. Atomic 2-write block (leagues counter + draft_events). Reason discriminator: insufficient_budget triggers cascade-to-next-nominator; no_eligible_players paired with auction_paused per ADR-002 §4.4 spec. Trusted-executor: requires service_role caller AND actor.kind in (autopick, commissioner).';

GRANT EXECUTE ON FUNCTION public.auction_nomination_skip_v2(uuid, uuid, jsonb, text, uuid) TO service_role;
