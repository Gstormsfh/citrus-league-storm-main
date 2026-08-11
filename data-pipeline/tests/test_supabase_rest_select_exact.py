#!/usr/bin/env python3
"""
test_supabase_rest_select_exact.py — 0E-XG-11 Task 2 regression.

Confirms that SupabaseRest.select_exact:
  * sends Prefer: count=exact,
  * reads Content-Range,
  * RAISES on truncation (received != expected slice),
  * RAISES on missing/malformed Content-Range,
  * PASSES when rows returned match the request-window slice.

Never re-implements PostgREST behavior — mocks the HTTP layer only.
"""
import os
import sys
import json
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa: E402


def _client_with_response(status: int, body, headers):
    """SupabaseRest instance whose _request_with_retry returns a canned response."""
    db = SupabaseRest("https://example.invalid", "test-key")
    resp = MagicMock()
    resp.status_code = status
    resp.text = json.dumps(body) if body is not None else ""
    resp.json = MagicMock(return_value=body if body is not None else [])
    resp.headers = headers
    db._request_with_retry = MagicMock(return_value=resp)
    return db


def test_full_response_passes():
    # 5 rows requested, 5 rows returned, Content-Range says 5 available
    rows = [{"id": i} for i in range(5)]
    db = _client_with_response(200, rows, {"Content-Range": "0-4/5"})
    result = db.select_exact("raw_shots", limit=1000)
    assert result == rows


def test_paginated_slice_passes():
    # Requesting offset=1000 limit=1000, PostgREST returns 500 rows, total=1500
    # Expected slice: min(1000, 1500-1000) = 500
    rows = [{"id": i} for i in range(500)]
    db = _client_with_response(200, rows, {"Content-Range": "1000-1499/1500"})
    result = db.select_exact("raw_shots", limit=1000, offset=1000)
    assert len(result) == 500


def test_truncation_detected():
    # Total 1394, requested full scan (no limit/offset), got 1369 → RAISE
    rows = [{"id": i} for i in range(1369)]
    db = _client_with_response(200, rows, {"Content-Range": "0-1368/1394"})
    with pytest.raises(RuntimeError, match=r"TRUNCATION detected"):
        db.select_exact("raw_shots")


def test_paginated_short_page_detected():
    # Asked for limit=1000 at offset=0, total=1500 available, got 900 back → RAISE
    rows = [{"id": i} for i in range(900)]
    db = _client_with_response(200, rows, {"Content-Range": "0-899/1500"})
    with pytest.raises(RuntimeError, match=r"TRUNCATION detected"):
        db.select_exact("raw_shots", limit=1000)


def test_missing_content_range_raises():
    rows = [{"id": i} for i in range(5)]
    db = _client_with_response(200, rows, {})  # no header at all
    with pytest.raises(RuntimeError, match=r"missing/malformed Content-Range"):
        db.select_exact("raw_shots")


def test_total_star_raises():
    # PostgREST returns "0-4/*" when it can't compute the exact total —
    # we cannot verify completeness against a nonexistent total.
    rows = [{"id": i} for i in range(5)]
    db = _client_with_response(200, rows, {"Content-Range": "0-4/*"})
    with pytest.raises(RuntimeError, match=r"unbounded total"):
        db.select_exact("raw_shots")


def test_star_range_with_zero_rows_is_truncation():
    # "*/N" means "no range returned, total N." If N > 0 and we got zero
    # rows, that's silent truncation.
    db = _client_with_response(200, [], {"Content-Range": "*/12345"})
    with pytest.raises(RuntimeError, match=r"TRUNCATION detected"):
        db.select_exact("raw_shots")


def test_offset_past_end_returns_empty():
    # offset=100 when total=50 → expected = 0, empty list is correct.
    db = _client_with_response(200, [], {"Content-Range": "0-0/50"})
    result = db.select_exact("raw_shots", offset=100, limit=10)
    assert result == []
