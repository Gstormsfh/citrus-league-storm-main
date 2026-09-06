"""Self-contained synthetic fixtures; never import legacy trainers or models."""
import json
import subprocess
import sys
from copy import deepcopy
import pytest
from acquisition.event_observation_service import prepare_observation
from projections.analytics_publication import fingerprint
from projections.causal_feature_contract import build_causal_input_contract


def frozen(*, goal=False, missing=False, date='2025-01-01'):
    plays = []
    for eid, code in [(9, 502), (2, 505 if goal else 506), (3, 506)]:
        details = {'eventOwnerTeamId': 1, 'xCoord': 0, 'yCoord': 0, 'shotType': 'wrist',
                   'homeScore': 999, 'assist1PlayerId': 777, 'reason': 'retrospective'}
        if missing:
            details.pop('shotType');details['xCoord'] = None
        plays.append({'eventId': eid, 'sortOrder': len(plays), 'typeCode': code,
                      'periodDescriptor': {'number': 1, 'periodType': 'REG'},
                      'timeInPeriod': '00:10', 'homeTeamDefendingSide': 'left',
                      'situationCode': '1551', 'details': details})
    payload = {'id': 2024020001, 'gameDate': date, 'season': 20242025, 'gameType': 2,
               'gameState': 'OFF', 'homeTeam': {'id': 1, 'score': int(goal), 'sog': 2},
               'awayTeam': {'id': 2, 'score': 0, 'sog': 0},
               'periodDescriptor': {'number': 3, 'periodType': 'REG'}, 'plays': plays}
    observed = '2026-09-05T00:00:00Z'
    return {'status': 'complete', 'game_id': payload['id'], 'observed_at': observed,
            'url': f'https://api-web.nhle.com/v1/gamecenter/{payload["id"]}/play-by-play',
            'prepared': list(prepare_observation(payload, observed))}


def build(source=None, **kwargs):
    return build_causal_input_contract(source or frozen(), evidence_kind='synthetic',
                                      exclusions=kwargs.pop('exclusions', []),
                                      now='2026-09-06T00:00:00Z', **kwargs)


def test_full_source_preserved_exact_membership_and_no_training_claim():
    source = frozen();before = json.dumps(source).encode()
    result = build(source, exclusions=[{'event_id': 3, 'reason': 'explicit_review'}])
    assert result['status'] == 'staged_not_training_ready'
    assert not result['training_ready'] and not result['publishable']
    assert not result['historical_as_of_verified']
    assert [r['event_id'] for r in result['rows']] == [2, 3]
    assert [r['event_id'] for r in result['stream_inventory']] == [9, 2, 3]
    assert result['stream_inventory'][0]['exclusion_reason'] == 'not_unblocked_attempt'
    assert result['rows'][1]['excluded_reason'] == 'explicit_review'
    assert result['source_receipt'] == source and json.dumps(source).encode() == before
    assert result['contract_sha256'] == fingerprint({k:v for k,v in result.items() if k != 'contract_sha256'})
    assert build(source, exclusions=[{'event_id': 3, 'reason': 'explicit_review'}]) == result


def test_current_outcome_and_future_events_never_enter_at_shot_context():
    no_goal, goal = build(), build(frozen(goal=True))
    a, b = no_goal['rows'][0], goal['rows'][0]
    assert a['at_shot_annotations'] == b['at_shot_annotations']
    assert a['strict_prior_context'] == b['strict_prior_context']
    assert a['retrospective_labels'] != b['retrospective_labels']
    assert [e['event_id'] for e in a['strict_prior_context']] == [9]
    assert [e['sort_order'] for e in no_goal['rows'][1]['strict_prior_context']] == [0, 1]
    for forbidden in ('homeScore', 'assist1PlayerId', 'reason', 'is_goal', 'shot_generated_rebound'):
        assert forbidden not in a['at_shot_annotations']
    assert 'event_type_code' not in a['at_shot_annotations']


def test_future_revision_changes_receipt_not_earlier_input_and_import_is_pure():
    source = frozen(); prior = build(source)
    payload = deepcopy(source['prepared'][0]['payload']['pbp'])
    payload['plays'][2]['details']['xCoord'] = 80
    source['prepared'] = list(prepare_observation(payload, source['observed_at']))
    revised = build(source)
    assert revised['contract_sha256'] != prior['contract_sha256']
    assert revised['rows'][0]['at_shot_annotations'] == prior['rows'][0]['at_shot_annotations']
    assert revised['rows'][0]['strict_prior_context'] == prior['rows'][0]['strict_prior_context']
    subprocess.run([sys.executable, '-c',
        "import sys; import projections.causal_feature_contract; "
        "assert not any(x in sys.modules for x in "
        "('joblib','xgboost','pandas','acquisition.data_acquisition','model_trainer','xa_model_trainer'))"],
        check=True, capture_output=True, text=True)


def test_missing_does_not_become_zero_or_wrist_and_no_learned_values():
    missing = build(frozen(missing=True))['rows'][0]['at_shot_annotations']
    assert missing['x_raw']['value'] is None and missing['shot_type_raw']['value'] is None
    assert missing['y_raw']['value'] == 0 and missing['y_raw']['status'] == 'observed_annotation'
    result = build()
    for family in ('rink_adjustment', 'shooting_talent', 'xa_pass_value', 'flurry_created_xg'):
        assert family in result['unavailable_families']


@pytest.mark.parametrize('exclusions', [None, {}, [{'event_id': True, 'reason': 'bad'}],
    [{'event_id': 2, 'reason': ''}], [{'event_id': 9, 'reason': 'not attempt'}],
    [{'event_id': 2, 'reason': 'x'}, {'event_id': 2, 'reason': 'y'}],
    [{'event_id': 2, 'reason': 'x', 'feature': 4}]])
def test_bad_exclusions_rejected(exclusions):
    with pytest.raises(ValueError): build(exclusions=exclusions)


@pytest.mark.parametrize('date', [None, '', '2024-01-01x', '2023-01-01', '2099-01-01'])
def test_missing_conflicting_future_date_rejected(date):
    with pytest.raises(ValueError): build(frozen(date=date))


@pytest.mark.parametrize('mutation', ['hash', 'url', 'future', 'order'])
def test_source_gate_failure_retains_source_but_no_rows(mutation):
    source = frozen()
    if mutation == 'hash': source['prepared'][0]['id'] = 'detached'
    elif mutation == 'url': source['url'] = 'https://moneypuck.com/data.csv'
    elif mutation == 'future': source['observed_at'] = '2099-01-01T00:00:00Z'
    else: source['prepared'][0]['payload']['pbp']['plays'][0]['sortOrder'] = 999
    before = deepcopy(source); result = build(source)
    assert result['status'] == 'unavailable' and result['rows'] == []
    assert result['source_receipt'] == before and source == before
