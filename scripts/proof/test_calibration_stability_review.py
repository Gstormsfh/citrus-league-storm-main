"""Independent earliest-only study contracts and genuine first-block source smoke."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from projections import portable_context_model as portable
from projections import conditional_calibration_shape as conditional
from projections import calibration_candidate
from projections.analytics_publication import fingerprint
from projections.development_feature_export import project_development_game
from projections.frozen_feature_source import adapt_frozen_feature_source
from run_conditional_shape_candidate import project, scalar_predictions
import run_calibration_stability as m


def test_real_partial_january_first_block_replays_saved_initial_map():
    """One certified real game's bytes -> features -> frozen raw -> fixed map; no fit."""
    root = Path(__file__).resolve().parents[2]
    source = 'scripts/proof/results/official-forward-shooter-movement-20260906-retry1'
    health_body = (root/source/'health.json').read_bytes()
    assert hashlib.sha256(health_body).hexdigest() == '829119131d856969b5278d1b14d1a711c19b4a5a404b6b932ee40cf29af9fe22'
    health = json.loads(health_body)
    def saved(name):
        body = (root/source/name).read_bytes()
        assert hashlib.sha256(body).hexdigest() == health['files'][name]
        return json.loads(body)
    closure = saved('consumed-file-sha256.json')
    gid = 2022020694
    prefix = f'scripts/proof/results/historical-official-freeze-20260906/2022/pbp/{gid}'
    body = (root/(prefix+'.body.json')).read_bytes()
    receipt_body = (root/(prefix+'.receipt.json')).read_bytes()
    assert hashlib.sha256(body).hexdigest() == closure[prefix+'.body.json']
    assert hashlib.sha256(receipt_body).hexdigest() == closure[prefix+'.receipt.json']
    payload, receipt = json.loads(body), json.loads(receipt_body)
    assert payload['gameDate'] == '2023-01-16'
    now = '2026-09-06T23:59:59Z'
    envelope = adapt_frozen_feature_source(body, receipt, now=now)
    rows = project_development_game(envelope, evidence_kind='real', now=now)['rows']
    extra = project(payload['plays'], home=payload['homeTeam']['id'], away=payload['awayTeam']['id'])
    model = saved('fold2/model.json')
    shape = saved('fold2/calibrators.json')['conditional_shape']
    schema = model['design']['schema']
    schema_sha = fingerprint(schema)
    for row in rows:
        row['features'] += extra[row['event_id']]
        row['feature_sha256'] = fingerprint({'schema_sha256': schema_sha, 'values': row['features'], 'categorical': row['categorical']})
    rows.sort(key=lambda x: x['event_id'])
    records = [r for r in saved('fold2/calibration-identity-inputs.json') if r['game_id'] == gid]
    assert [(r['game_id'], r['event_id']) for r in rows] == [(r['game_id'], r['event_id']) for r in records]
    assert len(schema['names']) == 47 and len(schema['categorical_names']) == 2
    raw = portable.predict_rows(model, rows)
    contexts = [calibration_candidate.context_from_row(row, schema) for row in rows]
    actual = conditional.predict(shape, raw, contexts)
    expected = np.array([r['probability'] for r in records])
    np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-12)
    np.testing.assert_allclose(scalar_predictions(shape, raw, contexts), expected, rtol=0, atol=1e-12)
    np.testing.assert_array_equal(portable.predict_rows(model, rows[::-1])[::-1], raw)
    np.testing.assert_allclose(conditional.predict(shape, raw[::-1], contexts[::-1])[::-1], expected, rtol=0, atol=1e-12)


def calendar():
    return [dict(game_id=2022020001+i, event_id=0, game_date=day, target=i%2)
            for i, day in enumerate(['2023-01-01', '2023-01-15', '2023-01-16',
                                     '2023-01-16', '2023-01-31', '2023-02-01', '2023-06-03'])]


def test_partial_month_whole_dates_no_future_labels_or_mutation():
    records = calendar(); before = deepcopy(records)
    blocks = m.monthly_blocks(records[::-1], '2023-01-16')
    assert [b['month'] for b in blocks] == ['2023-01', '2023-02', '2023-06']
    assert [len(b['test_records']) for b in blocks] == [3, 1, 1]
    assert [len(b['train_records']) for b in blocks] == [2, 5, 6]
    for b in blocks:
        assert max(x['game_date'] for x in b['train_records']) < min(x['game_date'] for x in b['test_records'])
        assert not set(m.strict_keys(b['train_records'])) & set(m.strict_keys(b['test_records']))
    changed = [{**x, 'target': 1-x['target']} for x in records]
    assert [x['receipt'] for x in m.monthly_blocks(changed, '2023-01-16')] == [x['receipt'] for x in blocks]
    assert records == before


@pytest.mark.parametrize('change', ['duplicate', 'bool', 'date_conflict', 'bad_date', 'empty_early', 'empty_late'])
def test_calendar_fail_closed(change):
    records = calendar(); cutoff = '2023-01-16'
    if change == 'duplicate': records.append(deepcopy(records[0]))
    if change == 'bool': records[0]['event_id'] = False
    if change == 'date_conflict': records[1]['game_id'] = records[0]['game_id']; records[1]['event_id'] = 1
    if change == 'bad_date': records[0]['game_date'] = '2023-01-99'
    if change == 'empty_early': cutoff = '2023-01-01'
    if change == 'empty_late': cutoff = '2024-01-01'
    with pytest.raises(ValueError): m.monthly_blocks(records, cutoff)


def supported():
    train = [dict(game_id=2022020001+i//4, event_id=i%4, game_date='2023-01-01', target=i%2) for i in range(120)]
    test = [dict(game_id=2022020900, event_id=0, game_date='2023-02-01', target=0)]
    block = {'month': '2023-02', 'train_records': train, 'test_records': test,
             'receipt': {'month': '2023-02', 'train': m.receipt(train), 'test': m.receipt(test)}}
    contexts = {k: {'shot_type': 'wrist', 'strength': '5v5', 'prior_sog_same_team': None}
                for k in m.strict_keys(train+test)}
    return block, contexts


def test_sparse_future_is_retained_but_fit_support_required():
    block, contexts = supported()
    assert m.preflight_block(block, contexts)['test_support'] == 'sparse'
    block['train_records'] = block['train_records'][:99]
    with pytest.raises(ValueError): m.preflight_block(block, contexts)


def test_future_context_vocabulary_never_enters_preflight(monkeypatch):
    block, contexts = supported()
    contexts[m.strict_keys(block['test_records'])[0]]['shot_type'] = 'future-only'
    seen = []
    old = m.conditional._vocabulary
    def inspect(values):
        seen.extend(x['shot_type'] for x in values)
        return old(values)
    monkeypatch.setattr(m.conditional, '_vocabulary', inspect)
    m.preflight_block(block, contexts)
    assert len(seen) == 120 and set(seen) == {'wrist'}


@pytest.mark.parametrize('which', ['second_fold', 'later_block'])
def test_allfold_allblock_preflight_rejects_late_failure_without_fit(monkeypatch, which):
    block, contexts = supported()
    prepared = {f: {'blocks': [deepcopy(block)], 'contexts_by_key': deepcopy(contexts)} for f in ('fold1', 'fold2')}
    if which == 'later_block':
        extra = deepcopy(block); extra['month'] = '2023-03'; extra['receipt']['month'] = '2023-03'
        prepared['fold2']['blocks'].append(extra)
    target = prepared['fold2']['blocks'][-1]
    for row in target['train_records']: row['target'] = 0
    expected = {f: [b['receipt'] for b in item['blocks']] for f, item in prepared.items()}
    monkeypatch.setattr(m.conditional, 'fit', lambda *a: pytest.fail('fit called during preflight'))
    with pytest.raises(ValueError): m.preflight_study(prepared, expected)


def test_fit_receives_only_past_labels_and_first_block_never_refits(monkeypatch):
    block, contexts = supported()
    raw = {k: .2 for k in contexts}
    seen = []
    def fit(p, y, c):
        seen.append(deepcopy((p, y, c)))
        return {'fixture': 'no model fit', 'sum_labels': sum(y)}
    monkeypatch.setattr(m.conditional, 'fit', fit)
    initial = {'fixture': 'saved', 'nested': [1]}
    copied = m.fit_block(block, initial, raw, contexts, first=True)
    assert copied == initial and copied is not initial and copied['nested'] is not initial['nested'] and not seen
    first = m.fit_block(block, initial, raw, contexts, first=False)
    changed = deepcopy(block); changed['test_records'][0]['target'] = 1
    second = m.fit_block(changed, initial, raw, contexts, first=False)
    assert first == second and seen[0] == seen[1]
    assert len(seen[0][1]) == len(block['train_records'])


@pytest.mark.parametrize('bad', [[], [float('nan')], [True], [[.2]], [.2, .3]])
def test_map_parity_rejects_malformed_output(monkeypatch, bad):
    monkeypatch.setattr(m, 'scalar_predictions', lambda *a: [.2])
    with pytest.raises(ValueError): m.map_parity({}, [.2], [{}], bad)


def test_actual_run_second_fold_gate_prevents_all_fits(monkeypatch, tmp_path):
    """Actual run orchestration with synthetic IO; real source smoke is separate."""
    block, context_by_key = supported()
    records = block['train_records'] + block['test_records']
    plan = json.loads((m.ROOT/m.PLAN).read_bytes())
    blocks = m.monthly_blocks(records, '2023-02-01')
    schema = {'fixture': True}
    plan.update(schema=schema, scorecard={}, cutoffs={f: '2023-02-01' for f in ('fold1', 'fold2')},
                blocks={f: [b['receipt'] for b in blocks] for f in ('fold1', 'fold2')})
    def retained(fold):
        data = deepcopy(records)
        if fold == 'fold2':
            for row in data: row['target'] = 0
        return data
    class Closure:
        def __init__(self, root): self.checked = {}; self.inventories = {}
        def pin(self, name, digest): self.checked[name] = digest
        def mapping(self, values): self.checked.update(values)
        def inventory(self, *args): pass
        def verify(self): pass
        def lines(self, name): return [{**row, 'groups': {}} for row in records]
        def read(self, name):
            if name == m.PLAN: return plan
            if name.endswith('/health.json'):
                return {'status': 'complete-forward-shooter-movement-development-not-accepted', 'publishable': False, 'files': {}}
            if name.endswith('/source-reuse.json'): return {'checked': {}, 'inventories': {}}
            fold = 'fold2' if '/fold2/' in name else 'fold1'
            if name.endswith('/model.json'): return {'design': {'schema': schema}}
            if name.endswith('/calibration-identity-inputs.json'): return retained(fold)
            if name.endswith('/calibrators.json'): return {'conditional_shape': {'fixture': True}}
            if name.endswith('/split.json'):
                return {'earlier_map': {'game_ids': sorted({r['game_id'] for r in block['train_records']})},
                        'later_identity': {'game_ids': [block['test_records'][0]['game_id']]}}
            raise AssertionError(name)
    features = SimpleNamespace(schema=schema, config={'scorecard': {}}, closure=Closure(tmp_path),
        folds={f: {'calibration': {'rows': retained(f)},
                   'train': {'rows': [{'game_date': '2022-01-01'}]},
                   'validation': {'rows': 'outer scoring is forbidden'}} for f in ('fold1', 'fold2')})
    monkeypatch.setattr(m, 'ROOT', tmp_path)
    monkeypatch.setattr(m, 'CODE', ())
    monkeypatch.setattr(m.reuse, 'Closure', Closure)
    monkeypatch.setattr(m.reuse, 'load', lambda root: features)
    def replay(model, initial, rows, saved):
        return np.full(len(rows), .2), [context_by_key[k] for k in m.strict_keys(rows)], np.full(len(rows), .2), {}
    monkeypatch.setattr(m, 'fixed_map_replay', replay)
    visited = []
    original = m.preflight_block
    def observed(b, ctx):
        visited.append({r['target'] for r in b['train_records']})
        return original(b, ctx)
    monkeypatch.setattr(m, 'preflight_block', observed)
    monkeypatch.setattr(m.conditional, 'fit', lambda *a: pytest.fail('Fitted before all fold gates passed'))
    (tmp_path/'scripts/proof/results').mkdir(parents=True)
    out = tmp_path/'scripts/proof/results/official-calibration-stability-synthetic'
    with pytest.raises(ValueError, match='supported earlier fit'): m.run(out)
    assert visited == [{0, 1}, {0}]
    assert (out/'failure.json').exists() and not (out/'declaration.json').exists()
