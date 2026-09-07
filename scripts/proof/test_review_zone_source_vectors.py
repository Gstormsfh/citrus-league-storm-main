import hashlib
import json
import pytest
from review_zone_source_vectors import complete_binding, in_window, prior_attempt, safe


def event(eid, code=506, owner=1, period=1):
    return {'eventId': eid, 'typeCode': code, 'details': {'eventOwnerTeamId': owner},
            'periodDescriptor': {'number': period, 'periodType': 'REG'}}


@pytest.mark.parametrize('code', [502, 509, 516, 520, 521, 524, 535, 505, 999])
def test_backward_boundary(code):
    assert prior_attempt([event(1), event(2, code), event(3)], 2) is None


def test_backward_skips_same_team_live_not_opponent_or_period():
    events = [event(1), event(2, 503), event(3)]
    assert prior_attempt(events, 2)['eventId'] == 1
    events[1] = event(2, 503, owner=2)
    assert prior_attempt(events, 2) is None
    assert prior_attempt([event(1), event(2, period=2)], 1) is None


@pytest.mark.parametrize('value,expected', [(None, False), (0, False), (.1, True), (3, True), (3.0001, False)])
def test_exact_window(value, expected):
    assert in_window(value) is expected


def fixture(candidate):
    hashes = {}
    for name in ('declaration.json', 'feature-audit.json', 'source-replay.json'):
        body = b'{}'
        (candidate / name).write_bytes(body)
        hashes[name] = hashlib.sha256(body).hexdigest()
    (candidate / 'health.json').write_text(json.dumps({'status': 'complete-zone-context-development-not-accepted',
                                                     'publishable': False, 'files': hashes}))


def test_changed_feature_artifact_rejected(tmp_path):
    fixture(tmp_path)
    assert complete_binding(tmp_path, {})['feature-audit.json'] == {}
    (tmp_path / 'feature-audit.json').write_text('{"changed":true}')
    with pytest.raises(ValueError, match='hash mismatch'):
        complete_binding(tmp_path, {})


def test_missing_health_and_failure_rejected(tmp_path):
    with pytest.raises(FileNotFoundError): complete_binding(tmp_path, {})
    fixture(tmp_path)
    (tmp_path / 'failure.json').write_text('{}')
    with pytest.raises(ValueError, match='failure'): complete_binding(tmp_path, {})


def test_symlink_rejected(tmp_path):
    (tmp_path / 'real').mkdir()
    (tmp_path / 'link').symlink_to(tmp_path / 'real')
    with pytest.raises(ValueError, match='Nonsymlink'): safe(tmp_path / 'link' / 'file.json')
