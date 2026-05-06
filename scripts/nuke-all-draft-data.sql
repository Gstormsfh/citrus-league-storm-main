-- CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
-- CATEGORY: DESTRUCTIVE
-- Purpose:     Wipe all draft-related rows across all leagues
-- Last active: 2025-12-17
-- Invoked:     manual via Supabase SQL Editor; review before run
-- Reads:       (none)
-- Writes:      draft_picks (DELETE all), draft_order (DELETE all), leagues.draft_status (UPDATE in_progress|completed → not_started)
-- Note:        RECOVERY: Supabase 7-day PITR. Take a backup before running. Note: does NOT touch draft_events / draft_picks_v2 / draft_queues — earlier headers were aspirational; corrected per R5 §7.7 audit.
-- ────────────────────────────────────────────────────────────
-- NUCLEAR OPTION: Delete ALL draft data from ALL leagues
-- This completely wipes all draft history
-- Run this in Supabase SQL Editor to nuke everything
-- WARNING: This cannot be undone!

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

