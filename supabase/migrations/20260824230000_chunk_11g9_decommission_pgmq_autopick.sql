-- =====================================================================
--  STAGING FIRST. DO NOT APPLY TO PRODUCTION YET.
-- =====================================================================
--
--  Evidence from prod (iezwazccqqrhrjupxzvf) on 2026-08-24:
--
--    autopicks on prod, total ................... 121
--    of those, fired by the EDGE WORKER ......... 62   (draft_metrics
--                                                       'autopick_fired'
--                                                       is written only
--                                                       by the Edge
--                                                       Function)
--    engine snapshots on prod ................... 6    (last 18:02Z)
--    safety_net_hit in the last 7 days .......... 106
--    prod engine VM ............................. NONE
--    prod web CSP connect-src engine host ....... wss://draft-staging.
--                                                 citrusfantasysports.com
--
--  Read that together: production has no draft engine of its own. Its
--  web app is only permitted to reach the STAGING engine host, and the
--  engine has touched prod's database just six times. Roughly half of
--  every autopick prod has ever made came from the Edge worker this
--  migration retires.
--
--  `OrphanedDraftScanner` cannot cover that gap on prod, because it
--  runs INSIDE the engine process and prod has no engine process to
--  run it. Applying this migration to prod today would not move
--  autopick from one mechanism to another — it would remove prod's
--  primary autopick and put nothing in its place.
--
--  ORDER OF OPERATIONS:
--    1. Apply to STAGING (citrus-staging / jjgspcpvqaiitloglxbb), which
--       has a real engine VM (citrus-draft-engine-staging).
--    2. Verify: run a draft, evict its lobby, confirm
--       `registry.orphan_adopted` fires and the clock resumes.
--    3. Stand up a durable PROD engine and add its host to the prod
--       CSP connect-src.
--    4. Only then apply here.
--
--  Until step 4, prod keeps the pgmq path. That is deliberate.
--
-- =====================================================================
--  ADDENDUM 2026-09-03 (read-only verification against prod, same day)
-- =====================================================================
--
--  The gating fact above has changed. Production now has its own engine:
--  citrus-draft-engine-prod (deploy-engine.yml), reached at
--  wss://draft.citrusfantasysports.com, which is in the prod CSP
--  connect-src (apps/web/firebase.json) and is the DRAFT_WS_HOST the
--  production API is deployed with (production-deploy.yml). Steps 1-3 of
--  the order above are done. Step 4 (apply here) is now unblocked,
--  subject to the deploy-order rule below.
--
--  What the pgmq path did while it stayed live, from draft_metrics:
--
--    2026-08-21  league f548834a  draftType=auction
--                safety_net_hit 83, Edge autopick_fired 42
--    2026-09-01  league a1a125c8  draftType=auction
--                safety_net_hit 105 (first at 17:17:35Z, 72s after the
--                engine's uuid-cast stall at 17:16:23Z), Edge
--                autopick_fired 53 over the next 2h36m
--
--  The Edge worker has no notion of draft format. reconstruct_draft_state
--  and submit_pick_v2 are snake semantics, so on both dates it "finished"
--  an auction draft as a snake draft, one pick every ~3 minutes, until
--  the league read completed. That is the second half of why the auction
--  tests looked broken: the engine stall was the first half (fixed in
--  LobbyManager.ts, close idempotency key), and this path was the second.
--  It also fired 48 times on the 2026-08-31 snake league aaaa1111...d3b0,
--  which says the engine's own autopick was not holding that clock either;
--  that is a separate finding for the engine, not a reason to keep this.
--
--  Live body check: pg_get_functiondef(draft_deadline_sweep) on prod today
--  is md5 edcd02ced675ff61d5b685e8ccbd6022, identical to the 2026-08-24
--  body this file was authored against (capture:
--  captures/2026-09-03_pre_chunk_11g9_decommission_pgmq_autopick.sql).
--  Queue state today: 0 live messages, 307 archived, 0 leagues
--  in_progress, wrapper RPCs already absent on prod.
--
--  DEPLOY ORDER FOR PROD, unchanged in spirit: redeploy the prod engine
--  from a build that contains server/src/draft/orphanedDraftScanner.ts
--  (present since 2026-08-24, so any current master build qualifies)
--  and the auction close fix, THEN apply steps 1-3 of this file, THEN
--  run the auction test. Applying before the redeploy leaves a window
--  with neither safety net; testing an auction before applying repeats
--  2026-09-01.
--
-- =====================================================================

-- Chunk 11g.9: decommission the pgmq autopick path.
--
-- This is the follow-up that migration 20260511010000 (chunk 11g.8)
-- promised and never shipped. Read that header first — then read this
-- one, because 11g.8's central factual claim was WRONG and this
-- migration is what makes it true.
--
-- ── WHAT 11g.8 CLAIMED vs WHAT PRODUCTION ACTUALLY HAD ─────────────
--
-- 11g.8's header states it removed `pgmq.send` from four functions,
-- including `draft_deadline_sweep`, and concluded: "The pgmq writer
-- wiring is vestigial ... Incident responders should NOT reach for the
-- legacy pgmq path during crises — it does nothing."
--
-- Audit of live production on 2026-08-24 found otherwise:
--
--   * `public.draft_deadline_sweep` STILL contained an unconditional
--     `PERFORM pgmq.send('draft_deadlines', ..., 'source','safety_net')`.
--   * The `draft-deadline-sweep` cron ran it every 30 seconds.
--   * The `draft-autopick-keepalive` cron POSTed the draft-autopick
--     Edge Function every 2 minutes, pointed at PRODUCTION.
--   * `pgmq.q_draft_deadlines` had a live message; `a_draft_deadlines`
--     had 105 archived ones.
--
-- So the "vestigial" path was a live, second autopick implementation
-- racing the persistent engine, kept mostly harmless only by
-- `submit_pick_v2`'s idempotency key and the worker's staleness gates.
-- It was ALSO doing real work: it was the only recovery path for an
-- in_progress league whose lobby had left the engine registry.
--
-- ── WHY IT IS SAFE TO REMOVE NOW ───────────────────────────────────
--
-- Deleting the pgmq path without a replacement WOULD have been an
-- availability regression, so the replacement lands in the same change:
-- `server/src/draft/orphanedDraftScanner.ts`, started from the engine
-- entry point. Coverage after this migration:
--
--   engine restart ............ LobbyRegistry.performBootScan (existing)
--   stalled clock, lobby loaded  LobbyRegistry.scanClockLiveness (existing)
--   lobby evicted mid-draft ... OrphanedDraftScanner (NEW — the gap
--                               `source: 'safety_net'` was filling)
--
-- The new scanner reinstates the LOBBY and nothing else. It never
-- selects a player and never calls `submit_pick_v2`. Autopick therefore
-- returns to exactly one implementation (`autopickStrategy.ts` behind
-- `LobbyManager`), which is what ADR-001 intended all along.
--
-- ── DETECTION STAYS IN THE DATABASE, ON PURPOSE ────────────────────
--
-- `draft_deadline_sweep` is NOT dropped. It keeps its detection query
-- and its `safety_net_hit` metric; only the `pgmq.send` is removed.
--
-- That split is deliberate and is an improvement on both the old design
-- and on simply deleting the function: DETECTION now lives in Postgres,
-- independent of the engine, while RECOVERY lives in the engine. If the
-- orphan scanner regresses, `safety_net_hit` still climbs in
-- `draft_metrics` and the failure is visible. A recovery mechanism that
-- is also its own monitor cannot report its own absence — that is the
-- F20 lesson, and this keeps the two on separate rails.
--
-- Operationally: `safety_net_hit` was previously a routine no-op
-- counter. After this migration a NON-ZERO value means "the engine let
-- a pick deadline blow past its 30s grace." Alert on it.
--
-- ── ORDER OF OPERATIONS ────────────────────────────────────────────
-- 1. Unschedule the keep-alive cron  -> no new worker invocations.
-- 2. Replace draft_deadline_sweep    -> no new queue writes.
-- 3. Drop the wrapper RPCs           -> nothing can read/archive/DLQ.
-- 4. Drop the queue + archive        -> DESTRUCTIVE (see below).
-- 5. Drop the extension              -> nothing references it by then.
--
-- ── DESTRUCTIVE STEP — READ BEFORE APPLYING ────────────────────────
-- Step 4 permanently deletes `pgmq.a_draft_deadlines` (105 historical
-- rows at time of writing). If you want that history, snapshot it
-- first:
--
--   CREATE TABLE public.archived_draft_deadlines_20260824 AS
--     SELECT * FROM pgmq.a_draft_deadlines;
--
-- Steps 4 and 5 are commented out below for exactly this reason. Steps
-- 1-3 are non-destructive and idempotent: they stop the double-autopick
-- path immediately. Uncomment 4-5 once you have taken the snapshot (or
-- decided you do not want it).
--
-- ── DEPLOY ORDER ───────────────────────────────────────────────────
-- Deploy the engine build containing OrphanedDraftScanner FIRST, then
-- apply this migration. Doing it the other way round leaves a window
-- with neither safety net. Then delete the Edge Function itself:
--   supabase functions delete draft-autopick --project-ref iezwazccqqrhrjupxzvf

BEGIN;

-- ── 1. Unschedule the keep-alive cron ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'draft-autopick-keepalive') THEN
      PERFORM cron.unschedule('draft-autopick-keepalive');
      RAISE NOTICE '11g.9: unscheduled draft-autopick-keepalive';
    ELSE
      RAISE NOTICE '11g.9: draft-autopick-keepalive not scheduled, skipping';
    END IF;
  END IF;
END $$;

-- ── 2. draft_deadline_sweep: detection + telemetry only ────────────
-- Body is byte-for-byte the live 2026-08-24 definition with the
-- `PERFORM pgmq.send(...)` block removed and the counter renamed from
-- v_enqueued to v_detected. Everything else — the auth gate, the
-- advisory lock, the detection predicate, the metric sub-block with its
-- own EXCEPTION handler, the return contract — is unchanged.
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
  v_detected       int := 0;
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

    -- The metric is now the JOB, not telemetry: recovery moved to the
    -- engine's OrphanedDraftScanner, and this row is the independent
    -- signal that the engine let a deadline lapse. The sub-block with
    -- its own EXCEPTION handler is kept so that one league whose
    -- metric INSERT fails cannot abort the sweep over the remaining
    -- leagues.
    BEGIN
      INSERT INTO public.draft_metrics (metric, league_id, value, detail)
      VALUES ('safety_net_hit', v_league.league_id, 1,
              jsonb_build_object('expired_by_sec', v_expired_by_sec,
                                 'generation',     v_league.draft_generation,
                                 'pick_number',    v_current_pick,
                                 'recovered_by',   'engine_orphan_scanner'));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'draft_deadline_sweep: metric write failed for league % (%)',
        v_league.league_id, SQLERRM;
    END;

    v_detected := v_detected + 1;
  END LOOP;

  RETURN v_detected;
END;
$function$;

COMMENT ON FUNCTION public.draft_deadline_sweep() IS
  'Chunk 11g.9: DETECTION ONLY. Records a safety_net_hit metric for any in_progress league whose pick_deadline lapsed past the 30s engine grace. Recovery is owned by the engine (server/src/draft/orphanedDraftScanner.ts). A non-zero return is an ALERT condition, not routine.';

-- ── 3. Drop the pgmq wrapper RPCs ──────────────────────────────────
DROP FUNCTION IF EXISTS public.draft_autopick_read(integer, integer);
DROP FUNCTION IF EXISTS public.draft_autopick_read(integer);
DROP FUNCTION IF EXISTS public.draft_autopick_archive(bigint);
DROP FUNCTION IF EXISTS public.draft_autopick_dlq(uuid, integer, integer, text, bigint);

-- Belt-and-braces: catch any overload the explicit signatures missed.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('draft_autopick_read','draft_autopick_archive','draft_autopick_dlq')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
    RAISE NOTICE '11g.9: dropped %', r.sig;
  END LOOP;
END $$;

COMMIT;

-- ── 4. DESTRUCTIVE — drop the queue + its archive ──────────────────
-- Deletes 105+ archived rows. Snapshot first if you want the history
-- (see header). Uncomment to run.
--
-- SELECT pgmq.drop_queue('draft_deadlines');

-- ── 5. Drop the extension ──────────────────────────────────────────
-- Only after step 4. Verified 2026-08-24: once steps 2-3 are applied,
-- the sole remaining reference to the string 'pgmq' anywhere in
-- public.* is the literal 'pgmq_msg_id' inside
-- validate_draft_event_payload's required-key array for the
-- 'autopick_failed' event type. That is a string in an array, not a
-- dependency on the extension, so it does not block this DROP. The
-- 'autopick_failed' event type simply becomes unreachable once the
-- worker is gone; leaving its validation arm in place is harmless and
-- keeps historical events replayable.
--
-- DROP EXTENSION IF EXISTS pgmq;
