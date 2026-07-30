#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Single source of truth for the current NHL season number used by
#              the data-pipeline live product path.
# Last active: 2026-07-30
# Invoked:     imported by projections / matchup scoring / backfill helpers
# ────────────────────────────────────────────────────────────
"""
season_config.py

CURRENT_SEASON is the START year of the current NHL season (2025 = 2025-26),
matching raw_shots.season and the MoneyPuck game_id schema. This is the
Python companion to `packages/shared/src/constants/season.ts`; when the
season rolls over, update BOTH constants in the same PR.

Live product path (daily projections, matchup scoring, GSAx-in-projection)
MUST filter raw_shots by CURRENT_SEASON so a historical load (phase 0c
adds seasons 2017-2024 to raw_shots) is invisible to end users. Use
`live_season_filter()` for the standard SupabaseRest filter tuple.
"""

from typing import Tuple

CURRENT_SEASON: int = 2025


def live_season_filter(season: int = CURRENT_SEASON) -> Tuple[str, str, int]:
    """SupabaseRest filter tuple for the live product path. Drop into any
    `filters=[...]` list. Default is CURRENT_SEASON.

    Example:
        rows = db.select(
            "raw_shots",
            select="player_id,xg_value",
            filters=[live_season_filter(), ("player_id", "eq", pid)],
        )
    """
    return ("season", "eq", int(season))
