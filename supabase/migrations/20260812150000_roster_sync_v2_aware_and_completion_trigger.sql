-- ============================================================================
-- E142 — a completed v2 draft must produce rosters.
-- Applied to STAGING (jjgspcpvqaiitloglxbb) live on 2026-08-12 and verified
-- end to end; this file is the source-of-truth replay for any other database.
--
-- THE DEFECT
-- ----------
-- sync_roster_assignments_for_league() read ONLY the v1 `draft_picks` table.
-- Every league drafted on the v2 engine writes `draft_picks_v2`, so the
-- function returned "No draft picks found for this league" and the manager's
-- roster stayed empty after a completed draft. On staging that was 1,177 of
-- 1,188 teams. Nothing called it on the v2 completion path either, so even a
-- v2-aware function would not have fired.
--
-- WHAT THIS DOES
-- --------------
--   1. Makes the sync function choose its source table by which one actually
--      holds picks, v2 first. The v1 branch is byte-for-byte the previous
--      behaviour, so v1 leagues and production are unaffected.
--   2. Adds a call site as an AFTER INSERT trigger on `draft_events`, gated on
--      event_type = 'draft_completed'.
--
-- WHY THE TRIGGER AND NOT THE ENGINE
-- ----------------------------------
-- The original proposal (docs/PROPOSED_roster_sync_v2.sql, STEP 2) put the
-- call in the engine. The event log is a better home:
--   * It covers EVERY completion path — submit_pick_v2, close_nomination_v2
--     and commissioner override all append the same `draft_completed` event.
--     An engine hook covers only the paths the engine drives.
--   * No deploy surface. Engine, API and web are untouched.
--   * It is atomic with the completion it reacts to.
--
-- WHY IT CANNOT STRAND A DRAFT
-- ----------------------------
-- sync_roster_assignments_for_league ends in `EXCEPTION WHEN OTHERS THEN
-- RETURN jsonb_build_object('success', false, ...)`. It never re-raises, so it
-- cannot abort the transaction carrying the final pick and the completion.
-- The proposal's hard requirement — "MUST NOT BLOCK THE COMPLETION BROADCAST"
-- — is satisfied by the callee's own contract rather than by hope. A failure
-- degrades to an empty roster plus a WARNING (today's behaviour), never to a
-- lost pick.
--
-- ORDERING (checked, not assumed)
-- -------------------------------
-- `draft_completed` is appended by submit_pick_v2 AFTER the final pick's
-- INSERT into draft_events, and draft_events_project_pick_trg is an AFTER
-- INSERT trigger in that same transaction. Every pick — including the last —
-- is already projected into draft_picks_v2 by the time this runs.
--
-- TYPE NOTE (inbox E167 — this exact line shipped broken once)
-- -----------------------------------------------------------
--   draft_picks_v2.player_id      is INTEGER
--   roster_assignments.player_id  is TEXT
-- Every comparison and insert of a v2 player_id MUST carry ::text. Without it
-- Postgres raises `operator does not exist: text = integer` at RUNTIME, not at
-- CREATE time — plpgsql plans on first execution, so a broken body applies
-- cleanly and fails on draft night.
--
-- VERIFIED ON STAGING 2026-08-12
-- ------------------------------
--   * 24-pick league  -> 24 rows, 12 teams, every row matching its source pick
--   * 252-pick soak   -> 252/252, is_1_to_1 true
--   * idempotent      -> second call returns gap_fill / 0 rows
--   * backfill        -> 1,302 of 1,302 teams now match their pick count; 0 empty
--   * LIVE DRAFT      -> draft_started -> 4x pick -> draft_completed produced
--                        4 roster rows with no intervention, correct snake
--                        order, names resolving
--   * cost            -> draft_completed shares a timestamp with the final
--                        pick (0.000 ms); autopick cadence unchanged at 2.117s
--
-- TO REVERSE THE CALL SITE ONLY:
--   DROP TRIGGER draft_events_sync_roster_trg ON public.draft_events;
-- ============================================================================

-- ── 1. v2-aware sync ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_roster_assignments_for_league(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_count   INTEGER := 0;
  v_inserted_count   INTEGER := 0;
  v_gap_filled_count INTEGER := 0;
  v_latest_session_id UUID;
  v_total_picks      INTEGER := 0;
  v_use_v2           BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.draft_picks_v2 WHERE league_id = p_league_id
  ) INTO v_use_v2;

  IF v_use_v2 THEN
    -- ══ V2 PATH ═══════════════════════════════════════════════════════
    -- No deleted_at and no draft_session_id on the v2 projection: it is
    -- rebuilt from the append-only event log, so it carries no soft-delete
    -- or multi-session history to disambiguate.
    SELECT COUNT(*) INTO v_total_picks
      FROM public.draft_picks_v2 WHERE league_id = p_league_id;

    SELECT COUNT(*) INTO v_existing_count
      FROM public.roster_assignments WHERE league_id = p_league_id;

    IF v_existing_count > 0 THEN
      INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
      SELECT dp.league_id, dp.team_id, dp.player_id::text,
             COALESCE(dp.picked_at, NOW())
        FROM public.draft_picks_v2 dp
       WHERE dp.league_id = p_league_id
         AND NOT EXISTS (
           SELECT 1 FROM public.roster_assignments ra
            WHERE ra.league_id = dp.league_id
              AND ra.player_id = dp.player_id::text   -- ::text REQUIRED (E167)
         )
      ON CONFLICT (league_id, player_id) DO NOTHING;

      GET DIAGNOSTICS v_gap_filled_count = ROW_COUNT;

      RETURN jsonb_build_object(
        'success', true, 'league_id', p_league_id,
        'players_synced', v_gap_filled_count,
        'existing_count', v_existing_count,
        'total_picks_in_session', v_total_picks,
        'skipped', false, 'mode', 'gap_fill', 'source', 'draft_picks_v2',
        'message', CASE WHEN v_gap_filled_count = 0
          THEN format('No gaps found: all %s v2 picks already have roster assignments', v_total_picks)
          ELSE format('Gap-fill (v2): recovered %s missing player(s) (had %s, now %s)',
                      v_gap_filled_count, v_existing_count, v_existing_count + v_gap_filled_count)
        END
      );
    ELSE
      INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
      SELECT dp.league_id, dp.team_id, dp.player_id::text,
             COALESCE(dp.picked_at, NOW())
        FROM public.draft_picks_v2 dp
       WHERE dp.league_id = p_league_id
      ON CONFLICT (league_id, player_id)
      DO UPDATE SET team_id     = EXCLUDED.team_id,
                    acquired_at = EXCLUDED.acquired_at,
                    updated_at  = NOW();

      GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

      -- Detector for the E162 gap: (league_id, player_id) on draft_picks_v2 is
      -- an INDEX, not a UNIQUE constraint, so the projection can in principle
      -- hold one player twice. ON CONFLICT would collapse them and ROW_COUNT
      -- would come back short. This warning is the only thing anywhere that
      -- would surface it.
      IF v_inserted_count <> v_total_picks THEN
        RAISE WARNING 'V2 SYNC MISMATCH: inserted % but expected % picks (league %)',
          v_inserted_count, v_total_picks, p_league_id;
      END IF;

      RETURN jsonb_build_object(
        'success', true, 'league_id', p_league_id,
        'players_synced', v_inserted_count,
        'total_picks_in_session', v_total_picks,
        'skipped', false, 'mode', 'initial_sync', 'source', 'draft_picks_v2',
        'is_1_to_1', v_inserted_count = v_total_picks,
        'message', format('Initial sync (v2): %s/%s players', v_inserted_count, v_total_picks)
      );
    END IF;
  END IF;

  -- ══ V1 PATH — unchanged from the pre-2026-08-12 definition ════════════
  SELECT draft_session_id INTO v_latest_session_id
  FROM public.draft_picks
  WHERE league_id = p_league_id AND deleted_at IS NULL AND draft_session_id IS NOT NULL
  ORDER BY picked_at DESC LIMIT 1;

  IF v_latest_session_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.draft_picks WHERE league_id = p_league_id AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object('success', true, 'league_id', p_league_id,
        'players_synced', 0, 'message', 'No draft picks found for this league');
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM public.roster_assignments WHERE league_id = p_league_id;

  SELECT COUNT(*) INTO v_total_picks
  FROM public.draft_picks
  WHERE league_id = p_league_id AND deleted_at IS NULL
    AND (v_latest_session_id IS NULL OR draft_session_id = v_latest_session_id);

  IF v_existing_count > 0 THEN
    INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
    SELECT dp.league_id, dp.team_id, dp.player_id, COALESCE(dp.picked_at, NOW())
    FROM public.draft_picks dp
    WHERE dp.league_id = p_league_id AND dp.deleted_at IS NULL
      AND (v_latest_session_id IS NULL OR dp.draft_session_id = v_latest_session_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.roster_assignments ra
        WHERE ra.league_id = dp.league_id AND ra.player_id = dp.player_id
      )
    ON CONFLICT (league_id, player_id) DO NOTHING;

    GET DIAGNOSTICS v_gap_filled_count = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'league_id', p_league_id,
      'players_synced', v_gap_filled_count, 'existing_count', v_existing_count,
      'total_picks_in_session', v_total_picks, 'draft_session_id', v_latest_session_id,
      'skipped', false, 'mode', 'gap_fill', 'source', 'draft_picks',
      'message', CASE WHEN v_gap_filled_count = 0
        THEN format('No gaps found: all %s draft picks already have roster assignments', v_total_picks)
        ELSE format('Gap-fill: recovered %s missing player(s) from draft session %s (had %s, now %s)',
          v_gap_filled_count, v_latest_session_id, v_existing_count, v_existing_count + v_gap_filled_count)
      END);
  ELSE
    INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
    SELECT dp.league_id, dp.team_id, dp.player_id, COALESCE(dp.picked_at, NOW())
    FROM public.draft_picks dp
    WHERE dp.league_id = p_league_id AND dp.deleted_at IS NULL
      AND (v_latest_session_id IS NULL OR dp.draft_session_id = v_latest_session_id)
    ON CONFLICT (league_id, player_id)
    DO UPDATE SET team_id = EXCLUDED.team_id, acquired_at = EXCLUDED.acquired_at, updated_at = NOW();

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count <> v_total_picks THEN
      RAISE WARNING 'SYNC MISMATCH: inserted % but expected % picks (session %)',
        v_inserted_count, v_total_picks, v_latest_session_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'league_id', p_league_id,
      'players_synced', v_inserted_count, 'total_picks_in_session', v_total_picks,
      'draft_session_id', v_latest_session_id, 'skipped', false,
      'mode', 'initial_sync', 'source', 'draft_picks',
      'is_1_to_1', v_inserted_count = v_total_picks,
      'message', format('Initial sync: %s/%s players from session %s',
        v_inserted_count, v_total_picks, v_latest_session_id));
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'league_id', p_league_id,
    'error', SQLERRM, 'message', 'Failed to sync roster_assignments');
END;
$function$;

-- ── 2. the call site ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_draft_events_sync_roster()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.sync_roster_assignments_for_league(NEW.league_id);

  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE WARNING 'ROSTER SYNC FAILED on draft_completed for league % — %',
      NEW.league_id, COALESCE(v_result->>'error', '<no error field>');
  ELSIF COALESCE((v_result->>'players_synced')::int, 0) = 0
        AND COALESCE((v_result->>'existing_count')::int, 0) = 0 THEN
    RAISE WARNING 'ROSTER SYNC produced 0 rows on draft_completed for league % — %',
      NEW.league_id, COALESCE(v_result->>'message', '<no message>');
  END IF;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$function$;

DROP TRIGGER IF EXISTS draft_events_sync_roster_trg ON public.draft_events;

-- The WHEN clause keeps this free for the other ~99% of events: Postgres
-- evaluates the condition without entering the function at all.
CREATE TRIGGER draft_events_sync_roster_trg
AFTER INSERT ON public.draft_events
FOR EACH ROW
WHEN (NEW.event_type = 'draft_completed')
EXECUTE FUNCTION public.tg_draft_events_sync_roster();

-- ── 3. backfill leagues that completed before this landed ───────────────────
-- Safe to re-run: the function is idempotent, and this only visits leagues
-- with v2 picks and zero roster rows.
DO $$
DECLARE r record; n int := 0; total int := 0; failed int := 0; res jsonb;
BEGIN
  FOR r IN
    SELECT l.id FROM public.leagues l
     WHERE EXISTS (SELECT 1 FROM public.draft_picks_v2 p WHERE p.league_id = l.id)
       AND NOT EXISTS (SELECT 1 FROM public.roster_assignments ra WHERE ra.league_id = l.id)
  LOOP
    res := public.sync_roster_assignments_for_league(r.id);
    n := n + 1;
    total := total + COALESCE((res->>'players_synced')::int, 0);
    IF COALESCE((res->>'success')::boolean, false) IS NOT TRUE THEN failed := failed + 1; END IF;
  END LOOP;
  RAISE NOTICE 'roster backfill: leagues=% rows=% failed=%', n, total, failed;
END $$;

-- ── 4. POST-APPLY VERIFICATION — do not skip (inbox E155) ───────────────────
-- E155 found a migration recorded in schema_migrations whose live function was
-- NOT what the migration said. Applying cleanly is not evidence of anything;
-- plpgsql plans on first execution. Run both of these:
--
--   SELECT proname, prosrc LIKE '%draft_picks_v2%' AS reads_v2
--     FROM pg_proc WHERE proname = 'sync_roster_assignments_for_league';
--   -- expect reads_v2 = true
--
--   WITH tp AS (SELECT league_id, team_id, count(*) picks
--                 FROM draft_picks_v2 GROUP BY 1,2),
--        tr AS (SELECT league_id, team_id, count(*) rows
--                 FROM roster_assignments GROUP BY 1,2)
--   SELECT count(*) FILTER (WHERE COALESCE(tr.rows,0) = 0) AS teams_with_zero_roster
--     FROM tp LEFT JOIN tr USING (league_id, team_id);
--   -- expect 0
