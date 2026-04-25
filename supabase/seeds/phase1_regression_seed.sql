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
  v_commissioner_user_id  uuid := '00000000-0000-0000-0000-000000000000';

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
-- Smoke-test commands (paste manually after seeding).
-- ════════════════════════════════════════════════════════════════════════
--
-- BEFORE applying the Phase 1 migration:
--   1. Open staging.citrusfantasysports.com signed in as the commissioner.
--   2. Open the seeded league: /league/11111111-1111-1111-1111-111111111111
--   3. Verify the lobby renders, draft countdown shows ~5 min, all 12
--      seed teams appear in the lobby.
--   4. (Optional) Make pick #1 via SQL to confirm v1 RPC works:
--
--      SELECT make_draft_pick(
--        p_league_id        => '11111111-1111-1111-1111-111111111111',
--        p_team_id          => '33333333-3333-3333-3333-000000000001',
--        p_player_id        => '8478402',  -- Connor McDavid (NHL API id)
--        p_round_number     => 1,
--        p_pick_number      => 1,
--        p_draft_session_id => '22222222-2222-2222-2222-222222222222'
--      );
--
--      Confirm a row appears in `draft_picks`. (You'll want to roll this
--      back before the after-migration test, OR re-seed between runs —
--      see cleanup block below.)
--
-- AFTER applying the Phase 1 migration:
--   5. Re-run the same lobby check + same `make_draft_pick(...)` call.
--      Expectation: identical behaviour. The Phase 1 migration adds
--      tables/columns but does not modify v1's path.
--   6. Confirm v2 sync endpoint:
--
--      curl -H "Authorization: Bearer $JWT" \
--        https://staging.citrusfantasysports.com/api/draft/v2/league/11111111-1111-1111-1111-111111111111/sync
--
--      Expectation: 200, body matches spec §7.2 shape:
--        { "data": {
--            "server_time": "...",
--            "pick_deadline": null,
--            "current_seq": 0,
--            "current_pick_number": 1,
--            "draft_state": "not_started",
--            "payload_hash": null
--          }
--        }
--
--      Note: `draft_state` is the v2 column (default `not_started`),
--      independent of `draft_status` ('queued' on this seed).
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
