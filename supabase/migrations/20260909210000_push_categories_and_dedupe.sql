-- ============================================================================
-- Per-category push preferences + a general delivery-dedupe key
-- ============================================================================
-- (a) WHAT THIS IS
--   The app has had ONE push ("You're on the clock") behind ONE boolean
--   (profiles.push_notifications, 2026-09-05). This adds the rest: trades,
--   roster moves, waivers, chat, matchups, league admin — each its own
--   category a manager can turn off without losing the others.
--
-- (b) WHY JSONB AND NOT A TABLE
--   `push_categories` stores ONLY the categories a manager has explicitly
--   changed. An absent key means "use the category's default", which is
--   stated once in packages/shared/src/constants/notificationCategories.ts.
--   Two consequences worth the denormalisation: shipping a new category needs
--   no backfill, and changing a default actually reaches every manager who
--   never touched that switch. A row-per-preference table would freeze both.
--   The sender already reads `profiles` for the master switch, so this costs
--   no extra round trip.
--
--   `push_notifications` is unchanged and remains the MASTER switch: false
--   there means send nothing, whatever the categories say.
--
-- (c) push_dedupe
--   push_deliveries is keyed (league_id, pick_number) — draft-specific by
--   construction. Every other notification needs the same
--   exactly-once guarantee against retries, duplicate webhooks and a second
--   server instance, so it gets a general text key
--   ("trade_offer:<offer_id>", "waiver:<claim_id>", …). The key is built by
--   the caller from ids it already has; the row carries no personal data.
--
--   Rows are disposable. `sent_at` is indexed so a sweep can delete anything
--   older than a few days; nothing reads a row's age, only its existence.
--
-- (d) RLS
--   push_categories rides `profiles`, which already has "Users can view own
--   profile" / "Users can update own profile" (auth.uid() = id). The API
--   writes through createUserClient, so ownership is enforced by that policy.
--   push_dedupe is written ONLY by the server's service-role client and is
--   readable by nobody else: RLS on with no policy denies every authenticated
--   caller, which is the intent.
--
-- (e) HOW THIS TELLS US IT IS BROKEN
--   PushService logs a reason per decision (opted_out / category_off /
--   no_devices / already_delivered), so a push a manager expected and did not
--   get is distinguishable from one that failed to send.
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_categories jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.push_categories IS
  'Per-category push overrides, e.g. {"draft_pick":true,"chat_all":false}. Absent key = that category''s default. Master switch is push_notifications.';

-- Overrides only; a manager cannot have more entries than there are categories.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_push_categories_is_object;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_push_categories_is_object
  CHECK (jsonb_typeof(push_categories) = 'object');

CREATE TABLE IF NOT EXISTS public.push_dedupe (
  key text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.push_dedupe IS
  'One row per delivered notification, keyed by the caller''s natural key (e.g. trade_offer:<uuid>). Insert-wins: the caller that inserts sends. Rows are disposable after a few days.';

CREATE INDEX IF NOT EXISTS push_dedupe_sent_at_idx ON public.push_dedupe (sent_at);

ALTER TABLE public.push_dedupe ENABLE ROW LEVEL SECURITY;
-- Deliberately no policy: service role only.

COMMIT;
