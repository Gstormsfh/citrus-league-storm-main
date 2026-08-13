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

from data_pipeline.utils.season_config import derive_nhl_season_year  # noqa: E402


# Boundary dates chosen to cover:
#   - Sep 29 / Sep 30: the CALENDAR rule puts these in season N-1. That is what
#     this test asserts, because both sides of the parity ARE the calendar rule.
#     It is NOT what the product should believe: the 2026-27 season opens
#     2026-09-29, and the product-path resolver handles that. See
#     test_season_boundary.py. Do not "fix" this file to expect 2026.
#   - Oct 1 / Oct 2:   first two days of NHL year N (calendar flip)
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


# Placeholder credentials planted by other test modules. test_projection_logic.py
# does os.environ.setdefault("VITE_SUPABASE_URL", "https://test.supabase.co") and
# the matching SERVICE_ROLE_KEY at MODULE level, because the module it imports needs
# them present at import time. pytest imports every test module during collection,
# before any test runs, so those values are in the environment by the time this file
# executes -- regardless of file order. The "are creds present?" guard below was
# therefore satisfied by credentials that were never real, and these tests tried to
# resolve test.supabase.co over the network. Eight of them failed that way on the
# first CI run of this suite (2026-08-13).
_PLACEHOLDER_URL_HOSTS = ("test.supabase.co", "example.supabase.co", "localhost")
_PLACEHOLDER_KEY_PREFIXES = ("test-", "dummy-", "placeholder")


def _live_supabase():
    """Return a SupabaseRest client, or skip when real credentials are absent."""
    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        pytest.skip("VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
    if any(h in url for h in _PLACEHOLDER_URL_HOSTS) or key.startswith(_PLACEHOLDER_KEY_PREFIXES):
        pytest.skip(
            "placeholder Supabase credentials leaked from another test module; "
            "this parity test needs real ones"
        )
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
