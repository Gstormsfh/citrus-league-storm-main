-- CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
-- CATEGORY: DESTRUCTIVE
-- Purpose: Full draft reset (combination of delete-all-draft-data + reset draft state)
-- Invoked: manual via Supabase SQL Editor; review before run
-- Reads:   (none)
-- Writes:  draft_events, draft_picks, draft_order, draft_queues, leagues.draft_state
-- Note:    RECOVERY: PITR.
-- ────────────────────────────────────────────────────────────
-- Complete Draft Reset Script
-- This will HARD DELETE all draft data from Supabase
-- Run this in Supabase SQL Editor to completely reset all drafts

-- Step 1: Delete ALL draft picks (hard delete - completely removes records)
DELETE FROM public.draft_picks;

-- Step 2: Delete ALL draft orders (hard delete - completely removes records)
DELETE FROM public.draft_order;

-- Step 3: Reset ALL league draft statuses to 'not_started'
UPDATE public.leagues 
SET draft_status = 'not_started'
WHERE draft_status IN ('in_progress', 'completed');

-- Step 4: Verify the cleanup (optional - run this to check)
-- SELECT 
--   (SELECT COUNT(*) FROM draft_picks) as remaining_picks,
--   (SELECT COUNT(*) FROM draft_order) as remaining_orders,
--   (SELECT COUNT(*) FROM leagues WHERE draft_status != 'not_started') as leagues_not_reset;

-- If the above query returns all zeros, the cleanup was successful!

