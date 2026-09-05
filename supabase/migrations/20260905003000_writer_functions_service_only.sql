-- ============================================================================
-- Two SECURITY DEFINER writers stop being callable by signed-in users
-- ============================================================================
-- Found 2026-09-05 while verifying 20260904101000 on prod, read-only.
--
-- Supabase's default privileges on `public` grant EXECUTE on every new
-- function to `authenticated` and `service_role` at CREATE time
-- (pg_default_acl for role postgres: {postgres=X,authenticated=X,service_role=X}).
-- `REVOKE ALL ... FROM PUBLIC` removes only the PUBLIC entry, so a function
-- meant for the service role alone still carries an explicit
-- `authenticated=X` -- and PostgREST exposes every function in `public` as
-- an RPC to any signed-in user.
--
-- Two writers were reachable that way:
--
--   refresh_manager_week_metrics(integer, integer)  -- the nightly aggregate
--     writer from 20260904101000. Cannot write false data (it rebuilds from
--     `matchups`), but it is a full-table rewrite on demand, and on draft
--     night that is load nobody asked for.
--
--   populate_player_weekly_stats(integer, date, date)  -- the weekly stats
--     upsert the Python pipeline calls. Takes the week's dates as
--     arguments and does not check them against the schedule, so a caller
--     could write a "week 3" row that sums the whole season. Scoring reads
--     player_weekly_stats.
--
-- Neither is called with a user token anywhere in the repo (server/, apps/,
-- supabase/functions): the pipeline calls the second with the service key,
-- and nothing calls the first yet. Both keep `service_role`; pg_cron runs as
-- `postgres` and is unaffected.
--
-- NOT touched, on purpose: sync_roster_assignments_for_league(uuid) has the
-- same shape (SECURITY DEFINER, no auth check inside, authenticated=X) but
-- the server calls it WITH THE USER'S TOKEN from POST /api/rosters/league/
-- :leagueId/sync and from DraftService after a completed draft. Revoking it
-- here would break the post-draft roster sync three days before the test
-- drafts. Its fix is a membership check inside the function body, after
-- Tuesday, with a proof.
--
-- Reversal: GRANT EXECUTE ON FUNCTION ... TO authenticated; for either.
-- ============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.refresh_manager_week_metrics(integer, integer) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.populate_player_weekly_stats(integer, date, date) FROM authenticated, anon;

COMMIT;
