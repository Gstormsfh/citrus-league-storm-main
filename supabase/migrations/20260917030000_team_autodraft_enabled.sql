-- AUTODRAFT THAT SURVIVES A CLOSED TAB (2026-09-14, Garrett: "autodraft
-- isn't persistent between/across sessions").
--
-- The v2 room's AUTODRAFT toggle lived in localStorage and fired from the
-- browser: close the tab, switch devices, or lose the connection and the
-- engine never knew you had asked it to pick for you, so your seat sat on
-- the full clock until the deadline autopick. The flag now lives on the
-- team row. The engine reads it when a seat comes on the clock and arms
-- the same instant-autopick window it already uses for ownerless seats.
--
-- Client writes go through PUT /api/draft/v2/league/:leagueId/teams/:teamId/
-- autodraft (membership + ownership verified server-side); no RLS policy
-- change is needed for that path. Owners could already UPDATE their own
-- team row under the existing policy, which is fine: the flag is theirs.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS autodraft_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.teams.autodraft_enabled IS
  'Owner-set: when true and this team is on the clock in a snake/linear draft, the engine autopicks within the instant window instead of waiting for the full pick clock. Persisted so it survives a closed tab or a device switch.';
