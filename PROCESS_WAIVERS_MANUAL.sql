-- ═══════════════════════════════════════════════════════════════════════════
-- MANUAL WAIVER PROCESSING
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this script to manually process all pending waiver claims
-- This is a temporary solution until a scheduled job is set up
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. First, show what will be processed
SELECT 
    'PENDING WAIVER CLAIMS TO PROCESS' as info,
    wc.league_id,
    l.league_name,
    COUNT(*) as pending_claims
FROM waiver_claims wc
JOIN leagues l ON l.id = wc.league_id
WHERE wc.status = 'pending'
GROUP BY wc.league_id, l.league_name;

-- 2. Process waivers for EACH league that has pending claims
-- You need to run this for each league_id
DO $$
DECLARE
    v_league RECORD;
    v_result RECORD;
    v_processed_count INT := 0;
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'PROCESSING WAIVERS FOR ALL LEAGUES';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    
    -- Loop through all leagues with pending claims
    FOR v_league IN 
        SELECT DISTINCT wc.league_id, l.league_name
        FROM waiver_claims wc
        JOIN leagues l ON l.id = wc.league_id
        WHERE wc.status = 'pending'
    LOOP
        RAISE NOTICE '';
        RAISE NOTICE 'Processing waivers for: %', v_league.league_name;
        
        -- Process claims for this league
        FOR v_result IN 
            SELECT * FROM process_waiver_claims(v_league.league_id)
        LOOP
            v_processed_count := v_processed_count + 1;
            IF v_result.status = 'successful' THEN
                RAISE NOTICE '  ✅ Claim % SUCCESSFUL: Player % added to team %', 
                    v_result.claim_id, v_result.player_id, v_result.team_id;
            ELSE
                RAISE NOTICE '  ❌ Claim % FAILED: % (Player %)', 
                    v_result.claim_id, v_result.failure_reason, v_result.player_id;
            END IF;
        END LOOP;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'PROCESSING COMPLETE: % claims processed', v_processed_count;
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- 3. Also clear any players that should have cleared waivers by now
-- (Their waiver period has expired but they weren't cleared)
UPDATE player_waiver_status
SET cleared_at = NOW()
WHERE cleared_at IS NULL
  AND NOW() > dropped_at + (waiver_period_hours || ' hours')::INTERVAL;

-- 4. Show results after processing
SELECT 
    'RESULTS AFTER PROCESSING' as info,
    wc.league_id,
    l.league_name,
    wc.status,
    COUNT(*) as claim_count
FROM waiver_claims wc
JOIN leagues l ON l.id = wc.league_id
GROUP BY wc.league_id, l.league_name, wc.status
ORDER BY l.league_name, wc.status;

-- 5. Show any claims that are still pending (shouldn't be any after processing)
SELECT 
    'REMAINING PENDING CLAIMS (should be 0)' as info,
    wc.id,
    l.league_name,
    t.team_name,
    pd.full_name as player_name,
    wc.status,
    wc.failure_reason,
    wc.created_at
FROM waiver_claims wc
JOIN leagues l ON l.id = wc.league_id
JOIN teams t ON t.id = wc.team_id
JOIN player_directory pd ON pd.player_id = wc.player_id
WHERE wc.status = 'pending'
ORDER BY wc.created_at;
