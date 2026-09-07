from copy import deepcopy
import pytest
from check_analytics_input_coverage import initial, check, scope, LEDGER
import json


def fixture():
    current = {'source_sha256': {'source.py': 'a'}, 'items': {'field:x': {'name': 'x'}}}
    return initial(current), current


def test_coverage_is_not_acceptance():
    ledger, current = fixture()
    result = check(ledger, current)
    assert result['accepted'] is False and result['open_decisions_and_gates'] == 7
    with pytest.raises(ValueError, match='Acceptance blocked'):
        check(ledger, current, require_accepted=True)


@pytest.mark.parametrize('change', ['added', 'removed', 'expression', 'source'])
def test_inventory_drift_fails(change):
    ledger, current = fixture()
    current = deepcopy(current)
    if change == 'added': current['items']['field:y'] = {'name': 'y'}
    if change == 'removed': current['items'].clear()
    if change == 'expression': current['items']['field:x']['name'] = 'changed'
    if change == 'source': current['source_sha256']['source.py'] = 'b'
    with pytest.raises(ValueError, match='inventory changed'):
        check(ledger, current)


def test_silently_omitting_field_fails():
    ledger, current = fixture()
    ledger['items'].clear()
    with pytest.raises(ValueError, match='tracked inputs'):
        check(ledger, current)


@pytest.mark.parametrize('status', ['verified', 'not_applicable'])
def test_closing_or_exempting_without_evidence_fails(status):
    ledger, current = fixture()
    ledger['items']['field:x']['gates']['source_semantics']['status'] = status
    with pytest.raises(ValueError, match='requires evidence'):
        check(ledger, current)


def test_repository_inventory_still_covered():
    assert check(json.loads(LEDGER.read_text()), scope())['status'] == 'coverage_reconciled_only'


def test_recorded_penalty_channels_are_separate_obligations():
    items = scope()['items']
    for channel in ('same_team', 'opponent'):
        for field in ('prior_event_id', 'penalty_team_id', 'recorded_type_code',
                      'recorded_duration_minutes', 'seconds_since_recorded_penalty_event', 'availability'):
            key = 'new_penalty_context:' + channel + ':' + field
            assert items[key]['kind'] == 'recorded_annotation_not_active_penalty'
    for name in ('pre_shot_penalty_context.py', 'conditional_calibration_shape.py'):
        assert 'new_component:' + name in items


def test_bundle_and_reuse_are_explicit_unaccepted_ledger_contracts():
    ledger = json.loads(LEDGER.read_text())
    assert LEDGER.name.endswith('-v9.json')
    for module in ('offline_xg_bundle', 'verified_movement_reuse', 'verified_movement_reuse_v2', 'xg_candidate_inference'):
        assert 'new_component:' + module + '.py' in ledger['items']
        fields = [key for key in ledger['items'] if key.startswith('new_offline_contract:' + module + ':')]
        assert fields
        assert all(ledger['items'][key]['disposition'] == 'unresolved' for key in fields)


def test_verified_reuse_v2_runtime_and_dataclass_seal_are_explicit():
    current = scope()
    assert 'new_component:verified_movement_reuse_v2.py' in current['items']
    for field in ('runtime', 'python', 'numpy', 'scipy', 'sklearn',
                  'folds', 'groups', 'schema', 'config', 'cache_key', 'closure', 'content_seal'):
        assert 'new_offline_contract:verified_movement_reuse_v2:' + field in current['items']
    assert 'data-pipeline/projections/verified_movement_reuse_v2.py' in current['python_source_catalog']


def test_recorded_penalty_plan_definitions_have_explicit_units_and_states():
    current = scope()
    assert 'new_component:recorded_penalty_features.py' in current['items']
    path = 'docs/analytics-recorded-penalty-candidate-plan-20260906.json'
    assert path in current['plan_source_sha256']
    fields = [value for key, value in current['items'].items() if key.startswith('recorded_penalty_predictor:')]
    assert len(fields) == 8
    numeric = [v for v in fields if v['predictor_type'] == 'numeric']
    categorical = [v for v in fields if v['predictor_type'] == 'categorical']
    assert len(numeric) == len(categorical) == 4
    assert {v['definition']['unit'] for v in numeric} == {'seconds', 'recorded minutes'}
    for item in fields:
        assert item['definition']['source'].startswith('annotation.')
        assert item['mapping_module'].endswith('recorded_penalty_features.py')
    states = [v for v in categorical if v['definition']['name'].endswith('__annotation_state')]
    assert len(states) == 2 and all('unknown status/reason is fatal' in v['definition']['rule'] for v in states)
