-- ============================================================================
-- A draft reset has to actually reset a v2 draft
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-04):
--   supabase/migrations/captures/2026-09-04_pre_nuclear_reset_draft.sql
--     93fb6a0f3823af8cee6da82555f36480
--
-- (a) WHAT CHANGED
--   nuclear_reset_draft(uuid) additionally deletes draft_picks_v2,
--   draft_events, draft_snapshots and the three auction tables for the
--   league, and additionally resets leagues.draft_state to 'not_started' and
--   drops settings->'draftCompletedAt'. The commissioner gate, the signature,
--   the return type, SECURITY DEFINER, search_path and every existing DELETE
--   and UPDATE are unchanged.
--
-- (b) WHY NOW
--
--   DEFECT: v2 has no working reset at all, and the failure is silent.
--
--   The function as it stands deletes draft_picks, draft_order, team_lineups
--   and roster_assignments. Every one of those is right. The problem is what
--   it does not name.
--
--   Citrus moved to the v2 engine on 2026-08-18. Since then picks are written
--   to draft_picks_v2 and the authoritative log is draft_events;
--   draft_picks is EMPTY on every league drafted since. Measured on
--   production 2026-09-04:
--     league "Test at golf"   draft_picks_v2 = 252, draft_events = 254,
--                             draft_picks = 0, roster_assignments = 252
--   So the reset's only pick-deleting statement targets the one table that
--   holds nothing, and all 252 picks plus the full event log survive it.
--
--   What the commissioner is left with is worse than a no-op. The rosters and
--   lineups really are gone, and leagues.draft_status really is 'not_started'
--   -- but leagues.draft_state is still 'completed', so the league now
--   disagrees with itself, and the picks it would re-derive from are all
--   still sitting there.
--
--   The next roster sync then finishes the job. sync_roster_assignments_for_
--   league sees EXISTS(draft_picks_v2), takes the v2 branch, finds
--   existing_count = 0, concludes this is a first sync, and rebuilds every
--   roster row from draft_picks_v2.team_id -- the DRAFTING team. Any trade
--   executed since the draft is silently reversed, because execute_trade
--   moves roster_assignments and roster_assignments is exactly what was just
--   deleted and re-derived.
--
--   And there is no way back: no path anywhere in server/src deletes
--   draft_picks_v2 or draft_events (grep, 2026-09-04), so a league in this
--   state cannot be re-drafted by any code the product ships. The reset
--   button on Profile.tsx:1717 is, for a v2 league, a one-way door.
--
--   Test drafts with real managers begin 2026-09-08. A commissioner whose
--   test draft goes sideways will reach for exactly this button.
--
-- (c) WHY THESE SIX TABLES AND NOT OTHERS
--
--   draft_picks_v2, draft_events   the pick record and the log the engine
--                                  rebuilds its whole state from. Without
--                                  both, "reset" means nothing.
--   draft_snapshots                the engine's restore point (9 rows in
--                                  production). Left behind, a restart can
--                                  resurrect the draft the commissioner just
--                                  reset.
--   auction_nominations,           an auction league re-drafting with stale
--   auction_bids,                  nominations, live bids or spent budgets is
--   auction_budgets                not re-drafting. draft_started re-seeds
--                                  budgets via
--                                  tg_draft_events_seed_auction_budgets, so
--                                  clearing them is the correct half of that
--                                  round trip.
--
--   Deliberately NOT deleted:
--   draft_queues                   a manager's own pre-draft prep. It is not
--                                  draft state and it is the thing they would
--                                  most want to keep for the re-draft.
--   draft_metrics_*                telemetry history, partitioned by month.
--                                  Deleting it destroys analytics and buys
--                                  the reset nothing.
--
--   Every trigger on draft_events is AFTER INSERT (verified on prod
--   2026-09-04: draft_events_notify_after_insert, draft_events_project_pick_
--   trg, draft_events_seed_auction_budgets_trg, draft_events_sync_roster_trg),
--   so deleting rows fires nothing. leagues.draft_state is plain text with no
--   constraint; draft_status is the draft_status enum and 'not_started' is a
--   member of it.
--
-- (d) WHO CAN RUN IT
--   Unchanged: the league commissioner, and only him. The gate is the first
--   statement and it still raises before any DELETE.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.nuclear_reset_draft(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id UUID;
BEGIN
  SELECT commissioner_id INTO v_commissioner_id
  FROM public.leagues
  WHERE id = p_league_id;

  IF v_commissioner_id IS NULL OR v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can reset the draft';
  END IF;

  -- The pick record, both generations. draft_picks is the pre-2026-08-18
  -- table and is empty on every modern league; draft_picks_v2 is the live one.
  DELETE FROM public.draft_picks WHERE league_id = p_league_id;
  DELETE FROM public.draft_picks_v2 WHERE league_id = p_league_id;

  -- The log the engine rebuilds its entire state from, and the snapshot it
  -- restores from on restart. Leaving either behind means the draft comes
  -- back.
  DELETE FROM public.draft_events WHERE league_id = p_league_id;
  DELETE FROM public.draft_snapshots WHERE league_id = p_league_id;

  DELETE FROM public.draft_order WHERE league_id = p_league_id;

  -- Auction state. Budgets are re-seeded from the next 'draft_started' event
  -- by tg_draft_events_seed_auction_budgets, so clearing them here is the
  -- other half of that round trip, not a loss.
  DELETE FROM public.auction_bids WHERE league_id = p_league_id;
  DELETE FROM public.auction_nominations WHERE league_id = p_league_id;
  DELETE FROM public.auction_budgets WHERE league_id = p_league_id;

  DELETE FROM public.team_lineups
    WHERE team_id IN (SELECT id FROM public.teams WHERE league_id = p_league_id);
  DELETE FROM public.roster_assignments WHERE league_id = p_league_id;

  UPDATE public.leagues
  SET draft_status = 'not_started',
      -- draft_state was left reading 'completed' next to a 'not_started'
      -- draft_status, so the league disagreed with itself after every reset.
      draft_state = 'not_started',
      scheduled_draft_time = NULL,
      settings = jsonb_set(
        -- A stale draftCompletedAt anchors week-1 math to a draft that no
        -- longer exists.
        COALESCE(settings, '{}'::jsonb) - 'draftCompletedAt',
        '{timerStartedAt}', 'null'::jsonb)
  WHERE id = p_league_id;
END;
$function$;

-- ── Guard: the migration is only correct if all of this is true afterwards ──
DO $$
DECLARE
  v_body text;
  v_tbl  text;
BEGIN
  v_body := pg_get_functiondef('public.nuclear_reset_draft(uuid)'::regprocedure);

  -- Every table the reset must now clear.
  FOREACH v_tbl IN ARRAY ARRAY[
    'draft_picks', 'draft_picks_v2', 'draft_events', 'draft_snapshots',
    'draft_order', 'auction_bids', 'auction_nominations', 'auction_budgets',
    'team_lineups', 'roster_assignments'
  ] LOOP
    IF v_body NOT LIKE '%DELETE FROM public.' || v_tbl || '%' THEN
      RAISE EXCEPTION 'nuclear_reset_draft no longer clears %', v_tbl;
    END IF;
  END LOOP;

  -- The two league columns must be reset together, or the league disagrees
  -- with itself exactly the way it did before this migration.
  IF v_body NOT LIKE '%draft_status = ''not_started''%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft lost its draft_status reset';
  END IF;
  IF v_body NOT LIKE '%draft_state = ''not_started''%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft does not reset draft_state';
  END IF;
  IF v_body NOT LIKE '%- ''draftCompletedAt''%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft leaves a stale draftCompletedAt behind';
  END IF;

  -- The commissioner gate must survive, and must still precede every DELETE.
  IF v_body NOT LIKE '%Only the commissioner can reset the draft%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft lost its commissioner gate';
  END IF;
  IF position('Only the commissioner can reset the draft' in v_body)
       > position('DELETE FROM public.draft_picks' in v_body) THEN
    RAISE EXCEPTION 'nuclear_reset_draft deletes before it authorizes';
  END IF;

  -- A manager's own draft queue is prep, not draft state. If a future edit
  -- starts deleting it, that is a product decision and should not arrive by
  -- accident.
  IF v_body LIKE '%DELETE FROM public.draft_queues%' THEN
    RAISE EXCEPTION 'nuclear_reset_draft now destroys draft queues; that is a product decision, not a reset';
  END IF;

  RAISE NOTICE 'nuclear_reset_draft md5 = %', md5(v_body);
END $$;

COMMIT;
