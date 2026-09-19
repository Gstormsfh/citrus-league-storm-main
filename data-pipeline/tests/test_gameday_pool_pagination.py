"""The daily emitter must read past PostgREST's cap without disabling guards."""
import json
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlparse

import pytest
import _bootstrap  # noqa: F401

from data_pipeline.gameday.emit import load_player_rows
from data_pipeline.utils.supabase_rest import SupabaseRest


def client(total, short_second_page=False, duplicate=False, missing_count=False):
    db = SupabaseRest("https://example.invalid", "test-key")

    def request(method, url, **kwargs):
        query = parse_qs(urlparse(url).query)
        assert query["limit"] == ["1000"]
        assert query["order"] == ["player_id.asc"]
        assert query["season"] == ["eq.2026"]
        assert kwargs["headers"]["Prefer"] == "count=exact"
        offset = int(query["offset"][0])
        count = min(1000, max(0, total - offset))
        if short_second_page and offset:
            count -= 1
        rows = [{"player_id": i} for i in range(offset, offset + count)]
        if duplicate and offset and rows:
            rows[0]["player_id"] = 0
        response = MagicMock(status_code=200)
        response.text = json.dumps(rows)
        response.json.return_value = rows
        response.headers = {} if missing_count else {"Content-Range": f"{offset}-{offset + count - 1}/{total}"}
        return response

    db._request_with_retry = MagicMock(side_effect=request)
    return db


@pytest.mark.parametrize("total", [0, 999, 1000, 1345, 2000])
def test_reads_complete_pool(total):
    db = client(total)
    rows = load_player_rows(db, "player_directory", "player_id", 2026)
    assert [r["player_id"] for r in rows] == list(range(total))
    assert db._request_with_retry.call_count == total // 1000 + 1


def test_short_second_page_still_fails_closed():
    with pytest.raises(RuntimeError, match="TRUNCATION"):
        load_player_rows(client(1345, short_second_page=True), "player_directory", "player_id", 2026)


def test_missing_count_still_fails_closed():
    with pytest.raises(RuntimeError, match="Content-Range"):
        load_player_rows(client(1345, missing_count=True), "player_directory", "player_id", 2026)


def test_duplicate_page_identity_fails_closed():
    with pytest.raises(RuntimeError, match="duplicate player"):
        load_player_rows(client(1345, duplicate=True), "player_directory", "player_id", 2026)
