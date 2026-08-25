-- ============================================================================
-- 2026-08-24 launch build — AUCTION BUDGET SEEDING GAP.
-- [APPLIED TO PROD iezwazccqqrhrjupxzvf as 20260824214500 — repo mirror.]
--
-- THE DEFECT (found in pre-E2E review; never reached a user):
--   Nothing in the v2 auction path ever creates `auction_budgets` rows.
--   The only seeder is v1 `AuctionService.initializeAuction`, reachable
--   solely via the legacy route POST /api/auction/league/:id/initialize,
--   which the v2 draft flow never calls. `start_draft_v2` does not touch
--   the table, and the engine only READS it. Prod had 0 rows total.
--
--   The engine reads every budget as `this.teamBudgets.get(teamId) ?? 0`
--   with NO fallback to settings.auctionBudget (LobbyManager L2106/2293/
--   4002/5346/...). So a v2 auction draft would have started with every
--   team holding $0: empty `teamBudgets` in the wire snapshot, an empty
--   budget board in the room, and budgets driven negative on the first
--   won nomination.
--
-- THE FIX (DB-side, deliberately):
--   Seed at the `draft_started` event — the one choke point every start
--   path funnels through — using the same trigger pattern already proven
--   by tg_draft_events_project_pick and tg_draft_events_sync_roster.
--   Chosen over an engine-side fallback because it needs no engine
--   deploy, is authoritative for the wire snapshot as well as the engine,
--   and covers any future start path for free.
--
-- ORDERING (checked, not assumed):
--   append_draft_event INSERTs 'draft_started' inside start_draft_v2's
--   transaction; this AFTER-INSERT trigger runs in that same transaction,
--   and pg_notify only fires post-commit. The engine's bootstrap read of
--   auction_budgets therefore always sees committed rows — no race.
--
-- CANNOT STRAND A DRAFT: the body is wrapped in an exception handler that
--   degrades to a WARNING, honoring the same contract as
--   tg_draft_events_sync_roster. A seeding failure can never abort the
--   transaction carrying the draft's ignition event.
--
-- VERIFIED IN PROD (rollback-wrapped live test, 2026-08-24): a 4-team
--   league with settings.auctionBudget=250 seeded 4 rows at $250 each,
--   proving the setting is read rather than the table default of 200.
--
-- NOTE ON THE BACKFILL: the first applied version scoped the repair to
--   draft_status IN ('in_progress','completed'). That was over-broad — it
--   invented budget rows for a COMPLETED league that never ran an auction
--   (2 rows, since deleted). A completed draft cannot benefit from
--   seeding, so the clause below is 'in_progress' only.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_draft_events_seed_auction_budgets()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings jsonb;
  v_budget   numeric;
  v_seeded   int;
BEGIN
  SELECT settings INTO v_settings FROM public.leagues WHERE id = NEW.league_id;

  -- Auction leagues only. Every other format no-ops.
  IF COALESCE(v_settings ->> 'draftType', '') <> 'auction' THEN
    RETURN NULL;
  END IF;

  BEGIN
    -- Mirror the engine's own default (auctionBudget ?? 200) and the
    -- table default. Guard the CHECK (initial_budget > 0).
    v_budget := COALESCE(NULLIF((v_settings ->> 'auctionBudget'), '')::numeric, 200);
    IF v_budget IS NULL OR v_budget <= 0 THEN
      v_budget := 200;
    END IF;

    INSERT INTO public.auction_budgets (league_id, team_id, initial_budget, remaining_budget, players_won)
    SELECT NEW.league_id, t.id, v_budget, v_budget, 0
      FROM public.teams t
     WHERE t.league_id = NEW.league_id
    ON CONFLICT ON CONSTRAINT auction_budgets_league_id_team_id_key DO NOTHING;

    GET DIAGNOSTICS v_seeded = ROW_COUNT;

    IF v_seeded = 0 THEN
      RAISE WARNING 'AUCTION BUDGET SEED produced 0 rows for league % (teams missing, or already seeded)',
        NEW.league_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'AUCTION BUDGET SEED FAILED for league % — %', NEW.league_id, SQLERRM;
  END;

  RETURN NULL;  -- AFTER trigger: return value ignored
END;
$function$;

DROP TRIGGER IF EXISTS draft_events_seed_auction_budgets_trg ON public.draft_events;
CREATE TRIGGER draft_events_seed_auction_budgets_trg
  AFTER INSERT ON public.draft_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'draft_started')
  EXECUTE FUNCTION public.tg_draft_events_seed_auction_budgets();

-- Repair only auction leagues actually mid-draft with missing rows.
INSERT INTO public.auction_budgets (league_id, team_id, initial_budget, remaining_budget, players_won)
SELECT l.id, t.id,
       GREATEST(COALESCE(NULLIF((l.settings ->> 'auctionBudget'), '')::numeric, 200), 1),
       GREATEST(COALESCE(NULLIF((l.settings ->> 'auctionBudget'), '')::numeric, 200), 1),
       0
  FROM public.leagues l
  JOIN public.teams t ON t.league_id = l.id
 WHERE l.settings ->> 'draftType' = 'auction'
   AND l.draft_status = 'in_progress'
ON CONFLICT ON CONSTRAINT auction_budgets_league_id_team_id_key DO NOTHING;
