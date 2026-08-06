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

import datetime as _dt
from typing import List, Tuple

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


def derive_nhl_season_year(d: _dt.date) -> int:
    """Python mirror of public.get_nhl_season_year (SQL, IMMUTABLE).

    NHL seasons run Oct→Jun. Months 10-12 use the current year; months 1-9
    use the previous year. Any drift between this function and the SQL side
    re-creates the season-rollover silent-failure that scores every player
    zero on opening night — the boundary-date test in
    tests/test_nhl_season_year_parity.py catches drift by calling the real
    SQL function over PostgREST and comparing bit-for-bit.
    """
    return d.year if d.month >= 10 else d.year - 1


def seasons_to_populate(today: _dt.date) -> List[int]:
    """Season list the daily player_directory refresh job should populate.

    During the offseason ramp (Aug 1 – Sep 30) return both the outgoing and
    the incoming NHL-season year, so opening night does not depend on a
    single first-of-October cron run succeeding at populating hundreds of
    season-N+1 rows from scratch. Otherwise return the single current
    season year.

    This function is the shared source of truth for BOTH the writer
    (populate_player_directory.py) and the workflow assertion. Do not
    duplicate the logic elsewhere; import from here.
    """
    current = derive_nhl_season_year(today)
    if today.month in (8, 9):
        return [current, current + 1]
    return [current]


def min_directory_rows_floor(today: _dt.date, season: int) -> int:
    """Minimum acceptable player_directory row count for a given season on
    a given date. Anything under the floor is treated as a functional
    outage — a directory with 40 rows passes a `> 0` check and still zero-
    scores almost every player.

    Rules:
      * The CURRENT-derived NHL season (derive_nhl_season_year(today)) is
        the season the scoring RPCs JOIN against every day of the year.
        It must have ≥ 700 rows always. 32 teams × ~23 players ≈ 736; 700
        is a safe lower bound leaving headroom for early-camp
        incompleteness right after an Oct 1 flip.
      * In September, the INCOMING season (current + 1) must also have
        ≥ 700 rows — opening night is imminent and we cannot have the
        first-of-October cron be the first successful population.
      * All other (season, date) combos return 0. This includes the Aug
        ramp for the incoming season (camps have not yet begun; partial
        roster is normal) and historical seasons prior to the current one.
    """
    current = derive_nhl_season_year(today)
    if season == current:
        return 700
    if today.month == 9 and season == current + 1:
        return 700
    return 0
