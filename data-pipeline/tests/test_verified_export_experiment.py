"""Actual adapter/source replay on small synthetic frozen files, never real fit."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest
from projections.analytics_publication import fingerprint
from projections import verified_export_experiment as adapter
from tests.test_compact_feature_export import freeze, run


def setup(tmp_path):
    root = freeze(tmp_path)
    export = tmp_path / 'export'
    run(root, export)
    original = Path(__file__).resolve().parents[2] / 'docs/analytics-first-neutral-experiment-plan-20260906.json'
    plan = json.loads(original.read_bytes())
    plan['source_seasons'] = [2023, 2024, 2025]
    plan_path = tmp_path / 'plan.json'
    plan_path.write_text(json.dumps(plan))
    return root, export, plan_path


def rebind_export(export, name):
    path = export / 'export-manifest.json'
    m = json.loads(path.read_bytes())
    body = (export / name).read_bytes()
    m['output_files'][name].update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
    m['manifest_content_sha256'] = fingerprint({k: v for k, v in m.items() if k != 'manifest_content_sha256'})
    path.write_text(json.dumps(m))


def test_replay_exact_source_and_explicit_boolean_and_unknowns(tmp_path):
    root, export, plan = setup(tmp_path)
    reader = adapter.ReplayedExport(export, root, plan)
    result = reader.load_split('train')
    assert len(result['cohort']['rows']) == 2
    first = result['cohort']['rows'][0]
    assert first['features'][4:6] == [0, 0]
    assert all(type(v) is not bool for v in first['features'])
    assert result['groups'][0]['groups']['rebound'] is None
    assert result['groups'][0]['groups']['defending_empty_net'] == 'goalie_present'
    assert reader.replays['train']['counts']['games'] == 1
    assert 'test' not in reader.replays
    with pytest.raises(ValueError, match='once'):
        reader.load_split('train')


def test_training_reader_never_parses_test_or_combined_inventory(tmp_path, monkeypatch):
    root, export, plan = setup(tmp_path)
    original = adapter.json_lines
    opened = []
    def guarded(path):
        opened.append(Path(path).name)
        assert not Path(path).name.startswith('test.')
        assert Path(path).name != 'game-inventory.jsonl'
        return original(path)
    monkeypatch.setattr(adapter, 'json_lines', guarded)
    reader = adapter.ReplayedExport(export, root, plan)
    reader.load_split('train')
    reader.load_split('calibration')
    assert set(opened) == {'train.features.jsonl', 'train.game-inventory.jsonl',
                           'calibration.features.jsonl', 'calibration.game-inventory.jsonl'}


@pytest.mark.parametrize('field', ['label', 'features', 'eligibility', 'event_hash'])
def test_rehashed_export_lies_rejected_against_actual_source(tmp_path, field):
    root, export, plan = setup(tmp_path)
    path = export / 'train.features.jsonl'
    rows = [json.loads(line) for line in path.read_bytes().splitlines()]
    row = rows[0]
    if field == 'label': row['label'] = not row['label']
    if field == 'features': row['features']['distance_to_goal_ft'] = 12
    if field == 'eligibility': row['cohort_eligibility']['geometry_baseline'] = False
    if field == 'event_hash': row['source_event_sha'] = 'f' * 64
    row['feature_sha'] = fingerprint({k: v for k, v in row.items() if k != 'feature_sha'})
    path.write_text(''.join(json.dumps(r) + '\n' for r in rows))
    rebind_export(export, path.name)
    reader = adapter.ReplayedExport(export, root, plan)
    with pytest.raises(ValueError, match='independent source replay'):
        reader.load_split('train')


def test_rehashed_missing_source_event_inventory_rejected(tmp_path):
    root, export, plan = setup(tmp_path)
    path = export / 'train.game-inventory.jsonl'
    game = json.loads(path.read_bytes())
    game['stream_inventory'].pop()
    path.write_text(json.dumps(game) + '\n')
    rebind_export(export, path.name)
    with pytest.raises(ValueError, match='game inventory'):
        adapter.ReplayedExport(export, root, plan).load_split('train')


@pytest.mark.parametrize('change', ['source', 'export', 'plan', 'schedule'])
def test_after_replay_drift_rejected(tmp_path, change):
    root, export, plan = setup(tmp_path)
    reader = adapter.ReplayedExport(export, root, plan)
    reader.load_split('train')
    path = {'source': root / '2023/pbp/2023020001.body.json',
            'export': export / 'train.features.jsonl', 'plan': plan,
            'schedule': root / 'schedule-manifest.json'}[change]
    path.write_bytes(path.read_bytes() + b' ')
    with pytest.raises(ValueError): reader.verify_unchanged()


def test_bool_encoding_is_narrow_and_schema_is_exact():
    schema = {'version': 'test', 'names': list(adapter.FEATURES)}
    row = {'features': {name: None for name in adapter.FEATURES}}
    row['features']['shooting_empty_net'] = True
    assert adapter.encode_features(row, schema)[4] == 1
    row['features']['distance_to_goal_ft'] = True
    with pytest.raises(ValueError): adapter.encode_features(row, schema)
    row['features']['distance_to_goal_ft'] = 1
    row['features']['shooting_empty_net'] = 1
    with pytest.raises(ValueError): adapter.encode_features(row, schema)
    other = deepcopy(schema); other['names'].reverse()
    with pytest.raises(ValueError): adapter.encode_features(row, other)


@pytest.mark.parametrize('body', [b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}'])
def test_strict_json_rejects_hidden_coercion(body):
    with pytest.raises(ValueError): adapter.strict_json(body)


def test_declared_fit_cannot_silently_change(tmp_path):
    root, export, plan_path = setup(tmp_path)
    plan = json.loads(plan_path.read_bytes())
    plan['fit']['context']['max_iter'] = 201
    plan_path.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match='configuration differs'):
        adapter.ReplayedExport(export, root, plan_path)


@pytest.mark.parametrize('change', ['population', 'boolean_encoding', 'predictors'])
def test_declared_semantic_policy_cannot_silently_differ(tmp_path, change):
    root, export, path = setup(tmp_path)
    plan = json.loads(path.read_bytes())
    if change == 'population': plan['population']['context_missing_policy'] = 'fill_zero'
    if change == 'boolean_encoding': plan['schema']['boolean_encoding']['shooting_empty_net'] = 'inverted'
    if change == 'predictors': plan['evaluation']['predictors'].pop()
    path.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match='policy differs'):
        adapter.ReplayedExport(export, root, path)


def test_rehashed_whole_game_omission_rejected(tmp_path):
    root, export, plan = setup(tmp_path)
    path = export / 'train.game-inventory.jsonl'
    path.write_bytes(b'')
    rebind_export(export, path.name)
    with pytest.raises(ValueError, match='Missing/extra'):
        adapter.ReplayedExport(export, root, plan).load_split('train')


def test_complete_adapter_fit_and_deferred_test_access(tmp_path, monkeypatch):
    root, export, plan = setup(tmp_path)
    output = tmp_path / 'experiment'
    original = adapter.json_lines
    def guarded(path):
        if Path(path).name.startswith('test.'):
            assert (output / 'experiment/pipeline-receipt.json').is_file()
            assert (output / 'experiment/context.pickle').is_file()
        return original(path)
    monkeypatch.setattr(adapter, 'json_lines', guarded)
    health = adapter.execute_verified_export(export, root, plan, output)
    assert health['status'] == 'completed-source-replayed-retrospective-not-publishable'
    assert not health['publishable'] and not (output / 'failure.json').exists()
    receipt = json.loads((output / 'source-replay-receipt.json').read_bytes())
    assert set(receipt['splits']) == {'train', 'calibration', 'test'}
    assert adapter.file_sha(output / 'source-replay-receipt.json') == health['source_replay_receipt_sha256']
    with pytest.raises(FileExistsError): adapter.execute_verified_export(export, root, plan, output)


@pytest.mark.parametrize('failure', ['late_source_drift', 'receipt_persistence'])
def test_outer_completion_abstains_when_final_verification_or_receipt_fails(tmp_path, monkeypatch, failure):
    root, export, plan = setup(tmp_path)
    output = tmp_path / 'experiment'
    if failure == 'late_source_drift':
        original = adapter.run_chronological_experiment
        def run_then_drift(**kwargs):
            result = original(**kwargs)
            path = root / '2025/pbp/2025020001.body.json'
            path.write_bytes(path.read_bytes() + b' ')
            return result
        monkeypatch.setattr(adapter, 'run_chronological_experiment', run_then_drift)
    else:
        original = adapter._persist
        def persistence(directory, name, value):
            if name == 'source-replay-receipt.json': raise OSError('synthetic disk failure')
            return original(directory, name, value)
        monkeypatch.setattr(adapter, '_persist', persistence)
    with pytest.raises((ValueError, OSError)):
        adapter.execute_verified_export(export, root, plan, output)
    assert (output / 'experiment/health.json').exists()
    assert not (output / 'health.json').exists()
    assert json.loads((output / 'failure.json').read_bytes())['status'] == 'failed-source-verification-or-experiment'
