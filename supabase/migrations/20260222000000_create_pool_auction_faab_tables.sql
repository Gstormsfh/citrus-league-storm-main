-- ============================================================================
-- Pool gameplay tables (Pick'em, Survivor, Confidence)
-- Auction draft tables (bidding system)
-- FAAB budget tracking table
-- ============================================================================

-- ============================================================================
-- 1. Pick'em Pool — stores game-level picks per user per week
-- ============================================================================
CREATE TABLE IF NOT EXISTS pool_picks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    game_id TEXT NOT NULL,            -- nhl_games.id or external game identifier
    picked_team TEXT NOT NULL,        -- team abbreviation (e.g. 'TOR')
    is_correct BOOLEAN DEFAULT NULL,  -- NULL = not yet scored
    spread_value NUMERIC DEFAULT NULL,-- for against-the-spread mode
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Each user can only pick once per game per week
    UNIQUE (league_id, user_id, week_number, game_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_picks_league_week
    ON pool_picks (league_id, week_number);
CREATE INDEX IF NOT EXISTS idx_pool_picks_user
    ON pool_picks (league_id, user_id);

-- ============================================================================
-- 2. Survivor Pool — one team pick per user per week, no repeats
-- ============================================================================
CREATE TABLE IF NOT EXISTS survivor_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    picked_team TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One pick per user per week
    UNIQUE (league_id, user_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_survivor_league_week
    ON survivor_selections (league_id, week_number);
CREATE INDEX IF NOT EXISTS idx_survivor_user
    ON survivor_selections (league_id, user_id);

-- ============================================================================
-- 3. Confidence Pool — ranked picks with confidence point values
-- ============================================================================
CREATE TABLE IF NOT EXISTS confidence_picks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    game_id TEXT NOT NULL,
    picked_team TEXT NOT NULL,
    confidence_points INTEGER NOT NULL,   -- 1 = least confident, N = most
    is_correct BOOLEAN DEFAULT NULL,
    points_earned INTEGER NOT NULL DEFAULT 0,  -- confidence_points if correct, 0 otherwise
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One pick per game per user per week
    UNIQUE (league_id, user_id, week_number, game_id)
);

CREATE INDEX IF NOT EXISTS idx_confidence_league_week
    ON confidence_picks (league_id, week_number);
CREATE INDEX IF NOT EXISTS idx_confidence_user
    ON confidence_picks (league_id, user_id);

-- ============================================================================
-- 4. Auction Draft — budget tracking per team
-- ============================================================================
CREATE TABLE IF NOT EXISTS auction_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    initial_budget NUMERIC NOT NULL DEFAULT 200,
    remaining_budget NUMERIC NOT NULL DEFAULT 200,
    players_won INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (league_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_auction_budgets_league
    ON auction_budgets (league_id);

-- ============================================================================
-- 5. Auction Nominations — tracks each player nomination and bidding
-- ============================================================================
CREATE TABLE IF NOT EXISTS auction_nominations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    draft_session_id UUID NOT NULL,
    nominated_by_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    minimum_bid NUMERIC NOT NULL DEFAULT 1,
    current_high_bid NUMERIC NOT NULL DEFAULT 1,
    current_high_bidder_team_id UUID REFERENCES teams(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'no_sale')),
    nomination_number INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auction_noms_league_session
    ON auction_nominations (league_id, draft_session_id);
CREATE INDEX IF NOT EXISTS idx_auction_noms_status
    ON auction_nominations (league_id, status);

-- ============================================================================
-- 6. Auction Bids — individual bids placed per nomination
-- ============================================================================
CREATE TABLE IF NOT EXISTS auction_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    nomination_id UUID NOT NULL REFERENCES auction_nominations(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    bid_amount NUMERIC NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auction_bids_nomination
    ON auction_bids (nomination_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_league
    ON auction_bids (league_id);

-- ============================================================================
-- 7. FAAB Budgets — tracks free-agent acquisition budget per team
-- ============================================================================
CREATE TABLE IF NOT EXISTS faab_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    initial_budget NUMERIC NOT NULL DEFAULT 100,
    remaining_budget NUMERIC NOT NULL DEFAULT 100,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (league_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_faab_budgets_league
    ON faab_budgets (league_id);

-- ============================================================================
-- Row Level Security — pool tables follow league membership patterns
-- ============================================================================

ALTER TABLE pool_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE survivor_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE confidence_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE faab_budgets ENABLE ROW LEVEL SECURITY;

-- Pool tables: users can read all picks in their league, insert/update their own
CREATE POLICY "pool_picks_select" ON pool_picks FOR SELECT
    USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "pool_picks_insert" ON pool_picks FOR INSERT
    WITH CHECK (user_id = auth.uid());
CREATE POLICY "pool_picks_update" ON pool_picks FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "survivor_select" ON survivor_selections FOR SELECT
    USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "survivor_insert" ON survivor_selections FOR INSERT
    WITH CHECK (user_id = auth.uid());
CREATE POLICY "survivor_update" ON survivor_selections FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "confidence_select" ON confidence_picks FOR SELECT
    USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "confidence_insert" ON confidence_picks FOR INSERT
    WITH CHECK (user_id = auth.uid());
CREATE POLICY "confidence_update" ON confidence_picks FOR UPDATE
    USING (user_id = auth.uid());

-- Auction tables: league members can read, team owners can insert bids
CREATE POLICY "auction_budgets_select" ON auction_budgets FOR SELECT
    USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "auction_budgets_all" ON auction_budgets FOR ALL
    USING (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));

CREATE POLICY "auction_noms_select" ON auction_nominations FOR SELECT
    USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "auction_noms_insert" ON auction_nominations FOR INSERT
    WITH CHECK (nominated_by_team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));

CREATE POLICY "auction_bids_select" ON auction_bids FOR SELECT
    USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "auction_bids_insert" ON auction_bids FOR INSERT
    WITH CHECK (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));

-- FAAB budgets: league members can read, system manages updates
CREATE POLICY "faab_budgets_select" ON faab_budgets FOR SELECT
    USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "faab_budgets_all" ON faab_budgets FOR ALL
    USING (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));
