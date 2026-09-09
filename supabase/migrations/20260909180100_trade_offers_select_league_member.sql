-- ============================================================
-- trade_offers: league members and the commissioner can read
-- every offer in their league
-- ============================================================
-- Found while auditing for the same shape as
-- 20260909180000_teams_select_league_member.sql: a table whose only SELECT
-- policy is own-rows, read by a service running as the caller, backing a
-- feature that inherently crosses teams.
--
-- The only SELECT policy was "Users can view trade offers involving their
-- teams" (from_team_id or to_team_id owned by auth.uid()). Every trade route
-- in server/src/routes/trades.ts runs under createUserClient, so:
--
--   * TradeService.verifyTradeAccess (vote and votes routes) returned
--     "Trade not found" for any voter who was not one of the two teams, and
--     the submit_trade_vote RPC refuses the two teams. In a league_vote
--     league nobody could vote.
--   * TradeService.commissionerDecision returned "Trade not found" unless the
--     commissioner happened to be a party to the trade. Commissioner review
--     did not work.
--   * TradeService.getLeagueTrades only returned offers involving the
--     caller's own team, so the Trade Center never listed anything to vote on
--     or review in the first place.
--
-- None of the 23 offers in production at the time involved a commissioner
-- who was not also a party, which is why it never surfaced in testing.
--
-- Verified in rolled-back transactions against production data: with a
-- throwaway under_review offer between two non-commissioner teams in
-- "Test night 9th", the commissioner went from 0 to 1 visible. For a user in
-- some leagues but not others, offers visible equalled offers in their own
-- leagues exactly (22 of 23), with the one foreign offer hidden.
--
-- trade_votes was already league-scoped; this brings trade_offers into line
-- with it. Both helper functions are STABLE SECURITY DEFINER with
-- search_path=public and do not recurse.

create policy trade_offers_select_league_member
  on public.trade_offers
  for select
  to authenticated
  using (
    public.user_owns_team_in_league_simple(league_id)
    or public.is_commissioner_of_league(league_id)
  );
