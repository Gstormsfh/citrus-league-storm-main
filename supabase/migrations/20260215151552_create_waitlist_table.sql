-- Waitlist table for email collection
-- Allows public signup for VC proof of user interest

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text, -- 'landing_page', 'draft_room', 'hero_section', etc.
  user_agent text,
  ip_address text
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON public.waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON public.waitlist(created_at DESC);

-- RLS: Anyone can insert (public signup), but only admins can read
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Public can add themselves to waitlist
CREATE POLICY "Anyone can join waitlist"
  ON public.waitlist FOR INSERT
  WITH CHECK (true);

-- Only service role can read (for admin dashboard)
-- Regular users cannot read the waitlist
CREATE POLICY "Service role can read waitlist"
  ON public.waitlist FOR SELECT
  USING (false); -- Will be accessed via service role key, not through RLS
