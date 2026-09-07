"""Synthetic arithmetic and failure tests; no model fits or external data."""
from copy import deepcopy
import numpy as np
import pytest
import decompose_recorded_penalty as m


def fixture():
    rows, diagnostics, old = [], [], []
    for i in range(6):
        common = {'game_id': 1+i//2, 'event_id': i+1, 'target': i % 2}
        groups = {'prior_sog_same_team': 'prior' if i < 3 else None}
        p = {'frozen_conditional_shape': .2, 'recorded_penalty_raw': .35,
             'recorded_penalty_conditional_shape': .3}
        rows.append({**common, 'groups': groups, 'predictions': p})
        diagnostics.append({**common, 'groups': {
            'recorded_penalty_same_team__annotation_state': 'unavailable:missing',
            'recorded_penalty_opponent__annotation_state': 'recorded:type_known:duration_known'},
            'predictions': dict(p)})
        old.append({**common, 'groups': groups, 'predictions': {'movement_raw': .25, 'conditional_shape': .2}})
    return rows, diagnostics, old


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -1, 1.01, True, None, '.1'])
def test_probability_rejects(value):
    with pytest.raises(ValueError):
        m.probability(value)


@pytest.mark.parametrize('p,expected', [(0,0), (.009,0), (.01,1), (.1,4), (.5,7), (1,8)])
def test_band_boundary(p, expected):
    assert m.band(p) == expected


def test_matches_by_identity_not_position_and_preserves_inputs():
    rows, d, old = fixture()
    before = deepcopy((rows, d, old))
    assert m.matched(rows, d, old) == m.matched(rows[::-1], d[::-1], old[::-1])
    assert (rows, d, old) == before
    assert m.matched(rows,d,old)[-1]['cell'][1] is None


@pytest.mark.parametrize('which', [0, 1, 2])
def test_duplicate_or_missing_population_rejected(which):
    args = list(fixture())
    args[which].append(deepcopy(args[which][0]))
    with pytest.raises(ValueError): m.matched(*args)
    args = list(fixture())
    args[which].pop()
    with pytest.raises(ValueError): m.matched(*args)


def test_exact_target_and_control_drift_rejected():
    rows, d, old = fixture()
    old[0]['target'] = 1
    with pytest.raises(ValueError): m.matched(rows, d, old)
    old[0]['target'] = 0
    old[0]['predictions']['conditional_shape'] += 1e-10
    with pytest.raises(ValueError): m.matched(rows, d, old)


def test_loss_arithmetic_and_telescoping():
    rows = m.matched(*fixture())
    delta = m.loss_deltas(rows)
    assert delta[0, 0, 0] == pytest.approx(.3**2-.2**2)
    assert delta[0, 0, 1] == pytest.approx(.35**2-.25**2)
    assert delta[0, 1, 0] == pytest.approx(-np.log(.7)+np.log(.8))
    np.testing.assert_allclose(delta[:,:,0], delta[:,:,1]+delta[:,:,2], atol=1e-16)


def test_deterministic_conservation_and_no_refit():
    rows = m.matched(*fixture())
    result = m.decomposition(rows, draws=32)
    assert result == m.decomposition(rows, draws=32)
    for metric in m.METRICS:
        for part in m.COMPONENTS:
            whole = result['overall']['metrics'][metric][part]['mean_delta']
            assert sum(c['metrics'][metric][part]['weighted_contribution'] for c in result['cells']) == pytest.approx(whole)
    assert sum(c['events'] for c in result['cells']) == len(rows)


def test_clipping_endpoints_finite():
    rows = m.matched(*fixture())
    rows[0]['p'] = [0, 1, 1, 0]
    assert np.isfinite(m.loss_deltas(rows)).all()


def test_output_create_only_and_scoped(tmp_path, monkeypatch):
    monkeypatch.setattr(m, 'RESULTS', tmp_path)
    existing = tmp_path/'recorded-penalty-decomposition-existing'
    existing.mkdir()
    with pytest.raises(ValueError): m.run(existing)
    with pytest.raises(ValueError): m.run(tmp_path/'other')
