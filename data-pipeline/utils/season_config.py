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


# Seasons that open BEFORE October, keyed by season year.
#
# The month rule below encodes "NHL seasons start in October". True of every
# season this pipeline has ever processed, and false for the next one: 2026-27
# opens 2026-09-29 and plays 8 regular-season games before October 1. Without
# this map the whole Python pipeline targets season 2025 on opening night and
# the day after -- calculate_daily_projections, fantasy_projection_pipeline,
# nightly_projection_batch and populate_team_stats all take their season from
# current_season(), and live_season_filter() would filter raw_shots to 2025
# while the rows arriving are 2026. The failure is silent: a season filter that
# matches nothing looks exactly like a night with no data.
#
# Explicit map rather than a derived rule, and the same shape as
# SEASON_START_DATES in packages/shared/src/constants/season.ts and the
# schedule-derived public.get_current_season() in SQL. The NHL sets this per
# season by agreement.
SEASON_START_DATES = {
    2026: _dt.date(2026, 9, 29),
}


def season_start_date(season: int) -> _dt.date:
    """First regular-season game date for `season`, Oct 1 unless overridden."""
    return SEASON_START_DATES.get(season, _dt.date(season, 10, 1))


def current_nhl_season(d: _dt.date) -> int:
    """The season number in effect on date `d`, honouring early season starts.

    Python companion to SQL public.get_current_season(date). Use this for
    "which season am I reading or writing". Use derive_nhl_season_year() only
    where the pure calendar rule is what you want -- it is kept as the exact
    mirror of the IMMUTABLE SQL get_nhl_season_year(date).
    """
    by_calendar = d.year if d.month >= 10 else d.year - 1
    start = SEASON_START_DATES.get(by_calendar + 1)
    if start is not None and d >= start:
        return by_calendar + 1
    return by_calendar


def _derive_from_today() -> int:
    """Computed each call. Honours early season starts via current_nhl_season."""
    return current_nhl_season(_dt.date.today())


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
    # The ramp exists because opening night must not depend on a single
    # first-of-October cron run. "Imminent" is a property of the SCHEDULE, not
    # of the month: with a Sept 29 opener, a month test still reads true on
    # Sept 29 and 30 -- AFTER the season has started -- and would have asked
    # this job to populate hundreds of rows for a season (current + 1) that is
    # over a year away, while min_directory_rows_floor demanded 700 of them.
    current = current_nhl_season(today)
    days_to_next = (season_start_date(current + 1) - today).days
    if 0 < days_to_next <= 60:
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
    current = current_nhl_season(today)
    if season == current:
        return 700
    # Same reasoning as seasons_to_populate: gate on how close the next season
    # actually is, not on the calendar month.
    days_to_next = (season_start_date(current + 1) - today).days
    if season == current + 1 and 0 < days_to_next <= 30:
        return 700
    return 0
