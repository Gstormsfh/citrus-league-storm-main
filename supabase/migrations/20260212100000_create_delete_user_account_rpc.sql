-- Server-side account deletion RPC (Apple App Store requirement)
-- Uses SECURITY DEFINER to run with elevated privileges so client code
-- does not need the service role key.

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_teams_deleted int := 0;
  v_leagues_deleted int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Step 1: Delete roster assignments for user's teams
  DELETE FROM roster_assignments
  WHERE team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Step 2: Delete team lineups
  DELETE FROM team_lineups
  WHERE team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Step 3: Delete waiver claims
  DELETE FROM waiver_claims
  WHERE team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Step 4: Delete waiver priority entries
  DELETE FROM waiver_priority
  WHERE team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Step 5: Delete matchup lines for user's teams
  DELETE FROM fantasy_matchup_lines
  WHERE team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Step 6: Delete draft picks by user's teams
  DELETE FROM draft_picks
  WHERE team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Step 7: Delete transaction ledger entries for user's teams
  DELETE FROM transaction_ledger
  WHERE team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Step 8: Anonymize trade history (keep records but remove identifying info)
  UPDATE trade_history
  SET proposer_team_name = 'Former Team'
  WHERE proposer_team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  UPDATE trade_history
  SET recipient_team_name = 'Former Team'
  WHERE recipient_team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Step 9: Delete user's fantasy teams
  DELETE FROM fantasy_teams WHERE user_id = v_user_id;
  GET DIAGNOSTICS v_teams_deleted = ROW_COUNT;

  -- Step 10: Delete orphaned leagues where user was commissioner and no teams remain
  DELETE FROM fantasy_leagues
  WHERE commissioner_id = v_user_id
    AND id NOT IN (SELECT DISTINCT league_id FROM fantasy_teams);
  GET DIAGNOSTICS v_leagues_deleted = ROW_COUNT;

  -- Step 11: Reassign commissioner of leagues that still have teams
  UPDATE fantasy_leagues
  SET commissioner_id = (
    SELECT ft.user_id FROM fantasy_teams ft
    WHERE ft.league_id = fantasy_leagues.id
    ORDER BY ft.created_at ASC
    LIMIT 1
  )
  WHERE commissioner_id = v_user_id
    AND id IN (SELECT DISTINCT league_id FROM fantasy_teams);

  -- Step 12: Delete privacy consent records
  DELETE FROM user_privacy_consent WHERE user_id = v_user_id;

  -- Step 13: Delete user profile
  DELETE FROM profiles WHERE id = v_user_id;

  -- Step 14: Delete the auth user (this is the final step)
  -- Using Supabase's internal auth schema deletion
  DELETE FROM auth.users WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'teams_deleted', v_teams_deleted,
    'leagues_deleted', v_leagues_deleted
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- Grant execute to authenticated users only
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;
