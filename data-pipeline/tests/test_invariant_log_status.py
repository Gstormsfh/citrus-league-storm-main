"""RPC statuses must fit the existing integrity log schema without hiding failures."""
import json
from unittest.mock import MagicMock

import pytest
import _bootstrap  # noqa: F401

from data_pipeline.monitoring.check_data_invariants import write_log


@pytest.mark.parametrize("source,stored", [
    ("pass", "pass"), ("fail", "fail"), ("warn", "warning"),
    ("warning", "warning"), ("info", "warning"), ("unexpected", "fail"), (None, "fail"),
])
def test_status_mapping_retains_original_severity(source, stored):
    db = MagicMock()
    write_log(db, {"check_name": "example", "status": source, "detail": "evidence"}, ignored=True)
    table, rows = db.insert.call_args.args
    assert table == "integrity_check_results"
    assert rows[0]["status"] == stored
    assert json.loads(rows[0]["details"]) == {
        "source_status": source, "measured": None, "threshold": None,
        "detail": "evidence", "ignored": True,
    }
