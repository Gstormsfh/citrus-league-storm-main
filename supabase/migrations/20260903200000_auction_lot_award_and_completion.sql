-- ============================================================================
-- Auction: award the uncontested lot, guard the budget, and finish the draft
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- 8cfb4889c4a26716cf5bed542a9c702a against live prod):
--   supabase/migrations/captures/2026-09-03_pre_auction_lot_award_and_completion.sql
--
-- (a) WHAT CHANGED
--   1. close_nomination_v2() no longer treats a single-bid lot as "no sale".
--      Every lot with a high bidder closes 'sold' to that bidder at that
--      amount. An uncontested lot therefore awards the nominator at their
--      opening bid, which is what every other auction in the sport does.
--   2. The budget UPDATE is now guarded: a decrement that matches zero rows
--      raises instead of silently succeeding.
--   3. close_nomination_v2() emits 'draft_completed' when the last lot of
--      the auction resolves. Nothing did before.
--   4. auction_nominations_status_check gains 'cancelled'.
--
--   Signature, return shape, SECURITY DEFINER, search_path and grants are
--   unchanged.
--
-- (b) WHY NOW
--
--   DEFECT 1 - the uncontested lot took the player away from its winner.
--   The body computed `v_no_sale := v_total_bids = 1`, and
--   nominate_player_v2 writes the nominator's opening bid as a row in
--   auction_bids. So a lot nobody else bid on had exactly one bid and ended
--   'no_sale': no player awarded, no budget spent, the nominator's turn
--   burned. Its own comment called this "6a simplicity", not a rule.
--
--   The product disagrees with it in four places, all read this session:
--     * v1 (AuctionService.ts:157-197, the behaviour ADR-002 carries
--       forward) sets 'sold' unconditionally and awards the high bidder.
--       v1's nominatePlayer also wrote the opening bid as a bid row, so
--       under v1 an uncontested lot awarded the nominator every time.
--     * ADR-002:162 defines auction_nomination_expired as "on window expiry
--       WITHOUT bid" - a state that cannot occur, because the opening bid
--       always exists. The 6a shortcut reinterpreted "without bid" as
--       "with exactly one bid".
--     * The client tells the nominator "You lead this auction"
--       (AuctionPanel.tsx:249-253) and disables their own bid button
--       because iAmLeading is true (AuctionPanel.tsx:216-222) - then prints
--       "No sale. <player> went unsold" when the timer expires.
--     * No DESIGN doc or Decision Log entry proposes no-sale-on-no-follow-up.
--
--   DEFECT 2 - the budget decrement could silently do nothing.
--   `UPDATE auction_budgets ... WHERE league_id = ... AND team_id = ...`
--   with no row check. League f548834a has ZERO rows in auction_budgets
--   (its draft_started predates the 20260824214706 seeding trigger), so on
--   that league every lot would have closed with no budget accounting at
--   all. Measured on production 2026-09-03:
--     auction_budgets rows                3 (all remaining_budget 200,
--                                            players_won 0, never written)
--     auction_nominations rows            1 (still 'active', the lot wedged
--                                            by the close-<uuid> 22P02 on
--                                            2026-09-01T17:16:23Z)
--     lots ever closed by this function   0
--   The 'sold' branch has never executed in production. Treat the first
--   auction close as a first run, not a regression.
--
--   DEFECT 3 - an auction could never finish.
--   Searched every function in the database: only submit_pick_v2 and
--   offline_import_draft_v2 contain 'draft_completed'. No auction RPC does.
--   The engine decides completion in memory (LobbyManager.ts:5303-5306,
--   `nominationsCompleted >= nominationOrder.length * draftRounds`) and
--   persists nothing - snapshotPersistence.ts:319-348 takes a draftStatus
--   argument and drops it, and LobbyManager never writes public.leagues at
--   all. So the league stays draft_status='in_progress' forever, the
--   tg_draft_events_sync_roster trigger never fires, no roster is written,
--   and - the sharp edge - deploy-engine.yml:278 refuses to deploy while
--   ANY league is in_progress. One failed auction test locks out engine
--   deploys until somebody edits the row by hand.
--
--   The completion predicate below counts LOTS OFFERED from draft_order
--   (the structural truth, mirroring submit_pick_v2's D1 ruling) rather
--   than leagues.roster_size or draft_rounds, because those two disagree
--   in production: league a1a125c8 has roster_size=21 and draft_rounds=18.
--   Verified against prod: SUM(jsonb_array_length(team_order)) is 54 for
--   a1a125c8 (3 teams x 18 rounds) and 42 for f548834a (2 x 21), both
--   exactly matching the engine's own arithmetic.
--
--   It counts LOTS RESOLVED as every event that advances the engine's
--   nominationsCompleted pointer, including the two commissioner override
--   actions that advance it (LobbyManager.ts:4241, :4259). A roster-slot
--   predicate would be wrong: auction_nomination_skip_v2 awards no player,
--   so a skipped team finishes short and a "every team has roster_size
--   players" test would hang that league forever - the same failure mode
--   with a different cause.
--
--   DEFECT 4 - the commissioner could not cancel a lot.
--   auction_commissioner_override_v2's cancel_nomination branch writes
--   status='cancelled'; the live CHECK allows only active/sold/no_sale, so
--   every cancel raises 23514. The four-value constraint was written a
--   month ago in 20260722000000_staging_schema_alignment.sql:124-131 and
--   never applied - that migration is absent from schema_migrations while
--   its sibling section A.1 (the draft_events event_type enum) did land.
--   Partial application. draftV2Auction.ts:232 already documents the
--   four-value enum as if it shipped. This replays A.2 verbatim.
--   'no_sale' stays in the enum: force_close_nomination still writes it
--   for the genuine zero-bid case, and historical rows must stay valid.
--
--   Blast radius: 0 rows currently hold status='no_sale' (verified), so
--   no historical row changes meaning. draft_picks is the correct target
--   for auction awards and stays so - draft_picks_v2 is written only by
--   tg_draft_events_project_pick on event_type='pick', which casts
--   player_id to int, and auction player ids are text.
--
--   Reversibility: CREATE OR REPLACE from the capture file restores the
--   prior body byte for byte. The CHECK constraint change is additive and
--   reversible by re-adding the three-value form.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch.
--
-- APPLY ORDER: this migration, then redeploy the draft engine. The engine
-- carries the close-key fix (md5UuidFromSeed) without which no lot closes
-- at all; this migration decides what a close DOES. Neither alone is
-- enough to run an auction.
--
-- Idempotent: CREATE OR REPLACE plus a DROP/ADD CONSTRAINT pair. A second
-- apply is a no-op. Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. The status enum the override RPC has always assumed --------------
ALTER TABLE public.auction_nominations
  DROP CONSTRAINT IF EXISTS auction_nominations_status_check;
ALTER TABLE public.auction_nominations
  ADD CONSTRAINT auction_nominations_status_check
  CHECK (status IN ('active', 'sold', 'no_sale', 'cancelled'));

-- -- 2. close_nomination_v2: award, guard, and finish --------------------
CREATE OR REPLACE FUNCTION public.close_nomination_v2(p_league_id uuid, p_nomination_id uuid, p_idempotency_key uuid, p_payload_hash text, p_actor jsonb, p_correlation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_budget_rows        int;
  v_completed_rows     int;
  v_lots_offered       int;
  v_lots_resolved      int;
  v_completion_payload jsonb;
  v_completion_hash    text;
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

  -- Step 2: Auth - close_nomination is engine-only (timer fire).
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

  SELECT count(*) INTO v_total_bids
    FROM public.auction_bids
   WHERE nomination_id = p_nomination_id;

  -- 2026-09-03: "no sale" is now what ADR-002:162 always said it was -
  -- a lot with NO bid at all. nominate_player_v2 writes the nominator's
  -- opening bid, so in practice a nomination always has a high bidder and
  -- this branch does not fire; it is kept because force_close_nomination
  -- can produce a bidder-less nomination, and a NULL winner must never
  -- reach the budget UPDATE or the draft_picks insert below.
  v_no_sale := v_winner_team_id IS NULL;

  -- Step 4: Atomic write block.

  IF v_no_sale THEN
    UPDATE public.auction_nominations
       SET status = 'no_sale'
     WHERE id = p_nomination_id;

    v_event_type := 'auction_nomination_expired';
    v_payload := jsonb_build_object(
      'nomination_id', p_nomination_id,
      'reason',        'no_bids'
    );
  ELSE
    UPDATE public.auction_nominations
       SET status = 'sold'
     WHERE id = p_nomination_id;

    UPDATE public.auction_budgets
       SET remaining_budget = remaining_budget - v_final_bid,
           players_won      = players_won + 1,
           updated_at       = now()
     WHERE league_id = p_league_id AND team_id = v_winner_team_id;

    -- A lot that awards a player MUST move a budget. Before 2026-09-03
    -- this UPDATE could match zero rows and the close would still report
    -- success; league f548834a has no auction_budgets rows at all, so
    -- every lot there would have been free. Fail the close instead: the
    -- engine's one-shot retry and the RPC's idempotency replay make a
    -- raised close recoverable, a silently free player is not.
    GET DIAGNOSTICS v_budget_rows = ROW_COUNT;
    IF v_budget_rows <> 1 THEN
      RAISE EXCEPTION 'illegal_state: auction_budgets has % rows for league % team % (expected exactly 1); refusing to award % without charging for it',
        v_budget_rows, p_league_id, v_winner_team_id, v_player_id
        USING ERRCODE = 'no_data_found';
    END IF;

    INSERT INTO public.draft_picks (
      league_id, round_number, pick_number, team_id,
      player_id, picked_at
    )
    VALUES (
      p_league_id,
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

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

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

  -- -- Step 4.5: Completion detection -----------------------------------
  --
  -- Placement mirrors submit_pick_v2's D3 invariant exactly: this runs
  -- AFTER the terminal event INSERT and AFTER the leagues counter UPDATE
  -- that holds the row lock, so the row just written is inside the count
  -- and no concurrent close can interleave. Do not hoist it.
  --
  -- Lots offered comes from draft_order, not from leagues.roster_size or
  -- draft_rounds - those disagree in production (a1a125c8: 21 vs 18).
  -- Lots resolved counts every event that advances the engine's
  -- nominationsCompleted pointer, so the two agree by construction.
  SELECT COALESCE(SUM(jsonb_array_length(d.team_order)), 0)::int
    INTO v_lots_offered
    FROM public.draft_order d
   WHERE d.league_id = p_league_id
     AND d.deleted_at IS NULL;

  SELECT count(*)::int
    INTO v_lots_resolved
    FROM public.draft_events e
   WHERE e.league_id = p_league_id
     AND ( e.event_type IN ( 'auction_nomination_closed'
                           , 'auction_nomination_expired'
                           , 'auction_nomination_skipped' )
        OR ( e.event_type = 'auction_commissioner_override'
             AND e.payload ->> 'override_action'
                 IN ('force_close_nomination', 'award_to_team') ) );

  IF v_lots_offered > 0 AND v_lots_resolved >= v_lots_offered THEN
    IF v_lots_resolved > v_lots_offered THEN
      RAISE WARNING
        'close_nomination_v2 completion: % lots resolved > % offered for league % - absorbing, but the rotation and draft_order disagree',
        v_lots_resolved, v_lots_offered, p_league_id;
    END IF;

    -- SINGLE-FIRE. The status flip is the latch: only the close that moves
    -- the league out of a non-completed state may emit draft_completed.
    -- Without this a late or retried close after the final lot emits a
    -- SECOND draft_completed, and tg_draft_events_sync_roster runs the
    -- roster sync twice. submit_pick_v2 gets this for free from its
    -- pick_out_of_order preflight; close_nomination_v2 has no equivalent
    -- bound on lot count, so it needs the latch. Safe under concurrency:
    -- the leagues row lock taken by the counter UPDATE above is still held.
    -- Caught by scripts/proof/auction-lot-award-and-completion.proof.sh
    -- step 6 before this migration was ever applied.
    UPDATE public.leagues
       SET draft_status  = 'completed',
           pick_deadline = NULL
     WHERE id = p_league_id
       AND draft_status IS DISTINCT FROM 'completed';

    GET DIAGNOSTICS v_completed_rows = ROW_COUNT;
    IF v_completed_rows = 0 THEN
      RETURN jsonb_build_object(
        'event_id',      v_event_id,
        'seq',           v_new_seq,
        'event_type',    v_event_type,
        'no_sale',       v_no_sale,
        'was_duplicate', false
      );
    END IF;

    -- Payload shape is fixed by validate_draft_event_payload('draft_completed'):
    -- completed_at and total_picks are both required. total_picks carries
    -- the lot count, which for an auction is the number of players awarded
    -- plus the lots that expired or were skipped.
    v_completion_payload := jsonb_build_object(
      'completed_at', now(),
      'total_picks',  v_lots_offered
    );
    v_completion_hash := encode(
      sha256(convert_to(v_completion_payload::text, 'UTF8')),
      'hex'
    );

    PERFORM public.append_draft_event(
      p_league_id,
      'draft_completed',
      v_completion_payload,
      NULL,
      v_completion_hash,
      p_actor,
      v_correlation_id
    );
  END IF;

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'event_type',    v_event_type,
    'no_sale',       v_no_sale,
    'was_duplicate', false
  );
END;
$function$;

-- Grants unchanged from the live function.
REVOKE ALL ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) FROM public;
GRANT ALL ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) TO service_role;
GRANT ALL ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) TO authenticated;

-- -- 3. Post-conditions: refuse to commit on drift -----------------------
DO $$
DECLARE v_body text; v_check text;
BEGIN
  v_body := pg_get_functiondef('public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid)'::regprocedure);

  IF v_body LIKE '%v_no_sale := v_total_bids = 1;%' THEN
    RAISE EXCEPTION 'close_nomination_v2 still forfeits the uncontested lot';
  END IF;
  IF v_body NOT LIKE '%v_no_sale := v_winner_team_id IS NULL;%' THEN
    RAISE EXCEPTION 'close_nomination_v2 is missing the winner-is-null no-sale rule';
  END IF;
  IF v_body NOT LIKE '%GET DIAGNOSTICS v_budget_rows = ROW_COUNT;%' THEN
    RAISE EXCEPTION 'close_nomination_v2 is missing the budget row guard';
  END IF;
  IF v_body NOT LIKE '%draft_completed%' THEN
    RAISE EXCEPTION 'close_nomination_v2 is missing the completion emitter';
  END IF;
  IF v_body NOT LIKE '%AND draft_status IS DISTINCT FROM ''completed''%' THEN
    RAISE EXCEPTION 'close_nomination_v2 completion is not single-fire latched';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_check
    FROM pg_constraint
   WHERE conrelid = 'public.auction_nominations'::regclass
     AND conname  = 'auction_nominations_status_check';
  IF v_check IS NULL OR v_check NOT LIKE '%cancelled%' THEN
    RAISE EXCEPTION 'auction_nominations_status_check does not admit cancelled: %', COALESCE(v_check, '<missing>');
  END IF;

  RAISE NOTICE 'close_nomination_v2 replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;
