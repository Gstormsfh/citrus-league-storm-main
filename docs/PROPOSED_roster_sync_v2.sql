-- ============================================================================
-- PROPOSED MIGRATION — NOT APPLIED. Review before running.
-- Architect, 2026-08-12. Fixes inbox E142: a completed v2 draft produces no roster.
--
-- Evidence (staging): 1,188 teams have rows in draft_picks_v2; 1,177 of them
-- have ZERO rows in roster_assignments. The only 11 teams with rosters all have
-- v1 draft_picks. Production (v1 drafts) has 216 roster rows across 12 teams.
--
-- Cause, both halves verified in source:
--   (a) nothing in server/src/draft/ (the v2 engine) references
--       sync_roster_assignments_for_league, complete_draft_and_sync, or
--       roster_assignments at all — the v2 pipeline ends at draft_picks_v2.
--   (b) both sync functions read `draft_picks` (v1). submit_pick_v2 writes
--       `draft_picks_v2`. The sync and the draft look at different tables.
--
-- Nothing rescues it later: staging's cron.job has exactly one entry, a nightly
-- security-drift check.
--
-- NOTE: `current_rosters` is a VIEW over roster_assignments — writing the table
-- is the whole job; the view follows. Confirmed via pg_class.relkind.
--
-- ============================================================================
-- ⚠️ TYPE NOTE — CORRECTED 2026-08-12 (inbox E167). READ BEFORE APPLYING.
--
-- The three player_id columns do NOT agree:
--     draft_picks.player_id        text      (v1)
--     draft_picks_v2.player_id     INTEGER   (v2)   ← the difference
--     roster_assignments.player_id text
--
-- The v1 function this file mirrors compares `ra.player_id = dp.player_id`,
-- which is text = text and correct there. This file originally preserved that
-- line verbatim — and against draft_picks_v2 it is text = INTEGER, which
-- Postgres rejects outright:
--
--     ERROR: 42883: operator does not exist: text = integer
--
-- Verified live against staging, not reasoned about. It would NOT have failed
-- at migration time: CREATE OR REPLACE accepts the body, and plpgsql only
-- plans the statement on first execution. It would have failed the first time
-- Garrett ran it on a real league, on the gap-fill branch.
--
-- Fixed: `dp.player_id::text` in the comparison and in both INSERT select
-- lists. The corrected predicate was executed against the 252-pick soak league
-- (ada00018-…-01) and returns exactly 252 rows to insert.
--
-- ✅ AND THE STATEMENTS THEMSELVES WERE EXECUTED (inbox E178, 2026-08-12) against
-- a disposable rig holding real v2 picks and an empty roster:
--     * initial-sync branch  → 2 rows written; player_id stored as TEXT from an
--       INTEGER source, values intact; team attribution followed pick order;
--       rows join cleanly back to player_directory (names resolve).
--     * gap-fill branch      → runs clean, inserts 0 (correctly sees the players
--       already assigned). Idempotent: 2 rows, 2 distinct players, no duplicates.
-- ✅ AND THE WRAPPER TOO (inbox E179): the full body was run inside an anonymous
-- DO block — legal, since that is not DDL and not CREATE FUNCTION. Verified:
--     run 1 → initial-sync branch selected (v_existing_count=0), 2 rows inserted,
--             v_inserted_count = v_total_picks so the mismatch WARNING did NOT
--             fire, exception handler never reached.
--     run 2 → gap-fill branch selected, GET DIAGNOSTICS reported 0, and the
--             surfaced values were: mode=gap_fill players_synced=0
--             existing_count=2 total_picks=2 — i.e. exactly the fields that
--             populate the returned jsonb.
--
-- STILL UNPROVEN, and it is now a short list:
--     * the CREATE OR REPLACE FUNCTION statement itself, and with it
--       SECURITY DEFINER + SET search_path — a DO block runs as the CALLER, so
--       definer semantics are untested. That is DDL and it is Garrett's.
--     * the backfill DO block (dry-run reviewed only).
--     * scale — tested at 2 picks, not 144/252.
--
-- NOTE ON THE MISMATCH WARNING: it is not boilerplate. draft_picks_v2's PK is
-- (league_id, pick_number); (league_id, player_id) is only an INDEX (see E162),
-- so the projection CAN hold a duplicate player. ON CONFLICT would then collapse
-- them and ROW_COUNT would come back short — this WARNING is the only thing that
-- would surface it. Keep it even after adding the unique constraint E162 asks for.
--
-- POST-APPLY PROOF IS THE COUNT, NOT THE BODY: E155's pg_proc check confirms the
-- function reads draft_picks_v2, but E167 showed a function can pass that check
-- and still fail at runtime. Trust `SELECT count(*) FROM roster_assignments
-- WHERE league_id = ...` = league_size × draft_rounds.
--
-- The irony is worth recording: this is the SAME disease as E142 itself — a
-- v1 assumption carried into v2 unchanged. The file's own comment boasting
-- that the body was "preserved verbatim" is precisely what introduced it.
-- ============================================================================

-- THIS FILE IS STEP 1 OF 3. Steps 2 and 3 are at the bottom and are NOT SQL.
-- ============================================================================

-- ── STEP 1: a v2-aware sync ─────────────────────────────────────────────────
--
-- Deliberately a SIBLING of sync_roster_assignments_for_league rather than an
-- edit to it. Rationale: the v1 function is the only thing standing between
-- production's 46 drafted teams and an empty roster, and production is where
-- the real users are. A new function cannot regress it. If the two are ever
-- merged, do it after THE TWELVE, not before.
--
-- The v2 body is SIMPLER than v1's, not more complex:
--   * no draft_session_id — v2 has no session concept; league_id + the append-
--     only event log is the identity. The whole v_latest_session_id block goes.
--   * no deleted_at — draft_picks_v2 is a projection of an append-only log and
--     carries no soft-delete column.
-- Everything else — gap-fill vs initial-sync, the ON CONFLICT, the mismatch
-- warning, the JSONB result shape, the exception wrapper — is preserved
-- verbatim so callers and logs are interchangeable between the two.

CREATE OR REPLACE FUNCTION public.sync_roster_assignments_for_league_v2(
  p_league_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count   INTEGER := 0;
  v_inserted_count   INTEGER := 0;
  v_gap_filled_count INTEGER := 0;
  v_total_picks      INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO v_total_picks
  FROM public.draft_picks_v2
  WHERE league_id = p_league_id;

  IF v_total_picks = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'league_id', p_league_id,
      'players_synced', 0,
      'source', 'draft_picks_v2',
      'message', 'No v2 draft picks found for this league'
    );
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM public.roster_assignments
  WHERE league_id = p_league_id;

  IF v_existing_count > 0 THEN
    -- ── Gap-fill: assignments exist. Insert only the missing players, so
    --    trades and waiver moves made after the draft are preserved.
    INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
    SELECT dp.league_id, dp.team_id, dp.player_id::text, COALESCE(dp.picked_at, NOW())
    FROM public.draft_picks_v2 dp
    WHERE dp.league_id = p_league_id
      AND NOT EXISTS (
        SELECT 1 FROM public.roster_assignments ra
        WHERE ra.league_id = dp.league_id
          AND ra.player_id = dp.player_id::text   -- ⚠️ ::text REQUIRED — see TYPE NOTE at top
      )
    ON CONFLICT (league_id, player_id) DO NOTHING;

    GET DIAGNOSTICS v_gap_filled_count = ROW_COUNT;

    RETURN jsonb_build_object(
      'success', true,
      'league_id', p_league_id,
      'players_synced', v_gap_filled_count,
      'existing_count', v_existing_count,
      'total_picks', v_total_picks,
      'source', 'draft_picks_v2',
      'mode', 'gap_fill',
      'message', format('Gap-fill v2: recovered %s of %s picks (had %s)',
                        v_gap_filled_count, v_total_picks, v_existing_count)
    );
  ELSE
    -- ── Initial sync: no assignments yet. Materialise the whole draft.
    INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
    SELECT dp.league_id, dp.team_id, dp.player_id::text, COALESCE(dp.picked_at, NOW())
    FROM public.draft_picks_v2 dp
    WHERE dp.league_id = p_league_id
    ON CONFLICT (league_id, player_id)
    DO UPDATE SET
      team_id     = EXCLUDED.team_id,
      acquired_at = EXCLUDED.acquired_at,
      updated_at  = NOW();

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count <> v_total_picks THEN
      RAISE WARNING 'V2 SYNC MISMATCH: inserted % but expected % picks (league %)',
        v_inserted_count, v_total_picks, p_league_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'league_id', p_league_id,
      'players_synced', v_inserted_count,
      'total_picks', v_total_picks,
      'source', 'draft_picks_v2',
      'mode', 'initial_sync',
      'is_1_to_1', v_inserted_count = v_total_picks,
      'message', format('Initial v2 sync: %s/%s players', v_inserted_count, v_total_picks)
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'league_id', p_league_id,
    'error', SQLERRM,
    'source', 'draft_picks_v2',
    'message', 'Failed to sync roster_assignments from v2 picks'
  );
END;
$$;

COMMENT ON FUNCTION public.sync_roster_assignments_for_league_v2(uuid) IS
  'Materialises roster_assignments from draft_picks_v2. Sibling of the v1 '
  'function, which reads draft_picks and must not be disturbed. Idempotent: '
  'safe to call repeatedly and safe to retry. See inbox E142.';


-- ── BACKFILL — run once, AFTER the function is created and verified ─────────
-- Every v2 league that already completed is currently stranded, including the
-- rig leagues from the night of Aug 11/12. Scoped to completed leagues only so
-- an in-flight draft is never touched mid-run.
--
-- REVIEW THE DRY RUN FIRST. Do not run the DO block until the counts look right.
--
-- ✅ THE DRY RUN HAS BEEN EXECUTED (inbox E180, 2026-08-12 ~10:15Z):
--       leagues selected .............. 109
--       roster rows it would create ... 1,718
--       smallest league ................. 2 picks
--       largest league ................ 252 picks
--       real user leagues in the set .... 0  (all 109 are rig / fixture data)
--
--   Re-run it before applying — these counts move as drafts complete.
--
--   ALSO VERIFIED: the DO block's loop predicate is IDENTICAL to the dry run's
--   (only the alias differs, r vs ra). That matters — the classic backfill
--   defect is reviewing one population and mutating another. Not present here.
--
--   The APPLY block was deliberately NOT run: it mutates 109 leagues, that is
--   Garrett's call, and unlike the dry run it is not undone by re-reading.

-- Dry run — what would be fixed:
--   SELECT l.id, l.name,
--          (SELECT count(*) FROM draft_picks_v2 p WHERE p.league_id = l.id) AS picks,
--          (SELECT count(*) FROM roster_assignments r WHERE r.league_id = l.id) AS roster_rows
--   FROM leagues l
--   WHERE l.draft_status = 'completed'
--     AND EXISTS (SELECT 1 FROM draft_picks_v2 p WHERE p.league_id = l.id)
--     AND NOT EXISTS (SELECT 1 FROM roster_assignments r WHERE r.league_id = l.id)
--   ORDER BY l.updated_at DESC;

-- Apply:
--   DO $backfill$
--   DECLARE r RECORD; v jsonb;
--   BEGIN
--     FOR r IN
--       SELECT l.id FROM leagues l
--       WHERE l.draft_status = 'completed'
--         AND EXISTS (SELECT 1 FROM draft_picks_v2 p WHERE p.league_id = l.id)
--         AND NOT EXISTS (SELECT 1 FROM roster_assignments ra WHERE ra.league_id = l.id)
--     LOOP
--       v := public.sync_roster_assignments_for_league_v2(r.id);
--       RAISE NOTICE '%', v;
--     END LOOP;
--   END
--   $backfill$;


-- ============================================================================
-- STEP 2 — THE CALL SITE (not SQL; belongs in the engine)
--
-- The v2 completion path must call this where `draft_completed` is appended.
-- Two requirements, both load-bearing:
--
--   * IDEMPOTENT AND RETRY-SAFE. The event log guarantees the event, not the
--     side effect. The function above is safe to call repeatedly by design —
--     lean on that rather than tracking whether it already ran.
--   * MUST NOT BLOCK THE COMPLETION BROADCAST. "ROSTERS ARE SET" should still
--     paint instantly; the materialisation happens behind it. A failed sync
--     must not prevent the room from rendering a finished draft.
--
-- Belt and braces worth having: also call it on the roster page's first load
-- when the league is completed and the team has zero assignments. That turns a
-- missed completion hook into a one-render delay instead of an empty season,
-- and it is the same idempotent call.
--
-- STEP 3 — THE TEST THAT SHOULD HAVE EXISTED
--
-- Assert that a completed v2 draft produces exactly `picks` roster rows per
-- team. This defect survived three days of certification — a five-checkpoint
-- corridor, an 86-draft load campaign and six live drafts — because every one
-- of them ended at "the draft finished correctly" and none asked what the
-- manager sees next. Add the sixth checkpoint: AFTER COMPLETION, THE MANAGER'S
-- ROSTER PAGE SHOWS THE PLAYERS HE DRAFTED.
--
-- ALSO NOTE: POST /api/rosters/league/:leagueId/sync (rosters.ts:296) is NOT a
-- draft-night fallback. It calls the v1-reading function and would return
-- "No draft picks found" on a v2 league. Point it at the v2 function — or make
-- it choose by which pick table has rows — in the same change.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFICATION — added 2026-08-12 (inbox E155). Do not skip.
-- ═══════════════════════════════════════════════════════════════════
-- E155 found a migration recorded in supabase_migrations.schema_migrations
-- whose replacement function is NOT what is live in pg_proc
-- (20260511010000's draft_deadline_sweep still carries the pgmq.send
-- that migration says it removed). Cause unknown -- partial apply,
-- snapshot restore, and out-of-order replay would all look like this.
-- One data point, on a function nobody calls, so it is NOT evidence of
-- a broken pipeline. But it costs one query to be sure this one landed:
--
--   SELECT proname, prosrc LIKE '%draft_picks_v2%' AS reads_v2
--     FROM pg_proc
--    WHERE proname = 'sync_roster_assignments_v2';
--
-- Expect reads_v2 = true. If the function is missing or still reads the
-- v1 draft_picks table, the migration did not take -- re-apply before
-- assuming the roster problem is fixed.
--
-- Then the actual proof, which is the number that matters:
--
--   SELECT count(*) FROM roster_assignments WHERE league_id = '<league>';
--
-- Expect rounds x teams (252 for a 12x21 league). Zero means the sync
-- ran against the wrong table; a partial count means the backfill was
-- scoped narrower than you intended.
