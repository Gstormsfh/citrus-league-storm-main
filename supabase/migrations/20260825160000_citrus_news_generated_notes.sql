-- CITRUS NEWS ENGINE (2026-08-25) — first-party, generated player notes.
--
-- WHY THIS TABLE EXISTS
-- --------------------
-- The News page fetched NHL.com and ESPN from the browser, was CORS-blocked,
-- and therefore always fell through to six hard-coded "articles" attributed to
-- those newsrooms with rolling fake timestamps. That fallback is gone (see
-- server/src/routes/news.ts). What replaces it has to be content we actually
-- own, and this is where it lives.
--
-- Sleeper's player cards carry Rotowire copy. We have no wire licence, but we
-- do have six seasons of shot-quality data that a wire does not, so Citrus
-- notes say things a generic feed cannot: who out-shot their finishing, whose
-- ice time moved, which goalie is actually carrying a starter's load. Every
-- note is derived from a row in this database and is bylined Citrus.
--
-- WHY A TABLE AND NOT ON-THE-FLY GENERATION
-- -----------------------------------------
-- Three reasons, in order of importance:
--   1. STABLE PUBLICATION TIME. A note has to have been published at a moment
--      and stay put. Deriving it per-request means its timestamp changes every
--      time someone loads the page, which is exactly the dishonesty the old
--      fallback was guilty of.
--   2. DEDUPE. A detector that runs hourly must not republish the same finding
--      hourly. dedupe_key is the unique constraint that makes a re-run a no-op.
--   3. COST. Detectors scan season-wide aggregates; doing that inside a page
--      request would put a multi-thousand-row scan on the critical path.
--
-- Notes are DERIVED, never authored, so this table is disposable: truncating it
-- and re-running the generator reproduces it. No user data lives here.

CREATE TABLE IF NOT EXISTS public.citrus_news (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Idempotency. Detectors build this from (kind, season, subject) so a
  -- re-run collides instead of duplicating. See CitrusNewsService.
  dedupe_key   TEXT        NOT NULL UNIQUE,

  -- Detector id, e.g. 'bounce-back', 'regression-risk', 'usage-surge'.
  kind         TEXT        NOT NULL,

  -- NHL player id (integer, matches player_directory.player_id and
  -- player_season_stats.player_id). NULL for league-wide notes.
  -- Deliberately NOT a foreign key: player_directory is season-scoped and
  -- re-seeded by the pipeline, and a note about a player who drops out of the
  -- directory should survive rather than cascade away.
  player_id    INTEGER,

  -- Season the note is ABOUT, which in the offseason is not the current one.
  season       INTEGER     NOT NULL,

  headline     TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  analysis     TEXT,

  -- 'info' | 'positive' | 'caution' — drives the UI accent, mirrors the
  -- WriteupTone union in apps/web/src/utils/playerWriteup.ts.
  severity     TEXT        NOT NULL DEFAULT 'info',

  tags         TEXT[]      NOT NULL DEFAULT '{}',

  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT citrus_news_severity_check
    CHECK (severity IN ('info', 'positive', 'caution'))
);

-- The player card asks "notes for this player, newest first" on every open.
CREATE INDEX IF NOT EXISTS citrus_news_player_published_idx
  ON public.citrus_news (player_id, published_at DESC)
  WHERE player_id IS NOT NULL;

-- The News feed asks "everything, newest first".
CREATE INDEX IF NOT EXISTS citrus_news_published_idx
  ON public.citrus_news (published_at DESC);

-- Detector maintenance ("drop everything this detector produced and re-run").
CREATE INDEX IF NOT EXISTS citrus_news_kind_idx
  ON public.citrus_news (kind);

COMMENT ON TABLE public.citrus_news IS
  'Generated, first-party player notes bylined Citrus. Derived from '
  'player_season_stats / player_game_stats — disposable and reproducible by '
  're-running the generator. Written only by the service role.';

-- ── RLS ──────────────────────────────────────────────────────────────
-- Published news is public: the News page and the demo experience are both
-- reachable without signing in, so anon must be able to read. Nobody but the
-- service role may write — these notes are generated, and a user-authored row
-- here would be indistinguishable from a derived one.
ALTER TABLE public.citrus_news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "citrus_news readable by everyone" ON public.citrus_news;
CREATE POLICY "citrus_news readable by everyone"
  ON public.citrus_news
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy is defined on purpose. With RLS enabled and
-- no permissive write policy, anon and authenticated are denied all writes;
-- the service_role key bypasses RLS entirely, which is how the generator
-- writes. Adding a write policy here would be the bug, not the fix.
