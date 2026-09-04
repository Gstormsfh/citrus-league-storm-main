CREATE OR REPLACE FUNCTION public.draft_deadline_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      COALESCE(v_caller_role, 'NULL')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT pg_try_advisory_xact_lock(hashtext('draft-sweep')) INTO v_lock_acquired;
  IF NOT v_lock_acquired THEN
    RETURN 0;
  END IF;

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
          AND e.created_at > l.pick_deadline
      )
  LOOP
    SELECT count(*) + 1 INTO v_current_pick
      FROM public.draft_events e
     WHERE e.league_id = v_league.league_id AND e.event_type = 'pick';

    v_expired_by_sec := EXTRACT(EPOCH FROM (v_now - v_league.pick_deadline))::int;

    -- The enqueue is the JOB. It happens first and unconditionally.
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
    v_enqueued := v_enqueued + 1;

    -- The metric is TELEMETRY. It must never be able to undo the job.
    -- A sub-block with its own EXCEPTION handler rolls back only the
    -- failed INSERT, leaving the pgmq.send committed. Swallowing an
    -- error is normally a smell; here it is the entire point.
    BEGIN
      INSERT INTO public.draft_metrics (metric, league_id, value, detail)
      VALUES ('safety_net_hit', v_league.league_id, 1,
              jsonb_build_object('expired_by_sec', v_expired_by_sec,
                                 'generation',     v_league.draft_generation));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'draft_deadline_sweep: metric write failed for league % (%), enqueue kept',
        v_league.league_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_enqueued;
END;
$function$
