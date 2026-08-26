#!/usr/bin/env python3
"""
test_supabase_rest_key_groups.py — PGRST102 regression.

WHAT BROKE. The daily "Refresh Player Directory" workflow failed every single
morning from 2026-08-14 to 2026-08-25 with:

    Supabase upsert failed (player_directory): 400
    {"code":"PGRST102", "message":"All object keys must match"}

PostgREST requires every object in a bulk body to carry exactly the same keys.
The directory rows are built from the NHL API, which omits fields it has
nothing for — one player carries `college_team`, the next does not — so the
batch was heterogeneous and the whole request was rejected. Eleven days of
callups and roster moves never landed, and it emailed a failure every day.

WHY GROUPING AND NOT PADDING. The obvious fix is to fill the missing keys with
None so every object matches. That would be worse than the bug. This client
upserts with `resolution=merge-duplicates`, which compiles to ON CONFLICT DO
UPDATE over the columns present in the body — so a padded None is not "leave
this alone", it is "overwrite the stored value with NULL". Padding converts a
loud 400 into silent data loss on every field the NHL API happened to omit.

So the batch is split into groups that each share a key set, one request per
group. These tests pin both halves: that the split happens, and that nothing
is ever padded.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa: E402

group = SupabaseRest._uniform_key_groups


def _signatures(groups):
    return {frozenset(g[0].keys()) for g in groups}


def test_uniform_batch_is_left_as_one_group():
    rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}, {"a": 5, "b": 6}]
    groups = group(rows)
    assert len(groups) == 1
    assert groups[0] == rows


def test_mixed_keys_are_split_by_signature():
    # The production shape: some players carry college_team, some do not.
    rows = [
        {"player_id": 1, "season": 2026, "college_team": "BU"},
        {"player_id": 2, "season": 2026},
        {"player_id": 3, "season": 2026, "college_team": "Denver"},
    ]
    groups = group(rows)

    assert len(groups) == 2
    assert _signatures(groups) == {
        frozenset({"player_id", "season", "college_team"}),
        frozenset({"player_id", "season"}),
    }


def test_every_row_survives_the_split_exactly_once():
    rows = [
        {"player_id": 1, "a": 1},
        {"player_id": 2, "b": 2},
        {"player_id": 3, "a": 3},
        {"player_id": 4},
    ]
    groups = group(rows)

    flat = [r for g in groups for r in g]
    assert len(flat) == len(rows)
    assert sorted(r["player_id"] for r in flat) == [1, 2, 3, 4]


def test_rows_are_never_padded_with_none():
    # The load-bearing assertion. A padded None would overwrite stored data
    # with NULL under resolution=merge-duplicates.
    rows = [
        {"player_id": 1, "season": 2026, "bio_summary": "written earlier"},
        {"player_id": 2, "season": 2026},
    ]
    groups = group(rows)

    for g in groups:
        for row in g:
            assert "bio_summary" not in row or row["bio_summary"] is not None
    # The row that never mentioned bio_summary must still not mention it.
    short = [r for g in groups for r in g if r["player_id"] == 2][0]
    assert "bio_summary" not in short


def test_rows_are_not_copied_when_already_uniform():
    # Identity, not equality: a uniform batch should pass straight through
    # rather than being rebuilt.
    rows = [{"a": 1}, {"a": 2}]
    groups = group(rows)
    assert groups[0][0] is rows[0]


def test_single_row_and_empty_batch():
    assert group([]) == []
    one = [{"a": 1}]
    assert group(one) == [one]
