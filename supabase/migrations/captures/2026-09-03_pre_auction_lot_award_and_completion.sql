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
$function$
