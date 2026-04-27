-- Draft Engine v2 — Phase 3 chunk 10b: draft_deadline_sweep() RPC.
--
-- Spec §4.8. The race-free safety-net pgmq enqueuer that catches
-- expired pick deadlines whose original submit_pick_v2 enqueue (spec
-- §5.2.2) was lost or never fired.
--
-- Design contract (from plan, §677–§737, locked in Phase 3 review):
--   * Predicate is over draft_events only — NOT pgmq internals. pgmq
--     does not expose a documented "predicate-match in-flight"
--     query; querying its underlying tables is implementation-
--     dependent, and any check-then-send is TOCTOU-racy across
--     concurrent sweeps. Safety under duplicate enqueue is provided
--     by the autopick idempotency key (Phase 4), not queue-side
--     dedupe.
--   * Concurrent sweeps no-op via pg_try_advisory_xact_lock on
--     hashtext('draft-sweep'). Transaction-scoped, never blocks,
--     released at txn commit/rollback.
--   * Per Q3 (locked): one safety_net_hit row per affected league
--     per sweep run, with league_id populated and expired_by_sec +
--     generation in detail jsonb. draft_metrics is the (chunk 10a)
--     partitioned table; this is the first writer to it.
--
-- Auth model:
--   The function is SECURITY DEFINER. Inside, it gates auth.role()
--   to ('service_role', 'postgres'). Same pattern as Phase 2's
--   submit_pick_v2 autopick path (deviation D2) and
--   record_shadow_event (D1) — pg_cron runs as postgres, the Phase 4
--   worker runs as service_role, manual emergency calls via the
--   Supabase Dashboard SQL Editor run as postgres. anon / authenticated
--   PostgREST callers are rejected. The spec §4.8 is silent on auth;
--   this fills in the gap rather than deviating.
--
-- Return type: spec §4.8 specifies int (count of messages enqueued).
-- Honored as-is. Operational visibility (sweep run, lock contention,
-- per-league timing) is captured in draft_metrics safety_net_hit rows
-- and — once Phase 6 lands the metric pipeline — cron_run / sweep_*
-- counters.

-- ── 1. draft_deadline_sweep() ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.draft_deadline_sweep()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role    text;
  v_lock_acquired  boolean;
  v_now            timestamptz := now();
  v_enqueued       int := 0;
  v_league         record;
  v_current_pick   int;
  v_expired_by_sec int;
BEGIN
  -- ── Auth (spec gap-fill; not a deviation since §4.8 is silent). ──
  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: draft_deadline_sweep requires service_role/postgres (got %)',
      COALESCE(v_caller_role, 'NULL')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Advisory lock — transaction-scoped, non-blocking. ──
  -- pg_try_advisory_xact_lock returns immediately whether or not it
  -- got the lock. If another sweep is running, we no-op. The lock
  -- releases automatically when this txn ends (commit or rollback).
  -- hashtext maps the human-readable namespace 'draft-sweep' to the
  -- int4 the advisory lock API expects.
  SELECT pg_try_advisory_xact_lock(hashtext('draft-sweep'))
    INTO v_lock_acquired;

  IF NOT v_lock_acquired THEN
    -- Another sweep won; ours no-ops. Returning 0 is indistinguishable
    -- from "no expired leagues" by design — operators distinguish via
    -- pg_locks during a live incident, or via Phase 6 counters once
    -- they land. Both outcomes are healthy steady-state.
    RETURN 0;
  END IF;

  -- ── Race-free predicate over draft_events. ──
  -- Selects leagues whose current pick slot's deadline has passed AND
  -- no pick / autopick_failed event has landed for that slot since the
  -- deadline expired. The "current pick slot" is derived from the event
  -- log itself (count of pick events + 1) — never from leagues.* — so
  -- the predicate stays correct even if leagues.pick_deadline diverges
  -- (e.g. trigger lag).
  --
  -- 2-second back-buffer (pick_deadline < now() - 2s): avoids racing
  -- submit_pick_v2's own pgmq enqueue at the moment of pick landing.
  -- Without this we'd double-enqueue every pick at the boundary; the
  -- duplicate is harmless (autopick idempotency key catches it) but
  -- wastes pgmq writes.
  --
  -- Phase 7 perf note: the inner correlated count(*) is O(picks_in_
  -- league); the (league_id, event_type) index on draft_events keeps
  -- it cheap at staging scale. Load testing in Phase 7 will validate
  -- under N×rounds × concurrent-leagues fan-out.
  FOR v_league IN
    SELECT
      l.id              AS league_id,
      l.draft_generation,
      l.pick_deadline
    FROM public.leagues l
    WHERE l.draft_state = 'active'
      AND l.pick_deadline IS NOT NULL
      AND l.pick_deadline < v_now - interval '2 seconds'
      AND NOT EXISTS (
        SELECT 1
        FROM public.draft_events e
        WHERE e.league_id = l.id
          AND e.event_type IN ('pick','autopick_failed')
          AND (e.payload->>'pick_number')::int =
               (SELECT count(*) + 1
                  FROM public.draft_events e2
                 WHERE e2.league_id = l.id
                   AND e2.event_type = 'pick')
          AND e.created_at > l.pick_deadline
      )
  LOOP
    -- Recompute current pick slot for the message payload. Same
    -- formula as the predicate's inner subquery; could be hoisted
    -- via a CTE but readability wins at this scale.
    SELECT count(*) + 1
      INTO v_current_pick
      FROM public.draft_events e
     WHERE e.league_id = v_league.league_id
       AND e.event_type = 'pick';

    v_expired_by_sec := EXTRACT(
      EPOCH FROM (v_now - v_league.pick_deadline)
    )::int;

    -- ── Enqueue. ──
    -- Schema mirrors submit_pick_v2's enqueue (spec §5.2.2 / Phase 2
    -- migration) so the worker treats both sources uniformly. send_
    -- delay = 0 → message is immediately visible to pgmq.read().
    -- The 'source' tag lets the worker / metrics pipeline distinguish
    -- safety-net messages from happy-path scheduled ones.
    PERFORM pgmq.send(
      'draft_deadlines',
      jsonb_build_object(
        'league_id',     v_league.league_id,
        'pick_number',   v_current_pick,
        'generation',    v_league.draft_generation,
        'scheduled_for', v_league.pick_deadline,
        'source',        'safety_net'
      ),
      0
    );

    -- ── Per-league metric (Q3 lock-in). ──
    -- One row per affected league per sweep run. league_id populated
    -- (so dashboards can group by league); detail carries the diag
    -- payload — expired_by_sec + generation. Phase 6 readers treat
    -- this row as authoritative for "this league hit the safety net
    -- at time ts."
    INSERT INTO public.draft_metrics (metric, league_id, value, detail)
    VALUES (
      'safety_net_hit',
      v_league.league_id,
      1,
      jsonb_build_object(
        'expired_by_sec', v_expired_by_sec,
        'generation',     v_league.draft_generation
      )
    );

    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION public.draft_deadline_sweep() IS
  'Spec §4.8: race-free safety-net deadline sweep. Predicate over draft_events (no pgmq introspection); pg_try_advisory_xact_lock(hashtext(''draft-sweep'')) so overlapping runs no-op; one safety_net_hit row per affected league per run (Q3). Returns count of pgmq messages enqueued.';

-- ── 2. Verify ─────────────────────────────────────────────────────────
-- Existence + signature only. The function has side effects (pgmq
-- writes, metric writes) so we do NOT execute it at migration time —
-- a real run during migration would alter pgmq state on staging.
-- Functional verification rides on the chunk 10e SQL integration
-- scenarios, which set up controlled fixtures before invocation.

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'draft_deadline_sweep'
       AND pg_get_function_result(p.oid) = 'integer'
  ) THEN
    RAISE EXCEPTION 'draft_deadline_sweep() was not created with the expected signature (RETURNS int)';
  END IF;
END
$verify$;
