#!/usr/bin/env python3
"""
test_player_directory_refresh_row.py — 23502 regression.

WHAT BROKE. On 2026-08-26 the "Refresh Player Directory" workflow — freshly
un-broken from eleven days of PGRST102 — failed on its first real write with:

    Supabase upsert failed (player_directory): 400
    {"code":"23502", "message":"null value in column \\"full_name\\" of relation
    \\"player_directory\\" violates not-null constraint",
     "details":"Failing row contains (2025, 8484153, null, ANA, C, f, 91, ...)"}
    [group of 45 rows, keys=['jersey_number','player_id','position_code',
     'season','team_abbrev','updated_at']]

WHY IT LOOKED IMPOSSIBLE. Those 45 rows are the roster fast lane: players
ALREADY in the directory, refreshed with only the cheap fields the roster
payload carries (team, position, jersey) so an October trade doesn't leave the
display stuck on the prior team. Every one of those rows targets an existing
row whose full_name is already populated, and the upsert runs with
resolution=merge-duplicates — ON CONFLICT DO UPDATE over the columns present —
which would never have touched full_name at all.

It fails anyway because Postgres validates NOT NULL against the PROPOSED tuple
during the insert attempt, BEFORE the ON CONFLICT arbiter fires. A column the
merge will never write still has to be legal on the way in. So the fast lane
could never have worked, on any row, ever.

THE FIX. The /roster/{team}/current payload already carries firstName and
lastName — sync_rosters.py has been reading them from that same endpoint all
along — so the name costs zero extra API calls. build_roster_refresh_row()
derives it, and returns None for a payload that cannot produce a legal row
rather than handing PostgREST a body that will 400 and take 44 healthy rows
down with it.

These tests pin: full_name is always present, optional keys are absent rather
than None (a padded None is a NULL overwrite under merge-duplicates, not a
no-op), and _flush_batch drops an illegal row instead of shipping it.
"""
import os
import sys
import importlib.util

# The module reads these at import time and raises without them. Real values
# are never used: nothing here touches the network or the database.
os.environ.setdefault("VITE_SUPABASE_URL", "https://tests.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_PIPELINE_DIR = os.path.dirname(_TESTS_DIR)
_REPO_ROOT = os.path.dirname(_PIPELINE_DIR)

sys.path.insert(0, _PIPELINE_DIR)
import _bootstrap  # noqa: F401,E402

_MODULE_PATH = os.path.join(_REPO_ROOT, "scripts", "utilities", "populate_player_directory.py")
_spec = importlib.util.spec_from_file_location("populate_player_directory_under_test", _MODULE_PATH)
ppd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ppd)

build = ppd.build_roster_refresh_row
REQUIRED = ppd.DIRECTORY_REQUIRED_FIELDS


# The literal shape of one entry in the 45-row ANA group that produced the
# 23502, reconstructed from the failing-row detail in the error body.
ANA_ENTRY = {
    "id": 8484153,
    "firstName": {"default": "Beckett"},
    "lastName": {"default": "Sennecke"},
    "positionCode": "C",
    "sweaterNumber": 91,
    "headshot": "https://assets.nhle.com/mugs/nhl/20252026/ANA/8484153.png",
}


class _FakeDb:
    """Captures upsert bodies instead of issuing them."""

    def __init__(self):
        self.calls = []

    def upsert(self, table, rows, on_conflict=None):
        self.calls.append({"table": table, "rows": rows, "on_conflict": on_conflict})


# ───────────────────────────── build_roster_refresh_row ──────────────────────

def test_refresh_row_carries_full_name():
    # The whole bug in one assertion.
    row = build(ANA_ENTRY, 2025, "ANA")
    assert row is not None
    assert row["full_name"] == "Beckett Sennecke"


def test_refresh_row_satisfies_every_not_null_column():
    row = build(ANA_ENTRY, 2025, "ANA")
    for field in REQUIRED:
        assert field in row, f"{field} missing — Postgres rejects the insert attempt"
        assert row[field] not in (None, ""), f"{field} is empty — same 23502"


def test_refresh_row_keeps_the_cheap_roster_fields():
    row = build(ANA_ENTRY, 2025, "ANA")
    assert row["season"] == 2025
    assert row["player_id"] == 8484153
    assert row["team_abbrev"] == "ANA"
    assert row["position_code"] == "C"
    assert row["jersey_number"] == "91"
    assert row["updated_at"]


def test_wing_codes_are_normalized():
    left = build({**ANA_ENTRY, "positionCode": "L"}, 2025, "ANA")
    right = build({**ANA_ENTRY, "positionCode": "R"}, 2025, "ANA")
    assert left["position_code"] == "LW"
    assert right["position_code"] == "RW"


def test_is_goalie_tracks_position():
    goalie = build({**ANA_ENTRY, "positionCode": "G"}, 2025, "ANA")
    skater = build({**ANA_ENTRY, "positionCode": "D"}, 2025, "ANA")
    assert goalie["is_goalie"] is True
    assert skater["is_goalie"] is False


def test_is_goalie_is_absent_when_position_is_unknown():
    # Asserting is_goalie=False with no position would demote a real goalie
    # on the next merge. Absent means "leave the stored value alone".
    row = build({k: v for k, v in ANA_ENTRY.items() if k != "positionCode"}, 2025, "ANA")
    assert "position_code" not in row
    assert "is_goalie" not in row


def test_optional_keys_are_absent_not_none():
    # Under resolution=merge-duplicates a None is an instruction to write NULL,
    # not an instruction to skip. Absence is the only safe encoding.
    sparse = {"id": 8484153, "firstName": {"default": "Beckett"}, "lastName": {"default": "Sennecke"}}
    row = build(sparse, 2025, "ANA")
    for key in ("position_code", "is_goalie", "jersey_number", "headshot_url"):
        assert key not in row
    assert None not in row.values()


def test_headshot_is_refreshed_when_present_and_never_nulled():
    with_shot = build(ANA_ENTRY, 2025, "ANA")
    assert with_shot["headshot_url"].endswith("8484153.png")
    without = build({**ANA_ENTRY, "headshot": None}, 2025, "ANA")
    assert "headshot_url" not in without


def test_nameless_entry_is_dropped_rather_than_sent():
    # One illegal row 400s the entire bulk body — 44 healthy rows go down with
    # it. A dropped row costs one stale jersey number.
    assert build({"id": 8484153, "positionCode": "C"}, 2025, "ANA") is None
    assert build({**ANA_ENTRY, "firstName": {"default": ""}, "lastName": {"default": "  "}}, 2025, "ANA") is None


def test_entry_without_id_is_dropped():
    assert build({k: v for k, v in ANA_ENTRY.items() if k != "id"}, 2025, "ANA") is None


def test_bare_string_names_are_accepted():
    # The landing endpoint always localizes; be tolerant if the roster feed
    # ever hands back a plain string.
    row = build({**ANA_ENTRY, "firstName": "Beckett", "lastName": "Sennecke"}, 2025, "ANA")
    assert row["full_name"] == "Beckett Sennecke"


def test_partial_name_still_produces_a_legal_row():
    row = build({**ANA_ENTRY, "firstName": {"default": ""}}, 2025, "ANA")
    assert row["full_name"] == "Sennecke"


def test_playerid_alias_is_honoured():
    row = build({**{k: v for k, v in ANA_ENTRY.items() if k != "id"}, "playerId": 8484153}, 2025, "ANA")
    assert row["player_id"] == 8484153


def test_timestamp_is_injectable_for_determinism():
    row = build(ANA_ENTRY, 2025, "ANA", now="2026-08-26T02:01:34+00:00")
    assert row["updated_at"] == "2026-08-26T02:01:34+00:00"


# ────────────────────────────────── _flush_batch ─────────────────────────────

def test_flush_sends_well_formed_rows():
    db = _FakeDb()
    batch = {8484153: build(ANA_ENTRY, 2025, "ANA")}
    assert ppd._flush_batch(db, batch, "test") == 1
    assert len(db.calls) == 1
    assert db.calls[0]["table"] == "player_directory"
    assert db.calls[0]["on_conflict"] == "season,player_id"
    assert batch == {}


def test_flush_drops_an_illegal_row_and_still_sends_the_rest():
    # The load-bearing one: a single nameless row must not cost the batch.
    db = _FakeDb()
    good = build(ANA_ENTRY, 2025, "ANA")
    bad = {"season": 2025, "player_id": 8480000, "team_abbrev": "ANA", "updated_at": "x"}
    batch = {8484153: good, 8480000: bad}

    assert ppd._flush_batch(db, batch, "test") == 1
    sent = db.calls[0]["rows"]
    assert [r["player_id"] for r in sent] == [8484153]


def test_flush_makes_no_request_when_every_row_is_illegal():
    db = _FakeDb()
    batch = {1: {"season": 2025, "player_id": 1, "full_name": ""}}
    assert ppd._flush_batch(db, batch, "test") == 0
    assert db.calls == []
    assert batch == {}, "batch must still drain, or the bad rows are re-checked forever"


def test_flush_on_empty_batch_is_a_noop():
    db = _FakeDb()
    assert ppd._flush_batch(db, {}, "test") == 0
    assert db.calls == []


# ───────────────── the two fixes together, on the production shape ───────────

def test_a_realistic_team_batch_is_accepted_by_both_guards():
    """The full ANA-group path: build rows from a roster payload, split them
    into uniform key sets, and assert every resulting request body would
    survive BOTH failure modes this pipeline has hit — PGRST102 (mixed keys)
    and 23502 (missing NOT NULL)."""
    from data_pipeline.utils.supabase_rest import SupabaseRest

    # A plausible 45-man roster: most complete, some missing the fields the
    # NHL API intermittently omits. This heterogeneity is what produced both
    # bugs.
    roster = []
    for i in range(45):
        entry = {
            "id": 8480000 + i,
            "firstName": {"default": f"First{i}"},
            "lastName": {"default": f"Last{i}"},
            "positionCode": ["C", "L", "R", "D", "G"][i % 5],
            "sweaterNumber": i + 1,
            "headshot": f"https://assets.nhle.com/mugs/nhl/20252026/ANA/{8480000 + i}.png",
        }
        if i % 7 == 0:
            del entry["sweaterNumber"]      # rookie with no number yet
        if i % 11 == 0:
            del entry["headshot"]           # portrait not shot yet
        if i % 13 == 0:
            del entry["positionCode"]       # position missing
        roster.append(entry)
    roster.append({"id": 8489999, "positionCode": "C", "sweaterNumber": 99})  # nameless

    rows = [r for r in (build(e, 2025, "ANA") for e in roster) if r is not None]
    assert len(rows) == 45, "only the nameless entry should have been dropped"

    groups = SupabaseRest._uniform_key_groups(rows)

    # PGRST102: every object inside one request body carries identical keys.
    for g in groups:
        signature = set(g[0].keys())
        for row in g:
            assert set(row.keys()) == signature

    # 23502: every row in every body satisfies the NOT NULL columns.
    for g in groups:
        for row in g:
            for field in REQUIRED:
                assert row.get(field) not in (None, "")

    # merge-duplicates: no key anywhere carries None, which would write NULL
    # over a stored value rather than leaving it alone.
    assert all(v is not None for g in groups for row in g for v in row.values())

    # Nothing lost in the split.
    assert sum(len(g) for g in groups) == 45
