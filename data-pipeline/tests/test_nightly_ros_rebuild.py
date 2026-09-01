"""The nightly batch rebuilds player_ros_projections through the SQL RPC.

Until 2026-09-01 nightly_projection_batch.py summed its own per-TEAM-game
projection rows into rest-of-season rows and upserted them. Each per-game
goalie row is an "if he starts" projection, so a goalie was written with
games_remaining = every team game (~82) and W/SV/SO summed over all of them:
a 55-start goalie became an ~82-start goalie, about 1.5x inflated, and
projected_ga_ros was never written at all.

The 08:50 UTC pg_cron job runs rebuild_ros_projections(p_season) — a full
DELETE + INSERT, start-aware through project_ros.exp_starts and GA-aware —
and overwrote those rows every day. So the table was wrong from the batch's
07:00 UTC run until 08:50 UTC, and every draft / autopick / free-agent view
in that window ranked goalies against inflated totals.

These tests run main() end to end against a fake SupabaseRest, with the
per-game worker stubbed, and pin:

  * the batch calls the RPC with the season it is projecting;
  * it never writes player_ros_projections itself — no row can carry
    games_remaining equal to the team-game count;
  * the per-game player_projected_stats write path is untouched;
  * an RPC failure is logged at error level and exits non-zero.
"""

import logging
import os
import signal
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# nightly_projection_batch (and calculate_daily_projections underneath it)
# raise at IMPORT time without Supabase credentials. Placeholders get us
# through the import and are then removed, exactly as
# test_goalie_start_probability.py does: leaving them set lets modules that
# fail fast on missing credentials proceed and sit in request retries.
_ENV_KEYS = ("VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
_saved_env = {k: os.environ.get(k) for k in _ENV_KEYS}
os.environ.setdefault("VITE_SUPABASE_URL", "https://tests.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-real-key")

# The module installs SIGINT/SIGTERM handlers when imported on the main
# thread. Put pytest's own handlers back afterwards so Ctrl-C keeps working.
_SIGNALS = (signal.SIGINT, signal.SIGTERM)
_saved_handlers = {s: signal.getsignal(s) for s in _SIGNALS}

from data_pipeline.projections import nightly_projection_batch as npb  # noqa: E402

for _s, _h in _saved_handlers.items():
    if _h is not None:
        signal.signal(_s, _h)
for _k, _v in _saved_env.items():
    if _v is None:
        os.environ.pop(_k, None)
    else:
        os.environ[_k] = _v


SEASON = 2025
GOALIE_ID = 8_476_945
SKATER_ID = 8_478_402
TEAM = "TOR"
OPPONENT = "BOS"

# Three remaining team games. The old code wrote the goalie with
# games_remaining == 3 == len(SCHEDULE), the defect under test.
SCHEDULE = [
    {"game_id": 2025020101 + i, "game_date": f"2099-01-0{i + 1}",
     "home_team": TEAM, "away_team": OPPONENT, "season": SEASON}
    for i in range(3)
]

PLAYERS = [
    {"player_id": GOALIE_ID, "full_name": "Test Goalie", "team_abbrev": TEAM,
     "position_code": "G", "season": SEASON},
    {"player_id": SKATER_ID, "full_name": "Test Skater", "team_abbrev": TEAM,
     "position_code": "C", "season": SEASON},
]

RPC_OK = [{"rows_written": 2, "skaters": 1, "goalies": 1, "target_games": 82}]


class FakeDb:
    """Stands in for SupabaseRest: canned reads, recorded writes and RPCs."""

    def __init__(self, tables, rpc_result=None, rpc_error=None):
        self.tables = tables
        self.rpc_result = rpc_result
        self.rpc_error = rpc_error
        self.upserts = []    # (table, rows, on_conflict)
        self.rpc_calls = []  # (fn, payload)

    def select(self, table, select="*", filters=None, order=None, limit=None, offset=None):
        rows = self.tables.get(table, [])
        off = int(offset or 0)
        return rows[off:off + (int(limit) if limit else len(rows))]

    def upsert(self, table, rows, on_conflict):
        body = rows if isinstance(rows, list) else [rows]
        self.upserts.append((table, body, on_conflict))

    def rpc(self, fn, payload):
        self.rpc_calls.append((fn, payload))
        if self.rpc_error is not None:
            raise self.rpc_error
        return self.rpc_result

    def rows_upserted_to(self, table):
        return [row for t, rows, _ in self.upserts if t == table for row in rows]


def fake_projection_worker(task):
    """Per-game rows as calculate_projection_worker would return them.

    The goalie rows are "if he starts" values: summing them over every team
    game is exactly the mistake the batch used to make.
    """
    player_id, game_id, game_date, season, _scoring, game_info = task
    if player_id == GOALIE_ID:
        return {
            "player_id": player_id, "game_id": game_id, "projection_date": game_date,
            "season": season, "is_goalie": True, "total_projected_points": 4.7,
            "projected_wins": 0.55, "projected_saves": 26.0, "projected_shutouts": 0.06,
            "projected_goals_against": 2.6, "projected_gp": 1,
            "opponent_abbrev": game_info["opponent_abbrev"],
        }
    return {
        "player_id": player_id, "game_id": game_id, "projection_date": game_date,
        "season": season, "is_goalie": False, "total_projected_points": 1.9,
        "projected_goals": 0.35, "projected_assists": 0.45, "projected_sog": 2.8,
        "opponent_abbrev": game_info["opponent_abbrev"],
    }


def _run_batch(monkeypatch, db, *extra_args):
    monkeypatch.setattr(npb, "get_db", lambda: db)
    monkeypatch.setattr(npb, "calculate_projection_worker", fake_projection_worker)
    monkeypatch.setattr(npb, "_shutdown_requested", False)
    monkeypatch.setattr(sys, "argv", [
        "nightly_projection_batch.py", "--season", str(SEASON), "--workers", "1",
        *extra_args,
    ])
    npb.main()


def _tables():
    # Every other table the batch reads (team_stats, nhl_teams, leagues,
    # player_injuries, player_projected_stats...) answers empty, which routes
    # each loader to its documented fallback without touching the network.
    return {"nhl_games": list(SCHEDULE), "player_directory": list(PLAYERS)}


class TestRosRebuildGoesThroughTheRpc:

    def test_batch_calls_rebuild_rpc_with_the_projected_season(self, monkeypatch):
        db = FakeDb(_tables(), rpc_result=RPC_OK)

        _run_batch(monkeypatch, db)

        assert db.rpc_calls == [("rebuild_ros_projections", {"p_season": SEASON})]

    def test_batch_never_writes_ros_rows_itself(self, monkeypatch):
        db = FakeDb(_tables(), rpc_result=RPC_OK)

        _run_batch(monkeypatch, db)

        assert db.rows_upserted_to("player_ros_projections") == []

        # The defect, stated directly: no write anywhere carries a goalie row
        # whose games_remaining is the TEAM's remaining game count.
        team_games = len(SCHEDULE)
        inflated = [
            row for _table, rows, _ in db.upserts for row in rows
            if row.get("player_id") == GOALIE_ID
            and row.get("games_remaining") == team_games
        ]
        assert inflated == []

    def test_per_game_projection_writes_are_untouched(self, monkeypatch):
        db = FakeDb(_tables(), rpc_result=RPC_OK)

        _run_batch(monkeypatch, db)

        per_game = db.rows_upserted_to("player_projected_stats")
        assert len(per_game) == len(SCHEDULE) * len(PLAYERS)
        goalie_rows = [r for r in per_game if r["player_id"] == GOALIE_ID]
        assert len(goalie_rows) == len(SCHEDULE)
        assert all(r["is_goalie"] for r in goalie_rows)

        # Matchup difficulty (Phase 6) still runs after the rebuild.
        assert db.rows_upserted_to("team_matchup_difficulty")

    def test_dry_run_never_rebuilds_the_live_table(self, monkeypatch):
        # The RPC is DELETE + INSERT on the live table; a dry run must not
        # reach it (the batch returns before every write phase).
        db = FakeDb(_tables(), rpc_result=RPC_OK)

        _run_batch(monkeypatch, db, "--dry-run")

        assert db.rpc_calls == []
        assert db.upserts == []

    def test_rpc_failure_is_logged_at_error_and_exits_non_zero(self, monkeypatch, caplog):
        db = FakeDb(
            _tables(),
            rpc_error=RuntimeError(
                "Supabase rpc failed (rebuild_ros_projections): 500 canceling statement"
            ),
        )
        caplog.set_level(logging.INFO)

        with pytest.raises(SystemExit) as exc_info:
            _run_batch(monkeypatch, db)

        assert exc_info.value.code == 1
        errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
        assert errors, "an RPC failure must be logged at error level"
        assert any("ROS rebuild failed" in r.getMessage() for r in errors)
        assert any("canceling statement" in r.getMessage() for r in errors)
        # Nothing was written to the ROS table on the way down.
        assert db.rows_upserted_to("player_ros_projections") == []


class TestRebuildRosProjectionsHelper:

    def test_returns_the_rpc_counts_as_ints(self):
        db = FakeDb({}, rpc_result=[
            {"rows_written": 1051, "skaters": 946, "goalies": 105, "target_games": 82},
        ])

        counts = npb.rebuild_ros_projections(db, SEASON)

        assert counts == {
            "rows_written": 1051, "skaters": 946, "goalies": 105, "target_games": 82,
        }
        assert db.rpc_calls == [("rebuild_ros_projections", {"p_season": SEASON})]

    @pytest.mark.parametrize("payload", [None, [], {}, "ok", [{"skaters": 1}]])
    def test_unexpected_payload_raises(self, payload):
        db = FakeDb({}, rpc_result=payload)

        with pytest.raises(RuntimeError, match="unexpected payload"):
            npb.rebuild_ros_projections(db, SEASON)

    def test_zero_rows_written_raises(self):
        # The RPC is DELETE + INSERT: a zero-row "success" is an empty pool.
        db = FakeDb({}, rpc_result=[
            {"rows_written": 0, "skaters": 0, "goalies": 0, "target_games": 82},
        ])

        with pytest.raises(RuntimeError, match="0 rows"):
            npb.rebuild_ros_projections(db, SEASON)

    def test_rpc_errors_propagate(self):
        db = FakeDb({}, rpc_error=RuntimeError("Supabase rpc failed: 404 not found"))

        with pytest.raises(RuntimeError, match="404"):
            npb.rebuild_ros_projections(db, SEASON)
