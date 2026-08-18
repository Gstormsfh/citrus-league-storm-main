#!/usr/bin/env python3
"""
test_nhl_season_year_parity.py — Task 0H.

Assert that the Python `derive_nhl_season_year()` in
`data_pipeline.utils.season_config` returns bit-for-bit the same value as
the SQL function `public.get_nhl_season_year(date)` for boundary dates
around the NHL season rollover.

Why this test exists: the season the writer targets and the season the
scoring RPCs JOIN against must agree. If the two drift by a day at any
boundary, every player rostered on the wrong side of the boundary scores
zero — silently. The comment "keep these in sync" is not a control; the
test is.

Skips when Supabase env vars are absent (local dev without service key).
"""

import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401,E402  — registers the data_pipeline package

from data_pipeline.utils.season_config import (  # noqa: E402
    current_nhl_season,
    derive_nhl_season_year,
)


# Boundary dates chosen to cover:
#   - Sep 29 / Sep 30: under the bare CALENDAR rule these are the last two
#     days of NHL year N-1. That is what get_nhl_season_year says and it is
#     correct as a statement of the calendar rule. It is NOT which season is
#     being played: 2026-27 opens 2026-09-29. The second test below is the
#     one that pins that, against get_current_season.
#   - Oct 1 / Oct 2:   first two days of NHL year N (season flip)
#   - Dec 31 / Jan 1:  calendar year boundary WITHIN a single NHL season
#   - Jun 30 / Jul 1:  postseason / offseason boundary WITHIN a single NHL season
# Anything the Python side gets wrong on these dates directly maps to
# scoring-RPC join misses.
BOUNDARY_DATES = [
    dt.date(2026, 9, 29),
    dt.date(2026, 9, 30),
    dt.date(2026, 10, 1),
    dt.date(2026, 10, 2),
    dt.date(2026, 12, 31),
    dt.date(2027, 1, 1),
    dt.date(2027, 6, 30),
    dt.date(2027, 7, 1),
]


def _live_supabase():
    """Return a SupabaseRest client, or skip the test if creds are absent."""
    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    # test_projection_logic.py sets placeholder creds at MODULE level with
    # os.environ.setdefault, which leaks across the whole pytest process. Under
    # a bare `not url` check this test then stopped skipping and tried to reach
    # https://test.supabase.co — hanging the suite anywhere the real secrets are
    # absent, while passing when each file was run on its own. Recognise the
    # placeholders explicitly. In CI the real secrets are exported before python
    # starts, so setdefault leaves them alone and these tests run for real.
    placeholder = (
        not url
        or not key
        or "test.supabase.co" in url
        or key.startswith("test-key")
    )
    if placeholder:
        pytest.skip("real VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
    from data_pipeline.utils.supabase_rest import SupabaseRest
    return SupabaseRest(url, key)


@pytest.mark.parametrize("d", BOUNDARY_DATES)
def test_python_matches_sql_get_nhl_season_year(d):
    """Python derive_nhl_season_year(d) MUST equal SQL get_nhl_season_year(d).

    Calls the real SQL function over PostgREST — never re-implements it in
    the test. If this test fails, the two definitions have drifted and
    scoring will silently drop players on the wrong side of the boundary.
    """
    db = _live_supabase()
    sql_result = db.rpc("get_nhl_season_year", {"p_date": d.isoformat()})
    py_result = derive_nhl_season_year(d)
    assert sql_result == py_result, (
        f"drift at {d.isoformat()}: SQL={sql_result} Python={py_result}. "
        f"Fix data_pipeline.utils.season_config.derive_nhl_season_year to "
        f"match the SQL definition in "
        f"supabase/migrations/20260109000000_fix_rpc_season_joins.sql."
    )


@pytest.mark.parametrize("d", BOUNDARY_DATES)
def test_python_matches_sql_get_current_season(d):
    """Python current_nhl_season(d) MUST equal SQL get_current_season(d).

    This is the pair that decides which season the pipeline reads and writes.
    get_nhl_season_year is the calendar rule and both sides agree on it; that
    agreement is necessary and not sufficient, because the calendar rule is
    wrong for a season that opens in September. On 2026-09-29 and 09-30 the two
    functions legitimately disagree with each other, and BOTH language bindings
    must follow get_current_season, not the calendar.

    The SQL side derives this from the loaded fixture list. Python cannot, so it
    carries SEASON_START_DATES. That is a duplication, which is exactly why it
    needs a test: an entry added to the schedule but not to the map shows up
    here rather than on opening night.
    """
    db = _live_supabase()
    sql_result = db.rpc("get_current_season", {"p_on": d.isoformat()})
    py_result = current_nhl_season(d)
    assert sql_result == py_result, (
        f"drift at {d.isoformat()}: SQL get_current_season={sql_result} "
        f"Python current_nhl_season={py_result}. Add the season start date to "
        f"SEASON_START_DATES in data_pipeline/utils/season_config.py (and to "
        f"SEASON_START_DATES in packages/shared/src/constants/season.ts)."
    )
