-- =============================================================================
-- FINAL AUDIT FIXES - Resolves all outstanding schema/security/performance issues
-- =============================================================================

-- ============================================================================
-- 1. FIX: matchup_difficulty RLS - remove overly permissive authenticated write
-- The "for development" policy lets ANY authenticated user INSERT/UPDATE/DELETE.
-- Service-role policy already covers backend writes; public SELECT covers reads.
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can manage matchup difficulty"
  ON public.team_matchup_difficulty;

-- ============================================================================
-- 2. FIX: trade_offers.counter_offer_id FK missing ON DELETE SET NULL
-- Self-referential FK: if the parent trade is deleted, NULL out the reference
-- rather than cascading (which could delete unrelated counter-offers).
-- ============================================================================

DO $$
BEGIN
  -- Drop the existing unnamed FK constraint on counter_offer_id
  -- PostgreSQL auto-names it trade_offers_counter_offer_id_fkey
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trade_offers_counter_offer_id_fkey'
      AND table_name = 'trade_offers'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.trade_offers
      DROP CONSTRAINT trade_offers_counter_offer_id_fkey;
  END IF;

  ALTER TABLE public.trade_offers
    ADD CONSTRAINT trade_offers_counter_offer_id_fkey
    FOREIGN KEY (counter_offer_id) REFERENCES public.trade_offers(id)
    ON DELETE SET NULL;

  RAISE NOTICE 'Fixed trade_offers.counter_offer_id FK → ON DELETE SET NULL';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'counter_offer_id FK fix skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- 3. FIX: trade_history.trade_offer_id FK missing ON DELETE CASCADE
-- If a trade_offer is deleted, the history record should go too.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trade_history_trade_offer_id_fkey'
      AND table_name = 'trade_history'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.trade_history
      DROP CONSTRAINT trade_history_trade_offer_id_fkey;
  END IF;

  ALTER TABLE public.trade_history
    ADD CONSTRAINT trade_history_trade_offer_id_fkey
    FOREIGN KEY (trade_offer_id) REFERENCES public.trade_offers(id)
    ON DELETE CASCADE;

  RAISE NOTICE 'Fixed trade_history.trade_offer_id FK → ON DELETE CASCADE';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trade_history FK fix skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- 4. ADD: Missing composite indexes for common query patterns
-- ============================================================================

-- waiver_claims: "my pending claims" query (team_id + status)
CREATE INDEX IF NOT EXISTS idx_waiver_claims_team_status
  ON public.waiver_claims(team_id, status);

-- trade_offers: "active trades in league" sorted by newest first
CREATE INDEX IF NOT EXISTS idx_trade_offers_league_status_created
  ON public.trade_offers(league_id, status, created_at DESC);

-- fantasy_daily_rosters: league-wide roster snapshot queries
CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_league_team_date
  ON public.fantasy_daily_rosters(league_id, team_id, roster_date);

-- nhl_games: recent games lookup (standalone descending date)
CREATE INDEX IF NOT EXISTS idx_nhl_games_game_date_desc
  ON public.nhl_games(game_date DESC);

-- ============================================================================
-- 5. DROP: Dead helper functions from early RLS iteration
-- These were created then dropped across multiple fix migrations.
-- Belt-and-suspenders cleanup in case any DB still has them.
-- ============================================================================

DROP FUNCTION IF EXISTS public.check_league_commissioner(UUID);
DROP FUNCTION IF EXISTS public.check_league_commissioner(UUID, UUID);

-- ============================================================================
-- 6. DONE
-- ============================================================================

COMMENT ON INDEX idx_waiver_claims_team_status IS 'Optimizes "my pending claims" queries filtering by team + status';
COMMENT ON INDEX idx_trade_offers_league_status_created IS 'Optimizes "active trades in league" queries sorted by newest first';
COMMENT ON INDEX idx_fantasy_daily_rosters_league_team_date IS 'Optimizes league-wide daily roster snapshot queries';
COMMENT ON INDEX idx_nhl_games_game_date_desc IS 'Optimizes recent games lookups sorted by date descending';
