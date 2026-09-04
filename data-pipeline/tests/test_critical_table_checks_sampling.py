#!/usr/bin/env python3
"""
test_critical_table_checks_sampling.py — the three checks in
critical_table_checks.py that had never once evaluated the invariant they were
written for.

Wired into Data Invariants (daily) on 2026-09-03. On their first real run,
2026-09-04, all three reported a problem and none of the three problems was
real:

  raw_shots_passer_id_is_player_id
      selected raw_shots.shot_id. The column is `id`. PostgREST 400 on every
      run, reported as FAIL/"query failed" -- it has never evaluated anything.

  player_game_stats_nhl_columns_populated
      sampled `updated_at.desc limit 2000` and expected some scoring. In this
      table `updated_at` is a bulk-backfill stamp: on production 2026-09-04 all
      2,000 rows at the top of that ordering shared the timestamp
      2026-08-21 03:52:34.780196. Inside a tie of that size PostgREST returns
      an arbitrary window. Two consecutive runs over unchanged data saw
      goals_total 18 and 5 against a threshold of 50, and paged both times.

  player_game_stats_no_orphan_game_ids
      demanded that every sampled game_id exist in nhl_games. nhl_games is the
      loaded SCHEDULE (2,738 rows, seasons 2025-2026, ids
      2025020001..2026021344). player_game_stats is the stat ARCHIVE (474,720
      rows back to 2017020001), 418,962 of which have no schedule row and are
      supposed not to. The check could not pass, and drawing its sample from
      the same tie above filled it with 2017 games: 200 of 200 "orphans".

The through-line is one mistake made twice: `updated_at.desc` is not "recent"
in a table that gets bulk-written. NHL game ids are SSSSTTNNNN, so `game_id`
sorts by season, then type, then game -- that IS recency here.

Each test below fails against the pre-fix code. That is the point of them: a
monitor nobody believes is worse than no monitor, and these three had been
crying wolf since the day they were switched on.
"""

import os
import sys
from copy import deepcopy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from monitoring.critical_table_checks import (
    STATUS_FAIL,
    STATUS_PASS,
    check_player_game_stats_nhl_columns_populated,
    check_player_game_stats_no_orphan_game_ids,
    check_raw_shots_passer_id_is_player_id,
)


class FakeDb:
    """A SupabaseRest stand-in that answers by table and REFUSES unknown columns.

    Refusing is the load-bearing half. A permissive fake would have let the
    shot_id typo through exactly the way the old test suite did -- which is to
    say, it would have had no opinion for nine months.
    """

    COLUMNS = {
        "raw_shots": {"id", "player_id", "passer_id", "goalie_id", "season",
                      "game_id", "event_owner_team_id", "created_at", "updated_at"},
        "player_game_stats": {"player_id", "game_id", "nhl_goals", "nhl_assists",
                              "nhl_shots_on_goal", "updated_at"},
        "nhl_games": {"game_id", "season", "game_type", "game_date", "updated_at"},
    }

    def __init__(self, tables):
        self.tables = tables
        self.calls = []

    def select(self, table, select="*", filters=None, order=None, limit=None, **kw):
        self.calls.append({"table": table, "select": select, "order": order,
                           "filters": filters, "limit": limit})

        known = self.COLUMNS[table]
        for col in select.split(","):
            col = col.strip()
            if col and col != "*" and col not in known:
                raise RuntimeError(
                    f'Supabase select failed ({table}): 400 '
                    f'{{"code":"42703","message":"column {table}.{col} does not exist"}}'
                )

        rows = list(self.tables.get(table, []))

        for column, op, value in (filters or []):
            if op == "in":
                wanted = set(value)
                rows = [r for r in rows if r.get(column) in wanted]
            elif op == "not.is" and value == "null":
                rows = [r for r in rows if r.get(column) is not None]

        if order:
            col, _, direction = order.partition(".")
            rows.sort(key=lambda r: r.get(col), reverse=(direction == "desc"))

        if limit is not None:
            rows = rows[:limit]
        return [{c.strip(): r.get(c.strip()) for c in select.split(",")} for r in rows]


# ── the shape of production, in miniature ────────────────────────────────────
# One backfill stamp shared by every archive row, the way production has it.
BACKFILL = "2026-08-21T03:52:34.780196+00:00"
LIVE = "2026-09-01T00:00:00+00:00"

# Bigger than the checks' own `limit=2000`, on purpose. That is where the
# production bite comes from: 474,720 rows and a 2,000-row window, so under a
# tied ordering the window never reaches the rows that matter. A fixture that
# fits inside the limit would let the broken ordering pass.
ARCHIVE = [  # 2017-2019: no schedule row, no scoring in the columns, bulk-stamped
    {"game_id": 2017020000 + i, "player_id": 8470000 + (i % 900),
     "nhl_goals": 0, "nhl_assists": 0, "nhl_shots_on_goal": 0,
     "updated_at": BACKFILL}
    for i in range(1, 2401)
]
RECENT = [  # 2025 playoffs: in the schedule, and people scored
    # Same `updated_at` as the archive, on purpose. That IS the production
    # condition: one backfill stamp across the whole table, so ordering by it
    # is a tie and tells you nothing about recency. Python's sort is stable, so
    # under `updated_at.desc` these rows stay behind the archive rows listed
    # first below -- which is exactly the arbitrary window PostgREST returned.
    # A fixture where LIVE > BACKFILL would let the broken ordering pass and
    # these tests would guard nothing.
    {"game_id": 2025030400 + i, "player_id": 8480000 + i,
     "nhl_goals": 1, "nhl_assists": 2, "nhl_shots_on_goal": 4,
     "updated_at": BACKFILL}
    for i in range(1, 61)
]
SCHEDULE = [{"game_id": r["game_id"], "season": 2025, "game_type": "playoff",
             "game_date": "2026-05-01", "updated_at": LIVE} for r in RECENT]


def db_like_production():
    # deepcopy, not the module-level lists: several tests below mutate rows to
    # build their negative case, and shared dicts would leak that mutation into
    # every test that ran after them (in alphabetical order, which is not an
    # order anyone reasons about). Found the hard way -- the all-zero-scoring
    # test silently zeroed the healthy fixture for its neighbours.
    return FakeDb({
        # Archive listed FIRST so an unordered read returns 2017 rows, which is
        # what the tie in updated_at amounts to on production.
        "player_game_stats": deepcopy(ARCHIVE + RECENT),
        "nhl_games": deepcopy(SCHEDULE),
        "raw_shots": [
            {"id": 1, "passer_id": 8471675, "season": 2025, "created_at": LIVE},
            {"id": 2, "passer_id": 8478402, "season": 2025, "created_at": LIVE},
        ],
    })


class TestPasserIdColumnExists:

    def test_the_check_actually_runs(self):
        """Pre-fix this returned FAIL with error='query failed: ... shot_id ...'."""
        result = check_raw_shots_passer_id_is_player_id(db_like_production())
        assert "error" not in result.details, result.details
        assert result.status == STATUS_PASS

    def test_it_never_asks_for_a_column_raw_shots_does_not_have(self):
        db = db_like_production()
        check_raw_shots_passer_id_is_player_id(db)
        asked = [c for c in db.calls if c["table"] == "raw_shots"]
        assert asked, "the check did not read raw_shots at all"
        assert "shot_id" not in asked[0]["select"]

    def test_a_team_id_in_passer_id_still_fails(self):
        """The invariant itself must survive the repair."""
        db = db_like_production()
        db.tables["raw_shots"].append(
            {"id": 3, "passer_id": 55, "season": 2025, "created_at": LIVE})
        result = check_raw_shots_passer_id_is_player_id(db)
        assert result.status == STATUS_FAIL
        assert result.details["sub_floor_count"] == 1


class TestScoringSampleIsActuallyRecent:

    def test_passes_on_a_healthy_table(self):
        """Pre-fix: sampled the bulk-stamped archive and paged with 0 goals."""
        result = check_player_game_stats_nhl_columns_populated(db_like_production())
        assert result.status == STATUS_PASS, result.details

    def test_samples_by_game_id_not_by_the_backfill_stamp(self):
        db = db_like_production()
        check_player_game_stats_nhl_columns_populated(db)
        read = [c for c in db.calls if c["table"] == "player_game_stats"][0]
        assert read["order"] == "game_id.desc", read["order"]

    def test_a_genuinely_empty_pipeline_still_fails(self):
        db = db_like_production()
        for row in db.tables["player_game_stats"]:
            row["nhl_goals"] = 0
            row["nhl_assists"] = 0
        result = check_player_game_stats_nhl_columns_populated(db)
        assert result.status == STATUS_FAIL


class TestOrphanScopeStopsAtTheScheduleFloor:

    def test_archive_below_the_schedule_floor_is_not_an_orphan(self):
        """Pre-fix: 200 of 200 'orphans', every one of them 2017 archive."""
        result = check_player_game_stats_no_orphan_game_ids(db_like_production())
        assert result.status == STATUS_PASS, result.details
        assert result.details["orphan_count"] == 0

    def test_a_real_hole_inside_the_schedule_window_still_fails(self):
        """The invariant that matters: a game the schedule COVERS is missing."""
        db = db_like_production()
        db.tables["nhl_games"] = [g for g in SCHEDULE if g["game_id"] != 2025030450]
        result = check_player_game_stats_no_orphan_game_ids(db)
        assert result.status == STATUS_FAIL, result.details
        assert 2025030450 in result.details["orphan_sample"]

    def test_it_reports_the_floor_it_used(self):
        result = check_player_game_stats_no_orphan_game_ids(db_like_production())
        assert result.details["schedule_floor"] == min(g["game_id"] for g in SCHEDULE)

    def test_samples_by_game_id_not_by_the_backfill_stamp(self):
        db = db_like_production()
        check_player_game_stats_no_orphan_game_ids(db)
        read = [c for c in db.calls if c["table"] == "player_game_stats"][0]
        assert read["order"] == "game_id.desc", read["order"]

    def test_an_empty_schedule_defers_to_season_boundary(self):
        db = db_like_production()
        db.tables["nhl_games"] = []
        result = check_player_game_stats_no_orphan_game_ids(db)
        assert result.status == STATUS_FAIL
        assert "season_boundary" in result.details["error"]
