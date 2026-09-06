"""Exercise actual projection source readers with mixed-season/game fixtures."""
import pytest
from datetime import date
from projections import calculate_daily_projections as projections


class SourceDb:
    def __init__(self, tables):
        self.tables = tables
        self.reads = []

    def select(self, table, filters, **kwargs):
        self.reads.append(table)
        return [row for row in self.tables.get(table, [])
                if all(row.get(key) == value for key, op, value in filters)]


def test_goalie_reader_requires_requested_season():
    db = SourceDb({'goalie_gsax_primary': [
        {'goalie_id': 1, 'season': 2024, 'regressed_gsax': 50},
        {'goalie_id': 1, 'season': 2025, 'regressed_gsax': -2},
    ]})
    assert projections.get_goalie_gsax(db, 1, 2025) == -2


def test_missing_same_season_does_not_substitute_legacy_or_prior_season():
    db = SourceDb({'goalie_gsax_primary': [
        {'goalie_id': 1, 'season': 2024, 'regressed_gsax': 50}],
        'goalie_gsax': [{'goalie_id': 1, 'regressed_gsax': 99}]})
    assert projections.get_goalie_gsax(db, 1, 2025) is None
    assert db.reads == ['goalie_gsax_primary']


@pytest.mark.parametrize('value', [None, True, False, float('nan'), float('inf'), '-Infinity', 'invalid'])
def test_invalid_same_season_gsax_remains_unavailable(value):
    db = SourceDb({'goalie_gsax_primary': [
        {'goalie_id': 1, 'season': 2025, 'regressed_gsax': value}]})
    assert projections.get_goalie_gsax(db, 1, 2025) is None


def test_missing_metric_field_is_not_a_verified_zero():
    db = SourceDb({'goalie_gsax_primary': [{'goalie_id': 1, 'season': 2025}]})
    assert projections.get_goalie_gsax(db, 1, 2025) is None


def test_finishing_denominator_matches_regular_season_goal_numerator():
    projections._finishing_talent_cache.clear()
    db = SourceDb({'player_season_stats': [
        {'player_id': 1, 'season': 2025, 'nhl_goals': 5}],
        'nhl_shots': [
            *[{'shooter_id': 1, 'season': 2025, 'game_type': 'regular', 'xg_sql': .1} for _ in range(50)],
            {'shooter_id': 1, 'season': 2025, 'game_type': 'playoff', 'xg_sql': 20},
            {'shooter_id': 1, 'season': 2024, 'game_type': 'regular', 'xg_sql': 20},
        ]})
    assert projections.calculate_finishing_talent(db, 1, 2025) == pytest.approx(1)
    projections._finishing_talent_cache.clear()


def test_physical_goalie_projection_passes_requested_season(monkeypatch):
    seasons = []
    def gsax(db, player_id, season, debug=False):
        seasons.append(season)
        return 0
    monkeypatch.setattr(projections, 'get_goalie_gsax', gsax)
    monkeypatch.setattr(projections, 'get_opponent_shots_for_per_60', lambda *args, **kwargs: 30)
    projections.calculate_goalie_physical_projection(SourceDb({}), 1, 2025020001,
        date(2025, 10, 1), 2025, 'TST', 'TST', 5)
    assert seasons == [2025]
