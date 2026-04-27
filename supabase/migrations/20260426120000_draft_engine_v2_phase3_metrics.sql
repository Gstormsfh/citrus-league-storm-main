-- Draft Engine v2 — Phase 3 chunk 10a: support tables + partition cron.
--
-- Schema and partition lifecycle only. No RPCs that read/write these
-- tables yet. The sweep RPC and DLQ writes land in chunk 10b. Phase 6
-- wires the metric pipeline (per-event INSERTs + the daily rollup).
--
-- Tables:
--   draft_metrics               — partitioned by RANGE(ts), monthly.
--   draft_metrics_2026_{04..07} — initial partitions (current + 3 ahead).
--   draft_metrics_daily         — schema only; Phase 6 populates the rollup.
--   autopick_failures           — Phase 4 worker DLQ.
--
-- Function + cron:
--   manage_draft_metrics_partitions() — idempotent: creates next month's
--     partition + drops old partitions (only if FULLY rolled up to daily).
--   pg_cron job 'draft-metrics-partition-management' runs it monthly on
--     the 25th at 00:00 UTC (6-day buffer before month-end).
--
-- RLS: enabled on all three new tables, no policies → default-deny for
-- non-service-role. Service-role writes via Phase 3+ RPCs / Edge
-- Function; reads go through admin endpoints that use the admin client.
-- Phase 6 may add a read policy for the admin dashboard if needed.
--
-- Spec refs:
--   §3.5 draft_metrics, §3.6 autopick_failures, §11.2 metric pipeline
--   (Phase 6).
-- Operations runbook deviations: D4 (PK shape on draft_metrics).

-- ── 1. draft_metrics (partitioned parent) ─────────────────────────────
-- Composite PK (ts, id) is required for range partitioning AND gives us
-- time-ordered rows per partition for cheap recent-N queries. The
-- synthetic id column is documented as deviation D4 in the operations
-- runbook — spec §3.5 omits a PK but partitioning forces one.
--
-- Schema decisions for Phase 6 forward-compat:
--   metric text (not enum)  — Phase 6 adds new metrics by inserting; no
--                             schema migration needed. Mitigation for
--                             typos: Phase 6 wraps inserts in a function
--                             that validates against an allowed set.
--   value bigint            — counts of millions/billions across a season
--                             are realistic; bigint is safe.
--   detail jsonb (nullable) — per-metric structured payload (e.g.
--                             clock_drift_detected.detail = {drift_ms: 187}).
--   league_id (nullable)    — global metrics (cron_run, worker_invocation)
--                             have no league.

CREATE TABLE IF NOT EXISTS public.draft_metrics (
  id        bigserial,
  ts        timestamptz NOT NULL DEFAULT now(),
  metric    text         NOT NULL,
  league_id uuid,
  value     bigint       NOT NULL DEFAULT 1,
  detail    jsonb,
  PRIMARY KEY (ts, id)
) PARTITION BY RANGE (ts);

COMMENT ON TABLE  public.draft_metrics IS
  'Spec §11.2 metric pipeline. Partitioned monthly. Phase 3 writes only safety_net_hit; Phase 6 wires the rest. PK shape (ts, id) per deviation D4.';
COMMENT ON COLUMN public.draft_metrics.metric IS
  'text (not enum) for Phase 6 forward-compat; new metric names land via INSERT, no schema change needed.';
COMMENT ON COLUMN public.draft_metrics.detail IS
  'Per-metric structured payload; shape varies by metric. JSONB lets each metric type carry its own fields without table-wide schema growth.';

ALTER TABLE public.draft_metrics ENABLE ROW LEVEL SECURITY;
-- No policies → default-deny for non-service-role. Reads go via admin
-- endpoints (server using the admin client), writes via Phase 3+ RPCs.

-- ── 2. Initial partitions: 2026-04 through 2026-07 ────────────────────

CREATE TABLE IF NOT EXISTS public.draft_metrics_2026_04
  PARTITION OF public.draft_metrics
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE INDEX IF NOT EXISTS draft_metrics_2026_04_metric_ts_idx
  ON public.draft_metrics_2026_04 (metric, ts);
CREATE INDEX IF NOT EXISTS draft_metrics_2026_04_league_ts_idx
  ON public.draft_metrics_2026_04 (league_id, ts) WHERE league_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.draft_metrics_2026_05
  PARTITION OF public.draft_metrics
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE INDEX IF NOT EXISTS draft_metrics_2026_05_metric_ts_idx
  ON public.draft_metrics_2026_05 (metric, ts);
CREATE INDEX IF NOT EXISTS draft_metrics_2026_05_league_ts_idx
  ON public.draft_metrics_2026_05 (league_id, ts) WHERE league_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.draft_metrics_2026_06
  PARTITION OF public.draft_metrics
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE INDEX IF NOT EXISTS draft_metrics_2026_06_metric_ts_idx
  ON public.draft_metrics_2026_06 (metric, ts);
CREATE INDEX IF NOT EXISTS draft_metrics_2026_06_league_ts_idx
  ON public.draft_metrics_2026_06 (league_id, ts) WHERE league_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.draft_metrics_2026_07
  PARTITION OF public.draft_metrics
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE INDEX IF NOT EXISTS draft_metrics_2026_07_metric_ts_idx
  ON public.draft_metrics_2026_07 (metric, ts);
CREATE INDEX IF NOT EXISTS draft_metrics_2026_07_league_ts_idx
  ON public.draft_metrics_2026_07 (league_id, ts) WHERE league_id IS NOT NULL;

-- ── 3. draft_metrics_daily (rollup, schema only — Phase 6 populates) ──
-- Long-horizon storage that survives partition drops. Phase 6 will run a
-- daily cron that aggregates the prior day's draft_metrics rows into
-- (day, metric, league_id, total). Phase 3 just creates the table so the
-- partition-drop guard in manage_draft_metrics_partitions() can reference
-- it without conditionally creating it.
--
-- Uniqueness model: a synthetic bigserial id is the PK (every row has
-- identity). Logical uniqueness — one row per (day, metric, league)
-- bucket — is enforced by two PARTIAL unique indexes, the standard
-- NULL-handling pattern. Postgres treats NULL as not-equal in btree
-- uniqueness, so a plain UNIQUE (day, metric, league_id) would silently
-- allow multiple (day, metric, NULL) rows for global metrics. The split
-- into two predicates (one for NULL, one for NOT NULL) enforces "at most
-- one row per bucket" for both per-league AND global metrics.

CREATE TABLE IF NOT EXISTS public.draft_metrics_daily (
  id        bigserial PRIMARY KEY,
  day       date         NOT NULL,
  metric    text         NOT NULL,
  league_id uuid,
  total     bigint       NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS draft_metrics_daily_unique_per_league_idx
  ON public.draft_metrics_daily (day, metric, league_id)
  WHERE league_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS draft_metrics_daily_unique_global_idx
  ON public.draft_metrics_daily (day, metric)
  WHERE league_id IS NULL;
CREATE INDEX IF NOT EXISTS draft_metrics_daily_metric_day_idx
  ON public.draft_metrics_daily (metric, day);

COMMENT ON TABLE public.draft_metrics_daily IS
  'Spec §11.2 long-horizon rollup. Phase 3 creates the schema; Phase 6 wires the daily aggregation cron. Used by manage_draft_metrics_partitions to gate partition drops (only drop if every day of the month is rolled up).';

ALTER TABLE public.draft_metrics_daily ENABLE ROW LEVEL SECURITY;

-- ── 4. autopick_failures (Phase 4 worker DLQ) ─────────────────────────
-- Spec §3.6. Worker inserts here when read_ct >= 3 (per chunk 4 plan).
-- Phase 3 just creates the schema so chunk 10c's worker scaffold has a
-- destination to fail safely into during Phase 4 development.

CREATE TABLE IF NOT EXISTS public.autopick_failures (
  id            bigserial PRIMARY KEY,
  league_id     uuid NOT NULL,
  pgmq_msg_id   bigint NOT NULL,
  payload       jsonb NOT NULL,
  last_error    text,
  read_ct       int NOT NULL,
  failed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS autopick_failures_league_failed_idx
  ON public.autopick_failures (league_id, failed_at);

COMMENT ON TABLE public.autopick_failures IS
  'Spec §3.6 DLQ for autopick worker. Insert when pgmq read_ct >= 3 (Phase 4). Pages on-call via the alerts trigger pattern; humans inspect this table during incidents instead of a separate pgmq DLQ queue.';

ALTER TABLE public.autopick_failures ENABLE ROW LEVEL SECURITY;

-- ── 5. manage_draft_metrics_partitions() ──────────────────────────────
-- Idempotent partition lifecycle:
--   (a) Ensure next month's partition exists (no-op if already present).
--   (b) For each partition older than 3 months: drop ONLY if
--       draft_metrics_daily contains a rollup row for EVERY day of that
--       month. Defensive — Phase 6's daily rollup must run before raw
--       partitions are discarded. Partial coverage (some days missing)
--       blocks the drop.
--
-- Schedule: registered below as 'draft-metrics-partition-management',
-- '0 0 25 * *' (25th of each month at 00:00 UTC; 6-day buffer before
-- month-end).

CREATE OR REPLACE FUNCTION public.manage_draft_metrics_partitions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_month     date := (date_trunc('month', now()) + interval '1 month')::date;
  v_next_part_name text := 'draft_metrics_' || to_char(v_next_month, 'YYYY_MM');
  v_cutoff         date := (date_trunc('month', now()) - interval '3 months')::date;
  v_part_name      text;
  v_part_month     date;
  v_days_in_month  int;
  v_distinct_days  int;
  v_created        text[] := ARRAY[]::text[];
  v_dropped        text[] := ARRAY[]::text[];
  v_skipped        text[] := ARRAY[]::text[];
BEGIN
  -- (a) Ensure next month's partition exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = v_next_part_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.draft_metrics
         FOR VALUES FROM (%L) TO (%L)',
      v_next_part_name,
      v_next_month,
      v_next_month + interval '1 month'
    );
    EXECUTE format(
      'CREATE INDEX %I ON public.%I (metric, ts)',
      v_next_part_name || '_metric_ts_idx',
      v_next_part_name
    );
    EXECUTE format(
      'CREATE INDEX %I ON public.%I (league_id, ts) WHERE league_id IS NOT NULL',
      v_next_part_name || '_league_ts_idx',
      v_next_part_name
    );
    v_created := array_append(v_created, v_next_part_name);
  END IF;

  -- (b) Drop partitions older than 3 months IF fully rolled up.
  FOR v_part_name IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = 'draft_metrics'
       AND c.relname ~ '^draft_metrics_\d{4}_\d{2}$'
  LOOP
    BEGIN
      v_part_month := to_date(
        substring(v_part_name from 'draft_metrics_(\d{4}_\d{2})$'),
        'YYYY_MM'
      );
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    IF v_part_month < v_cutoff THEN
      -- Days in the partition's month: last-day-of-month's day-of-month.
      -- Apr → 30, Feb 2026 → 28, Feb 2024 → 29 (leap year), etc.
      v_days_in_month := EXTRACT(
        day FROM (v_part_month + interval '1 month' - interval '1 day')::date
      )::int;

      EXECUTE format(
        'SELECT count(DISTINCT day) FROM public.draft_metrics_daily
          WHERE day >= %L AND day < %L',
        v_part_month,
        (v_part_month + interval '1 month')::date
      ) INTO v_distinct_days;

      -- Drop only if every day of the month has at least one rollup row.
      -- Partial coverage (e.g. Phase 6 missed some days) blocks the drop.
      IF v_distinct_days >= v_days_in_month THEN
        EXECUTE format('DROP TABLE public.%I', v_part_name);
        v_dropped := array_append(v_dropped, v_part_name);
      ELSE
        v_skipped := array_append(v_skipped, v_part_name);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created',                v_created,
    'dropped',                v_dropped,
    'skipped_no_rollup',      v_skipped,
    'next_month_partition',   v_next_part_name,
    'cutoff',                 v_cutoff
  );
END;
$$;

COMMENT ON FUNCTION public.manage_draft_metrics_partitions() IS
  'Idempotent partition lifecycle for draft_metrics. Creates next month if missing; drops partitions >3 months old ONLY if draft_metrics_daily has a rollup row for every day of the month. Scheduled monthly on the 25th at 00:00 UTC.';

-- ── 6. pg_cron schedule for partition management ──────────────────────
-- Wrapped in DO/EXCEPTION per the codebase's established pattern (see
-- 20260225000000_close_all_gaps_world_class.sql:1308). pg_cron is
-- already installed by 20260208400000_supabase_pro_upgrade.sql; this
-- block also handles dev/test environments where the extension may be
-- absent. cron.schedule(jobname, ...) is upsert-by-name, so re-applying
-- the migration is safe.

DO $cron_setup$
BEGIN
  PERFORM cron.schedule(
    'draft-metrics-partition-management',
    '0 0 25 * *',  -- monthly, 25th at 00:00 UTC (6-day buffer before EOM)
    'SELECT public.manage_draft_metrics_partitions()'
  );
  RAISE NOTICE '  Scheduled: draft-metrics-partition-management (monthly, 25th 00:00 UTC)';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available, skipping draft-metrics partition management schedule';
END $cron_setup$;

-- ── 7. Verify schema ──────────────────────────────────────────────────
-- Quick sanity: parent partitioned, 4 initial partitions attached,
-- daily summary present with both partial unique indexes, DLQ present,
-- function callable.
DO $verify$
DECLARE
  v_partition_count       int;
  v_unique_index_count    int;
BEGIN
  SELECT count(*) INTO v_partition_count
    FROM pg_class c
    JOIN pg_inherits i ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
   WHERE p.relname = 'draft_metrics';

  IF v_partition_count <> 4 THEN
    RAISE EXCEPTION 'expected 4 initial draft_metrics partitions, got %', v_partition_count;
  END IF;

  SELECT count(*) INTO v_unique_index_count
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'draft_metrics_daily'
     AND indexname IN (
       'draft_metrics_daily_unique_per_league_idx',
       'draft_metrics_daily_unique_global_idx'
     );

  IF v_unique_index_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 partial unique indexes on draft_metrics_daily, got %', v_unique_index_count;
  END IF;

  -- Function is callable (returns expected shape; side-effect-free
  -- during this run because next month already exists and no partition
  -- is older than the cutoff).
  PERFORM public.manage_draft_metrics_partitions();
END
$verify$;
