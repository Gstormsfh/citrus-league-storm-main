from copy import deepcopy
import hashlib
import json
import pytest
import run_calibration_transfer as subject


def records():
    calibration = [{'game_id': 100+i, 'event_id': j, 'game_date': '2020-01-01', 'target': j % 2}
        for i in range(30) for j in range(4)]
    validation = [{'game_id': 200, 'event_id': 0, 'game_date': '2020-02-02', 'target': 1},
        {'game_id': 201, 'event_id': 0, 'game_date': '2020-03-01', 'target': 0}]
    return calibration, validation


def context():
    return {'strength': '5v5', 'shot_type': 'wrist', 'prior_sog_same_team': None}


def prepared():
    cal, val = records(); blocks = subject.transfer_blocks(cal, val)
    contexts = {k: context() for k in subject.strict_keys(cal+val)}
    return {f: {'blocks': deepcopy(blocks), 'contexts_by_key': contexts} for f in ('fold1', 'fold2')}, {
        f: [deepcopy(b['receipt']) for b in blocks] for f in ('fold1', 'fold2')}


def test_plan_is_immutable():
    assert subject.file_sha(subject.ROOT/subject.PLAN) == subject.PLAN_SHA


def test_expanding_membership_and_permutation():
    cal, val = records()
    blocks = subject.transfer_blocks(cal, val)
    assert blocks == subject.transfer_blocks(cal[::-1], val[::-1])
    assert len(blocks[0]['train_records']) == 120
    assert len(blocks[1]['train_records']) == 121
    assert blocks[1]['train_records'][-1] == val[0]


def test_future_targets_cannot_change_membership():
    cal, val = records(); original = subject.transfer_blocks(cal, val)
    val[1]['target'] = object()
    changed = subject.transfer_blocks(cal, val)
    assert [b['receipt'] for b in original] == [b['receipt'] for b in changed]
    assert changed[1]['train_records'] == original[1]['train_records']


@pytest.mark.parametrize('kind', ['duplicate', 'date_alias', 'overlap', 'same_game'])
def test_bad_membership(kind):
    cal, val = records()
    if kind == 'duplicate': val.append(val[0].copy())
    if kind == 'date_alias': val[0]['game_date'] = '20200202'
    if kind == 'overlap': val[0]['game_date'] = '2020-01-01'
    if kind == 'same_game': val[1]['game_id'] = val[0]['game_id']; val[1]['event_id'] = 1
    with pytest.raises(ValueError): subject.transfer_blocks(cal, val)


def test_preflight_both_folds_sparse_retained():
    data, expected = prepared()
    result = subject.preflight_study(data, expected)
    assert result['fold2']['2020-03']['test_support'] == 'sparse'
    assert result['fold1']['2020-02']['train_allocation']['full_design_cached'] is False


def test_stale_receipt_rejected():
    data, expected = prepared(); data['fold2']['blocks'][1]['train_records'].pop()
    with pytest.raises(ValueError, match='receipt'): subject.preflight_study(data, expected)


def test_first_block_never_fits(monkeypatch):
    cal, val = records(); block = subject.transfer_blocks(cal, val)[0]
    monkeypatch.setattr(subject.bounded, 'fit', lambda *a, **kw: pytest.fail('Fit forbidden'))
    original = {'saved': [1, 2]}
    result = subject.fit_block(block, original, {}, {}, first=True)
    assert result == original and result is not original


def test_later_fit_receives_only_earlier_data(monkeypatch):
    cal, val = records(); block = subject.transfer_blocks(cal, val)[1]
    keys = subject.strict_keys(cal+val); raw = dict.fromkeys(keys, .1); contexts = dict.fromkeys(keys, context())
    def fit(p, y, c, *, chunk_rows):
        assert len(y) == 121 and y[-1] == 1 and chunk_rows == 4096
        return {'sentinel': True}
    monkeypatch.setattr(subject.bounded, 'fit', fit)
    val[1]['target'] = object()
    assert subject.fit_block(block, {}, raw, contexts, first=False) == {'sentinel': True}


def test_missing_fold_rejected():
    data, expected = prepared(); del data['fold2']
    with pytest.raises(ValueError): subject.preflight_study(data, expected)


@pytest.mark.parametrize('value', [float('nan'), float('inf'), True])
def test_nonfinite_guard(value):
    losses = {n: {m: .1 for m in subject.METRICS} for n in subject.OUTPUTS}
    losses['expanding']['brier'] = value
    assert not subject.primary_passed(losses)


def test_real_filesystem_source_hash_and_inventory(tmp_path):
    source = tmp_path/'source'; source.mkdir()
    body = subject.encode({'evidence': True}); (source/'data.json').write_bytes(body)
    health = subject.encode({'status': 'complete', 'publishable': False,
        'files': {'data.json': hashlib.sha256(body).hexdigest()}})
    (source/'health.json').write_bytes(health)
    digest = hashlib.sha256(health).hexdigest()
    closure = subject.reuse.Closure(tmp_path)
    subject.pin_run(closure, 'source', digest, 'complete'); closure.verify()
    (source/'data.json').write_bytes(b'{}')
    with pytest.raises(ValueError): closure.verify()
