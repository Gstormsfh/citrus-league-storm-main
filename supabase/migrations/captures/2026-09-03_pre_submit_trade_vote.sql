CREATE OR REPLACE FUNCTION public.submit_trade_vote(p_trade_offer_id uuid, p_voter_team_id uuid, p_vote text)
 RETURNS TABLE(success boolean, message text, veto_count integer, approve_count integer, votes_needed integer, is_vetoed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade RECORD;
  v_league RECORD;
  v_total_teams INT;
  v_eligible_voters INT;
  v_veto_count INT;
  v_approve_count INT;
  v_threshold INT;
  v_is_vetoed BOOLEAN := false;
BEGIN
  -- Get trade details
  SELECT * INTO v_trade FROM trade_offers WHERE id = p_trade_offer_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Trade not found'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Trade must be under_review to accept votes
  IF v_trade.status != 'under_review' THEN
    RETURN QUERY SELECT false, format('Trade is not under review (status: %s)', v_trade.status)::TEXT,
      0, 0, 0, false;
    RETURN;
  END IF;

  -- Can't vote on your own trade
  IF p_voter_team_id = v_trade.from_team_id OR p_voter_team_id = v_trade.to_team_id THEN
    RETURN QUERY SELECT false, 'Cannot vote on a trade you are involved in'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Check review period hasn't expired
  IF v_trade.review_ends_at IS NOT NULL AND NOW() > v_trade.review_ends_at THEN
    RETURN QUERY SELECT false, 'Review period has ended'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Get league settings
  SELECT * INTO v_league FROM leagues WHERE id = v_trade.league_id;

  -- Insert or update vote
  INSERT INTO trade_votes (trade_offer_id, league_id, voter_team_id, vote)
  VALUES (p_trade_offer_id, v_trade.league_id, p_voter_team_id, p_vote)
  ON CONFLICT (trade_offer_id, voter_team_id)
  DO UPDATE SET vote = p_vote, created_at = NOW();

  -- Count votes
  SELECT COUNT(*) INTO v_total_teams FROM teams WHERE league_id = v_trade.league_id;
  v_eligible_voters := v_total_teams - 2;  -- Exclude the two trading teams

  SELECT
    COUNT(*) FILTER (WHERE vote = 'veto'),
    COUNT(*) FILTER (WHERE vote = 'approve')
  INTO v_veto_count, v_approve_count
  FROM trade_votes WHERE trade_offer_id = p_trade_offer_id;

  v_threshold := CEIL(v_eligible_voters * COALESCE(v_league.trade_veto_threshold, 0.5));

  -- Check if trade is vetoed
  IF v_veto_count >= v_threshold THEN
    v_is_vetoed := true;
    UPDATE trade_offers
    SET status = 'vetoed', vetoed_at = NOW(), processed_at = NOW()
    WHERE id = p_trade_offer_id;
  END IF;

  RETURN QUERY SELECT true, 'Vote recorded'::TEXT,
    v_veto_count, v_approve_count, v_threshold, v_is_vetoed;
END;
$function$
