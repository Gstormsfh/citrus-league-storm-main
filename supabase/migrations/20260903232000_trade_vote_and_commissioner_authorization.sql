-- ============================================================================
-- You vote as your own team, and a commissioner can approve a trade
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 captures (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-03):
--   supabase/migrations/captures/2026-09-03_pre_submit_trade_vote.sql
--     f8959251e88ff55d3941267016a8d3cb
--   supabase/migrations/captures/2026-09-03_pre_execute_trade.sql
--     c4c470298e84c20c2c0d69e691849188
--
-- (a) WHAT CHANGED
--   1. submit_trade_vote() refuses a p_voter_team_id that is not in the
--      trade's league, and - when auth.uid() is present - refuses one the
--      caller does not own. Both checks run before any other check, so a
--      spoofed vote cannot even learn the trade's status.
--   2. execute_trade()'s caller gate now also admits the commissioner of
--      p_league_id. The existing owner check is unchanged.
--   Signatures, return types, SECURITY DEFINER, search_path and grants of both
--   functions are unchanged, as is all vote counting, veto thresholding,
--   roster movement, ledger writing and error handling.
--
-- (b) WHY NOW
--
--   DEFECT T3 - any league member can cast votes as every other team.
--
--   server/src/routes/trades.ts POST /api/trades/:tradeId/vote checked only
--   league membership and then passed body.voterTeamId straight through to
--   TradeService.submitTradeVote, which handed it to this RPC as
--   p_voter_team_id. The RPC never checked that the caller owns that team.
--
--   Because the function is SECURITY DEFINER, the policy that would have
--   stopped it never ran. Production, 2026-09-03:
--     policy trade_votes_insert, cmd INSERT, WITH CHECK
--       (voter_team_id IN (SELECT teams.id FROM teams
--                          WHERE teams.owner_id = (SELECT auth.uid())))
--   That is exactly the right rule. SECURITY DEFINER executes the INSERT as
--   the function owner, so it is bypassed by construction.
--
--   And the write is
--     ON CONFLICT (trade_offer_id, voter_team_id) DO UPDATE SET vote = p_vote
--   backed by UNIQUE (trade_offer_id, voter_team_id), so a member could not
--   only fabricate other managers' votes, they could overwrite votes those
--   managers had already cast. With trade_veto_threshold defaulting to 0.5,
--   one member can veto any trade in the league by themselves.
--
--   Exposure today is zero and that is the only reason this is not an
--   incident. Measured on production 2026-09-03:
--     leagues by trade_review_type          none = 55, commissioner = 0,
--                                           league_vote = 0
--     trade_votes rows                      1
--     trade_offers by status                cancelled 15, accepted 5,
--                                           rejected 1, vetoed 1, expired 1
--   submit_trade_vote is only reachable for a trade in 'under_review', and a
--   trade only reaches 'under_review' when its league sets
--   trade_review_type = 'league_vote'. No league does. The exposure begins the
--   moment one commissioner picks that setting in the UI, with no code change
--   and no deploy.
--
--   WHERE THE CHECK BELONGS: BOTH, AND WHY
--   The RPC is the load-bearing one. It is SECURITY DEFINER, so RLS gives the
--   database no other defence, and EXECUTE is granted to 'authenticated' -
--   any logged-in user can call it straight from the browser with
--   supabase.rpc('submit_trade_vote', {...}) and never touch the Hono route.
--   A check that only lives in the route protects only the callers that choose
--   to use the route.
--   The route check is added anyway (this migration's paired change in
--   server/src/routes/trades.ts) because it turns a silent refusal into a 403
--   with a clear message, resolves the caller's team with the codebase's
--   canonical fresh resolver rather than trusting the body, and matches the
--   house principle in LeagueMembershipService: "RLS is a backup layer -
--   explicit checks are primary".
--
--   The league check is separate from the ownership check on purpose. Ownership
--   is skipped when auth.uid() is NULL (the service role, unreachable from a
--   client - the same convention execute_trade and generate_playoff_bracket
--   already use), but "the voting team must be in this trade's league" is an
--   invariant that should hold for every caller, including a future admin tool.
--
--   DEFECT T2 - a commissioner cannot approve a trade they are reviewing.
--
--   execute_trade opened with:
--     v_caller_uid := auth.uid();
--     IF v_caller_uid IS NOT NULL THEN
--       IF NOT EXISTS (SELECT 1 FROM teams WHERE id IN (from, to)
--                        AND league_id = ... AND owner_id = v_caller_uid) THEN
--         RETURN ... 'Unauthorized: you are not an owner of either team'
--   TradeService.commissionerDecision('approve') calls it with the
--   commissioner's own JWT. A commissioner usually owns neither trading team,
--   so approve returned 400 while the service-role cron path (auth.uid() NULL)
--   worked. Production shape that makes this the normal case:
--     teams rows                            166
--     teams with owner_id NULL              55
--   A commissioner who owns no team in their own league cannot pass an owner
--   check, ever.
--
--   THE FIX, AND WHY IT IS NOT A HOLE. The gate stays; the commissioner of
--   p_league_id is added to the set it admits. Everything else in the function
--   already pins both teams to p_league_id, so a commissioner of league L can
--   only move players between two teams that are both in L. That is the power
--   the role already holds by design: they choose trade_review_type, they can
--   veto, and public.is_commissioner_of_league already backs the trade_votes
--   DELETE policy. No manager gains anything.
--
--   REJECTED ALTERNATIVE: run commissionerDecision through the service-role
--   client so auth.uid() is NULL and the gate is skipped. That does not fix the
--   control, it deletes it - the database would stop verifying the commissioner
--   for that path and LeagueMembershipService.requireCommissioner in Node would
--   be the only thing between a bug and an arbitrary roster move. The point of
--   the auth.uid() gate is that it holds regardless of which caller arrives, so
--   the right change is to teach it who else is legitimately allowed through.
--
--   NOT FIXED HERE, ANOTHER WORKSTREAM OWNS IT: the trade_offers UPDATE
--   policies permit only ('pending','cancelled') for the proposer and
--   ('pending','accepted','rejected','countered') for the recipient. The review
--   workflow writes 'under_review' and 'vetoed', which no policy allows, so
--   submitTradeForReview and the veto branch silently no-op under a user JWT
--   today. That is why T3's blast radius is theoretical rather than live, and
--   it is deliberately untouched here.
--
--   Reversibility: CREATE OR REPLACE from the two capture files restores both
--   prior bodies byte for byte. No schema change, no data change.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Trades subsystem, defects T3 and T2.
--
-- APPLY ORDER: independent of the playoff migrations. Pairs with the server
-- changes in server/src/routes/trades.ts and
-- server/src/services/TradeService.ts, which are safe to deploy in either
-- order: the route change only narrows what it sends, and the RPC change only
-- widens who execute_trade admits.
--
-- Idempotent: two CREATE OR REPLACE. A second apply is a no-op.
-- Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. submit_trade_vote: you vote as your own team, or not at all -------
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
  v_caller_uid UUID;
BEGIN
  -- Get trade details
  SELECT * INTO v_trade FROM trade_offers WHERE id = p_trade_offer_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Trade not found'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- 2026-09-03: AUTHORIZE THE VOTER BEFORE ANYTHING ELSE.
  -- This function is SECURITY DEFINER, so the trade_votes_insert RLS policy
  --   WITH CHECK (voter_team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()))
  -- never runs against the INSERT below. p_voter_team_id arrived straight from
  -- the request body, and the INSERT is ON CONFLICT (trade_offer_id,
  -- voter_team_id) DO UPDATE, so any league member could cast - and overwrite -
  -- a vote as every other team and veto any trade single-handed.
  --
  -- The check lives here rather than only in the route because SECURITY DEFINER
  -- means the database has no other defence: RLS is bypassed by construction,
  -- and any caller with EXECUTE (that is every 'authenticated' JWT) can call
  -- the RPC directly from the browser without going near the Hono handler.
  -- server/src/routes/trades.ts checks it too, so a spoof gets a 403 with a
  -- clear message instead of a silent no-op, but the route is the second layer.
  IF NOT EXISTS (
    SELECT 1 FROM teams t
     WHERE t.id = p_voter_team_id
       AND t.league_id = v_trade.league_id
  ) THEN
    RETURN QUERY SELECT false, 'Voting team is not in this league'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- auth.uid() IS NULL means the service role, which is not reachable from a
  -- client: every anon/authenticated JWT sets it. Same convention as
  -- execute_trade and generate_playoff_bracket.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM teams t
     WHERE t.id = p_voter_team_id
       AND t.owner_id = v_caller_uid
  ) THEN
    RETURN QUERY SELECT false, 'You can only vote as a team you own'::TEXT, 0, 0, 0, false;
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
$function$;

REVOKE ALL ON FUNCTION public.submit_trade_vote(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_trade_vote(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_trade_vote(uuid, uuid, text) TO service_role;

-- -- 2. execute_trade: the commissioner of THIS league is allowed through -
CREATE OR REPLACE FUNCTION public.execute_trade(p_trade_id uuid, p_league_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_offered_player_ids text[], p_requested_player_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pid TEXT; v_now TIMESTAMPTZ := NOW();
  v_offered_moved INT := 0; v_requested_moved INT := 0;
  v_caller_uid UUID; v_from_team_size INT; v_to_team_size INT; v_max_roster_size INT;
  v_from_user UUID; v_to_user UUID; v_commissioner UUID;
  v_n_offered INT := COALESCE(array_length(p_offered_player_ids, 1), 0);
  v_n_requested INT := COALESCE(array_length(p_requested_player_ids, 1), 0);
BEGIN
  -- 2026-09-03: the owner gate below is a real control on the ordinary accept
  -- path and is unchanged. What is added is the league's COMMISSIONER, and
  -- only for the league named in p_league_id.
  --
  -- Why it was needed: TradeService.commissionerDecision('approve') calls this
  -- RPC with the commissioner's own JWT. A commissioner usually owns neither
  -- trading team, so the gate returned 'Unauthorized: you are not an owner of
  -- either team' and approve failed with a 400 - while the service-role cron
  -- path, where auth.uid() is NULL, sailed through. The one review workflow
  -- that needs a human decision was the one that could not make it.
  --
  -- Why this is not a hole:
  --   * It is scoped to p_league_id. Every other check in this function already
  --     requires both teams to be in p_league_id, so a commissioner of league L
  --     can only ever move players between two teams that are both in L. That
  --     is the power the role already has - they set the trade review policy,
  --     they can veto, and public.is_commissioner_of_league already backs the
  --     trade_votes DELETE policy.
  --   * It does not widen the ordinary accept path by one row: a manager who
  --     owns neither team is still refused.
  --   * The alternative - having commissionerDecision call this with the
  --     service-role key so auth.uid() is NULL - was rejected. That removes the
  --     database-side check for the commissioner path entirely and leaves
  --     LeagueMembershipService.requireCommissioner in Node as the only thing
  --     standing between a bug and an arbitrary roster move. Teaching the RPC
  --     about commissioners keeps the verification in the database, where it
  --     holds no matter which caller arrives.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM teams WHERE id IN (p_from_team_id, p_to_team_id)
                     AND league_id = p_league_id AND owner_id = v_caller_uid)
       AND NOT EXISTS (SELECT 1 FROM leagues l
                        WHERE l.id = p_league_id AND l.commissioner_id = v_caller_uid) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: you are not an owner of either team or the commissioner of this league');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_from_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'From-team does not exist in this league';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_to_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'To-team does not exist in this league';
  END IF;
  IF p_from_team_id = p_to_team_id THEN
    RAISE EXCEPTION 'A team cannot trade with itself';
  END IF;
  IF v_n_offered = 0 AND v_n_requested = 0 THEN
    RAISE EXCEPTION 'Trade moves no players';
  END IF;

  SELECT l.commissioner_id, COALESCE(NULLIF(l.roster_size, 0), 22)
    INTO v_commissioner, v_max_roster_size
  FROM leagues l WHERE l.id = p_league_id;

  SELECT COALESCE(owner_id, v_commissioner) INTO v_from_user FROM teams WHERE id = p_from_team_id;
  SELECT COALESCE(owner_id, v_commissioner) INTO v_to_user   FROM teams WHERE id = p_to_team_id;

  SELECT COUNT(*) INTO v_from_team_size FROM roster_assignments
   WHERE team_id = p_from_team_id AND league_id = p_league_id;
  SELECT COUNT(*) INTO v_to_team_size FROM roster_assignments
   WHERE team_id = p_to_team_id AND league_id = p_league_id;

  IF (v_from_team_size - v_n_offered + v_n_requested) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for proposing team (% players)', v_max_roster_size;
  END IF;
  IF (v_to_team_size - v_n_requested + v_n_offered) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for accepting team (% players)', v_max_roster_size;
  END IF;

  FOREACH v_pid IN ARRAY COALESCE(p_offered_player_ids, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM roster_assignments
                    WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid) THEN
      RAISE EXCEPTION 'Offered player % is not on from-team roster', v_pid;
    END IF;
    UPDATE roster_assignments SET team_id = p_to_team_id, updated_at = v_now
     WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid;
    PERFORM public.trade_move_player_lineup(p_league_id, p_from_team_id, p_to_team_id, v_pid, v_now);
    v_offered_moved := v_offered_moved + 1;
  END LOOP;

  FOREACH v_pid IN ARRAY COALESCE(p_requested_player_ids, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM roster_assignments
                    WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid) THEN
      RAISE EXCEPTION 'Requested player % is not on to-team roster', v_pid;
    END IF;
    UPDATE roster_assignments SET team_id = p_from_team_id, updated_at = v_now
     WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid;
    PERFORM public.trade_move_player_lineup(p_league_id, p_to_team_id, p_from_team_id, v_pid, v_now);
    v_requested_moved := v_requested_moved + 1;
  END LOOP;

  INSERT INTO transaction_ledger (league_id, user_id, team_id, player_id, type, source, created_at)
  SELECT p_league_id, v_from_user, p_from_team_id, x, 'TRADE', 'Trade out', v_now
    FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_to_user, p_to_team_id, x, 'TRADE', 'Trade in', v_now
    FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_to_user, p_to_team_id, x, 'TRADE', 'Trade out', v_now
    FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_from_user, p_from_team_id, x, 'TRADE', 'Trade in', v_now
    FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x;

  INSERT INTO trade_history (league_id, trade_offer_id, team1_id, team2_id, team1_players, team2_players)
  VALUES (p_league_id, p_trade_id, p_from_team_id, p_to_team_id,
          ARRAY(SELECT x::int FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x),
          ARRAY(SELECT x::int FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x));

  RETURN jsonb_build_object('success', true,
    'offered_moved', v_offered_moved, 'requested_moved', v_requested_moved);

EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM public.log_function_error('execute_trade', SQLSTATE, SQLERRM, 'trade rolled back whole', jsonb_build_object('trade_id', p_trade_id, 'league_id', p_league_id, 'from_team_id', p_from_team_id, 'to_team_id', p_to_team_id)); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $function$;

REVOKE ALL ON FUNCTION public.execute_trade(uuid, uuid, uuid, uuid, text[], text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.execute_trade(uuid, uuid, uuid, uuid, text[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_trade(uuid, uuid, uuid, uuid, text[], text[]) TO service_role;

-- -- 3. Post-conditions: refuse to commit on drift -----------------------
DO $$
DECLARE v_body text;
BEGIN
  -- Comment-stripped: both new bodies quote the strings they are being checked
  -- for inside their own rationale comments.
  v_body := regexp_replace(
    pg_get_functiondef('public.submit_trade_vote(uuid,uuid,text)'::regprocedure), '--[^\n]*', '', 'g');
  IF v_body NOT LIKE '%You can only vote as a team you own%' THEN
    RAISE EXCEPTION 'submit_trade_vote is not checking team ownership';
  END IF;
  IF v_body NOT LIKE '%Voting team is not in this league%' THEN
    RAISE EXCEPTION 'submit_trade_vote is not checking league membership of the voting team';
  END IF;
  -- The authorization must precede the INSERT, or it guards nothing.
  IF position('You can only vote as a team you own' in v_body)
       > position('INSERT INTO trade_votes' in v_body) THEN
    RAISE EXCEPTION 'submit_trade_vote authorizes after it has already written the vote';
  END IF;

  v_body := regexp_replace(
    pg_get_functiondef('public.execute_trade(uuid,uuid,uuid,uuid,text[],text[])'::regprocedure), '--[^\n]*', '', 'g');
  IF v_body NOT LIKE '%l.commissioner_id = v_caller_uid%' THEN
    RAISE EXCEPTION 'execute_trade does not admit the league commissioner';
  END IF;
  -- The owner check must still be there: this migration widens the gate, it
  -- does not remove it.
  IF v_body NOT LIKE '%AND league_id = p_league_id AND owner_id = v_caller_uid%' THEN
    RAISE EXCEPTION 'execute_trade lost its team-owner check';
  END IF;
  IF v_body NOT LIKE '%IF v_caller_uid IS NOT NULL THEN%' THEN
    RAISE EXCEPTION 'execute_trade lost its caller gate entirely';
  END IF;
  -- And the commissioner allowance must be scoped to p_league_id.
  IF v_body NOT LIKE '%WHERE l.id = p_league_id AND l.commissioner_id = v_caller_uid%' THEN
    RAISE EXCEPTION 'execute_trade commissioner allowance is not scoped to p_league_id';
  END IF;

  RAISE NOTICE 'trade authorization tightened; submit_trade_vote md5 = %, execute_trade md5 = %',
    md5(pg_get_functiondef('public.submit_trade_vote(uuid,uuid,text)'::regprocedure)),
    md5(pg_get_functiondef('public.execute_trade(uuid,uuid,uuid,uuid,text[],text[])'::regprocedure));
END $$;

COMMIT;
