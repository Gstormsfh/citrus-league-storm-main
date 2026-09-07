"""Independent scalar algebra and controlled whole-game no-fit accounting."""
from copy import deepcopy
import hashlib
import json
import math

import numpy as np
import pytest
import decompose_forward_shooter as m


def joined():
    return [dict(key=(2022020001, 0), target=0, p=[.21, .3, .2, .4], cell=[5, '2022-10', None]),
            dict(key=(2022020001, 2), target=1, p=[.22, .4, .5, .6], cell=[5, '2022-10', None]),
            dict(key=(2022020002, 0), target=0, p=[.1, .2, .3, .2], cell=[4, '2022-11', 'not_prior_same_team_sog'])]


def test_scalar_losses_and_three_increment_telescoping():
    rows = joined()
    actual = m.loss_deltas(rows)
    assert actual.shape == (3, 2, 4)
    for i, row in enumerate(rows):
        loss = []
        for p in row['p']:
            q = min(1-m.EPSILON, max(m.EPSILON, p))
            loss.append([(p-row['target'])**2,
                         -row['target']*math.log(q)-(1-row['target'])*math.log1p(-q)])
        for metric in range(2):
            expected = [loss[3][metric]-loss[0][metric]] + [loss[j+1][metric]-loss[j][metric] for j in range(3)]
            np.testing.assert_allclose(actual[i, metric], expected, atol=1e-15, rtol=0)
            assert abs(actual[i, metric, 0]-sum(actual[i, metric, 1:])) < 1e-15


def test_one_shared_game_draw_matrix_empty_cells_and_fullfold_denominator(monkeypatch):
    rows = joined()
    weights = np.array([[2, 0], [0, 2], [1, 1], [1, 1]])
    calls = []
    class RNG:
        def multinomial(self, n, p, size):
            calls.append((n, size))
            assert (n, size) == (2, 4)
            return weights.copy()
    monkeypatch.setattr(m.np.random, 'default_rng', lambda seed: RNG())
    result = m.decomposition(rows, draws=4)
    assert calls == [(2, 4)]
    cell = next(c for c in result['cells'] if c['cell'][2] is None)
    assert cell['events'] == 2 and cell['games'] == 1 and cell['zero_event_draws'] == 1
    assert cell['support'] == 'sparse'
    delta = m.loss_deltas(rows)
    total_n = weights @ np.array([2, 1])
    for j, metric in enumerate(m.METRICS):
        for k, component in enumerate(m.COMPONENTS):
            draws = weights @ np.array([delta[:2, j, k].sum(), 0.])
            values = cell['metrics'][metric][component]
            np.testing.assert_allclose(values['weighted_contribution_ci95'], np.quantile(draws/total_n, [.025, .975]), atol=1e-15)
            np.testing.assert_allclose(values['mean_delta_ci95_nonempty_draws'],
                np.quantile(draws[[0, 2, 3]]/np.array([4, 2, 2]), [.025, .975]), atol=1e-15)
            assert values['weighted_contribution'] == pytest.approx(delta[:2, j, k].sum()/3)
            overall = result['overall']['metrics'][metric][component]['mean_delta']
            for entries in [result['cells'], *result['rollups'].values()]:
                assert sum(c['metrics'][metric][component]['weighted_contribution'] for c in entries) == pytest.approx(overall)


def test_fixed_seed_exact_order_invariance_and_immutability():
    rows = joined(); before = deepcopy(rows)
    assert m.decomposition(rows, draws=16, seed=42) == m.decomposition(rows[::-1], draws=16, seed=42)
    assert rows == before


def sources():
    group = {'prior_sog_same_team': None}
    row = dict(game_id=2022020001, event_id=0, target=0, groups=group,
               predictions={'frozen_conditional_shape': .05, 'new_neutral': .2, 'global_control': .3, 'shooter': .7})
    record = dict(game_id=row['game_id'], event_id=0, game_date='2022-10-01', target=0, probability=.2,
                  shooter_id=None, goalie_id=None, source_event_sha256='a'*64)
    prior = {**deepcopy(row), 'predictions': {'conditional_shape': .05}}
    return [row], [record], [prior], [deepcopy(record)]


def test_frozen_anchor_month_null_context_and_event_zero():
    row = m.matched(*sources())[0]
    assert row['cell'] == [m.band(.05), '2022-10', None]
    assert row['p'] == [.05, .2, .3, .7]
    assert row['key'] == (2022020001, 0)


@pytest.mark.parametrize('index', range(4))
@pytest.mark.parametrize('mutation', ['duplicate', 'target', 'float_key', 'missing'])
def test_every_join_source_rejects_bad_membership(index, mutation):
    data = list(sources())
    if mutation == 'duplicate': data[index].append(deepcopy(data[index][0]))
    if mutation == 'target': data[index][0]['target'] = 1
    if mutation == 'float_key': data[index][0]['event_id'] = 0.
    if mutation == 'missing': data[index] = []
    with pytest.raises(ValueError): m.matched(*data)


@pytest.mark.parametrize('mutation', ['nan', 'inf', 'width', 'duplicate', 'wrong_anchor', 'bad_month'])
def test_joined_boundary_rejects_corruption(mutation):
    rows = joined()
    if mutation == 'nan': rows[0]['p'][1] = float('nan')
    if mutation == 'inf': rows[0]['p'][2] = float('inf')
    if mutation == 'width': rows[0]['p'].append(.1)
    if mutation == 'duplicate': rows.append(deepcopy(rows[0]))
    if mutation == 'wrong_anchor': rows[0]['cell'][0] = 0
    if mutation == 'bad_month': rows[0]['cell'][1] = '2022-99'
    with pytest.raises(ValueError): m.decomposition(rows, draws=4)


def frozen_tree(tmp_path):
    folder = tmp_path/'receipt'
    folder.mkdir()
    content = b'{"evidence":"synthetic bytes, not actual model data"}'
    (folder/'rows.json').write_bytes(content)
    health = {'status': 'complete-synthetic', 'publishable': False,
              'files': {'rows.json': hashlib.sha256(content).hexdigest()}}
    encoded = json.dumps(health, sort_keys=True).encode()
    (folder/'health.json').write_bytes(encoded)
    return folder, hashlib.sha256(encoded).hexdigest()


def test_real_filesystem_exact_source_pin_and_end_drift(tmp_path):
    folder, digest = frozen_tree(tmp_path)
    closure = m.Closure(tmp_path)
    m.pin_run(closure, 'receipt', digest, 'complete-synthetic')
    assert closure.read('receipt/rows.json')['evidence'].startswith('synthetic')
    closure.verify()
    (folder/'rows.json').write_bytes(b'{"changed":true}')
    with pytest.raises(ValueError): closure.read('receipt/rows.json')
    with pytest.raises(ValueError): closure.verify()


@pytest.mark.parametrize('mutation', ['body', 'health', 'extra', 'missing', 'symlink', 'traversal'])
def test_real_filesystem_corrupt_inventory_or_hash_rejected(tmp_path, mutation):
    folder, digest = frozen_tree(tmp_path)
    if mutation == 'body': (folder/'rows.json').write_bytes(b'{}')
    if mutation == 'health': (folder/'health.json').write_bytes(b'{}')
    if mutation == 'extra': (folder/'unlisted.json').write_bytes(b'{}')
    if mutation == 'missing': (folder/'rows.json').unlink()
    if mutation == 'symlink': (folder/'alias.json').symlink_to(folder/'rows.json')
    if mutation == 'traversal':
        body = json.dumps({'status': 'complete-synthetic', 'publishable': False,
                           'files': {'../rows.json': 'a'*64}}).encode()
        (folder/'health.json').write_bytes(body)
        digest = hashlib.sha256(body).hexdigest()
    with pytest.raises(ValueError): m.pin_run(m.Closure(tmp_path), 'receipt', digest, 'complete-synthetic')


def test_real_filesystem_end_inventory_detects_new_unlisted_file(tmp_path):
    folder, digest = frozen_tree(tmp_path)
    closure = m.Closure(tmp_path)
    m.pin_run(closure, 'receipt', digest, 'complete-synthetic')
    (folder/'late.json').write_bytes(b'{}')
    with pytest.raises(ValueError): closure.verify()


@pytest.mark.parametrize('mutation', ['float_actor', 'invalid_hash'])
def test_identity_semantic_types_do_not_alias(mutation):
    data = list(sources())
    if mutation == 'float_actor':
        data[1][0]['shooter_id'] = 8470001.
        data[3][0]['shooter_id'] = 8470001
    else:
        data[1][0]['source_event_sha256'] = 'not a hash'
        data[3][0]['source_event_sha256'] = 'not a hash'
    with pytest.raises(ValueError): m.matched(*data)
