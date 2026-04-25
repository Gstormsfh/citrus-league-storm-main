-- Draft Engine v2 — Phase 2 RPCs and projection trigger.
--
-- Builds on Phase 1's foundation (`draft_events`, `draft_picks_v2`,
-- `leagues` column adds). Adds the SECURITY DEFINER RPCs that are the
-- ONLY way anything writes to `draft_events`, plus the AFTER INSERT
-- trigger that synchronously projects pick events into `draft_picks_v2`.
--
-- Spec references (every block below cites a section in
-- `docs/DRAFT_ENGINE_V2_SPEC.md`):
--   §4.1  validate_draft_event_payload
--   §4.2  append_draft_event
--   §4.3  record_shadow_event (hard-guarded shadow path)
--   §4.4  reconstruct_draft_state (rebuild/repair only)
--   §4.5  submit_pick_v2 (the pick path with idempotency + preflight)
--   §4.6  draft_pause / draft_resume / draft_extend (commissioner)
--   §3.2  tg_draft_events_project_pick (synchronous projection)
--   §5.2  pick submission state machine (preflight ordering)
--   §5.2.2  deadline rounding rule (CEIL + 1s pad)
--   §6     event catalog (payload schemas)
--
-- ── Sequencing nudge vs. plan ──────────────────────────────────────────
-- The plan put pgmq install + queue creation in Phase 3. submit_pick_v2
-- (Phase 2 per the plan) calls pgmq.send, which would fail at runtime
-- without the queue. To keep the RPC functional from day one of Phase 2,
-- we install pgmq + create the queue HERE. Phase 3 still adds the sweep,
-- the metrics table, the worker scaffold, and the pg_cron schedule.
--
-- ── Out of scope for Phase 2 ───────────────────────────────────────────
-- - Sweep RPC, pg_cron schedules, worker (Phase 3).
-- - Autopick state machine inside the worker (Phase 4).
-- - draft_metrics table — submit_pick_v2 emits structured RAISE NOTICE
--   logs; metric counters land when Phase 6 wires them.
-- - pick_undone, commissioner_override RPCs (v2.1, deferred).

-- ── 0. pgmq extension + the deadline queue ────────────────────────────
-- The runbook §2.1 verified Postgres is outside the pgmq drop_queue
-- bug window before this migration runs.

CREATE EXTENSION IF NOT EXISTS pgmq;

-- pgmq.create is idempotent: re-running this migration is safe.
SELECT pgmq.create('draft_deadlines');
