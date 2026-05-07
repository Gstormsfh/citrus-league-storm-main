-- ════════════════════════════════════════════════════════════════════
-- Phase 4.5 chunk 11g.7 sub-step 7c: snapshot persistence for engine
-- restart optimization.
--
-- The engine periodically (30s cadence + every-50-events milestone +
-- lifecycle triggers) writes a snapshot of its current state to this
-- table. Bootstrap reads the most recent snapshot and applies the
-- delta of events since the snapshot's `last_applied_seq` instead
-- of full event-log replay.
--
-- **Path C architecture (Decision Log 2026-05-07)**: each row
-- carries TWO JSONB payloads:
--   - `snapshot_payload`: the wire `DraftSnapshot` shape from
--     `buildSnapshot()` (chunk 11g.7 sub-step 7b helper). Same shape
--     clients see over HTTP/WS. Reuses 7b's reconstruction helper
--     so there's a single source of truth for the wire form.
--   - `engine_state`: engine-internal orchestration fields that
--     aren't in `DraftSnapshot` — `currentTimerKind`, `pauseState`,
--     `eventsSinceLastSnapshot`. Tiny, well-bounded surface.
--
-- **Canonical-replay principle preserved (chunk 11g.6 sub-step 6b)**:
-- snapshot+delta replay is an OPTIMIZATION on top of full event-log
-- replay. Every state-affecting event still has an apply-during-
-- replay handler. Bootstrap falls back to full event-replay on ANY
-- snapshot issue (missing, version-mismatched, validation failure,
-- snapshot ahead of event log). Belt-and-suspenders.
--
-- **`engine_version` migration safety**: bumping the constant in
-- `server/src/draft/snapshotPersistence.ts` invalidates older
-- snapshots — bootstrap rejects mismatched versions and falls back
-- to full event-replay. Adding optional fields to `engine_state`
-- doesn't require a bump (deserialization handles missing fields
-- gracefully). Removing/renaming/redefining a field requires a bump.
--
-- **Retention** (engine-side, not migration-side): the engine prunes
-- to most-recent-5 for in-progress drafts; keeps ALL snapshots for
-- completed/cancelled drafts as audit trail. Pruning runs after
-- each successful snapshot write.
--
-- **RLS enabled, no policies**: engine writes via service_role
-- (bypasses RLS); future user-facing reads (e.g., commissioner
-- audit UI) add policies at that point. The lack of policies is
-- intentional, not an oversight.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.draft_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id         UUID        NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  -- The seq number of the most-recent durable event reflected in
  -- this snapshot. Bootstrap reads delta events with `seq >
  -- last_applied_seq` and applies them on top of the snapshot.
  last_applied_seq  BIGINT      NOT NULL,
  -- Bumped when `engine_state` shape changes incompatibly. Bootstrap
  -- rejects snapshots whose `engine_version` doesn't match the
  -- current code's `ENGINE_SNAPSHOT_VERSION` constant.
  engine_version    INTEGER     NOT NULL,
  -- Wire `DraftSnapshot` shape (lobbyId, format, recentEvents,
  -- stateSnapshot, optional auctionState). Same shape served by
  -- the HTTP snapshot endpoint at `/api/drafts/:draftId/snapshot`.
  snapshot_payload  JSONB       NOT NULL,
  -- Engine-internal orchestration fields not in DraftSnapshot:
  --   currentTimerKind: 'pick' | 'bid_window' | 'nomination_window' | null
  --   pauseState: { pausedAt, remainingMs, pausedTimerKind } | null
  --   eventsSinceLastSnapshot: number (for milestone trigger continuity)
  engine_state      JSONB       NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast "most recent snapshot for this league" lookup. Bootstrap
-- queries `WHERE league_id = $1 ORDER BY last_applied_seq DESC LIMIT 1`;
-- this index is the natural fit.
CREATE INDEX IF NOT EXISTS idx_draft_snapshots_league_seq
  ON public.draft_snapshots (league_id, last_applied_seq DESC);

ALTER TABLE public.draft_snapshots ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.draft_snapshots IS
  'Phase 4.5 chunk 11g.7 sub-step 7c: engine state snapshots for restart optimization. Engine writes periodically + on milestones + on lifecycle. Bootstrap reads most recent, applies delta events. Falls back to full event-replay on any snapshot issue. Path C JSONB shape: snapshot_payload (DraftSnapshot wire shape) + engine_state (engine-internal orchestration fields).';

COMMENT ON COLUMN public.draft_snapshots.engine_version IS
  'Bumped when engine_state JSONB shape changes incompatibly. Mismatch → bootstrap WARN log + fall back to full event-replay.';

COMMENT ON COLUMN public.draft_snapshots.snapshot_payload IS
  'DraftSnapshot wire shape from buildSnapshot() helper (chunk 11g.7 sub-step 7b). Same shape clients see over HTTP/WS.';

COMMENT ON COLUMN public.draft_snapshots.engine_state IS
  'Engine-internal orchestration fields NOT in DraftSnapshot: currentTimerKind, pauseState, eventsSinceLastSnapshot. Tiny well-bounded surface.';
