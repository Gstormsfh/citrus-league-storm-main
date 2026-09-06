from monitoring.appearance_contract import reconcile_appearances, official_gp_from_landing


def test_equal_counts_with_wrong_event_fail():
    result = reconcile_appearances(
        [{"game_id": 2025020001, "nhl_toi_seconds": 600}],
        [{"gameId": 2025020002, "toi": "10:00"}], 1, 2025)
    assert result["reason"] == "event_set_mismatch"
    assert result["missing_games"] == [2025020002]


def test_positive_late_correction_and_missing_toi_fail():
    for toi in (None, 599):
        result = reconcile_appearances(
            [{"game_id": 2025020001, "nhl_toi_seconds": toi}],
            [{"gameId": 2025020001, "toi": "10:00"}], 1, 2025)
        assert result["reason"] == "toi_mismatch"


def test_verified_zero_counts_as_an_appearance():
    games = [{"game_id": 2025020001, "nhl_toi_seconds": 600},
             {"game_id": 2025020002, "nhl_toi_seconds": 0}]
    log = [{"gameId": 2025020001, "toi": "10:00"}, {"gameId": 2025020002, "toi": "00:00"}]
    assert reconcile_appearances(games, log, 2, 2025)["avg_toi_per_game"] == 5
    assert reconcile_appearances(games, log[:1], 2, 2025)["reason"] == "official_log_incomplete"


def test_historical_gp_requires_unambiguous_official_total():
    row = {"season": 20242025, "leagueAbbrev": "NHL", "gameTypeId": 2, "gamesPlayed": 70}
    assert official_gp_from_landing({"seasonTotals": [row]}, 2024) == 70
    assert official_gp_from_landing({"seasonTotals": [row, row]}, 2024) is None
    assert official_gp_from_landing({"seasonTotals": [row]}, 2025) is None
