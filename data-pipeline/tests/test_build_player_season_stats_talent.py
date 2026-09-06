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
        2025,
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
        2025,
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
        ) is None
    update = build_talent_metrics_update(
        {"player_id": 1, "games_played": 2, "nhl_toi_seconds": 0}, 2025
    )
    assert update["avg_toi_per_game"] == 0
