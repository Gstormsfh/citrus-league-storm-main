#!/usr/bin/env python3
"""
test_supabase_rest_build_query.py — Task 3C / D-02 regression.

Confirms that SupabaseRest._build_query preserves BOTH filters when the
same column appears twice (e.g. `game_date >= X AND game_date <= Y`).
Prior state: `params[k] = v` on the second write silently clobbered the
first filter. That is how the D-02 backfill resolved a single-date scrape
to `game_date=lte.<date>` and wrote 13,145 rows to STAGING against every
game up to that date.

Never re-implements PostgREST semantics — just asserts the emitted query
string contains BOTH filter values.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa: E402


def _client() -> SupabaseRest:
    # No network. _build_query is a pure string builder — pass any
    # credentials, we never call over the wire.
    return SupabaseRest("https://example.invalid", "test-key")


def test_same_column_range_preserves_both_filters():
    db = _client()
    qs = db._build_query(
        filters=[
            ("game_date", "gte", "2026-01-26"),
            ("game_date", "lte", "2026-01-26"),
        ],
    )
    # PostgREST convention: same key repeated, AND-composed server-side.
    assert "game_date=gte.2026-01-26" in qs, f"missing gte filter: {qs}"
    assert "game_date=lte.2026-01-26" in qs, f"missing lte filter: {qs}"


def test_same_column_range_across_two_different_dates():
    db = _client()
    qs = db._build_query(
        filters=[
            ("game_date", "gte", "2026-04-04"),
            ("game_date", "lte", "2026-04-05"),
        ],
    )
    assert "game_date=gte.2026-04-04" in qs
    assert "game_date=lte.2026-04-05" in qs


def test_three_filters_on_same_column_all_preserved():
    db = _client()
    qs = db._build_query(
        filters=[
            ("season", "eq", 2025),
            ("season", "eq", 2026),
            ("season", "eq", 2027),
        ],
    )
    # All three eq filters should survive the accumulation.
    assert qs.count("season=eq.2025") == 1
    assert qs.count("season=eq.2026") == 1
    assert qs.count("season=eq.2027") == 1


def test_distinct_columns_still_scalar():
    db = _client()
    qs = db._build_query(
        filters=[
            ("game_id", "eq", 2025020828),
            ("season", "eq", 2025),
        ],
    )
    assert "game_id=eq.2025020828" in qs
    assert "season=eq.2025" in qs
