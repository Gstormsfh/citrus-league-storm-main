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
from typing import List, Optional, Tuple


# ── SEPTEMBER OPENERS ────────────────────────────────────────────────
# The Oct-1 month rule below is wrong whenever a season opens in September.
# The 2026-27 season opens 2026-09-29, so on Sept 29 and Sept 30 the month
# rule returns 2025 and the entire product -- projections, scoring, roster
# locks, headshot URLs -- would think it is still last season for the first
# two days of the year.
#
# It CANNOT simply be changed to `month >= 9`. September 2020 holds 1,000
# player_game_stats rows and 2,093 shots from the COVID bubble, all correctly
# filed under season 2019; a month>=9 rule would silently reclassify every one
# of them to 2020. The schedule is the only ground truth, so the known season
# starts are listed here and the calendar rule is kept for everything older.
#
# Mirrors `SELECT season, min(game_date) FROM nhl_games WHERE game_type='regular'
# GROUP BY season`. Drift is caught by the check_season_boundary gate, which
# compares get_nhl_season_year() against get_current_season() across the next
# 180 days and fails when they disagree.
SEASON_STARTS = {
    2025: _dt.date(2025, 10, 7),
    2026: _dt.date(2026, 9, 29),
}


def _derive_from_today(on: "_dt.date | None" = None) -> int:
    """Computed each call. Mirrors the SQL public.get_current_season(): the most
    recent known season start on or before the date, falling back to the
    Oct-1 calendar rule for dates older than the schedule we ship."""
    d = on or _dt.date.today()
    for season in sorted(SEASON_STARTS, reverse=True):
        if d >= SEASON_STARTS[season]:
            return season
    return d.year if d.month >= 10 else d.year - 1


# CURRENT_SEASON is derived at IMPORT TIME from today's date. This closes
# the hardcoded-'2025' bug that would have made the projection pipeline
# read zero rows from raw_shots on 2026-10-01 (raw_shots would already
# contain season-2026 rows but the filter would still be 2025). For
# nightly cron jobs (nightly_projection_batch.py, run_daily_projections.py)
# this is correct — each run reimports and picks up today's value. For
# any long-running daemon consuming this constant, add a scheduled
# restart across Oct 1 or switch that daemon to call current_season()
# each iteration.
CURRENT_SEASON: int = _derive_from_today()


def current_season() -> int:
    """Always-fresh NHL season year derived from today. Prefer this over
    the CURRENT_SEASON constant inside any loop, daemon, or long-lived
    process that must pick up the Oct 1 season flip without a restart.
    """
    return _derive_from_today()


def live_season_filter(season: Optional[int] = None) -> Tuple[str, str, int]:
    """SupabaseRest filter tuple for the live product path. Drop into any
    `filters=[...]` list. Defaults to today's derived NHL season year
    (recomputed on every call — safe inside long-lived processes).

    Example:
        rows = db.select(
            "raw_shots",
            select="player_id,xg_value",
            filters=[live_season_filter(), ("player_id", "eq", pid)],
        )
    """
    if season is None:
        season = _derive_from_today()
    return ("season", "eq", int(season))


def derive_nhl_season_year(d: _dt.date) -> int:
    """Python mirror of public.get_nhl_season_year (SQL, IMMUTABLE).

    DO NOT "fix" this to handle September openers. It is deliberately the
    CALENDAR rule and nothing else -- its whole job is to stay bit-for-bit
    identical to the SQL function of the same name, which
    test_nhl_season_year_parity.py enforces over PostgREST. The product-path
    question "what season is it right now" is answered by current_season() /
    _derive_from_today(), which consult SEASON_STARTS first and therefore get
    2026-09-29 right.

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
