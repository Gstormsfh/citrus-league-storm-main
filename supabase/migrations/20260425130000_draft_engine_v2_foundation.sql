-- Draft Engine v2 — Phase 1 foundation
--
-- Purely additive. v1 (`draft_picks`, `make_draft_pick`, client autopick,
-- broadcastDraftPick) is **not** touched. v2 sits alongside until Phase 8.
--
-- Implements:
--   - draft_events table          → spec §3.1
--   - draft_picks_v2 table        → spec §3.2 (synchronous projection of pick events)
--   - leagues column additions    → spec §3.3
--
-- No RPCs in this migration. submit_pick_v2 / append_draft_event /
-- record_shadow_event / reconstruct_draft_state / draft_pause / draft_resume /
-- draft_extend land in Phase 2.
--
-- Reference: docs/DRAFT_ENGINE_V2_SPEC.md, docs/DRAFT_ENGINE_V2_PLAN.md.
-- Phase 0 column-collision check (runbook §2.8) ran clean: none of the six
-- new `leagues` columns pre-exist on staging.

-- ── 1. draft_events ───────────────────────────────────────────────────
-- Append-only event log. Every state change in a v2 draft is a row here.
-- This table is the single source of truth (principle P1, spec §1).

CREATE TABLE IF NOT EXISTS public.draft_events (
  id              bigserial PRIMARY KEY,
  league_id       uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  seq             bigint NOT NULL,
  event_type      text NOT NULL,
  event_version   smallint NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL,
  payload_hash    text NOT NULL,
  idempotency_key uuid,
  actor           jsonb NOT NULL,
  causation_id    bigint REFERENCES public.draft_events(id) ON DELETE SET NULL,
  correlation_id  uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT draft_events_event_type_chk CHECK (event_type IN (
    'pick',
    'pick_undone',
    'autopick_failed',
    'draft_started',
    'draft_paused',
    'draft_resumed',
    'draft_extended',
    'draft_completed',
    'draft_cancelled',
    'commissioner_override',
    'generation_bumped'
  )),
  CONSTRAINT draft_events_actor_kind_chk CHECK (
    (actor ->> 'kind') IN ('user','autopick','commissioner','shadow','system')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS draft_events_league_seq_uniq
  ON public.draft_events (league_id, seq);

-- Partial unique on idempotency_key — only enforced when present.
-- Spec §3.1 / I4: "idempotency_key uniqueness holds globally."
CREATE UNIQUE INDEX IF NOT EXISTS draft_events_idem_key_uniq
  ON public.draft_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Replay-window index: GET /events?since_seq=N&league_id=$1 reads
-- ordered by created_at within a league.
CREATE INDEX IF NOT EXISTS draft_events_league_created_idx
  ON public.draft_events (league_id, created_at);

-- Trace-join index: tooling correlates events from one logical request.
CREATE INDEX IF NOT EXISTS draft_events_correlation_idx
  ON public.draft_events (correlation_id);

COMMENT ON TABLE  public.draft_events IS
  'Draft Engine v2 append-only event log. Single source of truth (spec §3.1, principle P1). Writable only via Phase 2 RPCs.';
COMMENT ON COLUMN public.draft_events.seq IS
  'Per-league gap-free sequence number. Sourced from leagues.draft_event_counter, advanced inside the same txn as the insert.';
COMMENT ON COLUMN public.draft_events.event_version IS
  'Bumped on breaking payload-schema changes. Spec §1 (Versioning).';
COMMENT ON COLUMN public.draft_events.payload_hash IS
  'sha256 of canonical JSON payload. Used to detect "same key, different payload" idempotency conflicts.';
COMMENT ON COLUMN public.draft_events.idempotency_key IS
  'Spec §3.1: unique partial index. NULL only for system-generated events that cannot retry.';
COMMENT ON COLUMN public.draft_events.actor IS
  '{kind, id?, session_id?}. kind enum is CHECK-enforced; JSONB for forward extensibility of metadata.';
COMMENT ON COLUMN public.draft_events.correlation_id IS
  'Spec §6.13: source-of-truth table per actor.kind. Autopick: worker UUIDv4. User: X-Correlation-Id header. Shadow: uuid_v5(league_id,pick_id).';
COMMENT ON COLUMN public.draft_events.causation_id IS
  'Optional: identifies the event that caused this one (e.g. autopick caused by deadline-expiry).';

-- ── 2. draft_picks_v2 ─────────────────────────────────────────────────
-- Synchronous projection of `pick` events (spec §3.2, principle P6).
-- Phase 2's tg_draft_events_project_pick trigger is the *only* writer.
-- Hot-path read is `SELECT FROM draft_picks_v2`; reconstruct_draft_state
-- (spec §4.4) is rebuild/repair only.

CREATE TABLE IF NOT EXISTS public.draft_picks_v2 (
  league_id        uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  pick_number      int  NOT NULL,
  round            int  NOT NULL,
  team_id          uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- v1 draft_picks.player_id is TEXT; spec §3.2 uses int. The trigger in
  -- Phase 2 reads (event.payload->>'player_id')::int. Shadow-diff in Phase 8
  -- handles the type bridge against v1.
  player_id        int  NOT NULL,
  picked_at        timestamptz NOT NULL,
  picked_by_actor  jsonb NOT NULL,
  source_event_id  bigint NOT NULL REFERENCES public.draft_events(id) ON DELETE CASCADE,
  source_seq       bigint NOT NULL,
  PRIMARY KEY (league_id, pick_number)
);

CREATE INDEX IF NOT EXISTS draft_picks_v2_league_team_idx
  ON public.draft_picks_v2 (league_id, team_id);
CREATE INDEX IF NOT EXISTS draft_picks_v2_league_player_idx
  ON public.draft_picks_v2 (league_id, player_id);

COMMENT ON TABLE public.draft_picks_v2 IS
  'Trigger-maintained projection of pick events. Spec §3.2, principle P6. Read-only for clients; the projection trigger is the sole writer. Invariant I16 enforces consistency with draft_events.';

-- ── 3. leagues column additions ───────────────────────────────────────
-- Spec §3.3. Phase 0 collision check passed: none of these pre-exist on
-- staging. IF NOT EXISTS used for idempotency.

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS draft_event_counter bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pick_deadline       timestamptz,
  ADD COLUMN IF NOT EXISTS draft_state         text    NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS draft_generation    int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draft_shadow_mode   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS feature_flags       jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- CHECK constraint on draft_state (spec §3.3 / §5.1 lifecycle).
-- Conditional on the constraint not already existing (idempotent re-run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leagues_draft_state_chk'
  ) THEN
    ALTER TABLE public.leagues
      ADD CONSTRAINT leagues_draft_state_chk
      CHECK (draft_state IN (
        'not_started','pre_draft','active','paused','completed','cancelled'
      ));
  END IF;
END$$;

COMMENT ON COLUMN public.leagues.draft_event_counter IS
  'Per-league gap-free seq source. Advanced inside submit_pick_v2 / append_draft_event txns. Spec §3.3.';
COMMENT ON COLUMN public.leagues.pick_deadline IS
  'Server-authoritative absolute deadline. Spec §5.2.2: rounded to whole seconds + 1s pad. NULL when not actively drafting.';
COMMENT ON COLUMN public.leagues.draft_state IS
  'v2 draft lifecycle state machine. Spec §5.1. Coexists with v1 draft_status (different state space).';
COMMENT ON COLUMN public.leagues.draft_generation IS
  'Bumped on every pause/resume/extend. Namespaces autopick idempotency keys; lets workers no-op stale pgmq messages without queue-side cancellation. Spec §2 glossary, §5.3.';
COMMENT ON COLUMN public.leagues.draft_shadow_mode IS
  'Phase 8 shadow-mode flag. true = v1 trigger writes parallel v2 events via record_shadow_event. Default true so v2 observes new leagues automatically once shadow trigger ships in Phase 8.';
COMMENT ON COLUMN public.leagues.feature_flags IS
  'Per-league feature flags. Reaches the client via existing GET /api/leagues/:id response (spec §7.1, no new endpoint).';

-- ── 4. RLS ────────────────────────────────────────────────────────────
-- Spec §3.1 / §3.2: SELECT for league members; writes denied for non-service-role.
-- Match v1's draft_picks pattern (commissioner_id OR teams.owner_id).

ALTER TABLE public.draft_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_picks_v2  ENABLE ROW LEVEL SECURITY;

-- draft_events: members can SELECT.
DROP POLICY IF EXISTS "draft_events: members can read"
  ON public.draft_events;
CREATE POLICY "draft_events: members can read"
  ON public.draft_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.leagues l
      WHERE l.id = draft_events.league_id
        AND (
          l.commissioner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.teams t
            WHERE t.league_id = l.id
              AND t.owner_id  = auth.uid()
          )
        )
    )
  );
-- No INSERT/UPDATE/DELETE policies → only service_role (used by the
-- Phase 2 SECURITY DEFINER RPCs) can write. This is the deliberate
-- gate that funnels every write through the spec's contract.

-- draft_picks_v2: same SELECT policy, no write policies.
DROP POLICY IF EXISTS "draft_picks_v2: members can read"
  ON public.draft_picks_v2;
CREATE POLICY "draft_picks_v2: members can read"
  ON public.draft_picks_v2
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.leagues l
      WHERE l.id = draft_picks_v2.league_id
        AND (
          l.commissioner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.teams t
            WHERE t.league_id = l.id
              AND t.owner_id  = auth.uid()
          )
        )
    )
  );
