-- ============================================================
-- teams: league members can read every team in their league
-- ============================================================
-- Bug (2026-09-09, TestFlight + Android test night): proposing a trade
-- failed with "Target team not found" for every non-commissioner.
--
-- TradeService.createTradeOffer runs under the caller's JWT and looks up
-- both teams with `.in('id', [fromTeamId, toTeamId])`. The only SELECT
-- policies on public.teams were:
--   teams_select_own            owner_id = auth.uid()
--   teams_select_commissioner   commissioner of the league
--   "Public can view demo league teams"
-- so a member could see their own team and nothing else. The target row was
-- filtered out by RLS, `toTeam` came back undefined, and the service reported
-- it as missing. Commissioners never hit this, which is why it passed local
-- testing and failed for everyone else.
--
-- roster_assignments already grants league-wide reads ("Users can view
-- rosters in their leagues"); teams was the one table left behind.
--
-- Verified in a rolled-back transaction against production data before
-- writing this file: as the owner of "Big Screen TV" in "Test night 9th"
-- (league 27db6bc6), teams visible went from 1 to 4 of 4, and across the 58
-- leagues that user has no team in (204 teams) the count stayed at 0.
--
-- user_owns_team_in_league_simple is STABLE SECURITY DEFINER with
-- search_path=public, so it reads teams outside RLS and cannot recurse.

create policy teams_select_league_member
  on public.teams
  for select
  to authenticated
  using (public.user_owns_team_in_league_simple(league_id));
