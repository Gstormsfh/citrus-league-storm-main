-- ═══════════════════════════════════════════════════════════════════════
-- Chunk 11g.10 sub-step 10c-1c — staging schema alignment (recovery).
-- ═══════════════════════════════════════════════════════════════════════
--
-- Origin: 10b's `supabase migration repair --status applied` batch wrote
-- history rows for migrations that had never actually executed against
-- staging. Task 0 audit (2026-07-22) confirmed 8 non-executed migrations
-- (draft_snapshots + all auction RPCs + NOTIFY trigger) plus 1 partially
-- executed (#17 only recreated `draft_pause`, dropped nothing). This file
-- restores the intended state so 10c-2 measurement work stands on real
-- schema.
--
-- Audit table (as of 2026-07-22, pre-recovery):
--   ABSENT (additive):
--     - Table       draft_snapshots            (from #14)
--     - Function    nominate_player_v2         (from #8 → #10 terminal)
--     - Function    place_bid_v2               (from #8 → #9 → #10 → #11 terminal)
--     - Function    close_nomination_v2        (from #8)
--     - Function    auction_pause_v2           (from #10)
--     - Function    auction_resume_v2          (from #10)
--     - Function    compute_min_next_bid       (from #11)
--     - Function    auction_nomination_skip_v2 (from #12)
--     - Function    auction_commissioner_override_v2 (from #13)
--     - Function    draft_events_notify_trigger (from #15)
--     - Trigger     draft_events_notify_after_insert (from #15)
--     - Index       idx_draft_events_auction   (from #8)
--     - Index       idx_draft_snapshots_league_seq (from #14)
--     - Column      auction_nominations.nomination_event_id (from #8)
--     - CHECK enum  draft_events.event_type auction values (from #8, #12)
--     - CHECK enum  auction_nominations.status add 'cancelled' (from #13)
--   RPC bodies with pgmq.send that should be clean (from #17):
--     - submit_pick_v2
--     - draft_resume
--     - draft_extend
--   PRESENT-but-legacy (drain but do not drop — see scope below):
--     - pgmq extension, leagues.draft_generation column, wrapper RPCs
--       (draft_autopick_read/archive/deadline_sweep), pg_cron jobs
--       draft-deadline-sweep + draft-autopick-keepalive.
--
-- ── Scope: drain-then-drop (Option C-drain-then-drop from B2 gate) ────
--
--   PHASE A — Additive DDL (extracted from #8, #12, #13, #14, #15).
--   PHASE B — Terminal RPC bodies for the auction chain (#10/#11/#12/#13)
--             and for the snake/linear chain post-11g.9 (#17).
--   PHASE C — DRAIN: cron.unschedule the two Phase 4 legacy jobs so no
--             scheduled process invokes the deprecated Edge Function or
--             draft_deadline_sweep anymore. **Does NOT drop** the pgmq
--             extension, the wrapper RPCs (draft_autopick_read/archive/
--             deadline_sweep), or leagues.draft_generation — those drops
--             are deferred to a follow-up sub-step that co-commits with
--             the `supabase functions delete draft-autopick` operation.
--             Rationale: the deployed Edge Function still references
--             those surfaces (grep-verified on origin/master:
--             supabase/functions/draft-autopick/index.ts:136,179,194,202).
--             Dropping them while the Edge Function is deployed would
--             surface loud errors on every cron fire even after
--             unschedule (cron would already stop invoking, but any
--             manual invocation would fail; safer to remove Edge
--             Function first).
--
-- ── Idempotency: FULL. Every statement uses IF NOT EXISTS / CREATE OR
--    REPLACE / IF EXISTS / DROP-and-recreate guards. Applying this file
--    against a database that already ran the original chain #8–#17
--    produces zero observable state change. Production 10f will get
--    this migration via the normal chain; it will no-op there.
--
-- ── Cross-check: the NOTIFY trigger function at PHASE A step 5 emits
--    on channel `draft_events` with payload `{league_id, seq}`. This
--    matches `server/src/draft/eventSubscription.ts` parseNotificationPayload
--    (lines 66-92): expects `parsed.league_id: string` and
--    `parsed.seq: number`. Byte-level intent match preserved.
--
-- ── Repair ban: `supabase migration repair --status applied` is the
--    mechanism that produced the state this migration recovers from.
--    NEVER USE IT. History must only be written by tools that execute
--    the SQL in the same operation (`supabase db push` at minimum).
--    Standing rule per PROJECT_PLAN Decision Log 2026-07-22.
--
-- ── Verification: after apply, re-run the Task 0 audit queries. Every
--    "ABSENT" row above must flip to "PRESENT"; the four RPC bodies
--    must show "CLEAN" (no pgmq refs); the two cron jobs must no
--    longer appear in cron.job.


-- ═══════════════════════════════════════════════════════════════════════
-- PHASE A — Additive DDL
-- ═══════════════════════════════════════════════════════════════════════

-- ── A.1: draft_events.event_type CHECK enum (from #12 — final version) ──
-- The final admitted set is 22 values: 11 non-auction + 10 auction + 1
-- 6c3 Path Y skip. Drain-then-drop scope keeps `generation_bumped` in
-- place (still valid for historical rows; new bodies never emit it).
ALTER TABLE public.draft_events
  DROP CONSTRAINT IF EXISTS draft_events_event_type_chk;

ALTER TABLE public.draft_events
  ADD CONSTRAINT draft_events_event_type_chk CHECK (event_type IN (
    -- Snake/linear (chunk 11g.4 step 5+)
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
    'generation_bumped',
    -- Auction (chunks 11g.6 sub-steps 6a + 6b + 6c1)
    'auction_nomination_started',
    'auction_bid_placed',
    'auction_nomination_expired',
    'auction_nomination_closed',
    'auction_bid_extends_timer',
    'auction_auto_nominated',
    'auction_paused',
    'auction_resumed',
    'auction_commissioner_override',
    -- Auction (chunk 11g.6 sub-step 6c3 — Path Y extension)
    'auction_nomination_skipped'
  ));

-- ── A.2: auction_nominations.status CHECK enum (from #13) ──────────────
-- Adds 'cancelled' alongside pre-existing 'active','sold','no_sale'.
ALTER TABLE public.auction_nominations
  DROP CONSTRAINT IF EXISTS auction_nominations_status_check;

ALTER TABLE public.auction_nominations
  ADD CONSTRAINT auction_nominations_status_check
  CHECK (status IN ('active', 'sold', 'no_sale', 'cancelled'));

-- ── A.3: auction_nominations.nomination_event_id column (from #8) ──────
ALTER TABLE public.auction_nominations
  ADD COLUMN IF NOT EXISTS nomination_event_id BIGINT
  REFERENCES public.draft_events(id) ON DELETE SET NULL;

-- ── A.4: idx_draft_events_auction (from #8) ─────────────────────────────
-- Partial index for auction-specific replay during bootstrap. Keeps
-- snake/linear bootstraps fast (no scan of auction events) and
-- enables auction bootstraps to read only the relevant slice.
CREATE INDEX IF NOT EXISTS idx_draft_events_auction
  ON public.draft_events (league_id, seq)
  WHERE event_type LIKE 'auction_%';

-- ── A.5: draft_snapshots table + index + RLS + comments (from #14) ─────
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

-- ── A.6: NOTIFY trigger function + trigger (from #15) ───────────────────
-- CROSS-CHECKED against server/src/draft/eventSubscription.ts:66-92:
--   channel = 'draft_events', payload = {league_id, seq}. Byte-match.
-- ── 1. NOTIFY trigger function ────────────────────────────────────────
--
-- Fires on every `INSERT INTO draft_events` with a minimal JSON payload
-- containing the leagueId + seq. Engine fetches full event details by
-- seq via the existing `listDraftEvents(leagueId, sinceSeq=seq-1)`
-- helper — keeping the NOTIFY payload small (~70 bytes) well below
-- Postgres's 8KB notification payload limit.
--
-- Single global channel `draft_events`; per-engine JS-side filter on
-- the league_id field discards notifications for lobbies this engine
-- doesn't have in memory. Per-league channels (`draft_events_${leagueId}`
-- with dynamic LISTEN/UNLISTEN on lobby load/unload) are deferred to
-- Stage 3 (multi-VM MIG) per chunk 11g.7 sub-step 7e Decision Log;
-- the JS filter cost is ~1ms per no-op which is acceptable at Day 1
-- single-VM scale.

CREATE OR REPLACE FUNCTION public.draft_events_notify_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_notify(
    'draft_events',
    json_build_object(
      'league_id', NEW.league_id,
      'seq',       NEW.seq
    )::text
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.draft_events_notify_trigger() IS
  'Chunk 11g.7 sub-step 7e: emits pg_notify on every draft_events INSERT for cross-process engine subscription. Payload is minimal JSON {league_id, seq}; engine fetches full event details by seq. Commit-coupled by Postgres NOTIFY semantics (delivered at COMMIT, discarded on ROLLBACK).';

-- ── 2. AFTER INSERT trigger on draft_events ──────────────────────────
--
-- AFTER INSERT (not BEFORE) so the trigger sees the row as it was
-- actually inserted (defense against any future BEFORE INSERT triggers
-- that mutate NEW). FOR EACH ROW so every event fires its own NOTIFY
-- (auction RPCs that emit one event per call, lifecycle RPCs that emit
-- two events per call — generation_bumped + lifecycle event — both fire
-- two NOTIFY's, which is correct: the engine applies both).

DROP TRIGGER IF EXISTS draft_events_notify_after_insert ON public.draft_events;

CREATE TRIGGER draft_events_notify_after_insert
AFTER INSERT ON public.draft_events
FOR EACH ROW
EXECUTE FUNCTION public.draft_events_notify_trigger();

COMMENT ON TRIGGER draft_events_notify_after_insert ON public.draft_events IS
  'Chunk 11g.7 sub-step 7e: fires pg_notify on draft_events INSERT. See draft_events_notify_trigger() and 20260511000000_draft_events_notify.sql for rationale.';


-- ═══════════════════════════════════════════════════════════════════════
-- PHASE B — Terminal RPC bodies
-- ═══════════════════════════════════════════════════════════════════════
--
-- Each RPC lands at its TERMINAL version across the original chain:
--   compute_min_next_bid          — from #11
--   nominate_player_v2            — from #10 (superseded #8)
--   place_bid_v2                  — from #11 (superseded #8, #9, #10)
--   close_nomination_v2           — from #8  (never iterated)
--   auction_pause_v2              — from #10
--   auction_resume_v2             — from #10
--   auction_nomination_skip_v2    — from #12
--   auction_commissioner_override_v2 — from #13
--   submit_pick_v2                — from #17 (clean body; no pgmq.send)
--   draft_pause                   — from #17 (clean body)
--   draft_resume                  — from #17 (clean body)
--   draft_extend                  — from #17 (clean body)
--
-- All CREATE OR REPLACE FUNCTION; safe idempotent replace. The
-- DROP FUNCTION IF EXISTS statements from the original iteration
-- chain are included so re-executing on a partial-application state
-- (or a fresh DB) both work identically.

-- ── B.1: compute_min_next_bid (STABLE helper, from #11) ────────────────
CREATE OR REPLACE FUNCTION public.compute_min_next_bid(
  p_leading_bid numeric,
  p_tier_table  jsonb
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_tier            jsonb;
  v_below           numeric;
  v_increment       numeric;
  v_last_increment  numeric;
BEGIN
  IF p_tier_table IS NULL OR jsonb_array_length(p_tier_table) = 0 THEN
    RAISE EXCEPTION 'invalid_tier_table: empty or null tier table'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Walk the tier table in declared order. First tier whose `below`
  -- (strictly) exceeds the leading bid wins. Track the last tier's
  -- increment for the Path A fallback.
  FOR v_tier IN SELECT * FROM jsonb_array_elements(p_tier_table)
  LOOP
    v_below     := (v_tier ->> 'below')::numeric;
    v_increment := (v_tier ->> 'increment')::numeric;

    IF v_increment <= 0 THEN
      RAISE EXCEPTION 'invalid_tier_table: tier increment must be positive (got %)',
        v_increment
        USING ERRCODE = 'check_violation';
    END IF;

    v_last_increment := v_increment;

    IF p_leading_bid < v_below THEN
      RETURN p_leading_bid + v_increment;
    END IF;
  END LOOP;

  -- Path A gracious fallback: leading bid exceeds all `below`
  -- ceilings. Use the last tier's increment so absurd-but-legal
  -- bids (e.g., $1000 in a league with `below: 999` ceiling) still
  -- get a deterministic minimum.
  RETURN p_leading_bid + v_last_increment;
END;
$$;

COMMENT ON FUNCTION public.compute_min_next_bid(numeric, jsonb) IS
  'ADR-002 §4.3 / chunk 11g.6 sub-step 6c2: deterministic tier-based minimum-next-bid computation. STABLE. Strict-less-than boundary; Path A gracious fallback uses the last tier''s increment when leading bid exceeds all `below` ceilings.';

GRANT EXECUTE ON FUNCTION public.compute_min_next_bid(numeric, jsonb) TO service_role;


-- ── B.2: nominate_player_v2 (terminal from #10) ─────────────────────────
CREATE OR REPLACE FUNCTION public.nominate_player_v2(
  p_league_id        uuid,
  p_team_id          uuid,
  p_player_id        text,
  p_player_name      text,
  p_opening_bid      numeric,
  p_session_id       uuid,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_actor            jsonb,
  p_correlation_id   uuid,
  p_clock_seconds    int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id        bigint;
  v_existing_seq       bigint;
  v_existing_hash      text;
  v_actor_kind         text;
  v_caller_role        text;
  v_draft_state        text;
  v_active_count       int;
  v_clock_deadline     timestamptz;
  v_correlation_id     uuid;
  v_payload            jsonb;
  v_new_seq            bigint;
  v_event_id           bigint;
  v_nomination_id      uuid;
  v_nomination_number  int;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: nominate_player_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('user', 'autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by nominate_player_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Chunk 11g.6 sub-step 6c1: defense-in-depth rejection of
  -- nominations during paused state. Engine ALSO checks; the RPC
  -- gate protects against direct callers (admin tools, manual
  -- psql, future code paths).
  SELECT draft_state INTO v_draft_state
    FROM public.leagues
   WHERE id = p_league_id;

  IF v_draft_state = 'paused' THEN
    RAISE EXCEPTION 'illegal_state: cannot nominate while auction is paused (league %)',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reject if there's already an active nomination (UNIQUE
  -- constraint at the DB layer + state-machine check here).
  SELECT count(*) INTO v_active_count
    FROM public.auction_nominations
   WHERE league_id = p_league_id
     AND status = 'active';

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'illegal_state: nomination already active in league %',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Compute clock deadline. RPC adds +1s pad to align with
  -- `submit_pick_v2` precedent (engine-side timer fires AFTER
  -- the user-visible countdown reaches zero).
  v_clock_deadline := date_trunc('second', now())
                    + make_interval(secs => p_clock_seconds)
                    + interval '1 second';

  -- Compute the next nomination_number (1-indexed monotonic).
  SELECT COALESCE(MAX(nomination_number), 0) + 1
    INTO v_nomination_number
    FROM public.auction_nominations
   WHERE league_id = p_league_id;

  -- Atomic 5-write block (unchanged from 6a).
  --   BEGIN (implicit)

  --     INSERT auction_nominations (the active nomination row)
  -- The draft_session_id is not used for the engine flow but the
  -- v1 schema requires it; copy the league_id as a placeholder
  -- (matching the 6a behavior). nominated_by_team_id, minimum_bid,
  -- current_high_bid all flow from the parameters.
  INSERT INTO public.auction_nominations (
    league_id, draft_session_id, nominated_by_team_id,
    player_id, player_name, minimum_bid, current_high_bid,
    current_high_bidder_team_id, status, nomination_number,
    expires_at
  )
  VALUES (
    p_league_id, p_league_id, p_team_id,
    p_player_id, p_player_name, p_opening_bid, p_opening_bid,
    p_team_id, 'active', v_nomination_number,
    v_clock_deadline
  )
  RETURNING id INTO v_nomination_id;

  --     INSERT auction_bids (the initial opening bid)
  INSERT INTO public.auction_bids (
    league_id, nomination_id, team_id, bid_amount
  )
  VALUES (
    p_league_id, v_nomination_id, p_team_id, p_opening_bid
  );

  --     INSERT draft_events (auction_nomination_started)
  v_payload := jsonb_build_object(
    'nomination_id',     v_nomination_id,
    'player_id',         p_player_id,
    'player_name',       p_player_name,
    'opening_bid',       p_opening_bid,
    'nominator_team_id', p_team_id,
    'expires_at',        v_clock_deadline,
    'session_id',        p_session_id
  );

  --     UPDATE leagues (advance event counter; row lock serializes writers)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_nomination_started', v_payload,
    p_payload_hash, p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  --     UPDATE auction_nominations (back-link the event id)
  UPDATE public.auction_nominations
     SET nomination_event_id = v_event_id
   WHERE id = v_nomination_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',        v_event_id,
    'seq',             v_new_seq,
    'nomination_id',   v_nomination_id,
    'clock_deadline',  v_clock_deadline,
    'was_duplicate',   false
  );
END;
$$;

COMMENT ON FUNCTION public.nominate_player_v2(uuid,uuid,text,text,numeric,uuid,uuid,text,jsonb,uuid,int) IS
  'ADR-002 §3 / ADR-004 §5 / chunk 11g.6 sub-step 6a + 6c1: auction nomination. Atomic 5-write block (auction_nominations + auction_bids + draft_events + leagues counter + back-link). 6c1 added draft_state=paused rejection gate (defense-in-depth). Trusted-executor: requires service_role caller; engine validates user identity + team authorization + budget reserve before calling.';

GRANT EXECUTE ON FUNCTION public.nominate_player_v2(uuid,uuid,text,text,numeric,uuid,uuid,text,jsonb,uuid,int) TO service_role;


-- ── B.3: place_bid_v2 (terminal from #11 — tiered increments) ──────────
-- The RPC layer protects future code paths that bypass the engine.

DROP FUNCTION IF EXISTS public.place_bid_v2(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,uuid,int,int);

CREATE OR REPLACE FUNCTION public.place_bid_v2(
  p_league_id                       uuid,
  p_team_id                         uuid,
  p_nomination_id                   uuid,
  p_bid_amount                      numeric,
  p_session_id                      uuid,
  p_idempotency_key                 uuid,
  p_payload_hash                    text,
  p_actor                           jsonb,
  p_correlation_id                  uuid,
  p_anti_snipe_threshold_seconds    int,
  p_anti_snipe_extension_seconds    int,
  p_min_bid_increment_tiers         jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id              bigint;
  v_existing_seq             bigint;
  v_existing_hash            text;
  v_actor_kind               text;
  v_caller_role              text;
  v_draft_state              text;
  v_nom_status               text;
  v_current_high_bid         numeric;
  v_nom_expires_at           timestamptz;
  v_min_next_bid             numeric;
  v_payload                  jsonb;
  v_new_seq                  bigint;
  v_event_id                 bigint;
  v_correlation_id           uuid;
  v_seconds_remaining        numeric;
  v_was_extended             boolean := false;
  v_new_expires_at           timestamptz;
  v_extends_idempotency_key  uuid;
  v_extends_seq              bigint;
  v_extends_event_id         bigint;
  v_extends_payload          jsonb;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: place_bid_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('user', 'autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by place_bid_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Chunk 11g.6 sub-step 6c1: defense-in-depth pause gate.
  SELECT draft_state INTO v_draft_state
    FROM public.leagues
   WHERE id = p_league_id;

  IF v_draft_state = 'paused' THEN
    RAISE EXCEPTION 'illegal_state: cannot bid while auction is paused (league %)',
      p_league_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status, current_high_bid, expires_at
    INTO v_nom_status, v_current_high_bid, v_nom_expires_at
    FROM public.auction_nominations
   WHERE id = p_nomination_id AND league_id = p_league_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: nomination % not found in league %',
      p_nomination_id, p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_nom_status <> 'active' THEN
    RAISE EXCEPTION 'illegal_state: nomination % is % (expected active)',
      p_nomination_id, v_nom_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_bid_amount <= v_current_high_bid THEN
    RAISE EXCEPTION 'bid_too_low: bid % must be greater than current_high_bid %',
      p_bid_amount, v_current_high_bid
      USING ERRCODE = 'check_violation';
  END IF;

  -- Chunk 11g.6 sub-step 6c2: tiered-increment validation (defense-
  -- in-depth alongside engine fail-fast in
  -- LobbyManager.processPlaceBid). Per ADR-002 §4.3, the tier of
  -- the LEADING bid determines the increment for the next bid.
  v_min_next_bid := public.compute_min_next_bid(
    v_current_high_bid, p_min_bid_increment_tiers
  );

  IF p_bid_amount < v_min_next_bid THEN
    RAISE EXCEPTION 'bid_increment_violation: bid % below tier minimum % (current_high_bid %)',
      p_bid_amount, v_min_next_bid, v_current_high_bid
      USING ERRCODE = 'check_violation';
  END IF;

  --   BEGIN (implicit)

  INSERT INTO public.auction_bids (
    league_id, nomination_id, team_id, bid_amount
  )
  VALUES (
    p_league_id, p_nomination_id, p_team_id, p_bid_amount
  );

  UPDATE public.auction_nominations
     SET current_high_bid = p_bid_amount,
         current_high_bidder_team_id = p_team_id
   WHERE id = p_nomination_id;

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  -- Anti-snipe threshold check (chunk 11g.6 sub-step 6b — unchanged).
  v_seconds_remaining := EXTRACT(EPOCH FROM (v_nom_expires_at - now()));

  IF p_anti_snipe_threshold_seconds > 0
     AND v_seconds_remaining < p_anti_snipe_threshold_seconds
  THEN
    v_was_extended   := true;
    v_new_expires_at := now() + (p_anti_snipe_extension_seconds * interval '1 second');

    UPDATE public.auction_nominations
       SET expires_at = v_new_expires_at
     WHERE id = p_nomination_id;
  ELSE
    v_new_expires_at := v_nom_expires_at;
  END IF;

  v_payload := jsonb_build_object(
    'nomination_id',  p_nomination_id,
    'team_id',        p_team_id,
    'bid_amount',     p_bid_amount,
    'clock_deadline', v_new_expires_at,
    'session_id',     p_session_id
  );

  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_bid_placed', v_payload,
    p_payload_hash, p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  IF v_was_extended THEN
    v_extends_idempotency_key :=
      md5('extends:' || p_idempotency_key::text)::uuid;

    v_extends_payload := jsonb_build_object(
      'nomination_id',         p_nomination_id,
      'prior_expires_at',      v_nom_expires_at,
      'new_expires_at',        v_new_expires_at,
      'triggering_bid_id',     v_event_id,
      'triggering_team_id',    p_team_id,
      'triggering_bid_amount', p_bid_amount
    );

    UPDATE public.leagues
       SET draft_event_counter = draft_event_counter + 1
     WHERE id = p_league_id
    RETURNING draft_event_counter INTO v_extends_seq;

    INSERT INTO public.draft_events (
      league_id, seq, event_type, payload, payload_hash,
      idempotency_key, actor, correlation_id
    )
    VALUES (
      p_league_id, v_extends_seq, 'auction_bid_extends_timer',
      v_extends_payload, p_payload_hash,
      v_extends_idempotency_key, p_actor, v_correlation_id
    )
    RETURNING id INTO v_extends_event_id;
  END IF;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',         v_event_id,
    'seq',              v_new_seq,
    'clock_deadline',   v_new_expires_at,
    'was_duplicate',    false,
    'was_extended',     v_was_extended,
    'extends_event_seq', v_extends_seq
  );
END;
$$;

COMMENT ON FUNCTION public.place_bid_v2(
  uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, uuid, int, int, jsonb
) IS
  'ADR-002 §3.3 / §4.3 / §4.4 / chunk 11g.6 sub-step 6a + 6b + 6c1 + 6c2: auction bid with tiered-increment validation, anti-snipe timer extension, and pause gate. Atomic 5-or-8-write block. Strict-greater bid check + tier-based minimum-next-bid check (via compute_min_next_bid) + strict-less-than anti-snipe threshold + draft_state=paused rejection. Trusted-executor: requires service_role caller; engine validates budget reserve + reads anti-snipe + tier config from leagues.settings before calling.';


-- ── B.4: close_nomination_v2 (from #8, never iterated) ──────────────────
CREATE OR REPLACE FUNCTION public.close_nomination_v2(
  p_league_id        uuid,
  p_nomination_id    uuid,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_actor            jsonb,
  p_correlation_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id        bigint;
  v_existing_seq       bigint;
  v_existing_hash      text;
  v_actor_kind         text;
  v_caller_role        text;
  v_nom_status         text;
  v_winner_team_id     uuid;
  v_final_bid          numeric;
  v_player_id          text;
  v_player_name        text;
  v_total_bids         int;
  v_payload            jsonb;
  v_event_type         text;
  v_new_seq            bigint;
  v_event_id           bigint;
  v_correlation_id     uuid;
  v_no_sale            boolean;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- Step 2: Auth — close_nomination is engine-only (timer fire).
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: close_nomination_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by close_nomination_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Step 3: Load + lock the nomination row.
  SELECT status, current_high_bidder_team_id, current_high_bid,
         player_id, player_name
    INTO v_nom_status, v_winner_team_id, v_final_bid,
         v_player_id, v_player_name
    FROM public.auction_nominations
   WHERE id = p_nomination_id AND league_id = p_league_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: nomination % not found in league %',
      p_nomination_id, p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_nom_status <> 'active' THEN
    RAISE EXCEPTION 'illegal_state: nomination % is % (expected active)',
      p_nomination_id, v_nom_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- "No sale": only one bid (the nominator's opening), no follow-ups.
  -- Treat as auction_nomination_expired with the nominator forfeiting
  -- their turn (no player awarded, no budget decrement). For 6a
  -- simplicity, "no sale" is determined by total_bids = 1.
  SELECT count(*) INTO v_total_bids
    FROM public.auction_bids
   WHERE nomination_id = p_nomination_id;

  v_no_sale := v_total_bids = 1;

  -- Step 4: Atomic write block.
  --   BEGIN (implicit)

  IF v_no_sale THEN
    --     UPDATE auction_nominations.status = 'no_sale'
    UPDATE public.auction_nominations
       SET status = 'no_sale'
     WHERE id = p_nomination_id;

    -- No budget decrement, no draft_picks insert. Just emit the
    -- expired event so the engine advances state.
    v_event_type := 'auction_nomination_expired';
    v_payload := jsonb_build_object(
      'nomination_id', p_nomination_id,
      'reason',        'no_bids'
    );
  ELSE
    --     UPDATE auction_nominations.status = 'sold'
    UPDATE public.auction_nominations
       SET status = 'sold'
     WHERE id = p_nomination_id;

    --     UPDATE auction_budgets (decrement remaining + increment players_won)
    UPDATE public.auction_budgets
       SET remaining_budget = remaining_budget - v_final_bid,
           players_won      = players_won + 1,
           updated_at       = now()
     WHERE league_id = p_league_id AND team_id = v_winner_team_id;

    --     INSERT draft_picks (final ownership ledger)
    INSERT INTO public.draft_picks (
      league_id, round_number, pick_number, team_id,
      player_id, picked_at
    )
    VALUES (
      p_league_id,
      -- For auction, round_number / pick_number are nominally tracked
      -- via the nomination_number; using 1 / nomination_number for
      -- compatibility with the existing draft_picks shape. UI
      -- rendering treats auction picks as flat (no rounds).
      1,
      (SELECT nomination_number FROM public.auction_nominations
        WHERE id = p_nomination_id),
      v_winner_team_id,
      v_player_id,
      now()
    );

    v_event_type := 'auction_nomination_closed';
    v_payload := jsonb_build_object(
      'nomination_id',    p_nomination_id,
      'winning_team_id',  v_winner_team_id,
      'final_amount',     v_final_bid,
      'total_bids',       v_total_bids,
      'player_id',        v_player_id,
      'player_name',      v_player_name
    );
  END IF;

  --     INSERT draft_events
  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  --     UPDATE leagues (counter advance)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, v_event_type, v_payload,
    p_payload_hash, p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'event_type',    v_event_type,
    'no_sale',       v_no_sale,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.close_nomination_v2(uuid,uuid,uuid,text,jsonb,uuid) IS
  'ADR-002 §3 / chunk 11g.6 sub-step 6a: auction nomination close (engine timer fire). Atomic 5-write block (auction_nominations + auction_budgets + draft_picks + draft_events + leagues counter). No-sale variant skips budget decrement + draft_picks insert. Trusted-executor: requires service_role caller; actor.kind must be autopick (engine) or commissioner.';

-- ── 4. Grants ──────────────────────────────────────────────────────
-- Engine calls these via DraftServiceV2's admin client (service_role).

-- ── B.5: auction_pause_v2 (from #10) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auction_pause_v2(
  p_league_id        uuid,
  p_actor            jsonb,
  p_reason           text,
  p_idempotency_key  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id          bigint;
  v_existing_seq         bigint;
  v_commissioner         uuid;
  v_state                text;
  v_caller_role          text;
  v_actor_kind           text;
  v_active_nom_id        uuid;
  v_active_expires_at    timestamptz;
  v_remaining_seconds    int;
  v_paused_at            timestamptz;
  v_payload              jsonb;
  v_payload_hash         text;
  v_new_seq              bigint;
  v_event_id             bigint;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq
    INTO v_existing_id, v_existing_seq
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'event_id',      v_existing_id,
      'seq',           v_existing_seq,
      'was_duplicate', true
    );
  END IF;

  -- Step 2: Auth.
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: auction_pause_v2 requires actor.kind=commissioner (got %)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state
    INTO v_commissioner, v_state
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- State-machine guard: pause is only legal from 'active' (matches
  -- snake/linear `draft_pause` precedent at migration line 1010-1013).
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot pause auction from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 3: Lock + read the active nomination row, if any. The
  -- FOR UPDATE here serializes against any concurrent
  -- place_bid_v2 / close_nomination_v2 on the same nomination —
  -- the pause atomically captures the deadline at the moment of
  -- the lock acquisition.
  SELECT id, expires_at
    INTO v_active_nom_id, v_active_expires_at
    FROM public.auction_nominations
   WHERE league_id = p_league_id
     AND status = 'active'
   ORDER BY id DESC
   LIMIT 1
   FOR UPDATE;

  -- Compute captured_remaining_seconds (ceil to give the resumer a
  -- generous floor; matches snake/linear `draft_pause` line 1025-1028
  -- precedent). NULL when no active nomination.
  IF v_active_nom_id IS NOT NULL THEN
    v_remaining_seconds := GREATEST(
      0,
      ceil(EXTRACT(EPOCH FROM (v_active_expires_at - now())))::int
    );
  END IF;

  v_paused_at := now();

  -- Step 4: Atomic write block.
  --   BEGIN (implicit)

  --     UPDATE leagues.draft_state -> 'paused'
  UPDATE public.leagues
     SET draft_state = 'paused'
   WHERE id = p_league_id;

  --     UPDATE leagues counter (counter advance for the event)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  --     INSERT draft_events (auction_paused)
  -- Payload carries paused_nomination_id + captured_remaining_seconds
  -- when there's an active nomination; both NULL when paused
  -- between nominations.
  v_payload := jsonb_build_object(
    'commissioner_user_id', auth.uid(),
    'reason',               p_reason,
    'paused_at',            v_paused_at,
    'paused_nomination_id', v_active_nom_id,
    'captured_remaining_seconds', v_remaining_seconds
  );
  v_payload_hash := 'sha256:server-generated';

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_paused', v_payload,
    v_payload_hash, p_idempotency_key, p_actor, NULL
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',                   v_event_id,
    'seq',                        v_new_seq,
    'paused_at',                  v_paused_at,
    'paused_nomination_id',       v_active_nom_id,
    'captured_remaining_seconds', v_remaining_seconds,
    'was_duplicate',              false
  );
END;
$$;

COMMENT ON FUNCTION public.auction_pause_v2(uuid, jsonb, text, uuid) IS
  'ADR-002 §4.4 / chunk 11g.6 sub-step 6c1: auction pause. Atomic 4-write block (auction_nominations row-lock + leagues.draft_state + leagues counter + draft_events). Captures remaining_seconds in event payload for resume-restore. Trusted-executor: requires service_role caller AND actor.kind=commissioner AND auth.uid() matches league commissioner.';

GRANT EXECUTE ON FUNCTION public.auction_pause_v2(uuid, jsonb, text, uuid) TO service_role;


-- ── B.6: auction_resume_v2 (from #10) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.auction_resume_v2(
  p_league_id        uuid,
  p_actor            jsonb,
  p_idempotency_key  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id              bigint;
  v_existing_seq             bigint;
  v_commissioner             uuid;
  v_state                    text;
  v_caller_role              text;
  v_actor_kind               text;
  v_prior_pause_event_id     bigint;
  v_prior_pause_payload      jsonb;
  v_paused_nom_id            uuid;
  v_captured_remaining       int;
  v_resumed_at               timestamptz;
  v_new_expires_at           timestamptz;
  v_payload                  jsonb;
  v_payload_hash             text;
  v_new_seq                  bigint;
  v_event_id                 bigint;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq
    INTO v_existing_id, v_existing_seq
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'event_id',      v_existing_id,
      'seq',           v_existing_seq,
      'was_duplicate', true
    );
  END IF;

  -- Step 2: Auth (same model as auction_pause_v2).
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: auction_resume_v2 requires actor.kind=commissioner (got %)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state
    INTO v_commissioner, v_state
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- State-machine guard: resume is only legal from 'paused'.
  IF v_state <> 'paused' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot resume auction from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 3: Locate + LOCK the most recent prior auction_paused
  -- event for this league. The FOR UPDATE here is the world-class
  -- race-protection: locks the source-of-truth pause-event row so
  -- a simultaneous concurrent resume call blocks until this
  -- transaction completes (and then sees draft_state='active' and
  -- fails the state-machine guard above).
  --
  -- Locks the prior pause event row to prevent concurrent resume
  -- calls from both reading and writing — atomic under contention.
  SELECT id, payload
    INTO v_prior_pause_event_id, v_prior_pause_payload
    FROM public.draft_events
   WHERE league_id = p_league_id
     AND event_type = 'auction_paused'
   ORDER BY seq DESC
   LIMIT 1
   FOR UPDATE;

  IF v_prior_pause_event_id IS NULL THEN
    -- Should be unreachable: draft_state='paused' implies a prior
    -- pause event. Defensive raise.
    RAISE EXCEPTION 'illegal_state: draft_state=paused but no prior auction_paused event found for league %',
      p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_paused_nom_id      := (v_prior_pause_payload ->> 'paused_nomination_id')::uuid;
  v_captured_remaining := (v_prior_pause_payload ->> 'captured_remaining_seconds')::int;

  v_resumed_at := now();

  -- Step 4: Atomic write block.
  --   BEGIN (implicit)

  --     UPDATE auction_nominations.expires_at — only when there
  --     was an active nomination at pause time. ADR-002 §4.4:
  --     resume restores the captured remaining time, NOT a fresh
  --     full window. Divergent from snake/linear `draft_resume`.
  IF v_paused_nom_id IS NOT NULL AND v_captured_remaining IS NOT NULL THEN
    v_new_expires_at := v_resumed_at + (v_captured_remaining * interval '1 second');
    UPDATE public.auction_nominations
       SET expires_at = v_new_expires_at
     WHERE id = v_paused_nom_id;
  END IF;

  --     UPDATE leagues.draft_state -> 'active'
  UPDATE public.leagues
     SET draft_state = 'active'
   WHERE id = p_league_id;

  --     UPDATE leagues counter (counter advance for the event)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  --     INSERT draft_events (auction_resumed)
  v_payload := jsonb_build_object(
    'commissioner_user_id',  auth.uid(),
    'resumed_at',            v_resumed_at,
    'prior_pause_event_id',  v_prior_pause_event_id,
    'restored_nomination_id', v_paused_nom_id,
    'new_expires_at',        v_new_expires_at
  );
  v_payload_hash := 'sha256:server-generated';

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_resumed', v_payload,
    v_payload_hash, p_idempotency_key, p_actor, NULL
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',               v_event_id,
    'seq',                    v_new_seq,
    'resumed_at',             v_resumed_at,
    'prior_pause_event_id',   v_prior_pause_event_id,
    'restored_nomination_id', v_paused_nom_id,
    'new_expires_at',         v_new_expires_at,
    'was_duplicate',          false
  );
END;
$$;

COMMENT ON FUNCTION public.auction_resume_v2(uuid, jsonb, uuid) IS
  'ADR-002 §4.4 / chunk 11g.6 sub-step 6c1: auction resume. Atomic 4-or-5-write block (prior pause-event row-lock + optional auction_nominations.expires_at + leagues.draft_state + leagues counter + draft_events). Restores captured remaining_seconds (NOT fresh full window — divergent from snake/linear). Race-safe via SELECT FOR UPDATE on the prior pause-event row. Trusted-executor: same auth model as auction_pause_v2.';

GRANT EXECUTE ON FUNCTION public.auction_resume_v2(uuid, jsonb, uuid) TO service_role;


-- ── B.7: auction_nomination_skip_v2 (from #12) ──────────────────────────
CREATE OR REPLACE FUNCTION public.auction_nomination_skip_v2(
  p_league_id        uuid,
  p_team_id          uuid,
  p_actor            jsonb,
  p_reason           text,
  p_idempotency_key  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id      bigint;
  v_existing_seq     bigint;
  v_actor_kind       text;
  v_caller_role      text;
  v_payload          jsonb;
  v_new_seq          bigint;
  v_event_id         bigint;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_reason NOT IN ('insufficient_budget', 'no_eligible_players') THEN
    RAISE EXCEPTION 'invalid_event_payload: p_reason must be one of (insufficient_budget, no_eligible_players); got %',
      p_reason
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq
    INTO v_existing_id, v_existing_seq
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'event_id',      v_existing_id,
      'seq',           v_existing_seq,
      'was_duplicate', true
    );
  END IF;

  -- Step 2: Auth.
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: auction_nomination_skip_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor_kind NOT IN ('autopick', 'commissioner') THEN
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by auction_nomination_skip_v2 (engine fires autopick; commissioner override path lands in 6c4)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Step 3: Atomic write block.
  --   BEGIN (implicit)

  v_payload := jsonb_build_object(
    'skipped_team_id', p_team_id,
    'reason',          p_reason
  );

  --     UPDATE leagues (counter advance for seq)
  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  --     INSERT draft_events (auction_nomination_skipped)
  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_nomination_skipped', v_payload,
    'sha256:server-generated', p_idempotency_key, p_actor, NULL
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'skipped_team_id', p_team_id,
    'reason',        p_reason,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.auction_nomination_skip_v2(uuid, uuid, jsonb, text, uuid) IS
  'ADR-002 §4.2 + Path Y extension / chunk 11g.6 sub-step 6c3: auction nomination skip. Atomic 2-write block (leagues counter + draft_events). Reason discriminator: insufficient_budget triggers cascade-to-next-nominator; no_eligible_players paired with auction_paused per ADR-002 §4.4 spec. Trusted-executor: requires service_role caller AND actor.kind in (autopick, commissioner).';

GRANT EXECUTE ON FUNCTION public.auction_nomination_skip_v2(uuid, uuid, jsonb, text, uuid) TO service_role;

-- ── B.8: auction_commissioner_override_v2 (from #13) ───────────────────
CREATE OR REPLACE FUNCTION public.auction_commissioner_override_v2(
  p_league_id        uuid,
  p_actor            jsonb,
  p_override_action  text,
  p_action_payload   jsonb,
  p_idempotency_key  uuid,
  p_rationale        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id        bigint;
  v_existing_seq       bigint;
  v_actor_kind         text;
  v_caller_role        text;
  v_commissioner       uuid;
  v_actor_user_id      uuid;
  v_payload            jsonb;
  v_prior_state        jsonb;
  v_new_state          jsonb;
  v_new_seq            bigint;
  v_event_id           bigint;
  -- Action-specific locals
  v_nomination_id      uuid;
  v_nom_status         text;
  v_current_high_bid   numeric;
  v_current_bidder     uuid;
  v_nom_expires_at     timestamptz;
  v_nom_player_id      text;
  v_nom_player_name    text;
  v_nom_minimum_bid    numeric;
  v_nom_number         int;
  v_bid_count          int;
  v_prior_bid_amount   numeric;
  v_prior_bidder       uuid;
  v_target_team_id     uuid;
  v_target_amount      numeric;
  v_target_budget      numeric;
  v_target_won         int;
  v_delta              numeric;
  v_new_budget         numeric;
  v_extension_seconds  int;
  v_new_expires_at     timestamptz;
  v_new_floor          numeric;
  v_total_bids         int;
  v_settings           jsonb;
  v_min_bid_setting    numeric;
  v_roster_size        int;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Idempotency.
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq
    INTO v_existing_id, v_existing_seq
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'event_id',      v_existing_id,
      'seq',           v_existing_seq,
      'was_duplicate', true
    );
  END IF;

  -- Step 2: Auth (per ADR-004 §5 + ADR-002 §4.4).
  v_actor_kind  := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: auction_commissioner_override_v2 requires actor.kind=commissioner (got %)',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: auction_commissioner_override_v2 requires service_role (got %)',
      v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, settings INTO v_commissioner, v_settings
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_actor_user_id := NULLIF(p_actor ->> 'id', '')::uuid;
  -- Skip auth.uid() comparison for service_role (engine path); engine
  -- has independently verified `auth.uid() = leagues.commissioner_id`
  -- via verifyCommissionerAuthorization before calling.

  v_min_bid_setting := COALESCE((v_settings ->> 'auctionMinBid')::numeric, 1);
  v_roster_size := COALESCE(
    (v_settings ->> 'rosterSize')::int,
    (v_settings ->> 'draftRounds')::int,
    0
  );

  -- Step 3: Action dispatcher. Each branch is structurally distinct
  -- and atomic. Common-prefix code (idempotency + auth) ran above;
  -- common-suffix code (counter advance + draft_events INSERT)
  -- runs below the dispatcher. The dispatcher itself only writes
  -- to action-specific projection tables.

  IF p_override_action = 'revert_bid' THEN
    -- ── revert_bid ────────────────────────────────────────────────
    -- Reverts the most-recent bid; requires bid_count > 1 (the only
    -- bid, the nominator's opening, is reverted via cancel_nomination
    -- which has different semantics).

    SELECT id, status, current_high_bid, current_high_bidder_team_id, expires_at
      INTO v_nomination_id, v_nom_status, v_current_high_bid, v_current_bidder, v_nom_expires_at
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to revert in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_bid_count
      FROM public.auction_bids
     WHERE nomination_id = v_nomination_id;

    IF v_bid_count <= 1 THEN
      RAISE EXCEPTION 'no_bids_to_revert: nomination % has only the opening bid; use cancel_nomination instead',
        v_nomination_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Read the second-most-recent bid (the one we revert TO).
    SELECT team_id, bid_amount
      INTO v_prior_bidder, v_prior_bid_amount
      FROM public.auction_bids
     WHERE nomination_id = v_nomination_id
     ORDER BY id DESC
     OFFSET 1
     LIMIT 1;

    -- priorState captures what we're reverting AWAY from; newState
    -- captures the post-revert leader.
    v_prior_state := jsonb_build_object(
      'nominationId',         v_nomination_id,
      'leadingBidderId',      v_current_bidder,
      'leadingBid',           v_current_high_bid
    );
    v_new_state := jsonb_build_object(
      'nominationId',         v_nomination_id,
      'leadingBidderId',      v_prior_bidder,
      'leadingBid',           v_prior_bid_amount
    );

    UPDATE public.auction_nominations
       SET current_high_bid = v_prior_bid_amount,
           current_high_bidder_team_id = v_prior_bidder
     WHERE id = v_nomination_id;

  ELSIF p_override_action = 'force_close_nomination' THEN
    -- ── force_close_nomination ────────────────────────────────────
    -- Ends bid window early. Awards to current leader if
    -- bid_count > 1; treats as no-sale if only opening bid (mirrors
    -- 6a's natural-close no_sale branch).

    SELECT id, status, current_high_bid, current_high_bidder_team_id,
           expires_at, player_id, player_name, nomination_number
      INTO v_nomination_id, v_nom_status, v_current_high_bid, v_current_bidder,
           v_nom_expires_at, v_nom_player_id, v_nom_player_name, v_nom_number
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to force-close in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_bid_count
      FROM public.auction_bids
     WHERE nomination_id = v_nomination_id;

    v_prior_state := jsonb_build_object(
      'nominationId',         v_nomination_id,
      'currentClockDeadline', v_nom_expires_at,
      'leadingBidderId',      v_current_bidder,
      'leadingBid',           v_current_high_bid,
      'totalBids',            v_bid_count
    );

    IF v_bid_count <= 1 THEN
      -- No-sale outcome (only the nominator's opening bid).
      UPDATE public.auction_nominations
         SET status = 'no_sale'
       WHERE id = v_nomination_id;

      v_new_state := jsonb_build_object(
        'nominationId', v_nomination_id,
        'outcome',      'no_sale'
      );
    ELSE
      -- Sold outcome — mirrors 6a's natural-close sold branch.
      UPDATE public.auction_nominations
         SET status = 'sold'
       WHERE id = v_nomination_id;

      UPDATE public.auction_budgets
         SET remaining_budget = remaining_budget - v_current_high_bid,
             players_won      = players_won + 1,
             updated_at       = now()
       WHERE league_id = p_league_id AND team_id = v_current_bidder;

      INSERT INTO public.draft_picks (
        league_id, round_number, pick_number, team_id, player_id, picked_at
      )
      VALUES (
        p_league_id, 1, v_nom_number, v_current_bidder, v_nom_player_id, now()
      );

      v_new_state := jsonb_build_object(
        'nominationId',  v_nomination_id,
        'outcome',       'sold',
        'winnerTeamId',  v_current_bidder,
        'finalAmount',   v_current_high_bid,
        'totalBids',     v_bid_count
      );
    END IF;

  ELSIF p_override_action = 'award_to_team' THEN
    -- ── award_to_team ─────────────────────────────────────────────
    -- Force-awards the active nomination to a specified team at a
    -- specified amount, regardless of leading bidder. Validates
    -- target team has sufficient budget.

    v_target_team_id := (p_action_payload ->> 'teamId')::uuid;
    v_target_amount := (p_action_payload ->> 'amount')::numeric;

    IF v_target_team_id IS NULL OR v_target_amount IS NULL OR v_target_amount <= 0 THEN
      RAISE EXCEPTION 'invalid_event_payload: award_to_team requires teamId and positive amount'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, status, current_high_bid, current_high_bidder_team_id,
           player_id, player_name, nomination_number
      INTO v_nomination_id, v_nom_status, v_current_high_bid, v_current_bidder,
           v_nom_player_id, v_nom_player_name, v_nom_number
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to award in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT remaining_budget, players_won
      INTO v_target_budget, v_target_won
      FROM public.auction_budgets
     WHERE league_id = p_league_id AND team_id = v_target_team_id
     FOR UPDATE;

    IF v_target_budget IS NULL THEN
      RAISE EXCEPTION 'illegal_state: team % has no auction_budgets row in league %',
        v_target_team_id, p_league_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- Reserve check: target needs (slotsRemaining - 1) * minBid
    -- after this award. Same formula as v1 AuctionService and 6a's
    -- engine-side reserve calculation.
    IF v_target_amount + GREATEST(0, (v_roster_size - v_target_won - 1)) * v_min_bid_setting > v_target_budget THEN
      RAISE EXCEPTION 'insufficient_budget_for_award: team % budget % cannot cover award amount % + reserve',
        v_target_team_id, v_target_budget, v_target_amount
        USING ERRCODE = 'check_violation';
    END IF;

    v_prior_state := jsonb_build_object(
      'nominationId',     v_nomination_id,
      'leadingBidderId',  v_current_bidder,
      'leadingBid',       v_current_high_bid
    );

    UPDATE public.auction_nominations
       SET status = 'sold',
           current_high_bid = v_target_amount,
           current_high_bidder_team_id = v_target_team_id
     WHERE id = v_nomination_id;

    UPDATE public.auction_budgets
       SET remaining_budget = remaining_budget - v_target_amount,
           players_won      = players_won + 1,
           updated_at       = now()
     WHERE league_id = p_league_id AND team_id = v_target_team_id;

    INSERT INTO public.draft_picks (
      league_id, round_number, pick_number, team_id, player_id, picked_at
    )
    VALUES (
      p_league_id, 1, v_nom_number, v_target_team_id, v_nom_player_id, now()
    );

    v_new_state := jsonb_build_object(
      'nominationId',     v_nomination_id,
      'awardedTeamId',    v_target_team_id,
      'awardedAmount',    v_target_amount
    );

  ELSIF p_override_action = 'adjust_opening_bid' THEN
    -- ── adjust_opening_bid ────────────────────────────────────────
    -- Mid-nomination floor adjustment. New floor MUST be >= current
    -- leading bid (cannot retroactively undermine a committed bid).
    -- If new floor > current_high_bid, current_high_bid bumps up to
    -- match (commissioner forces leader's commitment up; brief #6
    -- safeguard validates leader's budget covers the increase).

    v_new_floor := (p_action_payload ->> 'newOpeningBid')::numeric;

    IF v_new_floor IS NULL OR v_new_floor <= 0 THEN
      RAISE EXCEPTION 'invalid_event_payload: adjust_opening_bid requires positive newOpeningBid'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, current_high_bid, current_high_bidder_team_id, minimum_bid
      INTO v_nomination_id, v_current_high_bid, v_current_bidder, v_nom_minimum_bid
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to adjust opening bid for in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Reject floor BELOW current leading bid as nonsensical.
    IF v_new_floor < v_current_high_bid THEN
      RAISE EXCEPTION 'opening_bid_below_current_leading: new floor % is below current leading bid %',
        v_new_floor, v_current_high_bid
        USING ERRCODE = 'check_violation';
    END IF;

    -- If floor > current_high_bid, validate leader's budget covers
    -- the higher commitment (Zach's safeguard from approval message).
    IF v_new_floor > v_current_high_bid THEN
      SELECT remaining_budget, players_won
        INTO v_target_budget, v_target_won
        FROM public.auction_budgets
       WHERE league_id = p_league_id AND team_id = v_current_bidder
       FOR UPDATE;

      IF v_target_budget IS NULL THEN
        RAISE EXCEPTION 'illegal_state: leader team % has no auction_budgets row',
          v_current_bidder
          USING ERRCODE = 'no_data_found';
      END IF;

      -- The leader currently has v_current_high_bid committed but not
      -- deducted; raising the floor to v_new_floor means they'd commit
      -- v_new_floor instead. Available budget after raise must cover
      -- (v_new_floor + reserve for remaining slots).
      IF v_new_floor + GREATEST(0, (v_roster_size - v_target_won - 1)) * v_min_bid_setting > v_target_budget THEN
        RAISE EXCEPTION 'insufficient_budget_for_floor_increase: leader team % budget % cannot cover new floor % + reserve',
          v_current_bidder, v_target_budget, v_new_floor
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    v_prior_state := jsonb_build_object(
      'nominationId',  v_nomination_id,
      'openingBid',    v_nom_minimum_bid,
      'leadingBid',    v_current_high_bid
    );

    UPDATE public.auction_nominations
       SET minimum_bid      = v_new_floor,
           current_high_bid = GREATEST(v_new_floor, current_high_bid)
     WHERE id = v_nomination_id;

    v_new_state := jsonb_build_object(
      'nominationId',  v_nomination_id,
      'openingBid',    v_new_floor,
      'leadingBid',    GREATEST(v_new_floor, v_current_high_bid)
    );

  ELSIF p_override_action = 'adjust_budget' THEN
    -- ── adjust_budget ─────────────────────────────────────────────
    -- Standalone team-budget delta (does NOT require active
    -- nomination). Debit beyond current budget rejects.

    v_target_team_id := (p_action_payload ->> 'teamId')::uuid;
    v_delta := (p_action_payload ->> 'delta')::numeric;

    IF v_target_team_id IS NULL OR v_delta IS NULL THEN
      RAISE EXCEPTION 'invalid_event_payload: adjust_budget requires teamId and delta'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT remaining_budget INTO v_target_budget
      FROM public.auction_budgets
     WHERE league_id = p_league_id AND team_id = v_target_team_id
     FOR UPDATE;

    IF v_target_budget IS NULL THEN
      RAISE EXCEPTION 'illegal_state: team % has no auction_budgets row in league %',
        v_target_team_id, p_league_id
        USING ERRCODE = 'no_data_found';
    END IF;

    v_new_budget := v_target_budget + v_delta;

    IF v_new_budget < 0 THEN
      RAISE EXCEPTION 'insufficient_budget: team % current budget % cannot absorb delta %',
        v_target_team_id, v_target_budget, v_delta
        USING ERRCODE = 'check_violation';
    END IF;

    v_prior_state := jsonb_build_object(
      'teamId',           v_target_team_id,
      'budgetRemaining',  v_target_budget
    );

    UPDATE public.auction_budgets
       SET remaining_budget = v_new_budget,
           updated_at       = now()
     WHERE league_id = p_league_id AND team_id = v_target_team_id;

    v_new_state := jsonb_build_object(
      'teamId',           v_target_team_id,
      'budgetRemaining',  v_new_budget,
      'delta',            v_delta
    );

  ELSIF p_override_action = 'cancel_nomination' THEN
    -- ── cancel_nomination ─────────────────────────────────────────
    -- Wipes active nomination; player returns to available pool;
    -- bids invalidated (auction_bids rows preserved per append-only
    -- audit principle); nominationsCompleted does NOT advance (redo
    -- semantics, NOT skip semantics — distinct from
    -- auction_nomination_skipped from 6c3).

    SELECT id, current_high_bid, current_high_bidder_team_id,
           player_id, expires_at
      INTO v_nomination_id, v_current_high_bid, v_current_bidder,
           v_nom_player_id, v_nom_expires_at
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to cancel in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_total_bids
      FROM public.auction_bids
     WHERE nomination_id = v_nomination_id;

    v_prior_state := jsonb_build_object(
      'nominationId',     v_nomination_id,
      'playerId',         v_nom_player_id,
      'totalBids',        v_total_bids,
      'leadingBidderId',  v_current_bidder,
      'leadingBid',       v_current_high_bid
    );
    v_new_state := jsonb_build_object();

    UPDATE public.auction_nominations
       SET status = 'cancelled'
     WHERE id = v_nomination_id;

  ELSIF p_override_action = 'extend_bid_window' THEN
    -- ── extend_bid_window ─────────────────────────────────────────
    -- Commissioner-initiated bid-window extension. Anti-snipe
    -- (chunk 11g.6 sub-step 6b) is engine-driven; this is the
    -- commissioner-driven equivalent. Validates extensionSeconds > 0.

    v_extension_seconds := (p_action_payload ->> 'extensionSeconds')::int;

    IF v_extension_seconds IS NULL OR v_extension_seconds <= 0 THEN
      RAISE EXCEPTION 'extension_below_current_deadline: extensionSeconds must be positive (got %)',
        COALESCE(v_extension_seconds::text, '<missing>')
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, expires_at
      INTO v_nomination_id, v_nom_expires_at
      FROM public.auction_nominations
     WHERE league_id = p_league_id AND status = 'active'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE;

    IF v_nomination_id IS NULL THEN
      RAISE EXCEPTION 'no_active_nomination: no active nomination to extend in league %', p_league_id
        USING ERRCODE = 'check_violation';
    END IF;

    v_new_expires_at := v_nom_expires_at + (v_extension_seconds * interval '1 second');

    v_prior_state := jsonb_build_object(
      'nominationId',         v_nomination_id,
      'priorClockDeadline',   v_nom_expires_at
    );

    UPDATE public.auction_nominations
       SET expires_at = v_new_expires_at
     WHERE id = v_nomination_id;

    v_new_state := jsonb_build_object(
      'nominationId',     v_nomination_id,
      'newClockDeadline', v_new_expires_at,
      'extensionSeconds', v_extension_seconds
    );

  ELSE
    RAISE EXCEPTION 'invalid_event_payload: unknown override_action %', p_override_action
      USING ERRCODE = 'check_violation';
  END IF;

  -- Step 4: Common-suffix code. UPDATE leagues counter + INSERT
  -- draft_events with the polymorphic auction_commissioner_override
  -- payload. Same atomic transaction as the per-action branch.

  v_payload := jsonb_build_object(
    'commissioner_user_id', v_actor_user_id,
    'override_action',      p_override_action,
    'prior_state',          v_prior_state,
    'new_state',            v_new_state,
    'rationale',            p_rationale
  );

  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'auction_commissioner_override', v_payload,
    'sha256:server-generated', p_idempotency_key, p_actor, NULL
  )
  RETURNING id INTO v_event_id;

  --   COMMIT (implicit)

  RETURN jsonb_build_object(
    'event_id',         v_event_id,
    'seq',              v_new_seq,
    'override_action',  p_override_action,
    'prior_state',      v_prior_state,
    'new_state',        v_new_state,
    'was_duplicate',    false
  );
END;
$$;

COMMENT ON FUNCTION public.auction_commissioner_override_v2(uuid, jsonb, text, jsonb, uuid, text) IS
  'ADR-002 §4.4 / chunk 11g.6 sub-step 6c4: auction commissioner override (seven action variants). Polymorphic single-event-variant architecture — one RPC, one event variant (auction_commissioner_override with overrideAction discriminator). Each branch atomically wraps action-specific multi-table writes. Trusted-executor: requires service_role caller AND actor.kind=commissioner.';

GRANT EXECUTE ON FUNCTION public.auction_commissioner_override_v2(uuid, jsonb, text, jsonb, uuid, text) TO service_role;

-- ── B.9: submit_pick_v2 (from #17 — clean body, no pgmq.send) ──────────
CREATE OR REPLACE FUNCTION public.submit_pick_v2(
  p_league_id        uuid,
  p_team_id          uuid,
  p_player_id        int,
  p_round            int,
  p_pick_number      int,
  p_session_id       uuid,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_actor            jsonb,
  p_correlation_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id    bigint;
  v_existing_seq   bigint;
  v_existing_hash  text;
  v_current_dl     timestamptz;
  v_draft_state    text;
  v_league_size    int;
  v_settings       jsonb;
  v_pick_count     int;
  v_expected_round int;
  v_pick_in_round  int;
  v_team_order     jsonb;
  v_expected_team  uuid;
  v_actor_kind     text;
  v_team_owner     uuid;
  v_caller_role    text;
  v_player_taken   boolean;
  v_picked_at      timestamptz;
  v_payload        jsonb;
  v_new_seq        bigint;
  v_event_id       bigint;
  v_correlation_id uuid;
  v_pick_time      int;
  v_new_deadline   timestamptz;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Step 1: Idempotency check (spec §5.2.1) ─────────────────────────
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      SELECT pick_deadline INTO v_current_dl
        FROM public.leagues WHERE id = p_league_id;
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'pick_deadline', v_current_dl,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- ── Step 2: Preflight (spec §5.2) ───────────────────────────────────

  SELECT draft_state, league_size, settings
    INTO v_draft_state, v_league_size, v_settings
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_draft_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state: draft_state is % (expected active)',
      v_draft_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_league_size IS NULL OR v_league_size <= 0 THEN
    RAISE EXCEPTION 'illegal_state: league_size not configured'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;

  IF p_pick_number <> v_pick_count + 1 THEN
    RAISE EXCEPTION 'pick_out_of_order: expected pick % got %',
      v_pick_count + 1, p_pick_number
      USING ERRCODE = 'check_violation';
  END IF;

  v_expected_round := ((p_pick_number - 1) / v_league_size) + 1;
  IF p_round <> v_expected_round THEN
    RAISE EXCEPTION 'pick_out_of_order: round mismatch (expected % got %)',
      v_expected_round, p_round
      USING ERRCODE = 'check_violation';
  END IF;

  v_pick_in_round := ((p_pick_number - 1) % v_league_size) + 1;

  SELECT team_order INTO v_team_order
    FROM public.draft_order
   WHERE league_id = p_league_id AND round_number = p_round;

  IF v_team_order IS NULL THEN
    RAISE EXCEPTION 'illegal_state: draft_order missing for round %', p_round
      USING ERRCODE = 'no_data_found';
  END IF;

  v_expected_team := (v_team_order ->> (v_pick_in_round - 1))::uuid;
  IF v_expected_team IS DISTINCT FROM p_team_id THEN
    RAISE EXCEPTION 'not_on_clock: expected team % got %',
      v_expected_team, p_team_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.draft_picks_v2
     WHERE league_id = p_league_id AND player_id = p_player_id
  ) INTO v_player_taken;

  IF v_player_taken THEN
    RAISE EXCEPTION 'player_taken: player % already picked in league %',
      p_player_id, p_league_id
      USING ERRCODE = 'unique_violation';
  END IF;

  v_actor_kind := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind = 'autopick' THEN
    IF v_caller_role NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'unauthorized: actor.kind=autopick requires service_role (got %)',
        v_caller_role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_actor_kind = 'user' THEN
    SELECT owner_id INTO v_team_owner
      FROM public.teams
     WHERE id = p_team_id AND league_id = p_league_id;

    IF v_team_owner IS NULL THEN
      RAISE EXCEPTION 'unauthorized: team % is not in league %',
        p_team_id, p_league_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_team_owner IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'unauthorized: caller % is not owner of team %',
        auth.uid(), p_team_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by submit_pick_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Step 3: Build payload, advance counter, insert event ────────────
  v_picked_at := now();
  v_payload := jsonb_build_object(
    'pick_number', p_pick_number,
    'round',       p_round,
    'team_id',     p_team_id,
    'player_id',   p_player_id,
    'picked_at',   v_picked_at,
    'is_autopick', (v_actor_kind = 'autopick'),
    'session_id',  p_session_id
  );

  PERFORM public.validate_draft_event_payload('pick', v_payload);

  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'pick', v_payload, p_payload_hash,
    p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  -- AFTER INSERT trigger tg_draft_events_project_pick fires HERE,
  -- writing the corresponding row into draft_picks_v2.
  -- AFTER INSERT trigger draft_events_notify_after_insert (chunk 11g.7
  -- sub-step 7e) fires HERE, emitting pg_notify('draft_events', ...).

  -- ── Step 4: Compute next pick_deadline (spec §5.2.2) ────────────────
  v_pick_time := COALESCE(
    (v_settings ->> 'pickTimeLimit')::int,
    90
  );

  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  UPDATE public.leagues
     SET pick_deadline = v_new_deadline
   WHERE id = p_league_id;

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'pick_deadline', v_new_deadline,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid) IS
  'Spec §4.5 / §5.2: the pick path. Idempotent (per-key advisory lock); preflight-checked (state, pick_number, round, on-the-clock, player-taken, auth); writes event + projection (via trigger); advances pick_deadline (CEIL + 1s pad). Chunk 11g.8: removed pgmq emission. Chunk 11g.9: removed v_generation leak — leagues.draft_generation column dropped.';


-- ── B.10: draft_pause (from #17 — clean body) ───────────────────────────
CREATE OR REPLACE FUNCTION public.draft_pause(
  p_league_id  uuid,
  p_actor      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_old_deadline   timestamptz;
  v_pick_count     int;
  v_remaining      int;
  v_paused_pick    int;
  v_paused_at      timestamptz;
  v_reason         text;
  v_caller_role    text;
  v_seq            bigint;
BEGIN
  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_pause requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state, pick_deadline
    INTO v_commissioner, v_state, v_old_deadline
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot pause from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  v_paused_at := now();
  v_reason    := COALESCE(p_actor ->> 'reason', 'commissioner');

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_paused_pick := v_pick_count + 1;
  v_remaining := GREATEST(
    0,
    COALESCE(ceil(EXTRACT(EPOCH FROM (v_old_deadline - now())))::int, 0)
  );

  UPDATE public.leagues
     SET draft_state   = 'paused',
         pick_deadline = NULL
   WHERE id = p_league_id;

  -- Event: draft_paused. Capture seq for the engine's dedup cursor
  -- (chunk 11g.7 sub-step 7e: lastAppliedSeq update path).
  -- Chunk 11g.9: generation_bumped emission removed (Decision Log D4).
  SELECT (public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_paused',
    p_payload          => jsonb_build_object(
      'paused_at',          v_paused_at,
      'paused_pick_number', v_paused_pick,
      'remaining_seconds',  v_remaining,
      'reason',             v_reason
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  ) ->> 'seq')::bigint INTO v_seq;

  RETURN jsonb_build_object(
    'paused_at', v_paused_at,
    'seq',       v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_pause(uuid, jsonb) IS
  'Spec §4.6: clears pick_deadline, transitions to paused. Emits draft_paused. Chunk 11g.7 sub-step 7e: returns seq for engine dedup. Chunk 11g.9: removed generation_bumped emission + draft_generation refs (column dropped).';


-- ── B.11: draft_resume (from #17 — clean body) ──────────────────────────
CREATE OR REPLACE FUNCTION public.draft_resume(
  p_league_id  uuid,
  p_actor      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_settings       jsonb;
  v_pick_time      int;
  v_pick_count     int;
  v_resumed_pick   int;
  v_new_deadline   timestamptz;
  v_resumed_at     timestamptz;
  v_caller_role    text;
  v_seq            bigint;
BEGIN
  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_resume requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state, settings
    INTO v_commissioner, v_state, v_settings
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_state <> 'paused' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot resume from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  v_resumed_at  := now();
  v_pick_time   := COALESCE((v_settings ->> 'pickTimeLimit')::int, 90);

  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_resumed_pick := v_pick_count + 1;

  UPDATE public.leagues
     SET draft_state   = 'active',
         pick_deadline = v_new_deadline
   WHERE id = p_league_id;

  -- Event: draft_resumed. Capture seq for engine dedup (7e).
  -- Chunk 11g.9: generation_bumped emission removed (Decision Log D4).
  SELECT (public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_resumed',
    p_payload          => jsonb_build_object(
      'resumed_at',          v_resumed_at,
      'resumed_pick_number', v_resumed_pick,
      'new_pick_deadline',   v_new_deadline
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  ) ->> 'seq')::bigint INTO v_seq;

  RETURN jsonb_build_object(
    'new_pick_deadline', v_new_deadline,
    'seq',               v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_resume(uuid, jsonb) IS
  'Spec §4.7: recomputes pick_deadline, transitions to active. Emits draft_resumed. Chunk 11g.7 sub-step 7e: returns seq for engine dedup. Chunk 11g.8: removed pgmq emission. Chunk 11g.9: removed generation_bumped emission + draft_generation refs (column dropped).';


-- ── B.12: draft_extend (from #17 — clean body) ──────────────────────────
CREATE OR REPLACE FUNCTION public.draft_extend(
  p_league_id      uuid,
  p_extra_seconds  int,
  p_actor          jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_old_deadline   timestamptz;
  v_new_deadline   timestamptz;
  v_extended_at    timestamptz;
  v_pick_count     int;
  v_pick_number    int;
  v_caller_role    text;
  v_seq            bigint;
BEGIN
  IF p_extra_seconds IS NULL OR p_extra_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid_event_payload: p_extra_seconds must be a positive int (got %)',
      p_extra_seconds
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_extend requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state, pick_deadline
    INTO v_commissioner, v_state, v_old_deadline
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot extend from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_old_deadline IS NULL THEN
    RAISE EXCEPTION 'illegal_state: active draft has no pick_deadline (data corruption?)'
      USING ERRCODE = 'check_violation';
  END IF;

  v_extended_at := now();

  v_new_deadline := date_trunc('second', v_old_deadline)
                  + make_interval(secs => p_extra_seconds);

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_pick_number := v_pick_count + 1;

  UPDATE public.leagues
     SET pick_deadline = v_new_deadline
   WHERE id = p_league_id;

  -- Event: draft_extended. Capture seq for engine dedup (7e).
  -- Chunk 11g.9: generation_bumped emission removed (Decision Log D4).
  SELECT (public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_extended',
    p_payload          => jsonb_build_object(
      'extended_at',       v_extended_at,
      'pick_number',       v_pick_number,
      'extra_seconds',     p_extra_seconds,
      'new_pick_deadline', v_new_deadline
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  ) ->> 'seq')::bigint INTO v_seq;

  RETURN jsonb_build_object(
    'new_pick_deadline', v_new_deadline,
    'seq',               v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_extend(uuid, int, jsonb) IS
  'Spec §4.8: extends pick_deadline by p_extra_seconds. Emits draft_extended. Chunk 11g.7 sub-step 7e: returns seq for engine dedup. Chunk 11g.8: removed pgmq emission. Chunk 11g.9: removed generation_bumped emission + draft_generation refs (column dropped).';



-- ═══════════════════════════════════════════════════════════════════════
-- PHASE C — Drain (cron.unschedule only; drops deferred)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Unschedules both Phase 4 legacy jobs. After these unschedule:
--   - `draft-deadline-sweep` (every 10s) no longer invokes
--     public.draft_deadline_sweep() → function no longer exercised.
--   - `draft-autopick-keepalive` (every 2 min) no longer HTTP-POSTs to
--     the draft-autopick Edge Function → Edge Function no longer
--     invoked. Its RPC dependencies (draft_autopick_read/archive) and
--     column dependency (leagues.draft_generation) remain in the DB
--     but are never called.
--
-- The DROP EXTENSION pgmq CASCADE + DROP FUNCTION statements from
-- migration #17 are INTENTIONALLY OMITTED here. They land in a
-- follow-up sub-step alongside `supabase functions delete draft-autopick`
-- so the Edge Function's runtime dependencies never disappear
-- underneath it in a partial-execution window.
--
-- Pattern mirrors #17 lines 100-114: guarded DO blocks so re-runs
-- and cron-absent environments both no-op cleanly.

DO $unsched_sweep$
BEGIN
  PERFORM cron.unschedule('draft-deadline-sweep');
  RAISE NOTICE '  Unscheduled: draft-deadline-sweep';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available or draft-deadline-sweep already unscheduled, skipping';
END $unsched_sweep$;

DO $unsched_keepalive$
BEGIN
  PERFORM cron.unschedule('draft-autopick-keepalive');
  RAISE NOTICE '  Unscheduled: draft-autopick-keepalive';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available or draft-autopick-keepalive already unscheduled, skipping';
END $unsched_keepalive$;


-- ═══════════════════════════════════════════════════════════════════════
-- Post-flight verify
-- ═══════════════════════════════════════════════════════════════════════
-- Fails loud if any expected object is still absent after this
-- migration completes. Mirrors #17's line 770 verify block pattern.

DO $verify$
DECLARE
  v_missing text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='draft_events_notify_trigger' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'draft_events_notify_trigger fn; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='draft_events_notify_after_insert')
    THEN v_missing := v_missing || 'draft_events_notify_after_insert trg; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='draft_snapshots')
    THEN v_missing := v_missing || 'draft_snapshots table; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='nominate_player_v2' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'nominate_player_v2 fn; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='place_bid_v2' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'place_bid_v2 fn; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='close_nomination_v2' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'close_nomination_v2 fn; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='auction_pause_v2' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'auction_pause_v2 fn; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='auction_resume_v2' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'auction_resume_v2 fn; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='compute_min_next_bid' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'compute_min_next_bid fn; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='auction_nomination_skip_v2' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'auction_nomination_skip_v2 fn; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='auction_commissioner_override_v2' AND pronamespace='public'::regnamespace)
    THEN v_missing := v_missing || 'auction_commissioner_override_v2 fn; '; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='submit_pick_v2' AND pronamespace='public'::regnamespace AND prosrc LIKE '%pgmq.send%')
    THEN v_missing := v_missing || 'submit_pick_v2 body still has pgmq.send; '; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='draft_resume' AND pronamespace='public'::regnamespace AND prosrc LIKE '%pgmq.send%')
    THEN v_missing := v_missing || 'draft_resume body still has pgmq.send; '; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='draft_extend' AND pronamespace='public'::regnamespace AND prosrc LIKE '%pgmq.send%')
    THEN v_missing := v_missing || 'draft_extend body still has pgmq.send; '; END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION '20260722 recovery post-flight FAILED: %', v_missing;
  END IF;
  RAISE NOTICE '20260722 recovery post-flight PASSED: all expected objects present + RPC bodies clean.';
END $verify$;
