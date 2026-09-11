-- ============================================================================
-- Revoke EXECUTE from anon/authenticated/PUBLIC on five SECURITY DEFINER
-- functions that no browser calls
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED  (grants only; no function body is touched)
--   lock_keepers_for_season(uuid,int)            REVOKE authenticated
--   sync_roster_assignments_for_league(uuid)     REVOKE authenticated
--   citrus_finalize_contest(...)                 REVOKE PUBLIC
--   citrus_disk_invariants()                     REVOKE PUBLIC, anon
--   tg_draft_events_seed_auction_budgets()       REVOKE PUBLIC, authenticated
--   service_role and postgres keep EXECUTE on all five.
--
-- (b) WHY
--   VERIFIED ON PRODUCTION 2026-09-11, read-only. All five are SECURITY
--   DEFINER, so RLS does not constrain them, and PostgREST exposes every
--   grantable function at /rest/v1/rpc/<name>. Grants read today:
--     lock_keepers_for_season              authenticated, postgres, service_role
--     sync_roster_assignments_for_league   authenticated, postgres, service_role
--     citrus_finalize_contest              PUBLIC, postgres, service_role
--     citrus_disk_invariants               PUBLIC, anon, authenticated, postgres, service_role
--     tg_draft_events_seed_auction_budgets PUBLIC, authenticated, postgres, service_role
--
--   lock_keepers_for_season is the sharp one. Earlier today the HTTP route
--   POST /api/keepers/league/:id/lock gained a commissioner check it never
--   had. That check is worth nothing while any signed-in user can skip the
--   handler and POST to PostgREST directly, so the grant is the other half
--   of the same fix, not a separate hardening item.
--
--   sync_roster_assignments_for_league rewrites every roster row in a
--   league. tg_draft_events_seed_auction_budgets is a TRIGGER function --
--   triggers do not consult EXECUTE, so nothing needs the grant.
--
-- (c) THE ORDERING THAT MATTERS -- READ BEFORE APPLYING
--   THREE server call sites used a USER client, not two. The first pass of
--   this header listed two and missed the third; it was caught on re-audit
--   2026-09-11 before this file was applied anywhere. All three are fixed:
--     server/src/routes/keepers.ts   POST /league/:id/lock
--                                    createUserClient -> supabaseAdmin,
--                                    behind a commissioner_id check
--     server/src/services/DraftService.ts:567
--                                    createUserClient -> supabaseAdmin
--     server/src/routes/rosters.ts   POST /league/:leagueId/sync
--                                    createUserClient -> supabaseAdmin,
--                                    behind commissionerMiddleware
--   so they executed as `authenticated`. APPLYING THIS MIGRATION AGAINST
--   THE CURRENTLY DEPLOYED SERVER WOULD BREAK ALL THREE -- keeper locking,
--   post-autopick roster sync, and the commissioner roster-sync route would
--   start returning "permission denied for function".
--
--   rosters.ts carried a second, independent defect found in the same pass:
--   its comment read "(commissioner only)" while the handler enforced
--   membershipMiddleware, so ANY league member could rewrite every
--   roster_assignments row in the league. SECURITY DEFINER meant RLS did
--   not backstop it. That route now uses commissionerMiddleware. This is
--   the same shape of bug as the keeper lock route: a comment asserting a
--   check the code never made.
--
--   The matching application changes move all three callers to supabaseAdmin
--   and ship with this file. DEPLOY THE SERVER FIRST, THEN APPLY THIS.
--   Verified read-only: zero browser-side call sites for any of the five
--   (grep over apps/web/src for .rpc('<name>') returns nothing), and
--   citrus_disk_invariants' only caller,
--   data-pipeline/monitoring/check_data_invariants.py, hard-exits without
--   SUPABASE_SERVICE_ROLE_KEY, so the service_role grant it keeps is enough.
--
-- (d) WHO / WORKSTREAM
--   Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett
--   Storms, 2026-09-11, audit cleanup item 8, ahead of drafts 15 Sep.
--
-- Reversibility: GRANT EXECUTE ... TO <role> restores each line exactly.
-- Idempotent: REVOKE of an absent privilege is a no-op.
-- ============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.lock_keepers_for_season(uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_roster_assignments_for_league(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.citrus_disk_invariants() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_draft_events_seed_auction_budgets() FROM PUBLIC, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname='public' AND p.proname='citrus_finalize_contest'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.lock_keepers_for_season(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_roster_assignments_for_league(uuid) TO service_role;

COMMIT;
