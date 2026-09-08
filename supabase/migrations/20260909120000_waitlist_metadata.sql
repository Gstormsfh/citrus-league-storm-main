-- LEAD GEN BEFORE THE APP IS LIVE (2026-09-09).
--
-- Two public web pages collect emails ahead of App Store approval: the
-- Opening Night pick'em (source 'opening-night-pickem', metadata = picks)
-- and the Bring Your League concierge form (source 'bring-your-league',
-- metadata = the league they run today). The waitlist table had no room
-- for either payload and a UNIQUE(email) that turned a returning waitlist
-- member into a duplicate error. The email stays unique; the server
-- upserts and merges metadata instead.
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.waitlist.metadata IS 'Per-source payload: pick''em picks, bring-your-league details. Merged on repeat sign-ups (2026-09-09).';
