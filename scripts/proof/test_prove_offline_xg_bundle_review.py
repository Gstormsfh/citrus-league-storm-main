"""Synthetic proof-orchestration failures; fake inference, no training/artifact reuse."""
from copy import deepcopy
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

spec = importlib.util.spec_from_file_location('offline_bundle_proof_review', Path(__file__).with_name('prove_offline_xg_bundle.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


@pytest.fixture
def harness(tmp_path, monkeypatch):
    monkeypatch.setattr(m, 'ROOT', tmp_path)
    results = tmp_path / 'scripts/proof/results'
    results.mkdir(parents=True)
    schema = {'version': 'synthetic', 'names': ['a'], 'categorical_names': ['shot_type']}
    checked, predictions, folds = {}, {}, {}
    for n, fold in enumerate(('fold1', 'fold2')):
        source = tmp_path / m.reuse.CONDITIONAL / fold
        source.mkdir(parents=True)
        for name, value in [('model.json', {'design': {'schema': schema}}), ('calibrators.json', {})]:
            path = source / name
            raw = m.bundle.encode(value)
            path.write_bytes(raw)
            checked[str(path.relative_to(tmp_path))] = m.bundle.sha(raw)
        rows = [dict(game_id=2018020059, event_id=10*n+i, label=0, features=[.1], categorical={'shot_type': None}) for i in range(2)]
        folds[fold] = {'validation': {'rows': rows}}
        predictions[str(source / 'predictions.json')] = [dict(game_id=r['game_id'], event_id=r['event_id'],
            target=0, predictions={'movement_raw': .1, 'conditional_shape': .2}) for r in rows]
    closure = SimpleNamespace(checked=checked, safe=lambda name: Path(name), read=lambda name: predictions[name])
    features = SimpleNamespace(closure=closure, folds=folds, schema=schema, cache_key='synthetic', verify=lambda: None)
    monkeypatch.setattr(m.reuse, 'load', lambda root: features)
    minimal = m.bundle.encode({'schema_sha256': 'b'*64, 'model': {'design': {'schema': schema}}})
    monkeypatch.setattr(m.bundle, 'create', lambda *args, **kwargs: minimal)
    def score(body, *, expected_sha256, rows):
        return [dict(game_id=r['game_id'], event_id=r['event_id'], raw_goal_probability=.1,
                     calibrated_goal_probability=.2, publishable=False) for r in rows]
    monkeypatch.setattr(m.bundle, 'score', score)
    return SimpleNamespace(output=results/'offline-xg-bundle-proof-synthetic', features=features,
                           predictions=predictions, score=score)


def test_synthetic_happy_path(harness):
    m.run(harness.output)
    assert (harness.output / 'health.json').exists()
    assert not (harness.output / 'failure.json').exists()


def test_preexisting_empty_output_remains_untouched(harness):
    harness.output.mkdir()
    with pytest.raises(FileExistsError):
        m.run(harness.output)
    assert list(harness.output.iterdir()) == []


def test_input_bytes_must_match_pinned_digest_at_read(harness):
    key = next(iter(harness.features.closure.checked))
    harness.features.closure.checked[key] = '0' * 64
    with pytest.raises(ValueError):
        m.run(harness.output)
    assert not (harness.output / 'health.json').exists()


def test_long_source_vector_not_silently_truncated_by_zip(harness):
    harness.features.folds['fold1']['validation']['rows'][0]['features'].append(.2)
    with pytest.raises(ValueError):
        m.run(harness.output)


def test_nan_saved_calibrated_not_accepted_by_comparison(harness):
    next(iter(harness.predictions.values()))[0]['predictions']['conditional_shape'] = float('nan')
    with pytest.raises(ValueError):
        m.run(harness.output)


def test_truncated_batch_rejected(harness, monkeypatch):
    monkeypatch.setattr(m.bundle, 'score', lambda *args, **kwargs: harness.score(*args, **kwargs)[:1])
    with pytest.raises(ValueError):
        m.run(harness.output)


@pytest.mark.parametrize('call_to_break', [2, 3])
def test_reversal_and_singleton_identity_checked(harness, monkeypatch, call_to_break):
    calls = 0
    def bad(*args, **kwargs):
        nonlocal calls
        calls += 1
        result = harness.score(*args, **kwargs)
        if calls == call_to_break:
            result[0]['event_id'] = 999
        return result
    monkeypatch.setattr(m.bundle, 'score', bad)
    with pytest.raises(ValueError):
        m.run(harness.output)


def test_duplicate_source_membership_across_batches_rejected(harness, monkeypatch):
    monkeypatch.setattr(m.bundle, 'MAX_ROWS', 1)
    rows = harness.features.folds['fold1']['validation']['rows']
    rows.append(deepcopy(rows[0]))
    with pytest.raises(ValueError):
        m.run(harness.output)


def test_empty_fold_cannot_claim_full_validation_parity(harness):
    harness.features.folds['fold1']['validation']['rows'] = []
    harness.predictions[next(iter(harness.predictions))] = []
    with pytest.raises(ValueError):
        m.run(harness.output)


def test_singleton_extra_output_rejected(harness, monkeypatch):
    calls = 0
    def bad(*args, **kwargs):
        nonlocal calls
        calls += 1
        result = harness.score(*args, **kwargs)
        return result * 2 if calls == 3 else result
    monkeypatch.setattr(m.bundle, 'score', bad)
    with pytest.raises(ValueError):
        m.run(harness.output)
