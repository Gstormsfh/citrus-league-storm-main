"""No-fit author tests including actual filesystem byte/inventory corruption."""
import copy
import hashlib
import json
import math
import pytest

import audit_prior_sog_fidelity as audit


def event(eid, code=506, seconds=1, team=1):
    return {'eventId': eid, 'sortOrder': eid, 'typeCode': code,
        'periodDescriptor': {'number': 1, 'periodType': 'REG'}, 'timeInPeriod': f'00:{seconds:02d}',
        'details': {'eventOwnerTeamId': team, 'xCoord': 1, 'yCoord': 2}}


def source(eid, state='1', goal=0):
    return {'game_id': 1, 'event_id': eid, 'game_date': '2022-10-01', 'target': goal,
        'context': {'prior_sog_same_team': state}, 'groups': {'prior_sog_same_team': audit.GROUPS[state]}}


def saved(eid, state='1', goal=0):
    r = source(eid, state, goal)
    return {k: r[k] for k in ('game_id', 'event_id', 'target', 'groups')} | {'predictions': {'fixed': .1, 'expanding': .11}}


def game(plays):
    return {'id': 1, 'gameDate': '2022-10-01', 'homeTeam': {'id': 1}, 'awayTeam': {'id': 2}, 'plays': plays}


def test_immediate_raw_stoppage_retained_not_previous_shot():
    selected = audit.join_saved([source(3, None)], [saved(3, None)])
    rows = audit.audit_game(game([event(1), event(2, 516, 2), event(3, seconds=3)]), selected, 'a'*64)
    assert rows[0]['predecessor_event_id'] == 2
    assert rows[0]['classification']['expected_state'] is None
    assert rows[0]['classification']['reason'] == 'prior_type_outside_baseline_live_set'


def test_long_gap_preserves_same_team_state_and_accounts():
    rows = audit.audit_game(game([event(1), event(2, seconds=20)]), audit.join_saved([source(2)], [saved(2)]), 'a'*64)
    assert rows[0]['classification']['expected_state'] == '1'
    assert rows[0]['classification']['gap_band'] == 'over_10s'
    report = audit.aggregate(rows)
    assert report['overall']['events'] == 1
    assert report['overall']['models']['fixed']['brier'] == pytest.approx(.01)
    assert report['overall']['models']['fixed']['log_loss_clipped'] == pytest.approx(-math.log(.9))


def test_missed_attempt_is_retained_but_prior_miss_is_not_prior_sog():
    rows = audit.audit_game(game([event(1), event(2, 507)]), audit.join_saved([source(2)], [saved(2)]), 'a'*64)
    assert rows[0]['target'] == 0
    rows = audit.audit_game(game([event(1, 507), event(2)]), audit.join_saved([source(2, '0')], [saved(2, '0')]), 'a'*64)
    assert rows[0]['classification']['expected_state'] == '0'


def test_game_date_and_shootout_fail_closed():
    selected = audit.join_saved([source(2)], [saved(2)])
    body = game([event(1), event(2)]); body['gameDate'] = '2023-01-01'
    with pytest.raises(ValueError, match='game date'): audit.audit_game(body, selected, 'a'*64)
    body = game([event(1), event(2)])
    for p in body['plays']: p['periodDescriptor']['periodType'] = 'SO'
    with pytest.raises(ValueError, match='Shootout'): audit.audit_game(body, selected, 'a'*64)


@pytest.mark.parametrize('change', [lambda r: r.update(target=True), lambda r: r.update(event_id=True),
    lambda r: r['predictions'].update(fixed=float('nan')), lambda r: r['predictions'].update(other=.1),
    lambda r: r['groups'].update(prior_sog_same_team=None)])
def test_saved_join_rejects_bad_members(change):
    r = saved(2); change(r)
    with pytest.raises((ValueError, KeyError)): audit.join_saved([source(2)], [r])


def test_duplicate_and_missing_saved_events():
    with pytest.raises(ValueError): audit.join_saved([source(2), source(2)], [saved(2)])
    with pytest.raises(ValueError): audit.join_saved([source(2)], [saved(3)])


@pytest.mark.parametrize('change', [lambda p: p.reverse(), lambda p: p[1].update(sortOrder=1),
    lambda p: p[1].update(timeInPeriod='00:00'), lambda p: p[1].update(eventId=1),
    lambda p: p[1]['periodDescriptor'].update(periodType='OT')])
def test_raw_order_fail_closed(change):
    plays = [event(1), event(2, seconds=2)]; change(plays)
    with pytest.raises(ValueError): audit.audit_game(game(plays), audit.join_saved([source(2)], [saved(2)]), 'a'*64)


def test_missing_raw_event_and_state_mismatch():
    selected = audit.join_saved([source(2)], [saved(2)])
    with pytest.raises(ValueError): audit.audit_game(game([event(1)]), selected, 'a'*64)
    with pytest.raises(ValueError): audit.audit_game(game([event(1, team=2), event(2)]), selected, 'a'*64)


def test_classification_happens_before_outcome_reconciliation():
    calls = []
    def classifier(current, previous, home, away):
        calls.append(current['eventId']); return audit.classify(current, previous, home, away)
    with pytest.raises(ValueError, match='target mismatch'):
        audit.audit_game(game([event(1), event(2, 505)]), audit.join_saved([source(2)], [saved(2)]), 'a'*64, classifier)
    assert calls == [2]


def test_sparse_null_and_joint_conservation():
    a = audit.audit_game(game([event(1), event(2)]), audit.join_saved([source(1, None), source(2)], [saved(1, None), saved(2)]), 'a'*64)
    report = audit.aggregate(a)
    for cells in report['rollups'].values():
        assert sum(r['events'] for r in cells) == 2
        assert all(r['support'] == 'sparse' for r in cells)
        for metric in ('brier', 'log_loss_clipped'):
            assert sum(r['weighted_contributions'][metric] for r in cells) == pytest.approx(report['overall']['expanding_minus_fixed'][metric])
    assert any(r['cell'] == [None] for r in report['rollups']['state'])
    assert audit.aggregate(list(reversed(a))) == report


def test_pin_run_genuine_bytes_inventory_and_end_drift(tmp_path):
    directory = tmp_path/'run'; directory.mkdir()
    body = b'{"x":1}'; (directory/'body.json').write_bytes(body)
    health = {'status': 'complete', 'publishable': False, 'files': {'body.json': hashlib.sha256(body).hexdigest()}}
    raw = json.dumps(health).encode(); (directory/'health.json').write_bytes(raw)
    sha = hashlib.sha256(raw).hexdigest(); closure = audit.Closure(tmp_path)
    audit.pin_run(closure, 'run', sha, 'complete')
    (directory/'body.json').write_bytes(b'{"x":2}')
    with pytest.raises(ValueError): closure.verify()
    with pytest.raises(ValueError): audit.pin_run(audit.Closure(tmp_path), 'run', sha, 'complete')
    (directory/'body.json').write_bytes(body); (directory/'extra').write_bytes(b'x')
    with pytest.raises(ValueError): audit.pin_run(audit.Closure(tmp_path), 'run', sha, 'complete')


def test_existing_output_does_not_gain_failure_receipt(tmp_path, monkeypatch):
    monkeypatch.setattr(audit, 'ROOT', tmp_path)
    output = tmp_path/'scripts/proof/results/prior-sog-fidelity-existing'; output.mkdir(parents=True)
    with pytest.raises(FileExistsError): audit.run(output)
    assert list(output.iterdir()) == []


def test_genuine_health_pinned_first_game_full_selected_population():
    def read(name, sha):
        raw = (audit.ROOT/name).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == sha
        return json.loads(raw)
    health = read(audit.SOURCE+'/health.json', audit.SOURCE_SHA)
    source = read(audit.SOURCE+'/fold1/source-validation.json', health['files']['fold1/source-validation.json'])
    predictions = read(audit.SOURCE+'/fold1/predictions.json', health['files']['fold1/predictions.json'])
    manifest = read(audit.SOURCE+'/source-reuse.json', health['files']['source-reuse.json'])
    gid = min(r['game_id'] for r in source)
    selected = audit.join_saved([r for r in source if r['game_id'] == gid], [r for r in predictions if r['game_id'] == gid])
    name = f'{audit.FREEZE}/{gid//1000000}/pbp/{gid}.body.json'
    body = read(name, manifest['checked'][name])
    rows = audit.audit_game(body, selected, manifest['checked'][name])
    assert len(rows) == len(selected)
    assert any(p['typeCode'] == 507 and p['eventId'] in {r['event_id'] for r in rows} for p in body['plays'])
    assert all(body['plays'][r['raw_play_index']-1]['eventId'] == r['predecessor_event_id'] for r in rows if r['raw_play_index'])
