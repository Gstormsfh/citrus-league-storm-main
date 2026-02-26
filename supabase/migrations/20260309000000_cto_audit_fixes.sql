-- =============================================================================
-- CTO AUDIT FIXES — Resolves top 10 issues from comprehensive system audit
-- =============================================================================
--
-- Fix #1:  execute_trade RPC — atomic trade execution with rollback
-- Fix #2:  calculate_daily_matchup_scores reads leagues.scoring_settings
-- Fix #6:  process_roster_move validates position limits from league settings
-- Fix #8:  Add draft_order to Supabase realtime publication
-- =============================================================================

-- ============================================================================
-- FIX #1: Atomic trade execution RPC
-- The old TradeService.acceptTradeOffer() did individual UPDATE calls on
-- roster_assignments without a transaction boundary. If one side failed,
-- players could vanish or duplicate. This RPC wraps everything in a single
-- atomic block with automatic rollback.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.execute_trade(
  p_trade_id UUID,
  p_league_id UUID,
  p_from_team_id UUID,
  p_to_team_id UUID,
  p_offered_player_ids TEXT[],
  p_requested_player_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_offered_moved INT := 0;
  v_requested_moved INT := 0;
BEGIN
  -- Validate both teams exist in the league
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_from_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'From-team does not exist in this league';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_to_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'To-team does not exist in this league';
  END IF;

  -- ======== MOVE OFFERED PLAYERS: from_team → to_team ========
  FOREACH v_pid IN ARRAY p_offered_player_ids
  LOOP
    -- Verify the player is actually on the from_team roster
    IF NOT EXISTS (
      SELECT 1 FROM roster_assignments
      WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid
    ) THEN
      RAISE EXCEPTION 'Offered player % is not on from-team roster', v_pid;
    END IF;

    UPDATE roster_assignments
    SET team_id = p_to_team_id, updated_at = v_now
    WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid;

    v_offered_moved := v_offered_moved + 1;
  END LOOP;

  -- ======== MOVE REQUESTED PLAYERS: to_team → from_team ========
  FOREACH v_pid IN ARRAY p_requested_player_ids
  LOOP
    -- Verify the player is actually on the to_team roster
    IF NOT EXISTS (
      SELECT 1 FROM roster_assignments
      WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid
    ) THEN
      RAISE EXCEPTION 'Requested player % is not on to-team roster', v_pid;
    END IF;

    UPDATE roster_assignments
    SET team_id = p_from_team_id, updated_at = v_now
    WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid;

    v_requested_moved := v_requested_moved + 1;
  END LOOP;

  -- ======== AUDIT TRAIL ========
  -- Log all moves to transaction_ledger
  INSERT INTO transaction_ledger (league_id, team_id, player_id, type, created_at)
  SELECT p_league_id, p_from_team_id, unnest(p_offered_player_ids), 'TRADE_OUT', v_now
  UNION ALL
  SELECT p_league_id, p_to_team_id, unnest(p_offered_player_ids), 'TRADE_IN', v_now
  UNION ALL
  SELECT p_league_id, p_to_team_id, unnest(p_requested_player_ids), 'TRADE_OUT', v_now
  UNION ALL
  SELECT p_league_id, p_from_team_id, unnest(p_requested_player_ids), 'TRADE_IN', v_now;

  -- Record in trade_history
  INSERT INTO trade_history (league_id, trade_offer_id, team1_id, team2_id, team1_players, team2_players)
  VALUES (p_league_id, p_trade_id, p_from_team_id, p_to_team_id,
          ARRAY(SELECT unnest(p_offered_player_ids)::int),
          ARRAY(SELECT unnest(p_requested_player_ids)::int));

  RETURN jsonb_build_object(
    'success', true,
    'offered_moved', v_offered_moved,
    'requested_moved', v_requested_moved
  );

EXCEPTION WHEN OTHERS THEN
  -- Entire transaction rolls back automatically
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_trade(UUID, UUID, UUID, UUID, TEXT[], TEXT[]) FROM public;
GRANT EXECUTE ON FUNCTION public.execute_trade(UUID, UUID, UUID, UUID, TEXT[], TEXT[]) TO authenticated;

COMMENT ON FUNCTION public.execute_trade IS
  'Atomic trade execution: moves players between two teams in a single transaction. '
  'Validates ownership, updates roster_assignments, logs to transaction_ledger and trade_history. '
  'Full rollback on any failure.';


-- ============================================================================
-- FIX #2: Scoring RPC reads from leagues.scoring_settings (restoring the
-- league-settings-aware version that was regressed in 20260301).
-- Now includes ALL 8 skater stats + 4 goalie stats with per-league weights.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_daily_matchup_scores(
  p_matchup_id UUID,
  p_team_id UUID,
  p_week_start DATE,
  p_week_end DATE
)
RETURNS TABLE (
  roster_date DATE,
  daily_score NUMERIC(10, 3)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE;
  v_score NUMERIC(10, 3);
  v_scoring_settings JSONB;
  -- Skater weights (defaults match DEFAULT_SCORING in scoringUtils.ts)
  v_sk_goals   NUMERIC := 3.0;
  v_sk_assists NUMERIC := 2.0;
  v_sk_ppp     NUMERIC := 1.0;
  v_sk_shp     NUMERIC := 2.0;
  v_sk_sog     NUMERIC := 0.4;
  v_sk_blocks  NUMERIC := 0.5;
  v_sk_hits    NUMERIC := 0.2;
  v_sk_pim     NUMERIC := 0.5;
  -- Goalie weights
  v_gl_wins     NUMERIC := 4.0;
  v_gl_saves    NUMERIC := 0.2;
  v_gl_shutouts NUMERIC := 3.0;
  v_gl_ga       NUMERIC := -1.0;
BEGIN
  -- Fetch league scoring_settings via the matchup
  SELECT l.scoring_settings INTO v_scoring_settings
  FROM matchups m
  JOIN leagues l ON m.league_id = l.id
  WHERE m.id = p_matchup_id;

  -- Override defaults with per-league settings if configured
  IF v_scoring_settings IS NOT NULL THEN
    IF v_scoring_settings->'skater' IS NOT NULL THEN
      v_sk_goals   := COALESCE((v_scoring_settings->'skater'->>'goals')::numeric,        v_sk_goals);
      v_sk_assists := COALESCE((v_scoring_settings->'skater'->>'assists')::numeric,      v_sk_assists);
      v_sk_ppp     := COALESCE((v_scoring_settings->'skater'->>'power_play_points')::numeric, v_sk_ppp);
      v_sk_shp     := COALESCE((v_scoring_settings->'skater'->>'short_handed_points')::numeric, v_sk_shp);
      v_sk_sog     := COALESCE((v_scoring_settings->'skater'->>'shots_on_goal')::numeric, v_sk_sog);
      v_sk_blocks  := COALESCE((v_scoring_settings->'skater'->>'blocks')::numeric,       v_sk_blocks);
      v_sk_hits    := COALESCE((v_scoring_settings->'skater'->>'hits')::numeric,          v_sk_hits);
      v_sk_pim     := COALESCE((v_scoring_settings->'skater'->>'penalty_minutes')::numeric, v_sk_pim);
    END IF;
    IF v_scoring_settings->'goalie' IS NOT NULL THEN
      v_gl_wins     := COALESCE((v_scoring_settings->'goalie'->>'wins')::numeric,        v_gl_wins);
      v_gl_saves    := COALESCE((v_scoring_settings->'goalie'->>'saves')::numeric,       v_gl_saves);
      v_gl_shutouts := COALESCE((v_scoring_settings->'goalie'->>'shutouts')::numeric,    v_gl_shutouts);
      v_gl_ga       := COALESCE((v_scoring_settings->'goalie'->>'goals_against')::numeric, v_gl_ga);
    END IF;
  END IF;

  FOR v_date IN
    SELECT generate_series(p_week_start, p_week_end, '1 day'::interval)::DATE
  LOOP
    SELECT COALESCE(SUM(
      CASE
        WHEN pgs.is_goalie = false THEN
          (COALESCE(pgs.nhl_goals, 0)         * v_sk_goals) +
          (COALESCE(pgs.nhl_assists, 0)       * v_sk_assists) +
          (COALESCE(pgs.nhl_ppp, 0)           * v_sk_ppp) +
          (COALESCE(pgs.nhl_shp, 0)           * v_sk_shp) +
          (COALESCE(pgs.nhl_shots_on_goal, 0) * v_sk_sog) +
          (COALESCE(pgs.nhl_blocks, 0)        * v_sk_blocks) +
          (COALESCE(pgs.nhl_hits, 0)          * v_sk_hits) +
          (COALESCE(pgs.nhl_pim, 0)           * v_sk_pim)
        ELSE
          (COALESCE(pgs.nhl_wins, 0)          * v_gl_wins) +
          (COALESCE(pgs.nhl_saves, 0)         * v_gl_saves) +
          (COALESCE(pgs.nhl_shutouts, 0)      * v_gl_shutouts) -
          (COALESCE(pgs.nhl_goals_against, 0) * ABS(v_gl_ga))
      END
    ), 0) INTO v_score
    FROM fantasy_daily_rosters fdr
    INNER JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    INNER JOIN nhl_games ng ON pgs.game_id = ng.game_id
    WHERE fdr.matchup_id = p_matchup_id
      AND fdr.team_id = p_team_id
      AND fdr.roster_date = v_date
      AND fdr.slot_type = 'active'
      AND ng.game_date = v_date;

    RETURN QUERY SELECT v_date, COALESCE(v_score, 0);
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_daily_matchup_scores(UUID, UUID, DATE, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.calculate_daily_matchup_scores(UUID, UUID, DATE, DATE) TO anon, authenticated;

COMMENT ON FUNCTION public.calculate_daily_matchup_scores IS
  'Calculates daily fantasy scores using per-league scoring_settings (with sensible defaults). '
  'Includes ALL 8 skater stats (G/A/PPP/SHP/SOG/BLK/HIT/PIM) + 4 goalie stats (W/SV/SO/GA). '
  'Falls back to default weights if league has no scoring_settings configured.';


-- ============================================================================
-- FIX #8: Add draft_order to Supabase realtime publication
-- Without this, mid-draft order changes are invisible to other clients for
-- up to 15 seconds (until next poll). With this, they propagate instantly.
-- ============================================================================

DO $$
BEGIN
  -- Only add if not already in the publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'draft_order'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_order;
    RAISE NOTICE 'Added draft_order to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'draft_order already in supabase_realtime publication';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add draft_order to realtime: %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #6: process_roster_move reads roster_size from league settings
-- Instead of hardcoded 22, read the league's configured roster_size.
-- Also reads league-level roster_slots for position-aware validation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_roster_move(
  p_league_id UUID,
  p_user_id UUID,
  p_drop_player_id TEXT DEFAULT NULL,
  p_add_player_id TEXT DEFAULT NULL,
  p_transaction_source TEXT DEFAULT 'Roster Tab'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id UUID;
  v_current_roster_size INT;
  v_max_roster_size INT;
  v_dropped_assignment_id UUID;
  v_drop_player_name TEXT;
  v_add_player_name TEXT;
  v_operation_start TIMESTAMPTZ := NOW();
  v_operation_duration INTERVAL;
BEGIN
  -- Read roster_size from league (with fallback to 22)
  SELECT COALESCE(l.roster_size, 22) INTO v_max_roster_size
  FROM public.leagues l WHERE l.id = p_league_id;
  IF v_max_roster_size IS NULL THEN
    v_max_roster_size := 22;
  END IF;

  -- Get user's team in this league
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE league_id = p_league_id AND owner_id = p_user_id
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'User does not have a team in this league';
  END IF;

  IF p_drop_player_id IS NULL AND p_add_player_id IS NULL THEN
    RAISE EXCEPTION 'Must specify at least one player to add or drop';
  END IF;

  BEGIN
    -- ======== DROP LOGIC ========
    IF p_drop_player_id IS NOT NULL THEN
      SELECT id INTO v_dropped_assignment_id
      FROM public.roster_assignments
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id
      LIMIT 1;

      IF v_dropped_assignment_id IS NULL THEN
        RAISE EXCEPTION 'Player % is not on your roster', p_drop_player_id;
      END IF;

      DELETE FROM public.roster_assignments WHERE id = v_dropped_assignment_id;

      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'DROP', p_drop_player_id, p_transaction_source, NOW());

      UPDATE public.team_lineups SET
        starters = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(starters, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        bench = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(bench, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        ir = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(ir, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        slot_assignments = COALESCE(slot_assignments, '{}'::jsonb) - p_drop_player_id,
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;

      UPDATE public.draft_picks SET deleted_at = NOW()
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id AND deleted_at IS NULL;
    END IF;

    -- ======== ADD LOGIC ========
    IF p_add_player_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_roster_size
      FROM public.roster_assignments
      WHERE team_id = v_team_id AND league_id = p_league_id;

      IF v_current_roster_size >= v_max_roster_size THEN
        RAISE EXCEPTION 'Roster is full (% / % players). Drop a player first.', v_current_roster_size, v_max_roster_size;
      END IF;

      -- Position validation: check league-level goalie limit if configured
      -- Prevents hoarding goalies beyond the league's G slots + bench buffer
      DECLARE
        v_player_position TEXT;
        v_goalie_slots INT;
        v_current_goalies INT;
        v_league_settings JSONB;
      BEGIN
        SELECT l.settings INTO v_league_settings FROM public.leagues l WHERE l.id = p_league_id;

        -- Get the position of the player being added
        SELECT pd.position_code INTO v_player_position
        FROM public.player_directory pd WHERE pd.player_id = p_add_player_id
        ORDER BY pd.season DESC LIMIT 1;

        -- Enforce goalie limit: (G slots from settings + 1 buffer) or default max 3
        IF v_player_position = 'G' AND v_league_settings IS NOT NULL THEN
          v_goalie_slots := COALESCE((v_league_settings->'rosterSlots'->>'G')::int, 2);
          SELECT COUNT(*) INTO v_current_goalies
          FROM public.roster_assignments ra
          JOIN public.player_directory pd ON ra.player_id = pd.player_id
          WHERE ra.league_id = p_league_id AND ra.team_id = v_team_id AND pd.position_code = 'G';

          IF v_current_goalies >= v_goalie_slots + 1 THEN
            RAISE EXCEPTION 'Too many goalies on roster (% / % max). Drop a goalie first.', v_current_goalies, v_goalie_slots + 1;
          END IF;
        END IF;
      END;

      INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at, created_at)
      VALUES (p_league_id, v_team_id, p_add_player_id, NOW(), NOW());

      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'ADD', p_add_player_id, p_transaction_source, NOW());

      UPDATE public.team_lineups SET
        bench = COALESCE(bench, '[]'::jsonb) || jsonb_build_array(p_add_player_id),
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;

      INSERT INTO public.team_lineups (league_id, team_id, bench, starters, ir, slot_assignments, updated_at)
      VALUES (p_league_id, v_team_id, jsonb_build_array(p_add_player_id), '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW())
      ON CONFLICT (league_id, team_id) DO NOTHING;

      INSERT INTO public.draft_picks (league_id, team_id, player_id, round_number, pick_number, picked_at, deleted_at)
      VALUES (p_league_id, v_team_id, p_add_player_id, 999,
        (SELECT COALESCE(MAX(pick_number), 0) + 1 FROM public.draft_picks WHERE league_id = p_league_id),
        NOW(), NULL)
      ON CONFLICT (league_id, team_id, player_id) DO UPDATE SET deleted_at = NULL, picked_at = NOW();
    END IF;

    v_operation_duration := NOW() - v_operation_start;

    RETURN jsonb_build_object(
      'success', true,
      'team_id', v_team_id,
      'dropped', p_drop_player_id,
      'added', p_add_player_id,
      'roster_size', (SELECT COUNT(*) FROM public.roster_assignments WHERE team_id = v_team_id AND league_id = p_league_id),
      'max_roster_size', v_max_roster_size,
      'duration_ms', EXTRACT(MILLISECOND FROM v_operation_duration)::int
    );

  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO public.failed_transactions (league_id, team_id, user_id, operation_type, player_id, error_message, error_detail)
      VALUES (p_league_id, v_team_id, p_user_id, 'ADD', p_add_player_id, 'DUPLICATE_PLAYER', SQLERRM);
      RETURN jsonb_build_object('success', false, 'error', 'Player is already on a team in this league', 'code', 'DUPLICATE_PLAYER');
    WHEN OTHERS THEN
      INSERT INTO public.failed_transactions (league_id, team_id, user_id, operation_type, player_id, error_message, error_detail)
      VALUES (p_league_id, v_team_id, p_user_id, CASE WHEN p_add_player_id IS NOT NULL THEN 'ADD' ELSE 'DROP' END,
        COALESCE(p_add_player_id, p_drop_player_id), SQLERRM, SQLSTATE);
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

COMMENT ON FUNCTION public.process_roster_move IS
  'Atomic roster transaction engine: handles add/drop with full validation. '
  'Reads roster_size from league settings (not hardcoded). '
  'Enforces goalie position limit from league rosterSlots config. '
  'Full rollback on any failure. Logs to transaction_ledger and failed_transactions.';
