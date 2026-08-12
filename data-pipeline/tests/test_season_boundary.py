#!/usr/bin/env python3
"""
test_season_boundary.py

The product-path season resolver must get OPENING NIGHT right.

The 2026-27 NHL season opens 2026-09-29. The plain calendar rule
("months 10-12 are season N, months 1-9 are season N-1") returns 2025 for
that date, so for the first two days of the season every projection, every
scoring join and every headshot URL would be a year stale.

The rule also cannot simply move to September: September 2020 holds 1,000
player_game_stats rows and 2,093 shots from the COVID bubble, all correctly
filed under season 2019. A month>=9 rule reclassifies every one of them.

So SEASON_STARTS is consulted first and the calendar rule is kept for
anything older than the schedule we ship. These cases pin that behaviour.
They need no database and no credentials, so they actually run.
"""

import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data_pipeline.utils.season_config import (  # noqa: E402
    SEASON_STARTS,
    _derive_from_today,
    derive_nhl_season_year,
)


PRODUCT_PATH_CASES = [
    (dt.date(2026, 8, 12), 2025, "offseason, before the opener"),
    (dt.date(2026, 9, 28), 2025, "day before opening night"),
    (dt.date(2026, 9, 29), 2026, "OPENING NIGHT"),
    (dt.date(2026, 9, 30), 2026, "day after opening night"),
    (dt.date(2026, 10, 1), 2026, "old calendar flip, now redundant"),
    (dt.date(2025, 10, 7), 2025, "previous season opener"),
    (dt.date(2026, 6, 14), 2025, "previous season, last game"),
    (dt.date(2020, 9, 15), 2019, "COVID bubble -- must stay 2019"),
    (dt.date(2020, 9, 1), 2019, "COVID bubble -- must stay 2019"),
]


@pytest.mark.parametrize("d,expected,why", PRODUCT_PATH_CASES)
def test_product_path_season(d, expected, why):
    assert _derive_from_today(d) == expected, why


def test_calendar_mirror_is_left_alone():
    """derive_nhl_season_year is the SQL mirror and must stay calendar-only.

    If this ever starts returning 2026 for 2026-09-29 somebody has "fixed"
    the mirror, and it will no longer match public.get_nhl_season_year.
    """
    assert derive_nhl_season_year(dt.date(2026, 9, 29)) == 2025
    assert derive_nhl_season_year(dt.date(2026, 10, 1)) == 2026


def test_season_starts_are_sane():
    """A season may open in its own autumn (2026 -> 2026-09-29) or, after a
    lockout or a pandemic, early in the following calendar year."""
    for season, start in SEASON_STARTS.items():
        assert start.year in (season, season + 1), f"season {season} start {start}"
        assert (
            (start.year == season and 8 <= start.month <= 10)
            or (start.year == season + 1 and start.month <= 2)
        ), f"season {season} start {start} is not in a plausible opener window"


def test_every_season_start_resolves_to_itself():
    for season, start in SEASON_STARTS.items():
        assert _derive_from_today(start) == season, f"{start} must resolve to {season}"


def test_september_opener_does_not_start_early():
    """Only meaningful for a SEPTEMBER opener -- that is the case this whole
    mechanism exists for.

    Deliberately NOT asserted for October openers: on 2025-10-06, the day
    before the 2025-26 opener, the calendar fallback already returns 2025,
    and public.get_current_season returns 2025 too. The two sides agree, so
    pinning "the day before must be the previous season" would be asserting
    something neither implementation believes.
    """
    for season, start in SEASON_STARTS.items():
        if start.month == 9:
            day_before = start - dt.timedelta(days=1)
            assert _derive_from_today(day_before) == season - 1, (
                f"{day_before} must still be season {season - 1}")
