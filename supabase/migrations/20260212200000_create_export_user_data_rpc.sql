-- Data export RPC for GDPR/CCPA compliance
-- Returns all user data in a structured JSON format for portability.

CREATE OR REPLACE FUNCTION public.export_user_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_profile jsonb;
  v_teams jsonb;
  v_leagues jsonb;
  v_transactions jsonb;
  v_draft_picks jsonb;
  v_consent jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Profile data
  SELECT to_jsonb(p.*) INTO v_profile
  FROM profiles p
  WHERE p.id = v_user_id;

  -- Fantasy teams
  SELECT COALESCE(jsonb_agg(to_jsonb(ft.*)), '[]'::jsonb) INTO v_teams
  FROM fantasy_teams ft
  WHERE ft.user_id = v_user_id;

  -- Leagues user is in (via their teams)
  SELECT COALESCE(jsonb_agg(to_jsonb(fl.*)), '[]'::jsonb) INTO v_leagues
  FROM fantasy_leagues fl
  WHERE fl.id IN (
    SELECT league_id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Transaction history
  SELECT COALESCE(jsonb_agg(to_jsonb(tl.*)), '[]'::jsonb) INTO v_transactions
  FROM transaction_ledger tl
  WHERE tl.team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Draft picks
  SELECT COALESCE(jsonb_agg(to_jsonb(dp.*)), '[]'::jsonb) INTO v_draft_picks
  FROM draft_picks dp
  WHERE dp.team_id IN (
    SELECT id FROM fantasy_teams WHERE user_id = v_user_id
  );

  -- Privacy consent records
  SELECT COALESCE(jsonb_agg(to_jsonb(pc.*)), '[]'::jsonb) INTO v_consent
  FROM user_privacy_consent pc
  WHERE pc.user_id = v_user_id;

  -- Build final export
  v_result := jsonb_build_object(
    'success', true,
    'exported_at', now(),
    'user_id', v_user_id,
    'profile', COALESCE(v_profile, '{}'::jsonb),
    'fantasy_teams', v_teams,
    'leagues', v_leagues,
    'transactions', v_transactions,
    'draft_picks', v_draft_picks,
    'privacy_consent', v_consent
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- Grant execute to authenticated users only
GRANT EXECUTE ON FUNCTION public.export_user_data() TO authenticated;
