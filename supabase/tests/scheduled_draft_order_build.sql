-- Scheduled drafts — regression tests for 20260912050000.
--
-- Run AGAINST STAGING ONLY (Supabase project ref jjgspcpvqaiitloglxbb).
-- Everything happens inside one transaction that ROLLS BACK, so the file is
-- safe to re-run and leaves no rows behind.
--
-- THE REGRESSION. start_due_scheduled_drafts ignited through start_draft_v2,
-- which only ever READS public.draft_order. The commissioner's button builds
-- that order first (useStartDraftFull step 1 → DraftService.initializeDraftOrder);
-- the sweep had no equivalent and no database function could insert one. So a
-- league whose commissioner had never pressed Start Draft could never start on
-- a schedule. Observed on staging 2026-09-12 04:22:47Z:
--   draft_not_configured: league ... has no round-1 draft_order, sqlstate 23514
--
-- Asserts use plain SELECT + RAISE EXCEPTION so a failure stops the script and
-- is visible in psql output.

\echo '── scheduled draft order build: regression tests starting ──'

BEGIN;

-- A real profile id, so notifications.user_id FK (→ profiles) is satisfied
-- without inventing auth.users rows.
CREATE TEMP TABLE _fix AS
SELECT (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1) AS commish,
       'ada0f001-0000-4000-8000-000000000001'::uuid AS league;

DO $$
BEGIN
  IF (SELECT commish FROM _fix) IS NULL THEN
    RAISE EXCEPTION 'fixture: no profiles row available to act as commissioner';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 1. The functions exist, and are not reachable by a signed-in user.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY['build_draft_order_for_league',
                        'notify_scheduled_start',
                        'start_due_scheduled_drafts']) AS fn
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn
    ) THEN RAISE EXCEPTION '% missing', r.fn; END IF;
  END LOOP;

  -- These are scheduled jobs. A JWT caller must not reach them, both by the
  -- auth.role() gate inside and by the absent EXECUTE grant.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('build_draft_order_for_league','notify_scheduled_start',
                         'start_due_scheduled_drafts')
       AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'a scheduled-job function is EXECUTE-able by authenticated or anon';
  END IF;
END $$;
\echo '  1. functions present, not granted to authenticated/anon ✓'

-- ─────────────────────────────────────────────────────────────────────
-- 2. A snake order is built: N rounds, even rounds reversed, one session.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.leagues (id, name, commissioner_id, league_size, draft_rounds,
                            draft_status, draft_state, settings)
SELECT league, 'REGRESSION snake', commish, 4, 3, 'not_started', 'not_started',
       '{"draftType":"snake"}'::jsonb
  FROM _fix;

INSERT INTO public.teams (league_id, team_name, owner_id)
SELECT league, 'T' || g, CASE WHEN g = 1 THEN commish ELSE NULL END
  FROM _fix, generate_series(1,4) g;

DO $$
DECLARE v jsonb; r1 jsonb; r2 jsonb; r3 jsonb; v_sessions int;
BEGIN
  v := public.build_draft_order_for_league((SELECT league FROM _fix));

  IF NOT (v->>'ok')::boolean THEN
    RAISE EXCEPTION 'snake build refused: %', v::text;
  END IF;
  IF (v->>'rounds')::int <> 3 THEN
    RAISE EXCEPTION 'expected 3 rounds, got %', v->>'rounds';
  END IF;

  SELECT team_order INTO r1 FROM public.draft_order
   WHERE league_id=(SELECT league FROM _fix) AND round_number=1;
  SELECT team_order INTO r2 FROM public.draft_order
   WHERE league_id=(SELECT league FROM _fix) AND round_number=2;
  SELECT team_order INTO r3 FROM public.draft_order
   WHERE league_id=(SELECT league FROM _fix) AND round_number=3;

  IF jsonb_array_length(r1) <> 4 THEN
    RAISE EXCEPTION 'round 1 length %, expected 4', jsonb_array_length(r1);
  END IF;

  -- Even rounds reverse; odd rounds repeat round 1.
  IF r2 <> (SELECT jsonb_agg(u.x ORDER BY u.ord DESC)
              FROM jsonb_array_elements(r1) WITH ORDINALITY u(x,ord)) THEN
    RAISE EXCEPTION 'round 2 is not round 1 reversed';
  END IF;
  IF r3 <> r1 THEN
    RAISE EXCEPTION 'round 3 should match round 1 (snake returns forward)';
  END IF;

  SELECT count(DISTINCT draft_session_id) INTO v_sessions
    FROM public.draft_order WHERE league_id=(SELECT league FROM _fix);
  IF v_sessions <> 1 THEN
    RAISE EXCEPTION 'expected one draft_session_id across rounds, got %', v_sessions;
  END IF;
END $$;
\echo '  2. snake order: 3 rounds, even reversed, single session ✓'

-- ─────────────────────────────────────────────────────────────────────
-- 3. Linear never reverses.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.leagues SET settings = '{"draftType":"linear"}'::jsonb
 WHERE id = (SELECT league FROM _fix);

DO $$
DECLARE v jsonb; r1 jsonb; r2 jsonb;
BEGIN
  v := public.build_draft_order_for_league((SELECT league FROM _fix));
  IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'linear build refused: %', v::text; END IF;

  SELECT team_order INTO r1 FROM public.draft_order
   WHERE league_id=(SELECT league FROM _fix) AND round_number=1;
  SELECT team_order INTO r2 FROM public.draft_order
   WHERE league_id=(SELECT league FROM _fix) AND round_number=2;

  IF r2 <> r1 THEN RAISE EXCEPTION 'linear round 2 must equal round 1'; END IF;
END $$;
\echo '  3. linear: every round forward ✓'

-- ─────────────────────────────────────────────────────────────────────
-- 4. A rebuild replaces rather than duplicating — UNIQUE(league,round).
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_rows int;
BEGIN
  PERFORM public.build_draft_order_for_league((SELECT league FROM _fix));
  PERFORM public.build_draft_order_for_league((SELECT league FROM _fix));
  SELECT count(*) INTO v_rows FROM public.draft_order
   WHERE league_id=(SELECT league FROM _fix);
  IF v_rows <> 3 THEN
    RAISE EXCEPTION 'rebuild left % rows, expected 3', v_rows;
  END IF;
END $$;
\echo '  4. rebuild is idempotent in row count ✓'

-- ─────────────────────────────────────────────────────────────────────
-- 5. Refusals carry the real reason, and write nothing.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE v jsonb;
BEGIN
  -- 5a. roster shorter than league_size. start_draft_v2 requires
  --     jsonb_array_length(team_order) = league_size, so a short roster can
  --     never produce a startable order; say so instead of writing one.
  UPDATE public.leagues SET league_size = 8 WHERE id=(SELECT league FROM _fix);
  v := public.build_draft_order_for_league((SELECT league FROM _fix));
  IF (v->>'ok')::boolean OR v->>'reason' <> 'roster_incomplete' THEN
    RAISE EXCEPTION 'expected roster_incomplete, got %', v::text;
  END IF;
  IF (v->>'teams')::int <> 4 OR (v->>'league_size')::int <> 8 THEN
    RAISE EXCEPTION 'roster_incomplete detail wrong: %', v::text;
  END IF;
  UPDATE public.leagues SET league_size = 4 WHERE id=(SELECT league FROM _fix);

  -- 5b. league_size unset.
  UPDATE public.leagues SET league_size = NULL WHERE id=(SELECT league FROM _fix);
  v := public.build_draft_order_for_league((SELECT league FROM _fix));
  IF (v->>'ok')::boolean OR v->>'reason' <> 'invalid_league_size' THEN
    RAISE EXCEPTION 'expected invalid_league_size, got %', v::text;
  END IF;
  UPDATE public.leagues SET league_size = 4 WHERE id=(SELECT league FROM _fix);

  -- 5c. THE MID-DRAFT GUARD. Rebuilding an order under a running draft
  --     desynchronises the engine's in-memory order from what clients are
  --     served. DraftService refuses this; so must we.
  UPDATE public.leagues SET draft_status='in_progress' WHERE id=(SELECT league FROM _fix);
  v := public.build_draft_order_for_league((SELECT league FROM _fix));
  IF (v->>'ok')::boolean OR v->>'reason' <> 'draft_not_startable' THEN
    RAISE EXCEPTION 'expected draft_not_startable mid-draft, got %', v::text;
  END IF;
  UPDATE public.leagues SET draft_status='not_started' WHERE id=(SELECT league FROM _fix);

  -- 5d. unknown league.
  v := public.build_draft_order_for_league('00000000-0000-0000-0000-000000000000');
  IF (v->>'ok')::boolean OR v->>'reason' <> 'league_not_found' THEN
    RAISE EXCEPTION 'expected league_not_found, got %', v::text;
  END IF;
END $$;
\echo '  5. refusals: roster_incomplete / invalid_league_size / mid-draft / not_found ✓'

-- ─────────────────────────────────────────────────────────────────────
-- 6. Notifications: AI teams excluded, and deduped per scheduled time.
--    The sweep runs every 30s; a league that cannot start fails on every
--    pass, so without the dedup a commissioner gets 120 rows an hour.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_when timestamptz := now(); v_n int; v_total int;
BEGIN
  -- commissioner-only path
  v_n := public.notify_scheduled_start((SELECT league FROM _fix), v_when,
           'scheduled_start_failed', 'T', 'M', 'roster_incomplete', true);
  IF v_n <> 1 THEN RAISE EXCEPTION 'expected 1 commissioner notification, got %', v_n; END IF;

  -- same (league, kind, scheduled time) → suppressed
  v_n := public.notify_scheduled_start((SELECT league FROM _fix), v_when,
           'scheduled_start_failed', 'T', 'M', 'roster_incomplete', true);
  IF v_n <> 0 THEN RAISE EXCEPTION 'dedup failed: second call wrote % rows', v_n; END IF;

  -- a RESCHEDULED draft is a different time, so it speaks again
  v_n := public.notify_scheduled_start((SELECT league FROM _fix), v_when + interval '1 hour',
           'scheduled_start_failed', 'T', 'M', 'roster_incomplete', true);
  IF v_n <> 1 THEN RAISE EXCEPTION 'rescheduled draft should notify again, got %', v_n; END IF;

  -- all-managers path: 4 teams but only 1 has an owner; AI teams (owner_id
  -- null) must not receive rows — notifications.user_id is NOT NULL.
  v_n := public.notify_scheduled_start((SELECT league FROM _fix), v_when,
           'scheduled_draft_started', 'T', 'M', null, false);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected 1 owner notification (3 AI teams skipped), got %', v_n;
  END IF;

  SELECT count(*) INTO v_total FROM public.notifications
   WHERE league_id=(SELECT league FROM _fix) AND user_id IS NULL;
  IF v_total <> 0 THEN RAISE EXCEPTION 'wrote % null-user notifications', v_total; END IF;
END $$;
\echo '  6. notifications: AI teams skipped, deduped, reschedule re-notifies ✓'

-- ─────────────────────────────────────────────────────────────────────
-- 7. THE REGRESSION ITSELF. A scheduled league with no draft_order must
--    end up in_progress rather than dying on draft_not_configured.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM public.draft_order WHERE league_id = (SELECT league FROM _fix);

UPDATE public.leagues
   SET scheduled_draft_time = now() - interval '10 seconds',
       draft_status = 'not_started', draft_state = 'not_started'
 WHERE id = (SELECT league FROM _fix);

DO $$
DECLARE v_outcome text; v_status text; v_orders int;
BEGIN
  SELECT outcome INTO v_outcome
    FROM public.start_due_scheduled_drafts(120)
   WHERE league_id = (SELECT league FROM _fix);

  IF v_outcome IS NULL THEN
    RAISE EXCEPTION 'sweep did not pick up the due league at all';
  END IF;
  IF v_outcome <> 'started' THEN
    RAISE EXCEPTION 'expected outcome started, got %', v_outcome;
  END IF;

  SELECT draft_status::text INTO v_status FROM public.leagues
   WHERE id=(SELECT league FROM _fix);
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'league is % after a successful sweep, expected in_progress', v_status;
  END IF;

  SELECT count(*) INTO v_orders FROM public.draft_order
   WHERE league_id=(SELECT league FROM _fix);
  IF v_orders <> 3 THEN
    RAISE EXCEPTION 'sweep should have built 3 rounds, found %', v_orders;
  END IF;
END $$;
\echo '  7. REGRESSION: no-order league schedules, builds, ignites ✓'

-- ─────────────────────────────────────────────────────────────────────
-- 8. A league that cannot be built is refused BEFORE ignition, so the
--    reported reason is the real one rather than draft_not_configured.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_outcome text; v_detail text;
BEGIN
  UPDATE public.leagues
     SET draft_status='not_started', draft_state='not_started',
         league_size = 8, scheduled_draft_time = now() - interval '10 seconds'
   WHERE id=(SELECT league FROM _fix);
  DELETE FROM public.draft_order WHERE league_id=(SELECT league FROM _fix);

  SELECT outcome, detail INTO v_outcome, v_detail
    FROM public.start_due_scheduled_drafts(120)
   WHERE league_id=(SELECT league FROM _fix);

  IF v_outcome <> 'blocked' THEN
    RAISE EXCEPTION 'expected blocked, got %', coalesce(v_outcome,'<null>');
  END IF;
  IF v_detail <> 'roster_incomplete' THEN
    RAISE EXCEPTION 'expected roster_incomplete, got %', coalesce(v_detail,'<null>');
  END IF;
END $$;
\echo '  8. unbuildable league blocked pre-ignition with the real reason ✓'

ROLLBACK;

\echo '── all scheduled draft order build tests passed (rolled back) ──'
