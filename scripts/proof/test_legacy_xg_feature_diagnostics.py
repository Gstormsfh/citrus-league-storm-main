"""Executable witnesses of CURRENT legacy defects, not desired behavior tests.

Only selected inspected AST statements/functions execute; module startup,
network, database access and serialized model loading never run.
"""
import ast
from pathlib import Path
import pytest
from audit_legacy_xg_inputs import build, ROOT


def test_declared_training_and_emission_inventory():
    report = build()
    assert set(report['training_feature_lists']['v3']) - set(report['training_feature_lists']['v4']) == {'is_rush'}
    for record in report['shot_record_assignments']:
        names = [f['name'] for f in record['fields']]
        assert len(names) == len(set(names))
        assert {'pass_lateral_distance', 'pass_immediacy_score', 'goalie_movement_score', 'time_before_shot'} <= set(names)


@pytest.mark.parametrize('prior_y,current_y', [(-12, 12), (12, -12), (-12, -6), (12, 6)])
def test_legacy_royal_road_sign_loss_witness(prior_y, current_y):
    tree = ast.parse((ROOT / 'data-pipeline/acquisition/data_acquisition.py').read_text())
    candidates = [n for n in ast.walk(tree) if isinstance(n, ast.If)
                  and ast.unparse(n.test) == 'is_rebound and previous_play'
                  and 'shot_angle_rebound_royal_road = 1' in ast.unparse(n)]
    assert len(candidates) == 2
    for node in candidates:
        scope = {'is_rebound': True, 'previous_play': {'details': {'yCoord': prior_y}},
                 'shot_coord_y': current_y, 'shot_angle_rebound_royal_road': 0}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<selected-legacy-block>', 'exec'), scope)
        assert scope['shot_angle_rebound_royal_road'] == 0


def test_legacy_dataframe_helper_overwrites_angular_rate_witness():
    import pandas as pd
    tree = ast.parse((ROOT / 'scripts/utilities/feature_calculations.py').read_text())
    selected = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                and n.name in {'calculate_shot_angle_plus_rebound', 'apply_calculated_features_to_dataframe'}]
    assert len(selected) == 2
    scope = {}
    exec(compile(ast.Module(body=selected, type_ignores=[]), '<selected-legacy-functions>', 'exec'), scope)
    # No coordinates: isolate the actual angle helper path without rink fitting.
    frame = pd.DataFrame({'angle': [30., 30.], 'is_rebound': [1, 0],
                          'shot_angle_plus_rebound_speed': [8., 0.]})
    out = scope['apply_calculated_features_to_dataframe'](frame)
    assert out['shot_angle_plus_rebound_speed'].tolist() == [27., 30.]
