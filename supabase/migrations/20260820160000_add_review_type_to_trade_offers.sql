-- 2026-08-20 — SCHEMA DRIFT FIX. Applied live to prod (iezwazccqqrhrjupxzvf)
-- and staging (jjgspcpvqaiitloglxbb) on 2026-08-20 via MCP apply_migration;
-- this file is the repo's source of truth.
--
-- INCIDENT: the shared TRADE_OFFER_COLUMNS constant
-- (packages/shared/src/constants/columns.ts:95) selects
-- trade_offers.review_type, and TradeService.acceptTradeOffer /
-- submitTradeForReview write it — but NO migration ever added the column.
-- Result: every trade creation and accept 400s with
--   column trade_offers.review_type does not exist
-- Confirmed missing on BOTH prod and staging. The sibling review columns
-- (review_started_at, review_ends_at, vetoed_at) are present, so review_type
-- was split off in code but never migrated. Discovered 2026-08-20 by
-- attempting a real trade through the API during the end-to-end proof.
--
-- Values used by the code: 'none' | 'commissioner' | 'league_vote'.
-- Default 'none' matches TradeService's `league.trade_review_type || 'none'`
-- fallback, so existing rows and new rows behave as the code expects.
ALTER TABLE public.trade_offers
  ADD COLUMN IF NOT EXISTS review_type text NOT NULL DEFAULT 'none';
