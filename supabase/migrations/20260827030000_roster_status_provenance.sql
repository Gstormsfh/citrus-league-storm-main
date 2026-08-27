-- ============================================================================
-- ROSTER STATUS PROVENANCE
-- ============================================================================
-- `player_talent_metrics.roster_status` drives two features that have never
-- worked: the IR slot (Roster.tsx gates every IR assignment on
-- `is_ir_eligible`) and the player news feed (`usePlayerNews` filters on
-- `roster_status`). On 2026-08-26 the column was NULL for all 940 rows.
--
-- The cause was not a missing cron. `scripts/utilities/populate_gp_last_10_metric.py`
-- called https://api-web.nhle.com/v1/roster/{team}/current and read
-- `status` / `rosterStatus` / `roster_status`. Verified against the live
-- endpoint on 2026-08-26: that payload carries none of those keys — it is
-- biographical only. `/v1/player/{id}/landing` carries `isActive`, which is
-- career-active, not injury. The NHL's public API publishes no injury or IR
-- designation at all; the three-key guess-chain is the fingerprint of a port
-- from the retired statsapi.web.nhl.com, which did expose `rosterStatus`.
--
-- Status now arrives from an external feed
-- (data-pipeline/acquisition/fetch_injury_status.py). That feed is a
-- SNAPSHOT, not an event log: a player who comes off IR simply stops being
-- listed. Without a clear-down, IR is a one-way door and players stay injured
-- forever.
--
-- Clearing blindly is not an option either — a commissioner override or any
-- other writer would be wiped on the next sync. So each row records WHO set
-- it, and the sync only clears rows it owns.
--
-- WHY NOT AN ENUM: the upstream status vocabulary is open. Observed
-- 2026-08-26: 'Out', 'Suspension', 'Injured Reserve'. In season it will carry
-- more. A CHECK constraint here would turn an unfamiliar designation into a
-- failed write, and the sync's own contract is that an unknown status is
-- stored verbatim rather than dropped to NULL — because NULL is
-- indistinguishable from healthy in every consumer downstream.
-- ============================================================================

ALTER TABLE public.player_talent_metrics
    ADD COLUMN IF NOT EXISTS roster_status_source TEXT;

COMMENT ON COLUMN public.player_talent_metrics.roster_status_source IS
    'Who set roster_status. NULL = unset or cleared. Automated syncs write '
    'their own identifier (e.g. ''espn-injuries'') and clear only rows '
    'carrying it, so a manual or commissioner-set status is never clobbered.';

-- The sync's clear-down reads exactly this predicate once per run: every row
-- it owns for the target season. Partial, because the overwhelming majority
-- of rows have no source and never will.
CREATE INDEX IF NOT EXISTS idx_player_talent_metrics_status_source
    ON public.player_talent_metrics (roster_status_source, season)
    WHERE roster_status_source IS NOT NULL;
