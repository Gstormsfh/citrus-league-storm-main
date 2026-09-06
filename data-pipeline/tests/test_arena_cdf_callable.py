"""Regression for explicit CDF building; no fitted artifacts or real shot data."""
import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def features():
    # Isolate mutable CDF caches from all other test modules and imports.
    path = Path(__file__).resolve().parents[2] / 'scripts/utilities/feature_calculations.py'
    spec = importlib.util.spec_from_file_location('arena_cdf_regression_features', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def synthetic_frame():
    return pd.DataFrame({'shot_x': [70.0, 65.0, 60.0], 'shot_y': [0.0, 4.0, 8.0],
                         'team_code': ['AWAY', 'AWAY', 'HOME'],
                         'home_team_abbrev': ['HOME', 'HOME', 'HOME'],
                         'shot_type': ['wrist', 'wrist', 'wrist'],
                         'is_home_team': [0, 0, 1], 'angle': [0.0, 12.0, 18.0],
                         'is_rebound': [False, True, False],
                         'source_event_id': [8, 3, 19], 'has_pass_before_shot': [0, 1, 0]})


def test_explicit_build_calls_real_builder_and_retains_source_columns(features):
    frame = synthetic_frame()
    original = frame.copy(deep=True)
    output = features.apply_calculated_features_to_dataframe(frame, build_schuckers_cdfs=True)
    expected = np.sort(np.sqrt((89-frame.loc[:1, 'shot_x'])**2 + frame.loc[:1, 'shot_y']**2))
    np.testing.assert_array_equal(features._SCHUCKERS_LEAGUE_CDF, expected)
    np.testing.assert_array_equal(features._SCHUCKERS_CDFS['HOME_wrist'], expected)
    pd.testing.assert_frame_equal(frame, original)
    pd.testing.assert_frame_equal(output[original.columns], original)
    assert {'arena_adjusted_x', 'arena_adjusted_shot_distance',
            'shot_angle_plus_rebound_speed'} <= set(output.columns)
    assert '_raw_distance' not in output and '_rink_key' not in output
    assert callable(features.build_schuckers_cdfs)


@pytest.mark.parametrize('kwargs', [{}, {'build_schuckers_cdfs': False}])
def test_default_and_explicit_false_do_not_build_or_transform_arena(features, kwargs):
    frame = synthetic_frame()
    output = features.apply_calculated_features_to_dataframe(frame, **kwargs)
    assert features._SCHUCKERS_LEAGUE_CDF is None and features._SCHUCKERS_CDFS == {}
    np.testing.assert_array_equal(output['arena_adjusted_x'], frame['shot_x'])
    np.testing.assert_array_equal(output['arena_adjusted_y'], frame['shot_y'])
    pd.testing.assert_frame_equal(output[frame.columns], frame)


def test_explicit_build_retains_existing_missing_columns_behavior(features, capsys):
    frame = synthetic_frame().drop(columns=['is_home_team'])
    output = features.apply_calculated_features_to_dataframe(frame, build_schuckers_cdfs=True)
    assert features._SCHUCKERS_LEAGUE_CDF is None
    assert 'Missing columns' in capsys.readouterr().out
    pd.testing.assert_frame_equal(output[frame.columns], frame)
