-- ════════════════════════════════════════════════════════════════════
-- Phase 4.5 chunk 11g.6 sub-step 6c4: auction commissioner override
-- (all seven action variants).
--
-- Per ADR-002 §4.1 + §4.4 + ADR-004 §5.
--
-- **ADR-002 extension framing**: §4.1 catalogs `auction_commissioner_override`
-- with three illustrative actions (forced nomination, forced close,
-- undo). 6c4 ships **seven** actions — the operational toolbox
-- commissioners need on day 1. Same Path Y treatment as 6c3:
-- explicit "Zach should push back if he disagrees with the broader
-- scope" framing in PHASE_4_5_PROJECT_PLAN.md Decision Log
-- (2026-05-07). The seven actions don't conflict with the spec;
-- they extend it.
--
-- **Polymorphic discriminator architecture** (single RPC, single
-- event variant). One `auction_commissioner_override_v2` RPC
-- accepts a `p_override_action TEXT` discriminator and dispatches
-- via IF/ELSIF to per-action atomic write blocks. Each action emits
-- the SAME `auction_commissioner_override` event with action-specific
-- `priorState` and `newState` JSONB snapshots. No side-effect events
-- (e.g., `force_close_nomination` does NOT additionally emit
-- `auction_nomination_closed` — engine state mutations match what a
-- natural close would produce, but the canonical durable event is
-- this single polymorphic row).
--
-- **Defense-in-depth**: engine-side `verifyCommissionerAuthorization`
-- callback fail-fasts in `LobbyManager.processCommissionerOverride`
-- before the RPC call; RPC enforces the same check (`auth.uid() =
-- leagues.commissioner_id` or `service_role`) for any code path
-- that bypasses the engine. Same pattern as 6c1's draft_state gate.
--
-- Migration scope:
--   1. EXTEND auction_nominations.status CHECK enum to admit
--      'cancelled' (for cancel_nomination action).
--   2. NEW: auction_commissioner_override_v2 — single RPC with seven
--      atomic action branches.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Extend auction_nominations.status CHECK enum ─────────────────
--
-- Pre-6c4: `('active', 'sold', 'no_sale')`. Adding `'cancelled'` to
-- preserve audit trail for commissioner-initiated cancellations
-- (distinct from natural no-sale where bid window expired without
-- bids).

ALTER TABLE public.auction_nominations
  DROP CONSTRAINT IF EXISTS auction_nominations_status_check;

ALTER TABLE public.auction_nominations
  ADD CONSTRAINT auction_nominations_status_check
  CHECK (status IN ('active', 'sold', 'no_sale', 'cancelled'));

-- ── 2. auction_commissioner_override_v2 ─────────────────────────────
--
-- Atomicity contract per action:
--
--   revert_bid:
--     BEGIN
--       SELECT auction_nominations FOR UPDATE  (lock active row)
--       SELECT prior + most-recent auction_bids ORDER BY id DESC LIMIT 2
--       UPDATE auction_nominations.current_high_bid + bidder
--         (revert to prior values)
--       UPDATE leagues counter
--       INSERT draft_events (auction_commissioner_override)
--     COMMIT
--
--   force_close_nomination:
--     BEGIN
--       SELECT auction_nominations FOR UPDATE
--       Determine outcome (sold vs no_sale based on bid count)
--       IF sold: UPDATE auction_nominations.status='sold' +
--         UPDATE auction_budgets (decrement winner) +
--         INSERT draft_picks
--       ELIF no_sale: UPDATE auction_nominations.status='no_sale'
--       UPDATE leagues counter
--       INSERT draft_events (auction_commissioner_override)
--     COMMIT
--
--   award_to_team:
--     BEGIN
--       SELECT auction_nominations FOR UPDATE
--       Validate target team's budget
--       UPDATE auction_nominations.status='sold'
--       UPDATE auction_budgets for awarded team
--       INSERT draft_picks
--       UPDATE leagues counter
--       INSERT draft_events (auction_commissioner_override)
--     COMMIT
--
--   adjust_opening_bid:
--     BEGIN
--       SELECT auction_nominations FOR UPDATE
--       Validate new floor vs current_high_bid
--       Validate leader's budget covers (new floor + reserve)
--       UPDATE auction_nominations.minimum_bid
--         (and current_high_bid if floor > current)
--       UPDATE leagues counter
--       INSERT draft_events (auction_commissioner_override)
--     COMMIT
--
--   adjust_budget:
--     BEGIN
--       SELECT auction_budgets FOR UPDATE (target team)
--       Validate post-mutation budget >= 0
--       UPDATE auction_budgets.remaining_budget += delta
--       UPDATE leagues counter
--       INSERT draft_events (auction_commissioner_override)
--     COMMIT
--
--   cancel_nomination:
--     BEGIN
--       SELECT auction_nominations FOR UPDATE
--       UPDATE auction_nominations.status='cancelled'
--       UPDATE leagues counter
--       INSERT draft_events (auction_commissioner_override)
--     COMMIT
--     (auction_bids rows for this nomination are NOT deleted —
--      append-only audit; the override event is the canonical
--      "logically cancelled" marker.)
--
--   extend_bid_window:
--     BEGIN
--       SELECT auction_nominations FOR UPDATE
--       Validate extensionSeconds > 0
--       UPDATE auction_nominations.expires_at += extensionSeconds
--       UPDATE leagues counter
--       INSERT draft_events (auction_commissioner_override)
--     COMMIT
--
-- All branches share idempotency-key check + commissioner-auth
-- check at function head. Common-prefix code is intentionally
-- duplicated rather than factored into a sub-function because
-- each branch's locking + state mutation is structurally distinct.

CREATE OR REPLACE FUNCTION public.auction_commissioner_override_v2(
  p_league_id        uuid,
  p_actor            jsonb,
  p_override_action  text,
  p_action_payload   jsonb,
  p_idempotency_key  uuid,
  p_rationale        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id        bigint;
  v_existing_seq       bigint;
  v_actor_kind         text;
  v_caller_role        text;
  v_commissioner       uuid;
  v_actor_user_id      uuid;
  v_payload            jsonb;
  v_prior_state        jsonb;
  v_new_state          jsonb;
  v_new_seq            bigint;
  v_event_id           bigint;
  -- Action-specific locals
  v_nomination_id      uuid;
  v_nom_status         text;
  v_current_high_bid   numeric;
  v_current_bidder     uuid;
  v_nom_expires_at     timestamptz;
  v_nom_player_id      text;
  v_nom_player_name    text;
  v_nom_minimum_bid    numeric;
  v_nom_number         int;
  v_bid_count          int;
  v_prior_bid_amount   numeric;
  v_prior_bidder       uuid;
  v_target_team_id     uuid;
  v_target_amount      numeric;
  v_target_budget      numeric;
  v_target_won         int;
  v_delta              numeric;
  v_new_budget         numeric;
  v_extension_seconds  int;
  v_new_expires_at     timestamptz;
  v_new_floor          numeric;
  v_total_bids         int;
  v_settings           jsonb;
  v_min_bid_setting    numeric;
  v_roster_size        int;
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

  -- Step 2: Auth (per ADR-004 §5 + ADR-002 §4.4).
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: auction_commissioner_override_v2 requires actor.kind=commissioner (got %)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: auction_commissioner_override_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, settings INTO v_commissioner, v_settings
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_actor_user_id := NULLIF(p_actor ->> 'id', '')::uuid;
  -- Skip auth.uid() comparison for service_role (engine path); engine
  -- has independently verified `auth.uid() = leagues.commissioner_id`
  -- via verifyCommissionerAuthorization before calling.

  v_min_bid_setting := COALESCE((v_settings ->> 'auctionMinBid')::numeric, 1);
  v_roster_size := COALESCE(
    (v_settings ->> 'rosterSize')::int,
    (v_settings ->> 'draftRounds')::int,
    0
  );

  -- Step 3: Action dispatcher. Each branch is structurally distinct
  -- and atomic. Common-prefix code (idempotency + auth) ran above;
  -- common-suffix code (counter advance + draft_events INSERT)
  -- runs below the dispatcher. The dispatcher itself only writes
  -- to action-specific projection tables.

  IF p_override_action = 'revert_bid' THEN
    -- ── revert_bid ────────────────────────────────────────────────
    -- Reverts the most-recent bid; requires bid_count > 1 (the only
    -- bid, the nominator's opening, is reverted via cancel_nomination
    -- which has different semantics).

    SELECT id, status, current_high_bid, current_high_bidder_team_id, expires_at
      INTO v_nomination_id, v_nom_status, v_current_high_bid, v_current_bidder, v_nom_expires_at
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to revert in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_bid_count
      FROM public.auction_bids
     WHERE nomination_id = v_nomination_id;

    IF v_bid_count <= 1 THEN
      RAISE EXCEPTION 'no_bids_to_revert: nomination % has only the opening bid; use cancel_nomination instead',
        v_nomination_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Read the second-most-recent bid (the one we revert TO).
    SELECT team_id, bid_amount
      INTO v_prior_bidder, v_prior_bid_amount
      FROM public.auction_bids
     WHERE nomination_id = v_nomination_id
     ORDER BY id DESC
     OFFSET 1
     LIMIT 1;

    -- priorState captures what we're reverting AWAY from; newState
    -- captures the post-revert leader.
    v_prior_state := jsonb_build_object(
      'nominationId',         v_nomination_id,
      'leadingBidderId',      v_current_bidder,
      'leadingBid',           v_current_high_bid
    );
    v_new_state := jsonb_build_object(
      'nominationId',         v_nomination_id,
      'leadingBidderId',      v_prior_bidder,
      'leadingBid',           v_prior_bid_amount
    );

    UPDATE public.auction_nominations
       SET current_high_bid = v_prior_bid_amount,
           current_high_bidder_team_id = v_prior_bidder
     WHERE id = v_nomination_id;

  ELSIF p_override_action = 'force_close_nomination' THEN
    -- ── force_close_nomination ────────────────────────────────────
    -- Ends bid window early. Awards to current leader if
    -- bid_count > 1; treats as no-sale if only opening bid (mirrors
    -- 6a's natural-close no_sale branch).

    SELECT id, status, current_high_bid, current_high_bidder_team_id,
           expires_at, player_id, player_name, nomination_number
      INTO v_nomination_id, v_nom_status, v_current_high_bid, v_current_bidder,
           v_nom_expires_at, v_nom_player_id, v_nom_player_name, v_nom_number
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to force-close in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_bid_count
      FROM public.auction_bids
     WHERE nomination_id = v_nomination_id;

    v_prior_state := jsonb_build_object(
      'nominationId',         v_nomination_id,
      'currentClockDeadline', v_nom_expires_at,
      'leadingBidderId',      v_current_bidder,
      'leadingBid',           v_current_high_bid,
      'totalBids',            v_bid_count
    );

    IF v_bid_count <= 1 THEN
      -- No-sale outcome (only the nominator's opening bid).
      UPDATE public.auction_nominations
         SET status = 'no_sale'
       WHERE id = v_nomination_id;

      v_new_state := jsonb_build_object(
        'nominationId', v_nomination_id,
        'outcome',      'no_sale'
      );
    ELSE
      -- Sold outcome — mirrors 6a's natural-close sold branch.
      UPDATE public.auction_nominations
         SET status = 'sold'
       WHERE id = v_nomination_id;

      UPDATE public.auction_budgets
         SET remaining_budget = remaining_budget - v_current_high_bid,
             players_won      = players_won + 1,
             updated_at       = now()
       WHERE league_id = p_league_id AND team_id = v_current_bidder;

      INSERT INTO public.draft_picks (
        league_id, round_number, pick_number, team_id, player_id, picked_at
      )
      VALUES (
        p_league_id, 1, v_nom_number, v_current_bidder, v_nom_player_id, now()
      );

      v_new_state := jsonb_build_object(
        'nominationId',  v_nomination_id,
        'outcome',       'sold',
        'winnerTeamId',  v_current_bidder,
        'finalAmount',   v_current_high_bid,
        'totalBids',     v_bid_count
      );
    END IF;

  ELSIF p_override_action = 'award_to_team' THEN
    -- ── award_to_team ─────────────────────────────────────────────
    -- Force-awards the active nomination to a specified team at a
    -- specified amount, regardless of leading bidder. Validates
    -- target team has sufficient budget.

    v_target_team_id := (p_action_payload ->> 'teamId')::uuid;
    v_target_amount := (p_action_payload ->> 'amount')::numeric;

    IF v_target_team_id IS NULL OR v_target_amount IS NULL OR v_target_amount <= 0 THEN
      RAISE EXCEPTION 'invalid_event_payload: award_to_team requires teamId and positive amount'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, status, current_high_bid, current_high_bidder_team_id,
           player_id, player_name, nomination_number
      INTO v_nomination_id, v_nom_status, v_current_high_bid, v_current_bidder,
           v_nom_player_id, v_nom_player_name, v_nom_number
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to award in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT remaining_budget, players_won
      INTO v_target_budget, v_target_won
      FROM public.auction_budgets
     WHERE league_id = p_league_id AND team_id = v_target_team_id
     FOR UPDATE;

    IF v_target_budget IS NULL THEN
      RAISE EXCEPTION 'illegal_state: team % has no auction_budgets row in league %',
        v_target_team_id, p_league_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- Reserve check: target needs (slotsRemaining - 1) * minBid
    -- after this award. Same formula as v1 AuctionService and 6a's
    -- engine-side reserve calculation.
    IF v_target_amount + GREATEST(0, (v_roster_size - v_target_won - 1)) * v_min_bid_setting > v_target_budget THEN
      RAISE EXCEPTION 'insufficient_budget_for_award: team % budget % cannot cover award amount % + reserve',
        v_target_team_id, v_target_budget, v_target_amount
        USING ERRCODE = 'check_violation';
    END IF;

    v_prior_state := jsonb_build_object(
      'nominationId',     v_nomination_id,
      'leadingBidderId',  v_current_bidder,
      'leadingBid',       v_current_high_bid
    );

    UPDATE public.auction_nominations
       SET status = 'sold',
           current_high_bid = v_target_amount,
           current_high_bidder_team_id = v_target_team_id
     WHERE id = v_nomination_id;

    UPDATE public.auction_budgets
       SET remaining_budget = remaining_budget - v_target_amount,
           players_won      = players_won + 1,
           updated_at       = now()
     WHERE league_id = p_league_id AND team_id = v_target_team_id;

    INSERT INTO public.draft_picks (
      league_id, round_number, pick_number, team_id, player_id, picked_at
    )
    VALUES (
      p_league_id, 1, v_nom_number, v_target_team_id, v_nom_player_id, now()
    );

    v_new_state := jsonb_build_object(
      'nominationId',     v_nomination_id,
      'awardedTeamId',    v_target_team_id,
      'awardedAmount',    v_target_amount
    );

  ELSIF p_override_action = 'adjust_opening_bid' THEN
    -- ── adjust_opening_bid ────────────────────────────────────────
    -- Mid-nomination floor adjustment. New floor MUST be >= current
    -- leading bid (cannot retroactively undermine a committed bid).
    -- If new floor > current_high_bid, current_high_bid bumps up to
    -- match (commissioner forces leader's commitment up; brief #6
    -- safeguard validates leader's budget covers the increase).

    v_new_floor := (p_action_payload ->> 'newOpeningBid')::numeric;

    IF v_new_floor IS NULL OR v_new_floor <= 0 THEN
      RAISE EXCEPTION 'invalid_event_payload: adjust_opening_bid requires positive newOpeningBid'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, current_high_bid, current_high_bidder_team_id, minimum_bid
      INTO v_nomination_id, v_current_high_bid, v_current_bidder, v_nom_minimum_bid
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to adjust opening bid for in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Reject floor BELOW current leading bid as nonsensical.
    IF v_new_floor < v_current_high_bid THEN
      RAISE EXCEPTION 'opening_bid_below_current_leading: new floor % is below current leading bid %',
        v_new_floor, v_current_high_bid
        USING ERRCODE = 'check_violation';
    END IF;

    -- If floor > current_high_bid, validate leader's budget covers
    -- the higher commitment (Zach's safeguard from approval message).
    IF v_new_floor > v_current_high_bid THEN
      SELECT remaining_budget, players_won
        INTO v_target_budget, v_target_won
        FROM public.auction_budgets
       WHERE league_id = p_league_id AND team_id = v_current_bidder
       FOR UPDATE;

      IF v_target_budget IS NULL THEN
        RAISE EXCEPTION 'illegal_state: leader team % has no auction_budgets row',
          v_current_bidder
          USING ERRCODE = 'no_data_found';
      END IF;

      -- The leader currently has v_current_high_bid committed but not
      -- deducted; raising the floor to v_new_floor means they'd commit
      -- v_new_floor instead. Available budget after raise must cover
      -- (v_new_floor + reserve for remaining slots).
      IF v_new_floor + GREATEST(0, (v_roster_size - v_target_won - 1)) * v_min_bid_setting > v_target_budget THEN
        RAISE EXCEPTION 'insufficient_budget_for_floor_increase: leader team % budget % cannot cover new floor % + reserve',
          v_current_bidder, v_target_budget, v_new_floor
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    v_prior_state := jsonb_build_object(
      'nominationId',  v_nomination_id,
      'openingBid',    v_nom_minimum_bid,
      'leadingBid',    v_current_high_bid
    );

    UPDATE public.auction_nominations
       SET minimum_bid      = v_new_floor,
           current_high_bid = GREATEST(v_new_floor, current_high_bid)
     WHERE id = v_nomination_id;

    v_new_state := jsonb_build_object(
      'nominationId',  v_nomination_id,
      'openingBid',    v_new_floor,
      'leadingBid',    GREATEST(v_new_floor, v_current_high_bid)
    );

  ELSIF p_override_action = 'adjust_budget' THEN
    -- ── adjust_budget ─────────────────────────────────────────────
    -- Standalone team-budget delta (does NOT require active
    -- nomination). Debit beyond current budget rejects.

    v_target_team_id := (p_action_payload ->> 'teamId')::uuid;
    v_delta := (p_action_payload ->> 'delta')::numeric;

    IF v_target_team_id IS NULL OR v_delta IS NULL THEN
      RAISE EXCEPTION 'invalid_event_payload: adjust_budget requires teamId and delta'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT remaining_budget INTO v_target_budget
      FROM public.auction_budgets
     WHERE league_id = p_league_id AND team_id = v_target_team_id
     FOR UPDATE;

    IF v_target_budget IS NULL THEN
      RAISE EXCEPTION 'illegal_state: team % has no auction_budgets row in league %',
        v_target_team_id, p_league_id
        USING ERRCODE = 'no_data_found';
    END IF;

    v_new_budget := v_target_budget + v_delta;

    IF v_new_budget < 0 THEN
      RAISE EXCEPTION 'insufficient_budget: team % current budget % cannot absorb delta %',
        v_target_team_id, v_target_budget, v_delta
        USING ERRCODE = 'check_violation';
    END IF;

    v_prior_state := jsonb_build_object(
      'teamId',           v_target_team_id,
      'budgetRemaining',  v_target_budget
    );

    UPDATE public.auction_budgets
       SET remaining_budget = v_new_budget,
           updated_at       = now()
     WHERE league_id = p_league_id AND team_id = v_target_team_id;

    v_new_state := jsonb_build_object(
      'teamId',           v_target_team_id,
      'budgetRemaining',  v_new_budget,
      'delta',            v_delta
    );

  ELSIF p_override_action = 'cancel_nomination' THEN
    -- ── cancel_nomination ─────────────────────────────────────────
    -- Wipes active nomination; player returns to available pool;
    -- bids invalidated (auction_bids rows preserved per append-only
    -- audit principle); nominationsCompleted does NOT advance (redo
    -- semantics, NOT skip semantics — distinct from
    -- auction_nomination_skipped from 6c3).

    SELECT id, current_high_bid, current_high_bidder_team_id,
           player_id, expires_at
      INTO v_nomination_id, v_current_high_bid, v_current_bidder,
           v_nom_player_id, v_nom_expires_at
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to cancel in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_total_bids
      FROM public.auction_bids
     WHERE nomination_id = v_nomination_id;

    v_prior_state := jsonb_build_object(
      'nominationId',     v_nomination_id,
      'playerId',         v_nom_player_id,
      'totalBids',        v_total_bids,
      'leadingBidderId',  v_current_bidder,
      'leadingBid',       v_current_high_bid
    );
    v_new_state := jsonb_build_object();

    UPDATE public.auction_nominations
       SET status = 'cancelled'
     WHERE id = v_nomination_id;

  ELSIF p_override_action = 'extend_bid_window' THEN
    -- ── extend_bid_window ─────────────────────────────────────────
    -- Commissioner-initiated bid-window extension. Anti-snipe
    -- (chunk 11g.6 sub-step 6b) is engine-driven; this is the
    -- commissioner-driven equivalent. Validates extensionSeconds > 0.

    v_extension_seconds := (p_action_payload ->> 'extensionSeconds')::int;

    IF v_extension_seconds IS NULL OR v_extension_seconds <= 0 THEN
      RAISE EXCEPTION 'extension_below_current_deadline: extensionSeconds must be positive (got %)',
        COALESCE(v_extension_seconds::text, '<missing>')
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, expires_at
      INTO v_nomination_id, v_nom_expires_at
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to extend in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    v_new_expires_at := v_nom_expires_at + (v_extension_seconds * interval '1 second');

    v_prior_state := jsonb_build_object(
      'nominationId',         v_nomination_id,
      'priorClockDeadline',   v_nom_expires_at
    );

    UPDATE public.auction_nominations
       SET expires_at = v_new_expires_at
     WHERE id = v_nomination_id;

    v_new_state := jsonb_build_object(
      'nominationId',     v_nomination_id,
      'newClockDeadline', v_new_expires_at,
      'extensionSeconds', v_extension_seconds
    );

  ELSE
    RAISE EXCEPTION 'invalid_event_payload: unknown override_action %', p_override_action
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 4: Common-suffix code. UPDATE leagues counter + INSERT
  -- draft_events with the polymorphic auction_commissioner_override
  -- payload. Same atomic transaction as the per-action branch.

  v_payload := jsonb_build_object(
    'commissioner_user_id', v_actor_user_id,
    'override_action',      p_override_action,
    'prior_state',          v_prior_state,
    'new_state',            v_new_state,
    'rationale',            p_rationale
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
    p_league_id, v_new_seq, 'auction_commissioner_override', v_payload,
    'sha256:server-generated', p_idempotency_key, p_actor, NULL
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',         v_event_id,
    'seq',              v_new_seq,
    'override_action',  p_override_action,
    'prior_state',      v_prior_state,
    'new_state',        v_new_state,
    'was_duplicate',    false
  );
END;
$$;

COMMENT ON FUNCTION public.auction_commissioner_override_v2(uuid, jsonb, text, jsonb, uuid, text) IS
  'ADR-002 §4.4 / chunk 11g.6 sub-step 6c4: auction commissioner override (seven action variants). Polymorphic single-event-variant architecture — one RPC, one event variant (auction_commissioner_override with overrideAction discriminator). Each branch atomically wraps action-specific multi-table writes. Trusted-executor: requires service_role caller AND actor.kind=commissioner.';

GRANT EXECUTE ON FUNCTION public.auction_commissioner_override_v2(uuid, jsonb, text, jsonb, uuid, text) TO service_role;
