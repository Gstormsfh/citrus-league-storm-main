"""Synthetic overlay contracts; pinned real bundle validation is not model evidence."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest

from acquisition import goal_sog_adjudication as module
from acquisition.event_observation_service import prepare_observation
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint


def encoded(value):
    return json.dumps(value, allow_nan=False).encode()


def pin(monkeypatch, manifest, bundle):
    b = encoded(bundle)
    manifest['approved_bundle_sha256'] = hashlib.sha256(b).hexdigest()
    m = encoded(manifest)
    monkeypatch.setattr(module, 'APPROVED_BUNDLE_SHA256', hashlib.sha256(b).hexdigest())
    monkeypatch.setattr(module, 'APPROVED_MANIFEST_SHA256', hashlib.sha256(m).hexdigest())
    monkeypatch.setattr(module, 'APPROVED_RECORD_COUNT', 1)
    return {'manifest_bytes':m, 'approved_bundle_bytes':b}


@pytest.fixture
def synthetic(monkeypatch):
    event = {'eventId':1,'typeCode':505,'sortOrder':10,'timeInPeriod':'01:00',
             'periodDescriptor':{'number':1,'periodType':'REG'},
             'details':{'eventOwnerTeamId':1,'scoringPlayerId':10,'xCoord':82,'yCoord':7}}
    payload = {'id':2025020001,'gameType':2,'season':20252026,'gameState':'OFF',
               'homeTeam':{'id':1,'score':1,'sog':0},'awayTeam':{'id':2,'score':0,'sog':0},
               'periodDescriptor':{'number':3,'periodType':'REG'},'plays':[event]}
    receipt = {'status':'complete','observed_at':'2026-01-01T01:00:00Z',
               'prepared':list(prepare_observation(payload,'2026-01-01T01:00:00Z'))}
    raw = encoded(receipt)
    record = {'game_id':payload['id'],'source_snapshot_id':receipt['prepared'][0]['id'],
              'source_payload_sha256':fingerprint(payload),'event_id':1,
              'source_event_sha256':fingerprint(event),'team_id':1,'player_id':10,
              'period':event['periodDescriptor'],'clock':'01:00','sort_order':10,
              'original_observed_at':receipt['observed_at'],
              'original_receipt_bytes_sha256':hashlib.sha256(raw).hexdigest(),
              'goal_credit':1,'recorded_sog_contribution':0,'base_shot_model_attempt_eligible':False,
              'mechanism':'synthetic_reviewed_own_goal',
              'prior_final_game_evidence':json.loads(encoded(verify_final_game(payload)))}
    case = {'game_id':payload['id'],'source_snapshot_id':record['source_snapshot_id'],
            'source_payload_sha256':record['source_payload_sha256'],
            'original_final_game_evidence':record['prior_final_game_evidence'],
            'reviewed_event':{k:record[k] for k in ('event_id','source_event_sha256','team_id',
                              'player_id','period','clock','sort_order')},
            'recommendation':'eligible_for_explicit_versioned_event_adjudication',
            'statistical_corroboration':{'status':'corroborated'}}
    manifest = {'contract':'citrus-exact-goal-sog-adjudication-manifest-v1','records':[record]}
    bundle = {'contract':'citrus-goal-sog-statistical-review-v2','cases':[case]}
    kwargs = pin(monkeypatch,manifest,bundle)
    return raw, receipt, manifest, bundle, kwargs


def test_exact_overlay_preserves_whole_source_goal_and_coordinates(synthetic):
    raw, receipt, _, _, kwargs = synthetic
    before = deepcopy(receipt)
    result = module.adjudicate_receipt(raw, **kwargs)
    assert result['status'] == 'verified_statistical_overlay'
    assert result['source_receipt'] == json.loads(encoded(before))
    assert receipt == before
    normalized = result['source_receipt']['prepared'][1][0]
    assert normalized['is_goal'] is True and normalized['x_raw'] == 82 and normalized['y_raw'] == 7
    overlay = result['event_overlays'][0]
    assert overlay['goal_credit'] == 1 and overlay['recorded_sog_contribution'] == 0
    assert overlay['base_shot_model_attempt_eligible'] is False
    assert overlay['probability_interpretation'] == 'no_probability_assigned'
    assert 'probability' not in overlay and 'xg' not in overlay
    assert result['original_final_game_evidence']['status'] == 'quarantined'
    counts = result['adjudicated_final_game_evidence']['team_counts']['1']
    assert counts == {'goals':1,'sog':0,'shootout_goals':0}
    assert result == module.adjudicate_receipt(raw, **kwargs)
    assert result['result_sha256'] == fingerprint({k:v for k,v in result.items() if k!='result_sha256'})


@pytest.mark.parametrize('change', ['coordinate','clock','shot_type','new_time','game'])
def test_new_source_revision_never_inherits_approval(synthetic, change):
    _, receipt, _, _, kwargs = synthetic
    payload = deepcopy(receipt['prepared'][0]['payload']['pbp'])
    if change == 'coordinate': payload['plays'][0]['details']['xCoord'] = 80
    elif change == 'clock': payload['plays'][0]['timeInPeriod'] = '01:01'
    elif change == 'shot_type': payload['plays'][0]['details']['shotType'] = 'wrist'
    elif change == 'game': payload['id'] += 1
    if change == 'new_time': receipt['observed_at'] = '2026-01-02T01:00:00Z'
    receipt['prepared'] = list(prepare_observation(payload, receipt['observed_at']))
    result = module.adjudicate_receipt(encoded(receipt), **kwargs)
    assert result['status'] == 'quarantined' and result['reason'] == 'unapproved_source_revision'
    assert result['event_overlays'] == [] and result['adjudicated_final_game_evidence'] is None


@pytest.mark.parametrize('change', ['partial','prepared','duplicate_unrelated','receipt_envelope'])
def test_incomplete_or_tampered_receipt_fails_closed(synthetic, change):
    _, receipt, _, _, kwargs = synthetic
    if change == 'partial': receipt['status'] = 'unavailable'
    elif change == 'prepared': receipt['prepared'][1][0]['x_raw'] = 0
    elif change == 'receipt_envelope': receipt['url'] = 'https://wrong.example'
    else:
        payload = receipt['prepared'][0]['payload']['pbp']
        payload['plays'].append({'eventId':1,'typeCode':502})
        receipt['prepared'] = list(prepare_observation(payload, receipt['observed_at']))
    with pytest.raises(ValueError): module.adjudicate_receipt(encoded(receipt), **kwargs)


def test_artifact_pins_require_exact_bytes_not_declared_hash(synthetic):
    raw, _, _, _, kwargs = synthetic
    for key in kwargs:
        bad = dict(kwargs); bad[key] += b' '
        with pytest.raises(ValueError, match='Unapproved'):
            module.adjudicate_receipt(raw, **bad)
    with pytest.raises(ValueError, match='bytes'):
        module.adjudicate_receipt(json.loads(raw), **kwargs)


def test_approved_population_and_prior_gate_cannot_be_weakened(synthetic, monkeypatch):
    raw, _, manifest, bundle, _ = synthetic
    manifest['records'].append(deepcopy(manifest['records'][0]))
    with pytest.raises(ValueError, match='population'):
        module.adjudicate_receipt(raw, **pin(monkeypatch,manifest,bundle))
    manifest['records'].pop()
    manifest['records'][0]['prior_final_game_evidence']['status'] = 'verified'
    with pytest.raises(ValueError):
        module.adjudicate_receipt(raw, **pin(monkeypatch,manifest,bundle))


def test_recount_keeps_shootout_bonus_separate_from_player_goals():
    def play(eid, owner, code, kind):
        return {'eventId':eid,'typeCode':code,'details':{'eventOwnerTeamId':owner},
                'periodDescriptor':{'periodType':kind}}
    payload = {'gameType':2,'periodDescriptor':{'periodType':'SO'},
               'homeTeam':{'id':1,'score':2,'sog':0},'awayTeam':{'id':2,'score':1,'sog':1},
               'plays':[play(1,1,505,'REG'),play(2,2,505,'REG'),
                        play(3,1,505,'SO'),play(4,2,506,'SO')]}
    result = module._recount(payload,1)
    assert result['status'] == 'verified'
    assert result['team_counts']['1'] == {'goals':1,'sog':0,'shootout_goals':1}
    assert result['shootout_score_bonus'] == {'1':1,'2':0}
    payload['plays'][3]['typeCode'] = 505
    with pytest.raises(ValueError, match='shootout'): module._recount(payload,1)


def test_checked_in_approval_bundle_and_manifest_match_runtime_pins():
    docs = Path(__file__).resolve().parents[2] / 'docs'
    result = module.validate_approval(
        (docs/'analytics-goal-sog-adjudications-20260906-v1.json').read_bytes(),
        (docs/'analytics-goal-sog-statistical-evidence-20260906-v2.json').read_bytes())
    assert len(result['records']) == module.APPROVED_RECORD_COUNT
