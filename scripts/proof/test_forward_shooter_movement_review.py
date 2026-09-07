"""Independent synthetic review; no real fits or source artifact mutation."""
from copy import deepcopy
import json
from types import SimpleNamespace

import numpy as np
import pytest

import forward_shooter_split as split
import run_forward_shooter_movement as r
from test_run_forward_shooter_movement import feature, record


def test_split_is_game_midpoint_whole_date_and_target_independent():
    rows = [record(feature(gid=2021020001+i, day=day, eid=j))
            for i, day in enumerate(['2021-10-01', '2021-10-02', '2021-10-02', '2021-10-03'])
            for j in range(1 if i else 10)]
    before = deepcopy(rows)
    early, late, receipt = split.partition(rows[::-1])
    assert receipt['cutoff_date'] == '2021-10-02'
    assert len(early) == 10 and len(late) == 3
    assert max(x['game_date'] for x in early) < min(x['game_date'] for x in late)
    assert split.partition([{**x, 'target': 1-x['target']} for x in rows])[2] == receipt
    assert rows == before


@pytest.mark.parametrize('stage', range(4))
def test_chronology_rejects_empty_stage(stage):
    parts = [[feature(gid=2020020001+i, day=f'2020-10-0{i+1}')] for i in range(4)]
    parts[stage] = []
    with pytest.raises(ValueError): r.stage_chronology(*parts)


def parity_fixture(monkeypatch):
    rows = [feature(eid=i+1) for i in range(3)]
    records = [record(x) for x in rows]
    for x in records: x['probability'] = .1*x['event_id']
    monkeypatch.setattr(r.portable, 'predict_rows', lambda m, rr: np.array([.1*x['event_id'] for x in rr]))
    monkeypatch.setattr(r.calibration_candidate, 'context_from_row', lambda row, schema: {})
    monkeypatch.setattr(r.conditional, 'predict', lambda m, pp, cc: np.asarray(pp))
    def score(model, requests):
        keys = [(x['game_id'], x['event_id']) for x in requests]
        if len(keys) != len(set(keys)): raise ValueError('duplicate')
        return [{k: x[k] for k in ('game_id', 'event_id', 'probability')}
                for x in sorted(requests, key=lambda x: x['event_id'])]
    monkeypatch.setattr(r, 'identity_score', score)
    expected = {name: [.1, .2, .1*3] for name in ('raw', 'new_neutral', 'global_control', 'shooter')}
    return ({'design': {'schema': {}}}, {}, {'global_control': {}, 'shooter': {}}, rows, records, expected)


def test_full_parity_reversal_singleton_and_unknowns(monkeypatch):
    args = parity_fixture(monkeypatch)
    before = deepcopy(args)
    result = r.inference_parity(*args)
    assert result['events'] == 3 and result['duplicates_rejected']
    assert all(v == 0 for v in result['maximum_errors'].values())
    assert args == before


@pytest.mark.parametrize('change', ['raw_short', 'raw_nan', 'raw_tiny', 'identity_short', 'identity_nan', 'identity_key', 'duplicate_accepted'])
def test_parity_rejects_corruption(monkeypatch, change):
    args = parity_fixture(monkeypatch)
    if change.startswith('raw'):
        original = r.portable.predict_rows
        def corrupt(m, rr):
            pp = original(m, rr)
            if change == 'raw_short': return pp[:-1]
            pp[0] = float('nan') if change == 'raw_nan' else pp[0]+1e-15
            return pp
        monkeypatch.setattr(r.portable, 'predict_rows', corrupt)
    else:
        original = r.identity_score
        def corrupt(m, requests):
            if change == 'duplicate_accepted' and len(requests) == 2 and requests[0] == requests[1]:
                return []
            pp = original(m, requests)
            if change == 'identity_short': return pp[:-1]
            if change == 'identity_nan': pp[0]['probability'] = float('nan')
            if change == 'identity_key': pp[0]['event_id'] += 20
            return pp
        monkeypatch.setattr(r, 'identity_score', corrupt)
    with pytest.raises(ValueError): r.inference_parity(*args)


@pytest.mark.parametrize('defect', ['vocabulary', 'numeric_names', 'categorical_names', 'schema'])
def test_preflight_requires_original_training_design(monkeypatch, defect):
    rows = [feature(eid=i, label=bool(i%2)) for i in range(4)]
    records = [record(x) for x in rows]
    schema = {'version': 'fixture'}
    config = {'views': {'enhanced_numeric_names': ['a'], 'enhanced_categorical_names': ['b']}}
    model = {'design': {'schema': schema, 'vocabulary': {'b': ['train-only']},
                        'numeric_names': ['a'], 'categorical_names': ['b']}}
    monkeypatch.setattr(r.development, '_vocabulary_and_design_bound', lambda *a: ({'b': ['train-only']}, {}))
    monkeypatch.setattr(r.portable, 'validate_model', lambda m: 3)
    changed = deepcopy(model)
    changed['design'][defect] = {} if defect in ('schema', 'vocabulary') else ['wrong']
    with pytest.raises(ValueError):
        r.preflight({s: {'rows': rows} for s in ('train', 'calibration', 'validation')},
                    records[:2], records[2:], changed, schema, config)


def test_second_fold_preflight_failure_prevents_every_fit(monkeypatch, tmp_path):
    """Mock IO only: exercise actual orchestration, fail the second fold preflight."""
    plan = json.loads((r.ROOT/r.PLAN).read_text())
    rows = [feature(gid=2021020001+i, day=f'2021-10-0{i+1}', label=bool(i%2)) for i in range(4)]
    records = [record(x) for x in rows]
    _, _, receipt = split.partition(records)
    expected = {k: ({n: v for n, v in value.items() if n != 'game_ids'} if isinstance(value, dict) else value)
                for k, value in receipt.items() if k not in ('rule', 'publishable')}
    schema = {'fixture': True}
    plan.update(schema=schema, scorecard={}, expected_splits={fold: expected for fold in ('fold1', 'fold2')})
    validation = [feature(gid=2022020001, day='2022-10-01')]
    parts = {'train': {'rows': [feature(gid=2020020001, day='2020-10-01')]},
             'calibration': {'rows': rows}, 'validation': {'rows': validation}}
    class Closure:
        def __init__(self, root): self.checked = {}; self.inventories = {}
        def pin(self, name, digest): self.checked[name] = digest
        def mapping(self, values): self.checked.update(values)
        def inventory(self, *args): pass
        def verify(self): pass
        def read(self, name):
            if name == r.PLAN: return plan
            if name.endswith('/health.json'): return {'status': 'complete-identity-development-not-accepted', 'publishable': False, 'files': {}}
            if name.endswith('/declaration.json'): return {'code_sha256': {}}
            if name.endswith('/consumed-file-sha256.json'): return {}
            if name.endswith('/calibration-identity-inputs.json'): return records
            if name.endswith('/validation-identity-inputs.json'): return [record(x) for x in validation]
            if name.endswith('/fit-receipt.json'): return {'model_sha256': 'a'*64, 'calibrators_sha256': 'b'*64}
            if name.endswith('/model.json'): return {'design': {'schema': schema}}
            if name.endswith('/seed-predictions.json'): return []
            if name.endswith('/simulation.json'): return {'rows': []}
            raise AssertionError(name)
    features = SimpleNamespace(schema=schema, config={'scorecard': {}},
        folds={fold: deepcopy(parts) for fold in ('fold1', 'fold2')}, groups={}, closure=Closure(tmp_path))
    monkeypatch.setattr(r, 'ROOT', tmp_path)
    monkeypatch.setattr(r, 'CODE', ())
    monkeypatch.setattr(r.reuse, 'Closure', Closure)
    monkeypatch.setattr(r.reuse, 'load', lambda root: features)
    monkeypatch.setattr(r.development, '_preflight_bounds', lambda *a: None)
    monkeypatch.setattr(r, 'verify_source_roles', lambda *a, **k: {})
    calls = []
    def preflight(*args):
        calls.append('preflight')
        if len(calls) == 2: raise ValueError('second fold gate')
        return {}
    monkeypatch.setattr(r, 'preflight', preflight)
    def forbidden(*a, **k): raise AssertionError('fit ran before both fold preflights')
    monkeypatch.setattr(r.identity, 'fit', forbidden)
    monkeypatch.setattr(r.conditional, 'fit', forbidden)
    (tmp_path/'scripts/proof/results').mkdir(parents=True)
    output = tmp_path/'scripts/proof/results/official-forward-shooter-movement-synthetic'
    with pytest.raises(ValueError, match='second fold gate'): r.run(output)
    assert calls == ['preflight', 'preflight']
    assert (output/'failure.json').exists()
    assert not (output/'declaration.json').exists()
