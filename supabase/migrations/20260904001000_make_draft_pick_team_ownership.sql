-- ============================================================================
-- You may pick for your own team, not for everyone else's
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-04):
--   supabase/migrations/captures/2026-09-04_pre_make_draft_pick.sql
--     a8a9e137445268ac3d5cffb2cc75561d
--
-- (a) WHAT CHANGED
--   make_draft_pick(...) now requires p_team_id to belong to p_league_id, and
--   requires the caller to be either the league commissioner or the owner of
--   that specific team. The signature, return type, SECURITY DEFINER,
--   search_path, grants, both duplicate checks, the soft-deleted cleanup and
--   the INSERT are all unchanged.
--
-- (b) WHY NOW
--
--   DEFECT: the authorization check was never correlated to the team being
--   picked for.
--
--   The gate read:
--     commissioner_id = auth.uid()
--     OR EXISTS (SELECT 1 FROM public.teams
--                WHERE teams.league_id = p_league_id
--                  AND teams.owner_id = auth.uid())
--   The subquery asks "does this caller own SOME team in this league". It is
--   never joined to p_team_id. So any member of a league could file a pick
--   assigning any player to any other manager's team, in any round, at any
--   pick number -- and p_team_id was never even checked against p_league_id,
--   so the team did not have to be in the league at all.
--
--   Because the function is SECURITY DEFINER, the policy that gets this right
--   never runs. On production 2026-09-04, draft_picks carries policy
--   "Team owners can make picks", whose WITH CHECK does correlate
--   teams.id = draft_picks.team_id. SECURITY DEFINER executes the INSERT as
--   the function owner, so that policy is bypassed by construction.
--
--   server/src/routes/draft.ts:148-163 already blocks this at the route, and
--   its comment names this exact RPC weakness. That check is real but it is
--   advisory: the RPC is reachable directly from any client holding the anon
--   key, and the anon key ships inside the iOS bundle. The fix belongs in the
--   function, where it cannot be routed around.
--
--   The v2 engine path is not affected and was never wrong: submit_pick_v2
--   checks v_team_owner IS DISTINCT FROM auth.uid() before it writes. This
--   migration brings the v1 RPC up to that standard.
--
--   Test drafts with real managers begin 2026-09-08.
--
-- (c) WHAT DOES NOT CHANGE
--   A service-role caller (auth.uid() IS NULL) was already refused by the old
--   gate -- both branches compare against auth.uid() -- and is still refused.
--   No engine or scheduled job calls this function; the only caller in the
--   tree is DraftService.makePick, which uses the requesting user's own
--   client. Nothing in the codebase matches on the old exception text
--   (grep, 2026-09-04).
--
--   The commissioner keeps the ability to pick on behalf of a manager, which
--   is a real commissioner power during a live draft. He is now held to the
--   same league-scope rule as everyone else: the team must be in his league.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.make_draft_pick(p_league_id uuid, p_team_id uuid, p_player_id text, p_round_number integer, p_pick_number integer, p_draft_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pick_id UUID;
  v_is_member BOOLEAN;
BEGIN
  -- The team has to be in the league, whoever is asking. The previous body
  -- never related p_team_id to p_league_id at all.
  IF NOT EXISTS (
    SELECT 1 FROM public.teams
    WHERE teams.id = p_team_id
    AND teams.league_id = p_league_id
  ) THEN
    RAISE EXCEPTION 'That team is not in this league';
  END IF;

  -- The commissioner may pick on behalf of any team in his league; everyone
  -- else may pick only for the team they own. The second EXISTS is correlated
  -- to p_team_id, which is the whole point of this migration.
  SELECT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
    AND commissioner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.teams
    WHERE teams.id = p_team_id
    AND teams.owner_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Not authorized to make picks for this team';
  END IF;

  -- Check if player already drafted in THIS SESSION (active picks only)
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
    AND draft_session_id = p_draft_session_id
    AND player_id = p_player_id
    AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Player already drafted in this session';
  END IF;

  -- Check for duplicate pick number (within same session, active only)
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
    AND draft_session_id = p_draft_session_id
    AND round_number = p_round_number
    AND pick_number = p_pick_number
    AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This pick number is already taken in this session';
  END IF;

  -- Clean up stale soft-deleted picks from THIS SESSION ONLY
  -- (Don't delete picks from other sessions - they're historical data)
  DELETE FROM public.draft_picks
  WHERE league_id = p_league_id
  AND draft_session_id = p_draft_session_id
  AND deleted_at IS NOT NULL;

  -- Insert the pick
  INSERT INTO public.draft_picks (
    league_id, team_id, player_id, round_number, pick_number,
    draft_session_id, picked_at
  ) VALUES (
    p_league_id, p_team_id, p_player_id, p_round_number, p_pick_number,
    p_draft_session_id, NOW()
  )
  RETURNING id INTO v_pick_id;

  RETURN v_pick_id;
END;
$function$;

-- ── Guard: the migration is only correct if all of this is true afterwards ──
DO $$
DECLARE
  v_body text;
BEGIN
  v_body := pg_get_functiondef('public.make_draft_pick(uuid,uuid,text,integer,integer,uuid)'::regprocedure);

  -- The ownership EXISTS must be correlated to the team being picked for.
  -- This is the defect, stated as a contract.
  IF v_body NOT LIKE '%WHERE teams.id = p_team_id%AND teams.owner_id = auth.uid()%' THEN
    RAISE EXCEPTION 'make_draft_pick does not tie team ownership to p_team_id';
  END IF;

  -- The old uncorrelated form must be gone, not merely joined by a better one.
  IF v_body LIKE '%WHERE teams.league_id = p_league_id%AND teams.owner_id = auth.uid()%' THEN
    RAISE EXCEPTION 'make_draft_pick still carries the uncorrelated ownership check';
  END IF;

  IF v_body NOT LIKE '%That team is not in this league%' THEN
    RAISE EXCEPTION 'make_draft_pick lost its league-scope check on p_team_id';
  END IF;

  -- Authorization must precede the INSERT, or it guards nothing.
  IF position('Not authorized to make picks for this team' in v_body)
       > position('INSERT INTO public.draft_picks' in v_body) THEN
    RAISE EXCEPTION 'make_draft_pick authorizes after it has already written the pick';
  END IF;

  -- The commissioner allowance must stay scoped to p_league_id.
  IF v_body NOT LIKE '%FROM public.leagues%WHERE id = p_league_id%AND commissioner_id = auth.uid()%' THEN
    RAISE EXCEPTION 'make_draft_pick commissioner allowance is not scoped to p_league_id';
  END IF;

  -- Everything the migration promised not to touch.
  IF v_body NOT LIKE '%Player already drafted in this session%'
     OR v_body NOT LIKE '%This pick number is already taken in this session%'
     OR v_body NOT LIKE '%deleted_at IS NOT NULL%' THEN
    RAISE EXCEPTION 'make_draft_pick lost one of its pre-existing checks';
  END IF;

  RAISE NOTICE 'make_draft_pick md5 = %', md5(v_body);
END $$;

COMMIT;
