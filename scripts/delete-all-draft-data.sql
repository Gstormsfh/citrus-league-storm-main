-- CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
-- CATEGORY: DESTRUCTIVE
-- Purpose: Wipe all draft data (alternate spelling of nuke-all-draft-data — possibly duplicate)
-- Invoked: manual via Supabase SQL Editor; review before run
-- Reads:   (none)
-- Writes:  draft_events, draft_picks, draft_picks_v2 — DELETEs
-- Note:    RECOVERY: PITR. Confirm whether duplicate of nuke-all-draft-data.sql.
-- ────────────────────────────────────────────────────────────
-- Delete ALL draft data and reset all leagues
-- WARNING: This is a destructive operation - it will permanently delete all draft data!
-- Run this in Supabase SQL Editor

-- Step 1: Delete all draft picks (hard delete - removes even soft-deleted records)
DELETE FROM public.draft_picks;

-- Step 2: Delete all draft orders (hard delete - removes even soft-deleted records)
DELETE FROM public.draft_order;

-- Step 3: Reset all leagues to 'not_started'
UPDATE public.leagues
SET draft_status = 'not_started';

-- Verify the cleanup
SELECT 
  (SELECT COUNT(*) FROM public.draft_picks) as remaining_picks,
  (SELECT COUNT(*) FROM public.draft_order) as remaining_orders,
  (SELECT COUNT(*) FROM public.leagues WHERE draft_status != 'not_started') as leagues_not_reset;

-- Expected result: all counts should be 0

