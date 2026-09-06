from projections.build_player_season_stats import (
    build_talent_metrics_update,
    upsert_talent_metrics,
)


def test_avg_toi_uses_all_official_appearances_including_zero_minute_game():
    update = build_talent_metrics_update(
        {
            "player_id": 8478402,
            "games_played": 2,
            "nhl_toi_seconds": 600,
            "x_goals": 0.5,
            "is_goalie": False,
        },
        2025, official_gp=2,
    )

    assert update == {
        "player_id": 8478402,
        "season": 2025,
        "avg_toi_per_game": 5.0,
        "xg_per_60": 3.0,
        "xg_rating": "Elite",
    }


def test_missing_advanced_values_are_not_fabricated_and_goalies_are_excluded():
    no_xg = build_talent_metrics_update(
        {
            "player_id": 1,
            "games_played": 4,
            "nhl_toi_seconds": 2400,
            "x_goals": None,
            "is_goalie": False,
        },
        2025, official_gp=4,
    )
    assert no_xg == {
        "player_id": 1,
        "season": 2025,
        "avg_toi_per_game": 10.0,
    }
    assert build_talent_metrics_update(
        {"player_id": 2, "games_played": 0, "nhl_toi_seconds": 0}, 2025
    ) is None
    assert build_talent_metrics_update(
        {"player_id": 3, "games_played": 5, "nhl_toi_seconds": 9000, "is_goalie": True},
        2025,
    ) is None


def test_talent_writer_preserves_unrelated_columns_by_using_narrow_payloads():
    class FakeDb:
        calls = []

        def upsert(self, table, rows, on_conflict):
            self.calls.append((table, rows, on_conflict))

    db = FakeDb()
    updates = [{"player_id": 1, "season": 2025, "avg_toi_per_game": 12.34}]
    upsert_talent_metrics(db, updates)

    assert db.calls == [("player_talent_metrics", updates, "player_id,season")]
    assert set(db.calls[0][1][0]) == {"player_id", "season", "avg_toi_per_game"}


def test_unknown_or_invalid_toi_is_unavailable_but_measured_zero_is_valid():
    for toi in (None, -1):
        assert build_talent_metrics_update(
            {"player_id": 1, "games_played": 2, "nhl_toi_seconds": toi}, 2025
        )["avg_toi_per_game"] is None
    update = build_talent_metrics_update(
        {"player_id": 1, "games_played": 2, "nhl_toi_seconds": 0}, 2025, official_gp=2
    )
    assert update["avg_toi_per_game"] == 0


def test_main_reconciles_inputs_before_writing(monkeypatch, caplog):
    import sys
    import types
    import logging
    from projections import build_player_season_stats as rollup

    def row(pid, game, toi):
        return {"player_id": pid, "game_id": game, "nhl_toi_seconds": toi}

    rows = [
        row(1, 2025020001, 600), row(1, 2025020002, 0),
        row(1, 2025030001, 9000), row(1, 2025010001, 9000),
        row(2, 2025020001, 600), row(2, 2025020002, None),
        row(3, 2025020001, 600),  # official GP says two; missing appearance
        row(4, 2025020001, 600),  # official endpoint unavailable
        row(5, 2025020001, 0),  # historical default zero without source evidence
    ]
    calls = []
    filters = []

    class Db:
        def select(self, table, **kwargs):
            filters.append(kwargs["filters"])
            return rows  # deliberately ignores filters: local boundary also guards

        def upsert(self, table, values, **kwargs):
            calls.append((table, values))

    monkeypatch.setattr(rollup, "supabase_client", Db)
    monkeypatch.setattr(rollup, "DEFAULT_SEASON", 2025)
    monkeypatch.setattr(rollup, "try_fetch_xg_totals", lambda *args: {})
    monkeypatch.setattr(rollup, "fetch_official_gp", lambda pid, season: {1: 2, 2: 2, 3: 2, 4: None, 5: 1}[pid])
    monkeypatch.setattr(rollup, "fetch_verified_zero_games", lambda pid, season: {2025020002} if pid == 1 else set())
    monkeypatch.setitem(sys.modules, "compute_player_season_plus_minus",
                        types.SimpleNamespace(compute_plus_minus=lambda *args: {}))
    with caplog.at_level(logging.INFO):
        assert rollup.main() == 0
    talent = {r["player_id"]: r for t, values in calls if t == "player_talent_metrics" for r in values}
    assert talent[1]["avg_toi_per_game"] == 5
    assert all(talent[pid]["avg_toi_per_game"] is None for pid in (2, 3, 4, 5))
    assert all(set(r) == {"player_id", "season", "avg_toi_per_game"} for r in talent.values())
    seasons = {r["player_id"]: r for t, values in calls if t == "player_season_stats" for r in values}
    assert seasons[1]["games_played"] == 2
    assert seasons[1]["nhl_toi_seconds"] == 600
    assert "nhl_toi_seconds" not in seasons[2]
    assert ("game_id", "gte", 2025020000) in filters[0]
    assert ("game_id", "lt", 2025030000) in filters[0]
    assert "avg_toi=1 withheld=4" in caplog.text


def test_duplicate_appearances_are_rejected():
    import pytest
    from projections.build_player_season_stats import regular_appearance_rows
    row = {"player_id": 1, "game_id": 2025020001}
    with pytest.raises(ValueError, match="Duplicate official appearance"):
        regular_appearance_rows([row, row], 2025)


def test_official_gp_requires_exact_season_and_regular_subseason(monkeypatch):
    import sys
    import types
    from projections.build_player_season_stats import fetch_official_gp
    data = {"featuredStats": {"season": 20252026, "regularSeason": {"subSeason": {"gamesPlayed": 2}},
                              "playoffs": {"subSeason": {"gamesPlayed": 20}}}}
    response = types.SimpleNamespace(raise_for_status=lambda: None, json=lambda: data)
    monkeypatch.setitem(sys.modules, "data_pipeline.utils.citrus_request",
                        types.SimpleNamespace(citrus_request=lambda *args, **kwargs: response))
    assert fetch_official_gp(1, 2025) == 2
    assert fetch_official_gp(1, 2024) is None
    del data["featuredStats"]["season"]
    assert fetch_official_gp(1, 2025) is None


def test_zero_confirmation_requires_explicit_game_log_measurement(monkeypatch):
    import sys
    import types
    from projections.build_player_season_stats import fetch_verified_zero_games
    urls = []
    def request(url, **kwargs):
        urls.append(url)
        return types.SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"gameLog": [
            {"gameId": 2025020001, "toi": "00:00"},
            {"gameId": 2025020002, "toi": "0:00"},
            {"gameId": 2025020003},
            {"gameId": 2025020004, "toi": "12:00"},
        ]})
    monkeypatch.setitem(sys.modules, "data_pipeline.utils.citrus_request",
                        types.SimpleNamespace(citrus_request=request))
    assert fetch_verified_zero_games(1, 2025) == {2025020001, 2025020002}
    assert urls == ["https://api-web.nhle.com/v1/player/1/game-log/20252026/2"]
