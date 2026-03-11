-- ============================================================================
-- PLAYER TRANSACTIONS TABLE
-- Tracks all add/drop transactions across the entire platform for trending data
-- Scalable to thousands of users with proper indexing
-- ============================================================================

-- Create the player_transactions table
CREATE TABLE IF NOT EXISTS player_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id INTEGER NOT NULL,
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('add', 'drop')),
    source TEXT DEFAULT 'free_agent', -- 'free_agent', 'waiver', 'trade', 'draft'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Player metadata at time of transaction (for historical reference)
    player_name TEXT,
    player_team TEXT,
    player_position TEXT
);

-- Performance indexes for scalability
CREATE INDEX IF NOT EXISTS idx_player_transactions_player_id ON player_transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_player_transactions_created_at ON player_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_transactions_type ON player_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_player_transactions_league ON player_transactions(league_id);
CREATE INDEX IF NOT EXISTS idx_player_transactions_team ON player_transactions(team_id);

-- Composite index for trending queries (last 7 days adds per player)
CREATE INDEX IF NOT EXISTS idx_player_transactions_trending 
ON player_transactions(player_id, transaction_type, created_at DESC)
WHERE transaction_type = 'add';

-- RLS Policies
ALTER TABLE player_transactions ENABLE ROW LEVEL SECURITY;

-- Anyone can read transactions (for trending data)
CREATE POLICY "Anyone can read player transactions"
ON player_transactions FOR SELECT
USING (true);

-- Only authenticated users can insert their own transactions
CREATE POLICY "Users can insert their own transactions"
ON player_transactions FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- RPC: Get trending players by add count (platform-wide)
-- Optimized for high traffic with proper aggregation
-- ============================================================================
CREATE OR REPLACE FUNCTION get_trending_players(
    days_back INTEGER DEFAULT 7,
    limit_count INTEGER DEFAULT 20,
    position_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
    player_id INTEGER,
    add_count BIGINT,
    drop_count BIGINT,
    net_adds BIGINT,
    last_added TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pt.player_id,
        COUNT(*) FILTER (WHERE pt.transaction_type = 'add') as add_count,
        COUNT(*) FILTER (WHERE pt.transaction_type = 'drop') as drop_count,
        COUNT(*) FILTER (WHERE pt.transaction_type = 'add') - 
        COUNT(*) FILTER (WHERE pt.transaction_type = 'drop') as net_adds,
        MAX(pt.created_at) FILTER (WHERE pt.transaction_type = 'add') as last_added
    FROM player_transactions pt
    WHERE pt.created_at >= NOW() - (days_back || ' days')::INTERVAL
    AND (position_filter IS NULL OR pt.player_position = position_filter)
    GROUP BY pt.player_id
    HAVING COUNT(*) FILTER (WHERE pt.transaction_type = 'add') > 0
    ORDER BY add_count DESC, last_added DESC
    LIMIT limit_count;
END;
$$;

-- ============================================================================
-- RPC: Record a player transaction (called when adding/dropping players)
-- ============================================================================
CREATE OR REPLACE FUNCTION record_player_transaction(
    p_player_id INTEGER,
    p_league_id UUID,
    p_team_id UUID,
    p_transaction_type TEXT,
    p_source TEXT DEFAULT 'free_agent',
    p_player_name TEXT DEFAULT NULL,
    p_player_team TEXT DEFAULT NULL,
    p_player_position TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_transaction_id UUID;
BEGIN
    INSERT INTO player_transactions (
        player_id,
        league_id,
        team_id,
        user_id,
        transaction_type,
        source,
        player_name,
        player_team,
        player_position
    )
    VALUES (
        p_player_id,
        p_league_id,
        p_team_id,
        auth.uid(),
        p_transaction_type,
        p_source,
        p_player_name,
        p_player_team,
        p_player_position
    )
    RETURNING id INTO v_transaction_id;
    
    RETURN v_transaction_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_trending_players TO authenticated, anon;
GRANT EXECUTE ON FUNCTION record_player_transaction TO authenticated;

COMMENT ON TABLE player_transactions IS 'Tracks all player add/drop transactions across the platform for trending analytics';
COMMENT ON FUNCTION get_trending_players IS 'Returns trending players by add count over specified time period';
COMMENT ON FUNCTION record_player_transaction IS 'Records a player transaction (add/drop) for trending analytics';
