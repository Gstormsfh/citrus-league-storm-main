-- Draft latency scorecard view (process audit 2026-09-01, §B-9 / §D-9;
-- runbook draft-engine-v2-operations.md §3.5 "TODO(10c): populate baselines").
--
-- WHY. Every "are we inside the Mandate?" question has been a fresh ad-hoc
-- query over draft_events. This view is the durable per-draft record the
-- weekly `draft-scorecard` workflow (data-pipeline/monitoring/
-- draft_latency_scorecard.py) reads through PostgREST, and the thing an
-- on-call human can SELECT from at 11 pm without re-deriving the event
-- payload shapes.
--
-- WHAT IT MEASURES (all from draft_events; nothing here touches the hot path).
--   * autopick deadline -> commit latency. For every autopick `pick` event the
--     deadline that was in effect is the value set by the most recent earlier
--     deadline-setting event in the same league:
--         draft_started.first_pick_deadline   (pick 1)
--         pick.pick_deadline                   (the previous pick, event_version 2 —
--                                               20260727010000_pick_event_carries_pick_deadline)
--         draft_resumed.new_pick_deadline      (after a pause)
--         draft_extended.new_pick_deadline     (after a commissioner extension)
--     LAG() over that ordered set gives exactly "the previous setter"; if the
--     previous pick pre-dates event_version 2 its deadline is NULL and the pick
--     is excluded from the percentiles rather than measured against a stale one.
--     Both timestamps are DB clock (`now()` inside the RPCs), so there is no
--     engine/DB skew in the difference. It EXCLUDES broadcast fanout — that
--     half lives in Cloud Logging (`pick.processed.broadcastMs`, see
--     infra/gcp/monitoring/).
--   * Instant autopicks (ENGINE-EAR v3 item 6: ownerless seats fire ~2 s after
--     the on-clock transition, BEFORE the deadline) are counted separately and
--     never enter the deadline->commit percentiles — they would be negative.
--   * autopick share, picks per minute, draft duration, started/completed.
--   * Manual pick latency (user click -> broadcast) is NOT derivable from the
--     DB (only commit timestamps exist); that is the Cloud Monitoring
--     dashboard's job.
--
-- ACCESS. security_invoker view over draft_events + leagues (both RLS'd), SELECT
-- granted to service_role only; anon and authenticated get nothing (explicit
-- REVOKE, not just the 20260804045646 default-privilege posture). No table is
-- created, so there is no new RLS surface; the view inherits the base tables'
-- policies for any future grantee.
--
-- Offline imports (20260824191610_offline_import_draft_v2) appear with
-- draft_format = 'offline' and a ~0 duration; filter them out of any
-- cadence/latency comparison.

BEGIN;

CREATE OR REPLACE VIEW public.draft_latency_scorecard
WITH (security_invoker = on)
AS
WITH deadline_events AS (
  -- Every event that either IS a pick or SETS the deadline for the next pick,
  -- in seq order, with the deadline it sets (NULL when the payload lacks it).
  -- The cast is guarded by a shape check so one malformed payload string can
  -- never take the whole scorecard down; it just yields NULL for that row.
  SELECT
    x.league_id,
    x.seq,
    x.event_type,
    x.created_at,
    x.payload,
    x.actor,
    CASE WHEN x.deadline_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
         THEN x.deadline_text::timestamptz
    END AS sets_deadline
  FROM (
    SELECT
      e.league_id,
      e.seq,
      e.event_type,
      e.created_at,
      e.payload,
      e.actor,
      CASE e.event_type
        WHEN 'draft_started'  THEN e.payload ->> 'first_pick_deadline'
        WHEN 'pick'           THEN e.payload ->> 'pick_deadline'
        WHEN 'draft_resumed'  THEN e.payload ->> 'new_pick_deadline'
        WHEN 'draft_extended' THEN e.payload ->> 'new_pick_deadline'
      END AS deadline_text
    FROM public.draft_events e
    WHERE e.event_type IN ('draft_started', 'pick', 'draft_resumed', 'draft_extended')
  ) x
),
with_deadline AS (
  -- LAG must run over the FULL ordered set (picks AND the non-pick setters),
  -- so the pick-only filter happens one CTE later.
  SELECT
    d.league_id,
    d.seq,
    d.event_type,
    d.created_at,
    (d.payload ->> 'pick_number')::int AS pick_number,
    COALESCE((d.payload ->> 'is_autopick')::boolean, (d.actor ->> 'kind') = 'autopick') AS is_autopick,
    -- Deadline in effect for THIS event = whatever the previous deadline-setting
    -- event established (NULL if that event carried no deadline, e.g. an
    -- event_version 1 pick).
    LAG(d.sets_deadline) OVER (PARTITION BY d.league_id ORDER BY d.seq) AS deadline_in_effect,
    -- seq of the latest draft_started in the league; picks before it (a
    -- re-seeded log) are ignored. Window, not a join, so the plan stays a
    -- single sort over draft_events.
    max(CASE WHEN d.event_type = 'draft_started' THEN d.seq END)
      OVER (PARTITION BY d.league_id) AS started_seq
  FROM deadline_events d
),
pick_latency AS (
  SELECT
    p.league_id,
    p.seq,
    p.created_at,
    p.pick_number,
    p.is_autopick,
    p.deadline_in_effect,
    CASE
      WHEN p.is_autopick AND p.deadline_in_effect IS NOT NULL AND p.created_at >= p.deadline_in_effect
        THEN round(extract(epoch FROM (p.created_at - p.deadline_in_effect))::numeric * 1000)::int
    END AS autopick_deadline_ms,
    (p.is_autopick AND p.deadline_in_effect IS NOT NULL AND p.created_at < p.deadline_in_effect) AS is_instant_autopick
  FROM with_deadline p
  WHERE p.event_type = 'pick'
    AND p.seq > COALESCE(p.started_seq, 0)
),
started AS (
  -- Latest draft_started per league (a league has one v2 draft; DISTINCT ON
  -- keeps the view well-defined if an event log is ever re-seeded).
  SELECT DISTINCT ON (s.league_id)
    s.league_id,
    s.seq        AS started_seq,
    s.created_at AS started_at,
    s.payload    AS started_payload
  FROM public.draft_events s
  WHERE s.event_type = 'draft_started'
  ORDER BY s.league_id, s.seq DESC
),
finished AS (
  SELECT
    f.league_id,
    max(f.created_at) FILTER (WHERE f.event_type = 'draft_completed') AS completed_at,
    max(f.created_at) FILTER (WHERE f.event_type = 'draft_cancelled') AS cancelled_at,
    max((f.payload ->> 'total_picks')::int) FILTER (WHERE f.event_type = 'draft_completed') AS completed_total_picks
  FROM public.draft_events f
  WHERE f.event_type IN ('draft_completed', 'draft_cancelled')
  GROUP BY f.league_id
),
agg AS (
  SELECT
    pl.league_id,
    count(*)                                              AS picks,
    count(*) FILTER (WHERE NOT pl.is_autopick)            AS manual_picks,
    count(*) FILTER (WHERE pl.is_autopick)                AS autopicks,
    count(pl.autopick_deadline_ms)                        AS deadline_autopicks,
    count(*) FILTER (WHERE pl.is_instant_autopick)        AS instant_autopicks,
    round((percentile_cont(0.50) WITHIN GROUP (ORDER BY pl.autopick_deadline_ms)
             FILTER (WHERE pl.autopick_deadline_ms IS NOT NULL))::numeric)::int AS autopick_deadline_p50_ms,
    round((percentile_cont(0.95) WITHIN GROUP (ORDER BY pl.autopick_deadline_ms)
             FILTER (WHERE pl.autopick_deadline_ms IS NOT NULL))::numeric)::int AS autopick_deadline_p95_ms,
    max(pl.autopick_deadline_ms)                          AS autopick_deadline_max_ms,
    min(pl.created_at)                                    AS first_pick_at,
    max(pl.created_at)                                    AS last_pick_at
  FROM pick_latency pl
  GROUP BY pl.league_id
)
SELECT
  st.league_id,
  l.name                                                   AS league_name,
  st.started_payload ->> 'draft_format'                    AS draft_format,
  (st.started_payload ->> 'total_teams')::int              AS total_teams,
  (st.started_payload ->> 'total_rounds')::int             AS total_rounds,
  (st.started_payload ->> 'pick_time_limit_seconds')::int  AS pick_time_limit_seconds,
  CASE
    WHEN fi.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN fi.completed_at IS NOT NULL THEN 'completed'
    ELSE 'in_progress'
  END                                                      AS draft_state,
  st.started_at,
  fi.completed_at,
  COALESCE(fi.completed_at, fi.cancelled_at, a.last_pick_at) - st.started_at AS draft_duration,
  round((extract(epoch FROM (COALESCE(fi.completed_at, fi.cancelled_at, a.last_pick_at) - st.started_at)) / 60.0)::numeric, 1)
                                                           AS draft_duration_minutes,
  COALESCE(a.picks, 0)                                     AS picks,
  COALESCE(a.manual_picks, 0)                              AS manual_picks,
  COALESCE(a.autopicks, 0)                                 AS autopicks,
  CASE WHEN COALESCE(a.picks, 0) > 0
       THEN round(a.autopicks::numeric / a.picks, 3)
  END                                                      AS autopick_share,
  COALESCE(a.deadline_autopicks, 0)                        AS deadline_autopicks,
  COALESCE(a.instant_autopicks, 0)                         AS instant_autopicks,
  a.autopick_deadline_p50_ms,
  a.autopick_deadline_p95_ms,
  a.autopick_deadline_max_ms,
  CASE WHEN a.last_pick_at > st.started_at
       THEN round((a.picks / (extract(epoch FROM (a.last_pick_at - st.started_at)) / 60.0))::numeric, 2)
  END                                                      AS picks_per_minute,
  fi.completed_total_picks
FROM started st
LEFT JOIN public.leagues l ON l.id = st.league_id
LEFT JOIN finished fi     ON fi.league_id = st.league_id
LEFT JOIN agg a           ON a.league_id = st.league_id;

COMMENT ON VIEW public.draft_latency_scorecard IS
  'Per-draft Mandate scorecard derived from draft_events (audit 2026-09-01 §B-9). autopick_deadline_*_ms = deadline expiry -> pick committed (DB clock both sides, excludes broadcast). instant_autopicks fired before their deadline (ownerless seats) and are excluded from the percentiles. security_invoker; SELECT for service_role only. Read weekly by .github/workflows/draft-scorecard.yml.';

-- ── Grants: explicit, service_role only ─────────────────────────────
REVOKE ALL ON public.draft_latency_scorecard FROM PUBLIC;
REVOKE ALL ON public.draft_latency_scorecard FROM anon;
REVOKE ALL ON public.draft_latency_scorecard FROM authenticated;
GRANT SELECT ON public.draft_latency_scorecard TO service_role;

-- ── Verify: the view compiles against the columns it uses, executes, and is
-- locked down. Fails the migration (and therefore the apply) otherwise. ─
DO $verify$
DECLARE
  v_missing   text[];
  v_expected  text[] := ARRAY[
    'league_id', 'league_name', 'draft_format', 'total_teams', 'total_rounds',
    'pick_time_limit_seconds', 'draft_state', 'started_at', 'completed_at',
    'draft_duration', 'draft_duration_minutes', 'picks', 'manual_picks',
    'autopicks', 'autopick_share', 'deadline_autopicks', 'instant_autopicks',
    'autopick_deadline_p50_ms', 'autopick_deadline_p95_ms',
    'autopick_deadline_max_ms', 'picks_per_minute', 'completed_total_picks'
  ];
  v_invoker   text;
BEGIN
  -- 1. Base columns the view reads must exist (draft_events: 20260425130000;
  --    leagues.name: original schema).
  SELECT array_agg(c ORDER BY c) INTO v_missing
    FROM unnest(ARRAY['league_id', 'seq', 'event_type', 'payload', 'actor', 'created_at']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public' AND ic.table_name = 'draft_events' AND ic.column_name = c
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'draft_latency_scorecard: draft_events is missing column(s) %', v_missing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns ic
     WHERE ic.table_schema = 'public' AND ic.table_name = 'leagues' AND ic.column_name = 'name'
  ) THEN
    RAISE EXCEPTION 'draft_latency_scorecard: leagues.name is missing';
  END IF;

  -- 2. The view exposes every column the scorecard script reads.
  SELECT array_agg(c ORDER BY c) INTO v_missing
    FROM unnest(v_expected) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public' AND ic.table_name = 'draft_latency_scorecard' AND ic.column_name = c
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'draft_latency_scorecard: view is missing column(s) %', v_missing;
  END IF;

  -- 3. It executes (planner + executor, full expression tree) — an empty
  --    draft_events is fine, a bad cast or window frame is not.
  PERFORM 1 FROM public.draft_latency_scorecard LIMIT 1;

  -- 4. security_invoker is on and the grants are exactly what we intend.
  SELECT option_value INTO v_invoker
    FROM pg_catalog.pg_options_to_table(
           (SELECT c.reloptions FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'draft_latency_scorecard'))
   WHERE option_name = 'security_invoker';
  -- reloptions keeps the literal spelling ('on' here); accept every boolean form.
  IF lower(COALESCE(v_invoker, 'off')) NOT IN ('on', 'true', '1', 'yes') THEN
    RAISE EXCEPTION 'draft_latency_scorecard: security_invoker is not on (got %)', COALESCE(v_invoker, '<unset>');
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.draft_latency_scorecard', 'SELECT') THEN
    RAISE EXCEPTION 'draft_latency_scorecard: anon must not be able to SELECT';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.draft_latency_scorecard', 'SELECT') THEN
    RAISE EXCEPTION 'draft_latency_scorecard: authenticated must not be able to SELECT';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.draft_latency_scorecard', 'SELECT') THEN
    RAISE EXCEPTION 'draft_latency_scorecard: service_role must be able to SELECT';
  END IF;
END
$verify$;

COMMIT;
