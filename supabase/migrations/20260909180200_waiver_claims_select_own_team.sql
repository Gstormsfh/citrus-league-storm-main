-- Waiver claims are private until they resolve.
-- The previous league-wide SELECT policy let every league member read every
-- pending/failed claim; LeagueService.fetchTransactions (user client) then
-- surfaced other owners' pending claims in the Roster LOG tab as if they were
-- the viewer's own. Only the claiming team's owner may see pending/failed/
-- cancelled claims; successful claims stay league-visible (used by
-- getAllFAABBudgets and the transaction log). Commissioner "process all"
-- runs through the service-role client and is unaffected.
drop policy if exists "Users can view waiver claims in their leagues" on public.waiver_claims;

create policy waiver_claims_select_own_or_successful on public.waiver_claims
  for select to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.id = waiver_claims.team_id
        and t.owner_id = (select auth.uid())
    )
    or status = 'successful'
  );
