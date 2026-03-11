-- ============================================================================
-- A+ Audit Fixes Migration
-- Closes all remaining gaps identified in the comprehensive audit:
-- 1. SELECT RLS on keeper_designations
-- 2. Server-side validation: playoff teams <= total teams
-- 3. Server-side validation: FAAB budget > 0 when FAAB selected
-- 4. Trade expiration auto-enforcement cron
-- 5. Settings change audit trail integration
-- 6. SELECT RLS on player_autopick_rankings
-- 7. Commissioner DELETE on trade_votes
-- ============================================================================

-- ============================================================================
-- 1. SELECT RLS on keeper_designations
-- Team owners can view their own keepers; commissioners can view all in league
-- ============================================================================

DO $$
BEGIN
  -- Only add if keeper_designations table exists (created in world_class migration)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'keeper_designations' AND table_schema = 'public') THEN
    -- Drop existing SELECT policy if any
    DROP POLICY IF EXISTS "Team owners can view their keeper designations" ON public.keeper_designations;
    DROP POLICY IF EXISTS "Commissioners can view all keeper designations" ON public.keeper_designations;

    -- Team owners can view their own keepers
    CREATE POLICY "Team owners can view their keeper designations"
      ON public.keeper_designations FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.id = keeper_designations.team_id
          AND t.owner_id = auth.uid()
        )
      );

    -- Commissioners can view all keeper designations in their leagues
    CREATE POLICY "Commissioners can view all keeper designations"
      ON public.keeper_designations FOR SELECT
      USING (
        public.is_commissioner_of_league(league_id)
      );
  END IF;
END $$;


-- ============================================================================
-- 2. SELECT RLS on player_autopick_rankings
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'player_autopick_rankings' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Users can view their own autopick rankings" ON public.player_autopick_rankings;
    DROP POLICY IF EXISTS "Commissioners can view autopick rankings in their leagues" ON public.player_autopick_rankings;

    -- Users can view their own rankings
    CREATE POLICY "Users can view their own autopick rankings"
      ON public.player_autopick_rankings FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.id = player_autopick_rankings.team_id
          AND t.owner_id = auth.uid()
        )
      );

    -- Commissioners can view all rankings in their leagues
    CREATE POLICY "Commissioners can view autopick rankings in their leagues"
      ON public.player_autopick_rankings FOR SELECT
      USING (
        public.is_commissioner_of_league(league_id)
      );
  END IF;
END $$;


-- ============================================================================
-- 3. DELETE policy on trade_votes for commissioners
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trade_votes' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Commissioners can delete trade votes in their leagues" ON public.trade_votes;

    CREATE POLICY "Commissioners can delete trade votes in their leagues"
      ON public.trade_votes FOR DELETE
      USING (
        public.is_commissioner_of_league(league_id)
      );
  END IF;
END $$;


-- ============================================================================
-- 4. Server-side validation: playoff_teams <= teamsCount
-- This is enforced as a CHECK on the leagues table settings JSONB.
-- Since settings is JSONB and teamsCount is inside it, we use a trigger.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_league_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teams_count INT;
  v_playoff_teams INT;
  v_waiver_type TEXT;
  v_faab_budget INT;
BEGIN
  -- Extract settings values
  v_teams_count := COALESCE((NEW.settings->>'teamsCount')::INT, 12);
  v_playoff_teams := COALESCE((NEW.settings->>'playoffTeams')::INT, 0);
  v_waiver_type := COALESCE(NEW.waiver_type, 'rolling');
  v_faab_budget := COALESCE((NEW.settings->>'faabBudget')::INT, 100);

  -- Validation 1: Playoff teams must not exceed total teams
  IF v_playoff_teams > v_teams_count THEN
    RAISE EXCEPTION 'Playoff teams (%) cannot exceed total teams (%)', v_playoff_teams, v_teams_count;
  END IF;

  -- Validation 2: FAAB budget must be > 0 when waiver type is FAAB
  IF v_waiver_type = 'faab' AND v_faab_budget <= 0 THEN
    RAISE EXCEPTION 'FAAB budget must be greater than 0 when FAAB waivers are enabled';
  END IF;

  -- Validation 3: Scoring settings numeric range (prevent extreme values)
  IF NEW.scoring_settings IS NOT NULL THEN
    -- Check skater scoring values are within reasonable range (-100 to 100)
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(NEW.scoring_settings->'skater', '{}'::jsonb))
      WHERE value::numeric < -100 OR value::numeric > 100
    ) THEN
      RAISE EXCEPTION 'Scoring values must be between -100 and 100';
    END IF;

    -- Check goalie scoring values are within reasonable range
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(NEW.scoring_settings->'goalie', '{}'::jsonb))
      WHERE value::numeric < -100 OR value::numeric > 100
    ) THEN
      RAISE EXCEPTION 'Scoring values must be between -100 and 100';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop and recreate the trigger
DROP TRIGGER IF EXISTS validate_league_settings_trigger ON public.leagues;
CREATE TRIGGER validate_league_settings_trigger
  BEFORE INSERT OR UPDATE ON public.leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_league_settings();


-- ============================================================================
-- 5. Trade expiration auto-enforcement
-- Process expired trade offers every 15 minutes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.expire_stale_trade_offers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count INT;
BEGIN
  -- Mark all pending trades past their expiration date as expired
  UPDATE public.trade_offers
  SET status = 'expired',
      processed_at = NOW()
  WHERE status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'expired_count', v_expired_count,
    'processed_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_trade_offers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_trade_offers() TO service_role;

-- Schedule trade expiration cron (every 15 minutes)
-- Uses pg_cron if available
DO $cron_expire$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove existing cron job if present
    PERFORM cron.unschedule('expire-stale-trades');

    -- Schedule new cron job: every 15 minutes
    PERFORM cron.schedule(
      'expire-stale-trades',
      '*/15 * * * *',
      'SELECT public.expire_stale_trade_offers()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not available, skip scheduling
  RAISE NOTICE 'pg_cron not available, trade expiration cron not scheduled';
END $cron_expire$;


-- ============================================================================
-- 6. Settings change audit trail
-- Log commissioner settings changes to security_audit_log
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_settings_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changes TEXT[];
BEGIN
  -- Only log if this is an UPDATE by the commissioner
  IF TG_OP = 'UPDATE' AND NEW.commissioner_id = auth.uid() THEN
    -- Track which settings groups changed
    IF OLD.waiver_type IS DISTINCT FROM NEW.waiver_type
       OR OLD.waiver_process_time IS DISTINCT FROM NEW.waiver_process_time
       OR OLD.waiver_period_hours IS DISTINCT FROM NEW.waiver_period_hours
       OR OLD.waiver_game_lock IS DISTINCT FROM NEW.waiver_game_lock
       OR OLD.allow_trades_during_games IS DISTINCT FROM NEW.allow_trades_during_games THEN
      v_changes := array_append(v_changes, 'waiver_settings');
    END IF;

    IF OLD.scoring_settings::text IS DISTINCT FROM NEW.scoring_settings::text THEN
      v_changes := array_append(v_changes, 'scoring_settings');
    END IF;

    IF OLD.draft_rounds IS DISTINCT FROM NEW.draft_rounds THEN
      v_changes := array_append(v_changes, 'draft_settings');
    END IF;

    IF OLD.trade_review_type IS DISTINCT FROM NEW.trade_review_type
       OR OLD.trade_review_period_hours IS DISTINCT FROM NEW.trade_review_period_hours
       OR OLD.trade_veto_threshold IS DISTINCT FROM NEW.trade_veto_threshold THEN
      v_changes := array_append(v_changes, 'trade_review_settings');
    END IF;

    IF OLD.settings::text IS DISTINCT FROM NEW.settings::text THEN
      v_changes := array_append(v_changes, 'league_settings');
    END IF;

    -- Log to audit trail if any changes were detected
    IF v_changes IS NOT NULL AND array_length(v_changes, 1) > 0 THEN
      -- Insert into security_audit_log if the table exists
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'security_audit_log' AND table_schema = 'public') THEN
        INSERT INTO public.security_audit_log (
          event_type, league_id, user_id, details, created_at
        ) VALUES (
          'ADMIN_ACTION',
          NEW.id,
          auth.uid(),
          jsonb_build_object(
            'action', 'settings_changed',
            'changed_groups', to_jsonb(v_changes),
            'timestamp', NOW()
          ),
          NOW()
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop and recreate the trigger
DROP TRIGGER IF EXISTS log_settings_change_trigger ON public.leagues;
CREATE TRIGGER log_settings_change_trigger
  AFTER UPDATE ON public.leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.log_settings_change();


-- ============================================================================
-- 7. Auction table commissioner policies
-- Allow commissioners to manage auctions in their leagues
-- ============================================================================

DO $$
BEGIN
  -- auction_nominations: commissioner can DELETE (cancel nominations)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auction_nominations' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Commissioners can delete nominations in their leagues" ON public.auction_nominations;
    CREATE POLICY "Commissioners can delete nominations in their leagues"
      ON public.auction_nominations FOR DELETE
      USING (public.is_commissioner_of_league(league_id));
  END IF;

  -- auction_bids: commissioner can DELETE (reset bids)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auction_bids' AND table_schema = 'public') THEN
    DROP POLICY IF EXISTS "Commissioners can delete bids in their leagues" ON public.auction_bids;
    CREATE POLICY "Commissioners can delete bids in their leagues"
      ON public.auction_bids FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM public.auction_nominations an
          WHERE an.id = auction_bids.nomination_id
          AND public.is_commissioner_of_league(an.league_id)
        )
      );
  END IF;
END $$;


-- ============================================================================
-- Done!
-- ============================================================================
