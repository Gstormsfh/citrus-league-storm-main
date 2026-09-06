import copy
import json

import pytest

from projections.chronological_experiment import run_chronological_experiment
from tests.test_chronological_fit import inputs, cohort


def arguments(tmp_path):
    fit = inputs()
    return {k: fit[k] for k in ('train', 'calibration', 'schema')} | {
        'test_window': {'start': '2026-01-01', 'end': '2026-01-01'},
        'provenance': {'export_manifest_sha256': 'c'*64, 'source_inventory_sha256': 'd'*64,
                       'execution_plan_sha256': 'e'*64, 'adapter_code_sha256': 'f'*64,
                       'export_combined_inventory_sha256': 'a'*64,
                       'evidence_kind': 'synthetic'},
        'output': tmp_path / 'experiment', 'group_dimensions': ['state']}


def test_payload():
    c = cohort('test', '2026-01-01', 2025020002, 20)
    return {'cohort': c, 'groups': [{'game_id': r['game_id'], 'event_id': r['event_id'],
            'groups': {'state': None}} for r in c['rows']]}


test_payload.__test__ = False


def test_reader_is_deferred_until_fit_and_pipeline_are_persisted(tmp_path):
    args = arguments(tmp_path); calls = []
    def reader():
        calls.append(1)
        directory = args['output']
        plan = json.loads((directory/'pipeline-receipt.json').read_bytes())
        assert len(plan['fit_files']) == 7
        assert all((directory/name).is_file() for name in plan['fit_files'])
        assert plan['groups_policy']['dimensions'] == ['state']
        assert not (directory/'predictions.json').exists()
        return test_payload()
    result = run_chronological_experiment(**args, read_test=reader)
    assert calls == [1] and result['publishable'] is False
    predictions = json.loads((args['output']/'predictions.json').read_bytes())
    assert len(predictions) == 20 and len(predictions[0]['predictions']) == 6
    report = json.loads((args['output']/'scorecard.json').read_bytes())
    assert len(report['overall']['paired_differences']) == 15
    assert report['subgroups'][0]['value'] is None
    with pytest.raises(FileExistsError): run_chronological_experiment(**args, read_test=reader)
    assert calls == [1]


@pytest.mark.parametrize('bad', ['fit', 'window', 'config'])
def test_invalid_prefit_inputs_never_open_test(tmp_path, bad):
    args = arguments(tmp_path); calls = []
    if bad == 'fit': args['train']['membership_sha256'] = '0'*64
    if bad == 'window': args['test_window']['start'] = '2025-01-01'
    if bad == 'config': args['scorecard_config'] = {}
    with pytest.raises(ValueError):
        run_chronological_experiment(**args, read_test=lambda: calls.append(1))
    assert not calls


@pytest.mark.parametrize('bad', ['duplicate', 'overlap', 'hash', 'groups_missing', 'groups_duplicate', 'unknown_group', 'artifact_change'])
def test_test_failures_retain_frozen_fit_and_never_report_success(tmp_path, bad):
    args = arguments(tmp_path)
    def reader():
        payload = copy.deepcopy(test_payload())
        if bad == 'duplicate': payload['cohort']['rows'].append(payload['cohort']['rows'][0])
        if bad == 'overlap': payload['cohort']['rows'][0]['game_id'] = args['calibration']['rows'][0]['game_id']
        if bad == 'hash': payload['cohort']['membership_sha256'] = '0'*64
        if bad == 'groups_missing': payload['groups'].pop()
        if bad == 'groups_duplicate': payload['groups'].append(payload['groups'][0])
        if bad == 'unknown_group': payload['groups'][0]['groups']['other'] = 'value'
        if bad == 'artifact_change': (args['output']/'prevalence.pickle').write_bytes(b'corrupt')
        return payload
    with pytest.raises(ValueError): run_chronological_experiment(**args, read_test=reader)
    assert (args['output']/'pipeline-receipt.json').exists()
    assert (args['output']/'failure.json').exists()
    assert not (args['output']/'health.json').exists()
    assert not (args['output']/'scorecard.json').exists()


def test_single_class_test_is_descriptive_not_a_fit_rejection(tmp_path):
    from projections.chronological_fit import cohort_digests
    args = arguments(tmp_path); payload = test_payload()
    for row in payload['cohort']['rows']: row['label'] = 0
    payload['cohort'].update(cohort_digests(payload['cohort']['rows']))
    run_chronological_experiment(**args, read_test=lambda: payload)
    report = json.loads((args['output']/'scorecard.json').read_bytes())
    assert report['overall']['models']['geometry_raw']['metrics']['roc_auc']['value'] is None


def test_end_source_drift_prevents_success(tmp_path, monkeypatch):
    from projections import chronological_experiment as module
    args = arguments(tmp_path)
    original = module._code_hashes
    def reader():
        monkeypatch.setattr(module, '_code_hashes', lambda: {**original(), 'fit': '0'*64})
        return test_payload()
    with pytest.raises(ValueError, match='source changed'):
        run_chronological_experiment(**args, read_test=reader)
    assert not (args['output']/'health.json').exists()


def test_scorecard_has_frozen_single_thread_runtime(tmp_path, monkeypatch):
    from projections import chronological_experiment as module
    from threadpoolctl import threadpool_info
    args = arguments(tmp_path)
    original = module.scorecard_module.probability_scorecard
    calls = []
    def scorecard(*positional, **kwargs):
        pools = [p for p in threadpool_info() if p['user_api'] == 'blas']
        assert pools and all(p['num_threads'] <= 1 for p in pools)
        calls.append(1)
        return original(*positional, **kwargs)
    def reader():
        plan = json.loads((args['output']/'pipeline-receipt.json').read_bytes())
        assert plan['evaluation_runtime']['threads'] == 1
        assert plan['evaluation_runtime']['numpy']
        assert plan['evaluation_runtime']['threadpoolctl']
        return test_payload()
    monkeypatch.setattr(module.scorecard_module, 'probability_scorecard', scorecard)
    run_chronological_experiment(**args, read_test=reader)
    assert calls == [1]
