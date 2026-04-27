-- Draft Engine v2 — Phase 4 chunk 11a: draft_queues table + RLS.
--
-- Spec §3.4. Team-owner-managed pre-pick queue. The Phase 4 autopick
-- worker reads this when a deadline expires: head-of-queue (filtered
-- to undrafted players) is the chosen pick; if no row exists for the
-- on-the-clock team, worker falls back to the FPTS+positional-need
-- heuristic ported from DraftRoom.tsx:2410-2524.
--
-- v1 stores the draft queue purely client-side (DraftRoom.tsx
-- setDraftQueue local state). Phase 4 adds the backend table; Phase 5
-- (UI work) wires the v1 client to write through to this table for
-- v2 leagues. Until then, v2 leagues with no queue rows still get
-- autopicked correctly via the heuristic fallback — there is no data
-- migration in Phase 4 by design.
--
-- RLS model: team owner only. Team membership is a single owner
-- (teams.owner_id = auth.uid()) per the v1 schema; there is no
-- broader "team members" surface in this codebase. service_role
-- bypasses RLS by default and is what the Phase 4 worker uses.
-- Commissioners do NOT get queue read/write per spec §3.4 — the
-- queue is the team owner's private intent. (Per deviation D3,
-- commissioners have no v2 pick power; queue access would be the
-- same shape and is intentionally withheld.)

-- ── 1. draft_queues ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_queues (
  team_id    uuid        NOT NULL REFERENCES public.teams(id)   ON DELETE CASCADE,
  league_id  uuid        NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  position   smallint    NOT NULL,
  player_id  int         NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT draft_queues_team_player_uniq    UNIQUE (team_id, player_id),
  CONSTRAINT draft_queues_team_position_uniq  UNIQUE (team_id, position)
);

COMMENT ON TABLE  public.draft_queues IS
  'Spec §3.4: team-owner-managed pre-pick queue. Phase 4 worker reads head-of-queue (filtered to undrafted) when autopicking; falls back to heuristic if no row. Phase 5 wires the v1 UI to write through.';
COMMENT ON COLUMN public.draft_queues.position IS
  'Queue ordinal (lower = higher priority). UNIQUE (team_id, position) prevents two players at the same slot. UNIQUE (team_id, player_id) prevents queueing the same player twice.';
COMMENT ON COLUMN public.draft_queues.player_id IS
  'int per spec §3.4 (matches draft_picks_v2.player_id and draft_events.payload->>player_id::int). v1 draft_picks.player_id is text; bridge handled in Phase 8 shadow-diff.';

-- The two UNIQUE constraints both index team_id as their leading
-- column, so the worker's `WHERE team_id = $1 ORDER BY position` lookup
-- is already indexed. No additional indexes needed.

-- ── 2. RLS policies ────────────────────────────────────────────────────

ALTER TABLE public.draft_queues ENABLE ROW LEVEL SECURITY;

-- Team owner: full read/write on their own team's queue rows.
-- Single FOR ALL policy with USING + WITH CHECK is equivalent to
-- four separate policies (SELECT/INSERT/UPDATE/DELETE) and is the
-- pattern used by the existing "Commissioners can manage draft order"
-- policy in 20250101000002_create_draft_tables.sql.
CREATE POLICY "Team owner manages own queue"
  ON public.draft_queues
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
       WHERE t.id = draft_queues.team_id
         AND t.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teams t
       WHERE t.id = draft_queues.team_id
         AND t.owner_id = auth.uid()
    )
  );

-- ── 3. Verify ──────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_rls_enabled  boolean;
  v_unique_count int;
  v_policy_count int;
BEGIN
  -- (a) Table exists and RLS is on.
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
   WHERE relname = 'draft_queues' AND relnamespace = 'public'::regnamespace;

  IF v_rls_enabled IS NULL THEN
    RAISE EXCEPTION 'draft_queues table was not created';
  END IF;

  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'draft_queues RLS is not enabled';
  END IF;

  -- (b) Both unique constraints present.
  SELECT count(*) INTO v_unique_count
    FROM pg_constraint
   WHERE conrelid = 'public.draft_queues'::regclass
     AND contype = 'u'
     AND conname IN (
       'draft_queues_team_player_uniq',
       'draft_queues_team_position_uniq'
     );

  IF v_unique_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 unique constraints on draft_queues, got %', v_unique_count;
  END IF;

  -- (c) Exactly one RLS policy (the FOR ALL team-owner policy).
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'draft_queues';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 RLS policy on draft_queues, got %', v_policy_count;
  END IF;
END
$verify$;
