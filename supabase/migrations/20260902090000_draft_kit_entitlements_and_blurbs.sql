-- DRAFT KIT (2026-09-02) — the paid analytics suite: entitlements + written blurbs.
--
-- WHY THESE TABLES EXIST
-- ----------------------
-- The Draft Kit is the first thing on Citrus anyone pays for. Two facts have to
-- live in the database rather than in the client for that to be true:
--
--   1. WHO IS ENTITLED. A paywall that the browser evaluates is a suggestion.
--      The gate has to be a row the server reads, so the premium payload is
--      never assembled for an unentitled caller in the first place. See
--      server/src/services/DraftKitService.ts — the free path builds a
--      different, smaller object; it does not build the full one and hide it.
--   2. WHO WROTE THE WORDS. The kit carries the founder's own analysis and, in
--      season, sourced writing from other hockey writers. Attribution is not
--      decoration on that content, it is the content: a blurb with no author
--      and no source is not publishable. The columns enforce it.
--
-- No payment-processor state lives here. There is no processor yet, and when
-- there is one, its identifiers belong in their own table keyed to this one
-- rather than smeared across it. `source` records how a grant happened in
-- words a human can audit, which is what matters before there is a processor
-- and still matters after.

-- ── Entitlements ─────────────────────────────────────────────────────
--
-- One row per user per tier grant. Deliberately NOT a column on profiles:
-- an entitlement has a start, an end and a provenance, and a boolean on a
-- profile row can carry none of those. Re-granting after an expiry is a new
-- row, so the history of what someone was sold survives.

CREATE TABLE IF NOT EXISTS public.draft_kit_entitlements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The authenticated user this grant belongs to. FK to auth.users so a
  -- deleted account takes its entitlements with it.
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which tier. Kept as a CHECKed text rather than an enum so adding a tier
  -- is a one-line migration instead of an ALTER TYPE dance.
  tier        TEXT        NOT NULL,

  -- How this grant happened, in auditable words: 'founder_grant',
  -- 'comp', 'promo', 'purchase'. Free text by design — the set of ways
  -- someone ends up entitled grows faster than an enum can be migrated.
  source      TEXT        NOT NULL DEFAULT 'founder_grant',

  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- NULL means it does not expire. A season pass sets this to the day after
  -- the season it covers.
  expires_at  TIMESTAMPTZ,

  -- Operator note. Never rendered to the entitled user.
  notes       TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT draft_kit_entitlements_tier_check
    CHECK (tier IN ('kit', 'suite')),

  CONSTRAINT draft_kit_entitlements_window_check
    CHECK (expires_at IS NULL OR expires_at > granted_at)
);

-- The hot read is "is THIS user entitled, right now" on every gated request.
CREATE INDEX IF NOT EXISTS draft_kit_entitlements_user_idx
  ON public.draft_kit_entitlements (user_id, expires_at);

COMMENT ON TABLE public.draft_kit_entitlements IS
  'Paid Draft Kit access grants, one row per user per tier grant. Read by the '
  'server before any premium payload is assembled; written only by the '
  'service role. A NULL expires_at is a grant that does not expire.';

ALTER TABLE public.draft_kit_entitlements ENABLE ROW LEVEL SECURITY;

-- A user may read their OWN grants and nobody else's. auth.uid() is the only
-- identity this policy trusts; no client-supplied id reaches it.
DROP POLICY IF EXISTS "draft_kit_entitlements readable by owner" ON public.draft_kit_entitlements;
CREATE POLICY "draft_kit_entitlements readable by owner"
  ON public.draft_kit_entitlements
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policy exists, on purpose. With RLS on and no
-- permissive write policy, anon and authenticated are denied every write, so
-- a client cannot grant itself access. The service_role key bypasses RLS and
-- is how a grant is actually issued. Adding a write policy here would be the
-- bug, not the fix — the same reasoning as citrus_news.

-- ── Blurbs ───────────────────────────────────────────────────────────
--
-- The written layer of the kit: the founder's own take on a player, and
-- sourced pieces from other hockey writers. Rows are AUTHORED, not derived,
-- which is the opposite of citrus_news and is why this is a separate table —
-- citrus_news is disposable and reproducible, this is not.
--
-- Nothing here is generated. The application ships the shell and the shape;
-- the words arrive through the service role when a human has written them.

CREATE TABLE IF NOT EXISTS public.draft_kit_blurbs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NHL player id, matching player_directory.player_id. NULL for a blurb
  -- about a team, a tier or the league rather than one player.
  -- Deliberately NOT a foreign key, for the reason citrus_news documents:
  -- player_directory is season-scoped and re-seeded by the pipeline, and a
  -- blurb should survive a player dropping out of it.
  player_id     INTEGER,

  -- Season the blurb is ABOUT, which in the offseason is the upcoming one.
  season        INTEGER     NOT NULL,

  -- 'player' | 'roster_change' | 'tier' | 'strategy'. Drives which surface
  -- of the kit the blurb renders on.
  kind          TEXT        NOT NULL DEFAULT 'player',

  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,

  -- ATTRIBUTION IS MANDATORY. A blurb with no author is not publishable, and
  -- NOT NULL is how that is enforced rather than hoped for. author_role is
  -- how a reader tells the founder's own take from a guest writer's.
  author_name   TEXT        NOT NULL,
  author_role   TEXT,

  -- Where the writing came from when it is not first-party. Both NULL means
  -- original Citrus copy; the pair is checked so a source name never appears
  -- without something to click, and a link never appears unattributed.
  source_name   TEXT,
  source_url    TEXT,

  -- Which tier can read it. 'free' blurbs are the teaser on the public page.
  tier_required TEXT        NOT NULL DEFAULT 'kit',

  -- Unpublished rows are drafts. The read policy will not serve them.
  is_published  BOOLEAN     NOT NULL DEFAULT false,
  published_at  TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT draft_kit_blurbs_kind_check
    CHECK (kind IN ('player', 'roster_change', 'tier', 'strategy')),

  CONSTRAINT draft_kit_blurbs_tier_check
    CHECK (tier_required IN ('free', 'kit', 'suite')),

  -- Source name and source URL travel together or not at all.
  CONSTRAINT draft_kit_blurbs_source_pair_check
    CHECK ((source_name IS NULL) = (source_url IS NULL)),

  -- A published blurb has a publication date. Same honesty rule the news
  -- table established: a timestamp that moves is worse than none.
  CONSTRAINT draft_kit_blurbs_published_at_check
    CHECK (is_published = false OR published_at IS NOT NULL)
);

-- The player card asks "published blurbs for this player, newest first".
CREATE INDEX IF NOT EXISTS draft_kit_blurbs_player_idx
  ON public.draft_kit_blurbs (player_id, published_at DESC)
  WHERE player_id IS NOT NULL AND is_published = true;

-- The kit index asks "everything published for this season, newest first".
CREATE INDEX IF NOT EXISTS draft_kit_blurbs_season_idx
  ON public.draft_kit_blurbs (season, published_at DESC)
  WHERE is_published = true;

COMMENT ON TABLE public.draft_kit_blurbs IS
  'Human-written Draft Kit copy: the founder plus sourced hockey writers. '
  'Authored, never generated — author_name is NOT NULL and source_name / '
  'source_url travel as a pair. Written only by the service role.';

ALTER TABLE public.draft_kit_blurbs ENABLE ROW LEVEL SECURITY;

-- Free-tier blurbs are the public teaser and are readable by anyone, signed
-- in or not. Everything else is resolved server-side against the caller's
-- entitlement before it is ever selected, so no paid row leaks through a
-- direct PostgREST read.
DROP POLICY IF EXISTS "draft_kit_blurbs free tier readable by everyone" ON public.draft_kit_blurbs;
CREATE POLICY "draft_kit_blurbs free tier readable by everyone"
  ON public.draft_kit_blurbs
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true AND tier_required = 'free');

-- Paid blurbs: readable only by a caller who holds a live entitlement. The
-- subquery keys on auth.uid(), so the row a client claims to be has no
-- bearing on what it can read.
DROP POLICY IF EXISTS "draft_kit_blurbs paid tier readable by entitled" ON public.draft_kit_blurbs;
CREATE POLICY "draft_kit_blurbs paid tier readable by entitled"
  ON public.draft_kit_blurbs
  FOR SELECT
  TO authenticated
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1
      FROM public.draft_kit_entitlements e
      WHERE e.user_id = auth.uid()
        AND (e.expires_at IS NULL OR e.expires_at > now())
        AND (
          e.tier = 'suite'
          OR (e.tier = 'kit' AND public.draft_kit_blurbs.tier_required IN ('free', 'kit'))
        )
    )
  );

-- No write policy, same reasoning as above: blurbs are authored through the
-- service role, and a user-authored row here would be indistinguishable from
-- an editor's.

-- ── Entitlement resolver ─────────────────────────────────────────────
--
-- One place that answers "what tier is the CALLER on, right now". SECURITY
-- DEFINER so it can read the entitlements table without every consumer
-- needing a policy of its own, and it takes NO ARGUMENTS on purpose: there is
-- no user id for a caller to pass, so there is no user id for a caller to
-- forge. auth.uid() is the only input.
CREATE OR REPLACE FUNCTION public.citrus_draft_kit_tier()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT e.tier
      FROM public.draft_kit_entitlements e
      WHERE e.user_id = auth.uid()
        AND (e.expires_at IS NULL OR e.expires_at > now())
      -- 'suite' outranks 'kit', so a user holding both resolves to the
      -- higher one. Alphabetical DESC happens to give that order; the
      -- CASE makes the intent explicit instead of relying on the accident.
      ORDER BY CASE e.tier WHEN 'suite' THEN 2 WHEN 'kit' THEN 1 ELSE 0 END DESC,
               e.granted_at DESC
      LIMIT 1
    ),
    'free'
  );
$$;

COMMENT ON FUNCTION public.citrus_draft_kit_tier() IS
  'The calling user''s live Draft Kit tier (''free'' | ''kit'' | ''suite''). '
  'Takes no arguments by design — auth.uid() is the only identity it trusts.';

REVOKE ALL ON FUNCTION public.citrus_draft_kit_tier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.citrus_draft_kit_tier() TO authenticated;
