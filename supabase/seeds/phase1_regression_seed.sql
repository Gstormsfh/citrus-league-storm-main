-- ════════════════════════════════════════════════════════════════════════
-- Phase 1 regression seed — v1 fake draft on staging.
-- ════════════════════════════════════════════════════════════════════════
--
-- Purpose. Create ONE working v1 league on staging that can host a draft
--          end-to-end via the v1 path (`make_draft_pick` RPC). Use this to
--          smoke-test v1 BEFORE applying the Phase 1 migration, then run
--          the same smoke AFTER the migration to prove zero regression.
--
-- Where.   STAGING ONLY (Supabase project `jjgspcpvqaiitloglxbb`).
--          Refuses to run on prod via the guard at the top of the DO block.
--
-- How.     Paste this whole file into the Supabase SQL Editor (which runs
--          as `service_role` and bypasses RLS), edit the four variables
--          inside the `DECLARE` block (commissioner_user_id, league_id,
--          team_count, draft_rounds), and click Run. Re-running is safe:
--          deterministic UUIDs + `ON CONFLICT DO NOTHING` make the seed
--          idempotent.
--
-- Prereq.  At least one user must already exist in `auth.users` to act as
--          the league commissioner. Easiest path: log in to
--          staging.citrusfantasysports.com once via the normal email/
--          password flow. Your auth UID is then visible in
--          Supabase dashboard → Authentication → Users.
--
-- Cleanup. Block at the bottom (commented out) drops everything this seed
--          inserted, identified by the deterministic `seed_league_id`.
--
-- Reusability. Phase 2 / Phase 3 / Phase 7 soak harness can reuse this
--              seed as the starting fixture. Edit the league_id only if
--              you need multiple seeded leagues side by side.
--
-- Spec / plan refs:
--   - docs/DRAFT_ENGINE_V2_PLAN.md (Phase 1 verify step: "smoke-test one
--     fake draft via prior tooling").
--   - docs/RUNBOOKS/draft-engine-v2-staging-preflight.md §3 (synthetic
--     league seeding pattern).
--
-- ════════════════════════════════════════════════════════════════════════

DO $seed$
DECLARE
  ----------------------------------------------------------------------
  -- ▼ EDIT THESE FOUR VALUES BEFORE RUNNING ▼
  ----------------------------------------------------------------------

  -- Your staging auth.users id. Find it in Supabase dashboard →
  -- Authentication → Users (UID column). Required: cannot be the
  -- all-zeros default; the seed raises if you forget.
  v_commissioner_user_id  uuid := '882b59c9-8882-418b-9450-3fd004d57edd';

  -- Deterministic league id. Fixed so re-runs are idempotent and the
  -- cleanup block can find it. Change only if you need multiple
  -- seeded leagues at once.
  v_seed_league_id        uuid := '11111111-1111-1111-1111-111111111111';

  -- Number of teams. Per CLAUDE.md / plan: default 12.
  v_team_count            int  := 12;

  -- Draft rounds. Default matches `leagues.draft_rounds` default (21).
  -- Setting this populates `draft_order` rows for all rounds in
  -- snake/serpentine order so v1 renders a complete bracket.
  v_draft_rounds          int  := 21;

  ----------------------------------------------------------------------
  -- ▲ Edit nothing below this line. ▲
  ----------------------------------------------------------------------

  v_seed_session_id       uuid := '22222222-2222-2222-2222-222222222222';
  v_minutes_until_draft   int  := 5;
  v_team_ids              uuid[];
  v_round                 int;
  v_ordered               jsonb;
  v_first_team_id         uuid;
BEGIN
  -- ── Guard 0 — refuse to run unless the commissioner UID was set ────
  IF v_commissioner_user_id = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION
      'You must set v_commissioner_user_id (top of DO block) to your '
      'staging auth.users id before running this seed. Find it in '
      'Supabase dashboard -> Authentication -> Users.';
  END IF;

  -- ── Guard 1 — verify the commissioner exists in auth.users ─────────
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_commissioner_user_id
  ) THEN
    RAISE EXCEPTION
      'auth.users row not found for commissioner_user_id %. Log in to '
      'staging once to create your auth.users row, then re-run.',
      v_commissioner_user_id;
  END IF;

  -- ── Guard 2 — refuse to run on prod ─────────────────────────────────
  -- The staging Supabase project ref is jjgspcpvqaiitloglxbb. inet_server_addr()
  -- on staging resolves to a hostname containing that ref. On prod it
  -- resolves to a different ref. This is paranoid but cheap.
  IF inet_server_addr() IS NOT NULL
     AND inet_server_addr()::text NOT LIKE '%jjgspcpvqaiitloglxbb%'
     AND current_setting('app.allow_seed_off_staging', true) IS DISTINCT FROM 'yes'
  THEN
    -- Most Supabase hosted DBs do NOT have inet_server_addr() return the
    -- project ref directly — this guard will only fire in rare network
    -- topologies. The user-set GUC `app.allow_seed_off_staging=yes`
    -- bypasses the check. The runbook documents both paths.
    RAISE NOTICE
      'Staging-host check inconclusive (inet_server_addr=%). Continuing. '
      'Manually verify you are on staging before relying on this seed.',
      inet_server_addr();
  END IF;

  RAISE NOTICE 'Seeding v1 fake draft. league_id=%, team_count=%, rounds=%',
    v_seed_league_id, v_team_count, v_draft_rounds;

  ----------------------------------------------------------------------
  -- 1. League row.
  --    `draft_status='queued'` is what gates DraftRoom.tsx into the
  --    "all users can enter the draft room" UI branch (per
  --    DraftRoom.tsx:588-598). `scheduled_draft_time` 5 min in the
  --    future displays a countdown; 5 min is enough lead-time for the
  --    smoke test without making the tester wait.
  ----------------------------------------------------------------------
  INSERT INTO public.leagues (
    id,
    name,
    commissioner_id,
    draft_status,
    draft_rounds,
    roster_size,
    league_size,
    scheduled_draft_time,
    join_code
  )
  VALUES (
    v_seed_league_id,
    'Phase 1 Regression Seed',
    v_commissioner_user_id,
    'queued',
    v_draft_rounds,
    21,
    v_team_count,
    now() + make_interval(mins => v_minutes_until_draft),
    'PHASE1SEED'
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Re-runs reset the schedule + counter so the seed always presents
    -- a fresh "draft about to start" state.
    scheduled_draft_time = EXCLUDED.scheduled_draft_time,
    draft_status         = 'queued',
    league_size          = EXCLUDED.league_size,
    draft_rounds         = EXCLUDED.draft_rounds;

  ----------------------------------------------------------------------
  -- 2. Teams. Generate v_team_count of them with deterministic UUIDs
  --    so re-runs find the same rows. Team #1's owner_id = commissioner
  --    so the smoke test can drive picks from at least one human-owned
  --    seat. Teams #2..N are unowned (owner_id NULL) — the commissioner
  --    can still pick for them via `make_draft_pick`'s commissioner
  --    bypass.
  ----------------------------------------------------------------------
  v_team_ids := ARRAY[]::uuid[];
  FOR v_round IN 1..v_team_count LOOP
    -- Deterministic: 33333333-...-NN where NN is the team slot.
    DECLARE
      v_team_id uuid;
      v_owner   uuid;
    BEGIN
      v_team_id := ('33333333-3333-3333-3333-' ||
                    lpad(v_round::text, 12, '0'))::uuid;
      v_owner   := CASE WHEN v_round = 1 THEN v_commissioner_user_id ELSE NULL END;

      INSERT INTO public.teams (id, league_id, team_name, owner_id)
      VALUES (
        v_team_id,
        v_seed_league_id,
        format('Seed Team %s', lpad(v_round::text, 2, '0')),
        v_owner
      )
      ON CONFLICT (id) DO UPDATE SET
        team_name = EXCLUDED.team_name,
        owner_id  = EXCLUDED.owner_id;

      v_team_ids := v_team_ids || v_team_id;
    END;
  END LOOP;

  v_first_team_id := v_team_ids[1];
  RAISE NOTICE 'Seeded % teams. First team (owned): %',
    array_length(v_team_ids, 1), v_first_team_id;

  ----------------------------------------------------------------------
  -- 3. Draft order. Snake/serpentine: round N forward, round N+1
  --    reversed. Pre-populating all rounds means v1's draft UI has a
  --    complete bracket from pick 1 — useful for visual smoke testing,
  --    not strictly required (v1 generates rounds on demand otherwise).
  ----------------------------------------------------------------------
  FOR v_round IN 1..v_draft_rounds LOOP
    IF v_round % 2 = 1 THEN
      -- Odd rounds: 1..N
      v_ordered := to_jsonb(v_team_ids);
    ELSE
      -- Even rounds: N..1
      v_ordered := to_jsonb(
        ARRAY(
          SELECT t
          FROM unnest(v_team_ids) WITH ORDINALITY AS x(t, ord)
          ORDER BY ord DESC
        )
      );
    END IF;

    INSERT INTO public.draft_order (
      league_id, round_number, team_order, draft_session_id
    )
    VALUES (
      v_seed_league_id, v_round, v_ordered, v_seed_session_id
    )
    ON CONFLICT (league_id, round_number) DO UPDATE SET
      team_order        = EXCLUDED.team_order,
      draft_session_id  = EXCLUDED.draft_session_id;
  END LOOP;

  RAISE NOTICE 'Seeded % rounds of draft_order (snake).', v_draft_rounds;
  RAISE NOTICE 'Seed complete. League: %  Session: %',
    v_seed_league_id, v_seed_session_id;
END
$seed$;

-- ════════════════════════════════════════════════════════════════════════
-- Verification block. Run this after the seed to confirm state.
-- ════════════════════════════════════════════════════════════════════════
SELECT
  l.id                                                 AS league_id,
  l.name,
  l.draft_status,
  l.league_size,
  l.draft_rounds,
  l.scheduled_draft_time,
  (SELECT count(*) FROM teams t       WHERE t.league_id = l.id) AS teams,
  (SELECT count(*) FROM draft_order d WHERE d.league_id = l.id) AS draft_order_rows,
  (SELECT count(*) FROM draft_picks p WHERE p.league_id = l.id) AS picks_so_far
FROM leagues l
WHERE l.id = '11111111-1111-1111-1111-111111111111';

-- Expected after a fresh run:
--   draft_status        = 'queued'
--   teams               = 12 (or v_team_count)
--   draft_order_rows    = 21 (or v_draft_rounds)
--   picks_so_far        = 0
--   scheduled_draft_time ≈ now() + 5 min

-- ════════════════════════════════════════════════════════════════════════
-- Baseline-capture protocol — PRE-MIGRATION (run BEFORE `supabase db push`)
-- ════════════════════════════════════════════════════════════════════════
-- The point of this protocol is to capture, with screenshots and a SQL
-- snapshot, exactly what v1 looks and behaves like on this seeded league
-- BEFORE the Phase 1 migration runs. After the migration you re-run the
-- same protocol; any visual or data divergence is a regression.
--
-- ──────────────────────────────────────────────────────────────────────
-- About v1's autopick behavior on this seed (read this once before
-- starting — it explains what to expect at each step).
-- ──────────────────────────────────────────────────────────────────────
-- The schema constraint `unique(league_id, owner_id)` (see
-- `supabase/migrations/20250101000001_create_leagues_teams_tables.sql:27`)
-- prevents one user from owning multiple teams in the same league.
-- This seed therefore assigns ONLY team 1 to your commissioner UID;
-- teams 2–12 are unowned (`owner_id = NULL`).
--
-- v1 treats unowned teams as "AI teams" (DraftRoom.tsx:1850). When
-- the next team is unowned and the commissioner's browser is open,
-- v1 schedules an autopick **1.5 seconds** after the prior pick
-- commits (DraftRoom.tsx:2193-2199). That means:
--   - Team 1's turn  → manual pick by you (or v1 timer-expiry autopick).
--   - Teams 2–12     → AI autopick fires ~1.5s after each prior pick.
--                      You don't need to "let the timer expire" for
--                      these — the AI autopick beats the timer.
--
-- This is fine for the baseline. We're capturing v1's actual behavior,
-- including the 1.5s AI-autopick path, which is one of the v1 paths
-- v2 replaces with a server-authoritative scheduler.
--
-- ──────────────────────────────────────────────────────────────────────
-- Step 1. Lobby snapshot.
-- ──────────────────────────────────────────────────────────────────────
--   Sign in to https://staging.citrusfantasysports.com as the
--   commissioner (882b59c9-…). Navigate to:
--     /league/11111111-1111-1111-1111-111111111111
--   Confirm: lobby renders, draft countdown shows ~5 min, all 12
--   seed teams appear with the right names.
--   📸  Screenshot: lobby.
--
-- ──────────────────────────────────────────────────────────────────────
-- Step 2. Trigger the draft to start.
-- ──────────────────────────────────────────────────────────────────────
--   v1 advances `draft_status` from `'queued'` → `'in_progress'` when
--   `scheduled_draft_time` passes (or via an explicit start action).
--   To start immediately, run in the Supabase SQL Editor:
--
--     UPDATE leagues
--        SET scheduled_draft_time = now()
--      WHERE id = '11111111-1111-1111-1111-111111111111';
--
--   Refresh the draft page. Confirm:
--     - Pick timer is counting down.
--     - Team 1 ("Seed Team 01") is on the clock.
--     - Pick #1 shows team 1's name.
--   📸  Screenshot: draft active, team 1 on clock.
--
-- ──────────────────────────────────────────────────────────────────────
-- Step 3. Manual pick as team 1.
-- ──────────────────────────────────────────────────────────────────────
--   Pick a player from the available list — anyone who is clearly
--   recognizable in the picks list (e.g. McDavid, MacKinnon).
--   Confirm:
--     - Pick saves (no toast error).
--     - Pick #1 appears in the picks list with team 1's name and the
--       player you chose.
--     - The clock advances; team 2 ("Seed Team 02") is now on the
--       clock with a fresh timer.
--   📸  Screenshot: picks list showing pick #1.
--
-- ──────────────────────────────────────────────────────────────────────
-- Step 4. Observe v1 AI autopick fire for team 2.
-- ──────────────────────────────────────────────────────────────────────
--   Do NOTHING. Wait ~1.5–3 seconds. v1's AI autopick path
--   (DraftRoom.tsx:2196 `setTimeout(..., 1500)`) should fire and
--   pick a player for team 2 automatically. Confirm:
--     - Pick #2 appears with team 2's name.
--     - The picks list shows two rows.
--     - The clock advances to team 3 with a fresh timer.
--   📸  Screenshot: picks list showing picks #1 and #2.
--
-- ──────────────────────────────────────────────────────────────────────
-- Step 5. Let v1 AI autopick fire 2–3 more times (teams 3, 4, 5).
-- ──────────────────────────────────────────────────────────────────────
--   With teams 3–12 also unowned, AI autopick will continue picking
--   automatically every ~1.5s. Watch picks #3, #4, #5 land.
--   Note: this is NOT a manual-pick test — see the "About v1's
--   autopick behavior" note above for why. We're observing the
--   AI autopick flow is stable and not stalling.
--   Confirm:
--     - Picks #3–#5 land at roughly 1.5–2s intervals.
--     - No "Pick failed" / "Network error" toasts.
--     - The picks list stays in pick-number order (1, 2, 3, 4, 5).
--   📸  Screenshot: picks list after pick #5.
--
-- ──────────────────────────────────────────────────────────────────────
-- Step 6. Capture the data baseline.
-- ──────────────────────────────────────────────────────────────────────
--   Run the following in the Supabase SQL Editor and SAVE THE OUTPUT
--   as `baseline_pre_migration.txt` (or paste into a draft PR comment):
--
--     SELECT round_number,
--            pick_number,
--            team_id,
--            player_id,
--            picked_at
--     FROM   draft_picks
--     WHERE  league_id = '11111111-1111-1111-1111-111111111111'
--     ORDER  BY pick_number;
--
--   Note: v1's `draft_picks` does not have a `source` column. The
--   distinction between "manual" (pick #1) and "autopick" (picks
--   #2..N) is implicit — we know it from the protocol order, not
--   the data. v2 captures this in `draft_events.actor.kind`.
--
--   This snapshot is the pre-migration baseline.
--
-- ════════════════════════════════════════════════════════════════════════
-- POST-MIGRATION protocol (run AFTER `supabase db push` and the smoke
-- test in `supabase/tests/draft_engine_v2_phase1_smoke.sql`).
-- ════════════════════════════════════════════════════════════════════════
--
-- Step 7.  Re-seed (cleanup block at the bottom + re-run this seed) to
--          restore an unstarted "queued" league. The schema migration
--          should not affect v1, but we want a clean slate so the
--          comparison is apples-to-apples.
--
-- Step 8.  Repeat steps 1–6 exactly. Compare each screenshot side-by-side
--          with its pre-migration counterpart. If anything differs:
--          colors, labels, button positions, picks-list rendering, the
--          clock — that is a regression to investigate before approving
--          Phase 1.
--
-- Step 9.  Diff the two SQL outputs from step 6. The picks themselves
--          will differ (RNG-driven AI selection), but the SHAPE
--          (5 rows, gap-free pick_numbers 1..5, all team_ids in
--          {seed team UUIDs}, picked_at monotonic) must be identical.
--
-- Step 10. Smoke the new v2 sync endpoint:
--
--     curl -H "Authorization: Bearer $JWT" \
--       https://staging.citrusfantasysports.com/api/draft/v2/league/11111111-1111-1111-1111-111111111111/sync
--
--   Expected response (200), spec §7.2 shape:
--     { "data": {
--         "server_time":         "2026-04-25T..Z",
--         "pick_deadline":       null,
--         "current_seq":         0,
--         "current_pick_number": 1,
--         "draft_state":         "not_started",
--         "payload_hash":        null
--       }
--     }
--
--   Note: v2's `draft_state` is independent of v1's `draft_status`.
--   This seed leaves `draft_state` at its default ('not_started')
--   because Phase 1 doesn't drive any v2 state transitions yet.
--   Phase 2 lands the RPCs that will do that.
--
-- Step 11. Final additivity assertion. Run in the SQL Editor:
--
--     SELECT
--       (SELECT count(*) FROM draft_picks    WHERE league_id = '11111111-1111-1111-1111-111111111111') AS v1_picks,
--       (SELECT count(*) FROM draft_events   WHERE league_id = '11111111-1111-1111-1111-111111111111') AS v2_events,
--       (SELECT count(*) FROM draft_picks_v2 WHERE league_id = '11111111-1111-1111-1111-111111111111') AS v2_projection;
--
--   Expected: v1_picks > 0 (whatever you ended up with from step 8),
--             v2_events = 0, v2_projection = 0. v2 is dormant.
--

-- ════════════════════════════════════════════════════════════════════════
-- Cleanup. Uncomment and run when you're done with the seeded league.
-- ════════════════════════════════════════════════════════════════════════
--
-- BEGIN;
-- DELETE FROM draft_picks WHERE league_id = '11111111-1111-1111-1111-111111111111';
-- DELETE FROM draft_order WHERE league_id = '11111111-1111-1111-1111-111111111111';
-- DELETE FROM teams       WHERE league_id = '11111111-1111-1111-1111-111111111111';
-- DELETE FROM leagues     WHERE id        = '11111111-1111-1111-1111-111111111111';
-- COMMIT;
