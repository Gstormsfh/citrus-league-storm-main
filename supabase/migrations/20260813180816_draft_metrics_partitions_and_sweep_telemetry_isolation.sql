-- ARCHITECT 2026-08-13 — the safety net was dead, and TELEMETRY killed it.
--
-- FOUND BY: arming a net-proof rig with the engine stopped. The sweep
-- never enqueued. Calling draft_deadline_sweep() directly surfaced:
--   ERROR: no partition of relation "draft_metrics" found for row
--   DETAIL: Partition key of the failing row contains (ts) = (2026-08-13)
--
-- draft_metrics is RANGE-partitioned on ts, with partitions only for
-- 2026_04 .. 2026_07. Every write failed from 2026-08-01 onward.
--
-- WHY THAT KILLED THE NET: the sweep did
--     PERFORM pgmq.send(...);            -- succeeds
--     INSERT INTO draft_metrics (...);   -- throws, no partition
-- in ONE function call. The throw rolled back the whole transaction
-- INCLUDING the enqueue. The net looked armed — cron running, zero
-- errors in job_run_details, function present — and enqueued nothing
-- for 13 days. It would have been dead on Aug 20.
--
-- THREE FIXES; any one alone leaves the failure mode reachable:
--   1. The missing monthly partitions (Aug 2026 -> Mar 2027).
--   2. A DEFAULT partition, so running off the end of the calendar can
--      never again be a hard error — rows there are a signal, not an outage.
--   3. THE REAL ONE: the metric write is now non-fatal. A safety net that
--      stops working because its TELEMETRY failed is not a safety net.
--      Observability must never be load-bearing for the thing it observes.

DO $$
DECLARE m date := date '2026-08-01';
BEGIN
  WHILE m < date '2027-04-01' LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.draft_metrics
         FOR VALUES FROM (%L) TO (%L)',
      'draft_metrics_' || to_char(m, 'YYYY_MM'),
      m::timestamptz, (m + interval '1 month')::timestamptz);
    m := (m + interval '1 month')::date;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.draft_metrics_default
  PARTITION OF public.draft_metrics DEFAULT;

CREATE OR REPLACE FUNCTION public.draft_deadline_sweep()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role    text;
  v_lock_acquired  boolean;
  v_now            timestamptz := now();
  v_enqueued       int := 0;
  v_league         record;
  v_current_pick   int;
  v_expired_by_sec int;
  v_engine_grace   interval := interval '30 seconds';
BEGIN
  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: draft_deadline_sweep requires service_role/postgres (got %)',
      COALESCE(v_caller_role, 'NULL') USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT pg_try_advisory_xact_lock(hashtext('draft-sweep')) INTO v_lock_acquired;
  IF NOT v_lock_acquired THEN RETURN 0; END IF;
  FOR v_league IN
    SELECT l.id AS league_id, l.draft_generation, l.pick_deadline
    FROM public.leagues l
    WHERE l.draft_status = 'in_progress'
      AND l.draft_state  = 'active'
      AND l.pick_deadline IS NOT NULL
      AND l.pick_deadline < v_now - v_engine_grace
      AND NOT EXISTS (
        SELECT 1 FROM public.draft_events e
        WHERE e.league_id = l.id
          AND e.event_type IN ('pick','autopick_failed')
          AND (e.payload->>'pick_number')::int =
               (SELECT count(*) + 1 FROM public.draft_events e2
                 WHERE e2.league_id = l.id AND e2.event_type = 'pick')
          AND e.created_at > l.pick_deadline)
  LOOP
    SELECT count(*) + 1 INTO v_current_pick FROM public.draft_events e
     WHERE e.league_id = v_league.league_id AND e.event_type = 'pick';
    v_expired_by_sec := EXTRACT(EPOCH FROM (v_now - v_league.pick_deadline))::int;

    -- The enqueue is the JOB. First, and unconditional.
    PERFORM pgmq.send('draft_deadlines',
      jsonb_build_object('league_id', v_league.league_id, 'pick_number', v_current_pick,
        'generation', v_league.draft_generation, 'scheduled_for', v_league.pick_deadline,
        'source', 'safety_net'), 0);
    v_enqueued := v_enqueued + 1;

    -- The metric is TELEMETRY. It must never be able to undo the job.
    -- Swallowing an error is normally a smell; here it is the point.
    BEGIN
      INSERT INTO public.draft_metrics (metric, league_id, value, detail)
      VALUES ('safety_net_hit', v_league.league_id, 1,
              jsonb_build_object('expired_by_sec', v_expired_by_sec,
                                 'generation', v_league.draft_generation));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'draft_deadline_sweep: metric write failed for league % (%), enqueue kept',
        v_league.league_id, SQLERRM;
    END;
  END LOOP;
  RETURN v_enqueued;
END;
$function$;
