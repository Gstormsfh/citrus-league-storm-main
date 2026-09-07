"""Independent synthetic transfer contract checks; no real-data fitting."""
from copy import deepcopy
import ast
import inspect

import pytest
import run_calibration_transfer as runner


def inputs():
    calibration = [{'game_id': 2022020001+i//2, 'event_id': i,
                    'game_date': '2022-09-01', 'target': i % 2} for i in range(102)]
    outer = [{'game_id': 2023020001+i, 'event_id': i, 'game_date': day, 'target': i % 2}
             for i, day in enumerate(['2022-10-07', '2022-10-31', '2022-11-02', '2022-11-30', '2023-06-13'])]
    return calibration, outer


def prepared():
    cal, outer = inputs(); blocks = runner.transfer_blocks(cal, outer)
    contexts = {(r['game_id'], r['event_id']): {'shot_type': None, 'strength': '5v5', 'prior_sog_same_team': None} for r in cal+outer}
    item = {'blocks': blocks, 'contexts_by_key': contexts}
    return {'fold1': deepcopy(item), 'fold2': deepcopy(item)}, {'fold1': [deepcopy(b['receipt']) for b in blocks], 'fold2': [deepcopy(b['receipt']) for b in blocks]}


def test_all_months_final_sparse_and_complete_prior_month_prefix():
    cal, outer = inputs(); before = deepcopy((cal, outer)); blocks = runner.transfer_blocks(cal, outer)
    assert [b['month'] for b in blocks] == ['2022-10', '2022-11', '2023-06']
    assert blocks[0]['train_records'] == cal
    assert blocks[1]['train_records'] == cal+outer[:2]
    assert blocks[-1]['train_records'] == cal+outer[:4]
    assert sum(len(b['test_records']) for b in blocks) == len(outer)
    assert (cal, outer) == before
    assert blocks == runner.transfer_blocks(cal[::-1], outer[::-1])


def test_current_future_labels_do_not_enter_current_training_or_membership():
    cal, outer = inputs(); original = deepcopy(runner.transfer_blocks(cal, outer))
    for r in outer[2:]: r['target'] = 1-r['target']
    changed = runner.transfer_blocks(cal, outer)
    assert [b['receipt'] for b in changed] == [b['receipt'] for b in original]
    assert changed[1]['train_records'] == original[1]['train_records']
    assert changed[2]['train_records'] != original[2]['train_records']


@pytest.mark.parametrize('mutation', ['duplicate', 'same_day', 'mixed_game_date', 'boolean_id', 'invalid_date', 'empty_cal', 'empty_outer'])
def test_bad_membership_rejected(mutation):
    cal, outer = inputs()
    if mutation == 'duplicate': outer.append(deepcopy(outer[0]))
    if mutation == 'same_day': outer[0]['game_date'] = cal[0]['game_date']
    if mutation == 'mixed_game_date': outer[1]['game_id'] = outer[0]['game_id']
    if mutation == 'boolean_id': outer[0]['event_id'] = True
    if mutation == 'invalid_date': outer[0]['game_date'] = '2022-02-30'
    if mutation == 'empty_cal': cal = []
    if mutation == 'empty_outer': outer = []
    with pytest.raises(ValueError): runner.transfer_blocks(cal, outer)


def test_first_map_reuse_never_calls_fit_and_is_json_copy(monkeypatch):
    cal, outer = inputs(); block = runner.transfer_blocks(cal, outer)[0]
    monkeypatch.setattr(runner.bounded, 'fit', lambda *a, **k: pytest.fail('unexpected fit'))
    original = {'map': [1., None]}
    result = runner.fit_block(block, original, {}, {}, first=True)
    assert result == original and result is not original


def test_only_complete_earlier_targets_enter_bounded_fit(monkeypatch):
    cal, outer = inputs(); block = runner.transfer_blocks(cal, outer)[1]
    raw = {(r['game_id'], r['event_id']): .1 for r in cal+outer}
    contexts = {k: {'marker': list(k)} for k in raw}; calls = []
    def fit(p, y, c, **kwargs): calls.append((p, y, c, kwargs)); return {'synthetic': True}
    monkeypatch.setattr(runner.bounded, 'fit', fit)
    assert runner.fit_block(block, {}, raw, contexts, first=False) == {'synthetic': True}
    expected = cal+outer[:2]
    assert calls == [([.1]*len(expected), [r['target'] for r in expected], [contexts[r['game_id'], r['event_id']] for r in expected], {'chunk_rows': 4096})]


def test_preflight_all_folds_and_sparse_final_month_without_fitting(monkeypatch):
    p, expected = prepared()
    monkeypatch.setattr(runner.bounded, 'fit', lambda *a, **k: pytest.fail('preflight fit'))
    result = runner.preflight_study(p, expected)
    assert result['fold1']['2023-06']['test_support'] == 'sparse'
    del p['fold2']
    with pytest.raises(ValueError): runner.preflight_study(p, expected)


@pytest.mark.parametrize('mutation', ['omit_month', 'remove_train', 'remove_test', 'missing_context', 'bad_late_labels'])
def test_preflight_rejects_changed_support_or_membership(mutation):
    p, expected = prepared(); item = p['fold2']
    if mutation == 'omit_month': item['blocks'].pop()
    if mutation == 'remove_train': item['blocks'][0]['train_records'].pop()
    if mutation == 'remove_test': item['blocks'][0]['test_records'].pop()
    if mutation == 'missing_context': item['contexts_by_key'].pop(next(iter(item['contexts_by_key'])))
    if mutation == 'bad_late_labels':
        for r in item['blocks'][-1]['train_records']: r['target'] = 0
    with pytest.raises((ValueError, KeyError)): runner.preflight_study(p, expected)


def test_runtime_calls_preflight_before_any_fit_and_never_raw_fitter():
    tree = ast.parse(inspect.getsource(runner.run))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]
    preflight = [n.lineno for n in calls if isinstance(n.func, ast.Name) and n.func.id == 'preflight_study']
    fits = [n.lineno for n in calls if isinstance(n.func, ast.Name) and n.func.id == 'fit_block']
    assert len(preflight) == len(fits) == 1 and preflight[0] < fits[0]
    assert not any(isinstance(n.func, ast.Attribute) and n.func.attr == 'fit' for n in calls)


@pytest.mark.parametrize('mutation', ['traversal', 'absolute', 'status', 'publishable'])
def test_source_health_requires_complete_scoped_nonpublishing_inventory(mutation):
    class Closure:
        def __init__(self): self.pins = []; self.inventories = []
        def pin(self, p, digest): self.pins.append((p, digest))
        def inventory(self, p, names): self.inventories.append((p, names))
        def read(self, p): return health
    health = {'status': 'complete', 'publishable': False, 'files': {'safe.json': 'a'*64}}
    if mutation == 'traversal': health['files'] = {'../escape.json': 'a'*64}
    if mutation == 'absolute': health['files'] = {'/escape.json': 'a'*64}
    if mutation == 'status': health['status'] = 'running'
    if mutation == 'publishable': health['publishable'] = True
    with pytest.raises(ValueError): runner.pin_run(Closure(), 'proof/source', 'b'*64, 'complete')


def test_first_block_recomputed_tolerance_precedes_exact_saved_vector_reuse():
    source = inspect.getsource(runner.run)
    check = source.index('first_error = maximum_error(expanded, fixed, len(keys)) if number == 0 else None')
    reuse = source.index('if number == 0: expanded = np.asarray(fixed)')
    output = source.index("'predictions': {'fixed': float(fixed[i]), 'expanding': float(expanded[i])}")
    assert check < reuse < output
