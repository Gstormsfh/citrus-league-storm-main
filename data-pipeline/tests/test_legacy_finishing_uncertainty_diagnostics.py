"""Source-isolated reproductions, NOT acceptance tests for legacy uncertainty.

Do not import the projection engine, query services or load fitted artifacts.
The deterministic draws expose algebra, not Monte Carlo quality or live impact.
"""
import ast
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict

import numpy as np
import pandas as pd
import pytest

SOURCE = Path(__file__).resolve().parents[1] / 'projections/projection_uncertainty.py'


def legacy_method():
    tree = ast.parse(SOURCE.read_text())
    methods = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)
               and n.name == '_apply_finishing_uncertainty']
    constants = [n for n in tree.body if isinstance(n, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id in
                         ('FINISHING_PRIOR_ALPHA', 'FINISHING_PRIOR_BETA') for t in n.targets)]
    assert len(methods) == 1 and len(constants) == 2
    scope = {'np': np, 'Dict': Dict, 'Any': Any}
    exec(compile(ast.Module(body=[*constants, *methods], type_ignores=[]), str(SOURCE), 'exec'), scope)
    return scope['_apply_finishing_uncertainty']


class FixedDraw:
    """Return a deterministic posterior-mean draw, not an estimated clipped mean."""
    def beta(self, alpha, beta, size):
        return np.full(size, alpha/(alpha+beta))

    def normal(self, mean, sd, size):
        return np.full(size, mean)


def apply(context, multiplier=1.0):
    samples = {'goals': np.ones(4), 'assists': np.full(4, 2.0)}
    engine = SimpleNamespace(rng=FixedDraw(), n_samples=4)
    return legacy_method()(engine, samples, {'finishing_multiplier': multiplier}, context)


def test_exact_goal_xg_agreement_can_still_shift_goal_samples():
    result = apply({'shot_count': 100, 'actual_goals': 20, 'total_xg': 20.0})
    # Fixture draw: Beta(30,170) mean=.15, divided by prior .10 =>1.5.
    # Actual goals/xG is neutral1.0, yet unit goal samples are boosted.
    np.testing.assert_allclose(result['goals'], 1.5)
    np.testing.assert_array_equal(result['assists'], 2.0)


def test_positive_xg_magnitude_is_ignored_after_gate():
    context = {'shot_count': 100, 'actual_goals': 20, 'total_xg': 10.0}
    first = apply(context)
    second = apply({**context, 'total_xg': 40.0})
    np.testing.assert_array_equal(first['goals'], second['goals'])


def test_existing_finishing_multiplier_divides_samples_without_recentering_draws():
    context = {'shot_count': 100, 'actual_goals': 10, 'total_xg': 10.0}
    result = apply(context, multiplier=1.25)
    # Posterior fixture draw=.10 gives multiplier1.0, then divides by1.25.
    np.testing.assert_allclose(result['goals'], .8)


@pytest.mark.parametrize('context', [
    {'shot_count': 9, 'actual_goals': 1, 'total_xg': 1.0},
    {'shot_count': 100, 'actual_goals': 10, 'total_xg': 0.0},
])
def test_low_evidence_branch_uses_neutral_fixture_noise(context):
    np.testing.assert_array_equal(apply(context)['goals'], 1.0)


def talent_method():
    source = SOURCE.parents[2] / 'scripts/utilities/feature_calculations.py'
    tree = ast.parse(source.read_text())
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                 and n.name == 'calculate_shooting_talent_adjusted_xg']
    assert len(functions) == 1
    scope = {}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), scope)
    return scope['calculate_shooting_talent_adjusted_xg']


def test_original_talent_application_preserves_copy_and_multiplies_flurry_quantity():
    frame = pd.DataFrame({'playerId': [1, 2], 'flurry_adjusted_xg': [.2, .3]})
    before = frame.copy(deep=True)
    output = talent_method()(frame, {1: 1.25})
    np.testing.assert_allclose(output['shooting_talent_adjusted_xg'], [.25, .3])
    np.testing.assert_allclose(output['shooting_talent_multiplier'], [1.25, 1.0])
    pd.testing.assert_frame_equal(frame, before)


def test_unknown_player_still_gets_legacy_cap_not_identity_transform():
    frame = pd.DataFrame({'playerId': [1], 'flurry_adjusted_xg': [.7]})
    output = talent_method()(frame, {})
    assert output['shooting_talent_multiplier'].iloc[0] == 1.0
    assert output['shooting_talent_adjusted_xg'].iloc[0] == .5
    # Therefore successful neutral lookup is not identical to uncapped fallback.


def test_missing_player_id_raises_in_legacy_application():
    frame = pd.DataFrame({'playerId': [None], 'flurry_adjusted_xg': [.2]})
    with pytest.raises((TypeError, ValueError)):
        talent_method()(frame, {})
