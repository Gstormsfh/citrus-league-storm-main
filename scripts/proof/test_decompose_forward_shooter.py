"""Synthetic saved-loss accounting contracts, not a fitted experiment."""
from copy import deepcopy
import math
import numpy as np
import pytest
import decompose_forward_shooter as module


def sources():
    rows, identities, prior, original = [], [], [], []
    for i in range(4):
        gid, eid = 2022020001+i, 1
        p = [.02, .03, .04, .025]
        groups = {'prior_sog_same_team': None if i%2 == 0 else 'null', 'strength': '5v5'}
        rows.append({'game_id': gid, 'event_id': eid, 'target': i%2, 'groups': groups,
                     'predictions': dict(zip(module.PREDICTIONS, p))})
        actor = {'game_id': gid, 'event_id': eid, 'target': i%2, 'game_date': f'2022-10-0{i+1}',
                 'probability': p[1], 'shooter_id': None, 'goalie_id': None, 'source_event_sha256': 'a'*64}
        identities.append(actor); original.append(deepcopy(actor))
        prior.append({'game_id': gid, 'event_id': eid, 'target': i%2, 'groups': groups,
                      'predictions': {'conditional_shape': p[0]}})
    return rows, identities, prior, original


def test_four_way_join_canonical_order_unknown_preserved():
    values = sources(); before = deepcopy(values)
    actual = module.matched(*values)
    assert module.matched(*(v[::-1] for v in values)) == actual
    assert values == before
    assert actual[0]['cell'] == [1, '2022-10', None]
    assert actual[1]['cell'][2] == 'null'


@pytest.mark.parametrize('change', ['duplicate', 'bool_key', 'float_key', 'date', 'label', 'groups', 'actor', 'source', 'probability', 'extra_prediction'])
def test_join_rejects_drift(change):
    rows, actors, prior, original = sources()
    if change == 'duplicate': rows.append(deepcopy(rows[0]))
    if change == 'bool_key': rows[0]['event_id'] = True
    if change == 'float_key': actors[0]['event_id'] = 1.
    if change == 'date': actors[0]['game_date'] = '2022-11-01'
    if change == 'label': original[0]['target'] = 1
    if change == 'groups': prior[0]['groups'] = {'prior_sog_same_team': 'different'}
    if change == 'actor': original[0]['shooter_id'] = 8470000
    if change == 'source': original[0]['source_event_sha256'] = 'b'*64
    if change == 'probability': rows[0]['predictions']['new_neutral'] = .5
    if change == 'extra_prediction': rows[0]['predictions']['extra'] = .1
    with pytest.raises(ValueError): module.matched(rows, actors, prior, original)


def test_loss_algebra_is_loss_not_probability_differences():
    rows = module.matched(*sources())
    deltas = module.loss_deltas(rows)
    for i, row in enumerate(rows):
        y = row['target']; p = row['p']
        for metric, loss in enumerate((lambda v: (v-y)**2, lambda v: -math.log(v if y else 1-v))):
            values = [loss(v) for v in p]
            expected = [values[3]-values[0], values[1]-values[0], values[2]-values[1], values[3]-values[2]]
            np.testing.assert_allclose(deltas[i, metric], expected, atol=1e-15, rtol=0)
    np.testing.assert_allclose(deltas[:, :, 0], deltas[:, :, 1:].sum(axis=2), atol=1e-15, rtol=0)


def test_sparse_null_month_rollups_and_conservation():
    rows = module.matched(*sources())
    report = module.decomposition(rows, draws=16, seed=60906)
    assert report == module.decomposition(rows[::-1], draws=16, seed=60906)
    assert report['observed_cells'] == 2
    assert all(c['support'] == 'sparse' for c in report['cells'])
    assert {type(r['value']) for r in report['rollups']['prior_sog_same_team']} == {type(None), str}
    for metric in module.METRICS:
        for component in module.COMPONENTS:
            expected = report['overall']['metrics'][metric][component]['mean_delta']
            for collection in [report['cells'], *report['rollups'].values()]:
                assert sum(c['metrics'][metric][component]['weighted_contribution'] for c in collection) == pytest.approx(expected, abs=1e-14)


def test_all_anchor_boundaries_final_inclusive():
    assert module.band(0) == 0 and module.band(1) == len(module.EDGES)-2
    for i, edge in enumerate(module.EDGES[1:-1], 1): assert module.band(edge) == i


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -.1, 1.1, True, 10**1000])
def test_nonfinite_or_invalid_probability_rejected(value):
    with pytest.raises(ValueError): module.probability(value)


def test_same_game_cannot_cross_month_or_duplicate():
    rows = module.matched(*sources())
    rows[1]['key'] = (rows[0]['key'][0], 2)
    rows[1]['cell'][1] = '2022-11'
    with pytest.raises(ValueError, match='month'): module.decomposition(rows, draws=8)
    with pytest.raises(ValueError, match='Duplicate'): module.decomposition([rows[0], rows[0]], draws=8)
