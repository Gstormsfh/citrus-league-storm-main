import json
from pathlib import Path

import pytest

from projections.analytics_publication import fingerprint
from projections.chronological_experiment import _persist, DEFAULT_SCORECARD_CONFIG, run_chronological_experiment
from projections.prospective_reservation import reserve_prospective_experiment, PREDICTORS
from projections.verified_export_experiment import DEPENDENCIES, file_sha
from projections import verified_export_experiment
from tests.test_chronological_experiment import arguments, test_payload


def completed(tmp_path, manifest_changes=None):
    root = tmp_path/'completed'; root.mkdir()
    base = Path(verified_export_experiment.__file__).resolve().parents[1]
    schema = arguments(tmp_path)['schema']
    manifest = {'contract': 'citrus-official-compact-feature-export-v1',
        'status': 'export_complete_not_fit_accepted', 'source_and_code_drift_check': 'passed',
        'publishable': False, 'historical_as_of_verified': False, 'source_failure_games': [],
        'feature_schema': schema['names'], 'schedule_manifest_sha256': 'a'*64,
        'output_files': {'game-inventory.jsonl': {'sha256': 'b'*64}},
        'code_sha256': {str((base/n).resolve()): file_sha(base/n) for n in DEPENDENCIES}}
    manifest.update(manifest_changes or {})
    manifest['manifest_content_sha256'] = fingerprint(manifest)
    manifest_sha = _persist(tmp_path, 'export.json', manifest)
    plan = {'contract': 'citrus-first-official-retrospective-experiment-plan-v1',
        'schema': schema, 'publishable': False, 'untouched_test_claim': False,
        'evaluation': {'scorecard': DEFAULT_SCORECARD_CONFIG, 'predictors': list(PREDICTORS)}}
    plan_sha = _persist(tmp_path, 'plan.json', plan)
    args = arguments(tmp_path)
    args['output'] = root/'experiment'
    args['provenance'].update(export_manifest_sha256=manifest_sha, execution_plan_sha256=plan_sha,
        source_inventory_sha256='a'*64, export_combined_inventory_sha256='b'*64,
        adapter_code_sha256=file_sha(verified_export_experiment.__file__))
    health = run_chronological_experiment(**args, read_test=test_payload)
    replay_sha = _persist(root, 'source-replay-receipt.json', {'contract': verified_export_experiment.VERSION,
        'source_and_code_drift_check': 'passed',
        'publishable': False, 'splits': {n: {'counts': {'games': 1, 'eligible_rows': 20},
            'source_replay_sha256': 'a'*64} for n in ('train', 'calibration', 'test')},
        'provenance': args['provenance']})
    _persist(root, 'health.json', {'status': 'completed-source-replayed-retrospective-not-publishable',
        'publishable': False, 'source_replay_receipt_sha256': replay_sha,
        'experiment_health_sha256': file_sha(root/'experiment/health.json'),
        'pipeline_sha256': health['pipeline_sha256']})
    return {'completed_dir': root, 'export_manifest': tmp_path/'export.json',
        'execution_plan': tmp_path/'plan.json', 'output': tmp_path/'reservation',
        'future_window': {'start': '2026-09-15', 'end': '2027-08-31'},
        'evidence_kind': 'synthetic', 'now': '2026-09-06T12:00:00Z'}


def test_all_six_reserved_create_only_without_deserialization(tmp_path, monkeypatch):
    args = completed(tmp_path)
    import pickle
    monkeypatch.setattr(pickle, 'loads', lambda *_: pytest.fail('Artifact deserialization forbidden'))
    result = reserve_prospective_experiment(**args)
    assert set(result['pipelines']) == set(PREDICTORS)
    assert result['publishable'] is False
    assert result['criteria']['automatic_acceptance'] is False
    health = json.loads((args['output']/'health.json').read_bytes())
    assert health['reservation_file_sha256'] == file_sha(args['output']/'reservation.json')
    assert not (args['output']/'failure.json').exists()
    assert result['reservation_sha256'] == fingerprint({k: v for k, v in result.items() if k != 'reservation_sha256'})
    with pytest.raises(FileExistsError): reserve_prospective_experiment(**args)


@pytest.mark.parametrize('bad', ['past', 'naive', 'future_rows', 'model', 'outer', 'replay', 'inner',
                               'plan', 'manifest', 'evidence_kind', 'failed', 'symlink', 'current_code'])
def test_incomplete_or_changed_evidence_cannot_reserve(tmp_path, monkeypatch, bad):
    args = completed(tmp_path); root = args['completed_dir']
    if bad == 'past': args['now'] = '2026-09-15T00:00:00Z'
    if bad == 'naive': args['now'] = '2026-09-06T12:00:00'
    if bad == 'future_rows': args['future_rows'] = []
    if bad == 'model': (root/'experiment/geometry.pickle').write_bytes(b'changed')
    if bad == 'outer': (root/'health.json').unlink()
    if bad == 'replay': (root/'source-replay-receipt.json').write_text('{}')
    if bad == 'inner': (root/'experiment/health.json').write_text('{}')
    if bad == 'plan': args['execution_plan'].write_text('{}')
    if bad == 'manifest': args['export_manifest'].write_text('{}')
    if bad == 'evidence_kind': args['evidence_kind'] = 'real'
    if bad == 'failed': (root/'failure.json').write_text('{}')
    if bad == 'symlink':
        path = root/'experiment/geometry.pickle'; target = tmp_path/'saved.pickle'
        path.rename(target); path.symlink_to(target)
    if bad == 'current_code':
        from projections import prospective_reservation as module
        original = module._code_hashes()
        monkeypatch.setattr(module, '_code_hashes', lambda: {**original, 'fit': '0'*64})
    with pytest.raises((ValueError, KeyError, TypeError, FileNotFoundError)):
        reserve_prospective_experiment(**args)
    assert not args['output'].exists()


@pytest.mark.parametrize('field,value', [('contract', 'unrelated'), ('source_and_code_drift_check', 'pending'),
                                        ('publishable', 0)])
def test_rehashed_wrong_replay_contract_still_rejected(tmp_path, field, value):
    args = completed(tmp_path); root = args['completed_dir']
    path = root/'source-replay-receipt.json'
    replay = json.loads(path.read_bytes()); replay[field] = value
    path.write_text(json.dumps(replay))
    outer_path = root/'health.json'; outer = json.loads(outer_path.read_bytes())
    outer['source_replay_receipt_sha256'] = file_sha(path)
    outer_path.write_text(json.dumps(outer))
    with pytest.raises(ValueError): reserve_prospective_experiment(**args)


def test_returned_criteria_do_not_alias_module_policy(tmp_path):
    from projections.prospective_reservation import CRITERIA
    result = reserve_prospective_experiment(**completed(tmp_path))
    result['criteria']['automatic_acceptance'] = True
    assert CRITERIA['automatic_acceptance'] is False


@pytest.mark.parametrize('changes', [{'contract': 'unrelated'}, {'status': 'partial'},
    {'source_and_code_drift_check': 'pending'}, {'publishable': 0},
    {'historical_as_of_verified': 0}, {'feature_schema': ['wrong']},
    {'source_failure_games': 0}, {'source_failure_games': [2025020001]}])
def test_fully_rehashed_wrong_export_semantics_rejected(tmp_path, changes):
    # Build the entire pipeline/provenance chain against these bytes, so only
    # contract semantics (not an incidental stale file hash) can reject them.
    args = completed(tmp_path, manifest_changes=changes)
    with pytest.raises(ValueError): reserve_prospective_experiment(**args)
    assert not args['output'].exists()


def test_criteria_drift_during_write_records_failure(tmp_path, monkeypatch):
    from projections import prospective_reservation as module
    args = completed(tmp_path); original = module._persist
    def persist(directory, name, value):
        result = original(directory, name, value)
        if name == 'reservation.json':
            monkeypatch.setitem(module.CRITERIA, 'future_tuning', 'changed')
        return result
    monkeypatch.setattr(module, '_persist', persist)
    with pytest.raises(ValueError, match='during persistence'):
        reserve_prospective_experiment(**args)
    assert (args['output']/'failure.json').exists()


@pytest.mark.parametrize('late_file', ['reservation.json', 'health.json'])
def test_late_persistence_failure_invalidates_even_complete_bytes(tmp_path, monkeypatch, late_file):
    from projections import prospective_reservation as module
    args = completed(tmp_path); original = module._persist
    def persist(directory, name, value):
        result = original(directory, name, value)
        if name == late_file:
            raise OSError('Injected late fsync error')
        return result
    monkeypatch.setattr(module, '_persist', persist)
    with pytest.raises(OSError): reserve_prospective_experiment(**args)
    assert (args['output']/late_file).exists()
    assert (args['output']/'failure.json').exists()


def test_cli_compact_output_and_no_clock_override(tmp_path, monkeypatch, capsys):
    from projections import prospective_reservation as module
    calls = []
    def reserve(**kwargs):
        calls.append(kwargs)
        return {'reservation_sha256': 'a'*64}
    monkeypatch.setattr(module, 'reserve_prospective_experiment', reserve)
    argv = ['--completed-dir', 'completed', '--export-manifest', 'export', '--execution-plan', 'plan',
        '--output', 'out', '--future-start', '2026-09-15', '--future-end', '2027-08-31', '--evidence-kind', 'real']
    assert module.main(argv) == 0
    assert 'now' not in calls[0]
    assert set(json.loads(capsys.readouterr().out)) == {'status', 'reservation_sha256', 'publishable'}
    with pytest.raises(SystemExit): module.main(argv+['--now', '2020-01-01'])
