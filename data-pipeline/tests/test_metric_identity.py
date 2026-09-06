from monitoring.metric_identity import reconcile


def rows():
    common = {"game_id": 2025020001, "event_id": 10, "season": 2025,
              "period": 1, "is_goal": False}
    return {**common, "shooter_id": 7}, {**common, "player_id": 7}


def test_same_key_does_not_hide_changed_shooter_or_goal():
    a, b = rows()
    b.update(player_id=8, is_goal=True)
    result = reconcile([a], [b])
    assert not result["accepted"]
    assert result["matched"] == []
    assert result["quarantine"][0]["fields"] == ["shooter", "outcome"]


def test_duplicates_and_unmatched_are_preserved_not_arbitrarily_selected():
    a, b = rows()
    result = reconcile([a], [b, b, {**b, "event_id": 11}])
    assert result["quarantine_counts"] == {"cardinality": 2}
    assert not result["matched"]


def test_replay_is_deterministic_and_corrections_change_fingerprint():
    a, b = rows()
    result = reconcile([a], [b])
    assert result["accepted"]
    assert result == reconcile([a], [b])
    changed = reconcile([a], [{**b, "player_id": 8}])
    assert result["source_sha256"]["raw"] != changed["source_sha256"]["raw"]


def test_empty_unknown_and_wrong_season_never_pass():
    a, b = rows()
    assert not reconcile([], [])["accepted"]
    for bad in ({**b, "season": 2024}, {**b, "player_id": None},
                {**b, "period_type": "SO"}, {**b, "event_id": None}):
        assert not reconcile([a], [bad])["accepted"]
