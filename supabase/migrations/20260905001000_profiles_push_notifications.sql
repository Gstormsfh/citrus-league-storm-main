-- ============================================================================
-- profiles.push_notifications — the one notification switch that is real
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1: no capture required. One NEW column with a
-- default; nothing is replaced.
--
-- (a) WHAT THIS IS
--   A per-manager opt-out for the app's only push: "You're on the clock"
--   (server/src/services/PushService.ts, APNs, fired by the draft engine when
--   a pick becomes yours). The account screen has drawn "Push Notifications"
--   and "Email Notifications" switches since 2026-08 that wrote to component
--   state and toasted "saved automatically". Nothing was saved. This column
--   is what the push switch writes, and PushService reads it before sending.
--
--   There is NO email column, because there is no email sender in this repo
--   (measured 2026-09-04: no mailer dependency, no send path). A switch for a
--   thing that cannot happen is not drawn.
--
-- (b) DEFAULT true, NOT NULL
--   72 managers have registered devices under the current behaviour, which is
--   "every on-the-clock pick sends". The default keeps that behaviour for
--   every existing row; the column exists so a manager can turn it OFF.
--
-- (c) RLS
--   `profiles` already has RLS: "Users can update own profile"
--   (auth.uid() = id) admits the write, "Users can view own profile" the
--   read. The API writes through the user's own JWT (createUserClient), so
--   the policy is what enforces ownership, not the route. No new policy.
--
-- (d) HOW THIS TELLS US IT IS BROKEN
--   PushService logs every on_the_clock decision with a reason; an opted-out
--   owner logs `skipped reason=opted_out` and the push_deliveries claim row is
--   still written, so a "missing" push is distinguishable from a failed one.
--
-- (e) DRAFT-NIGHT COST
--   One primary-key read of `profiles` per on-the-clock event (one per pick),
--   alongside the `teams` and `device_tokens` reads the sender already makes.
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_notifications boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.push_notifications IS
  'Manager opt-in for the on-the-clock APNs push. Default true; PushService skips owners set false.';

COMMIT;
