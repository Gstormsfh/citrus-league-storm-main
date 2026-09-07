import copy
import hashlib
import json
import pytest
import audit_timing_eras as audit

SCHEMA = {'names': ['immediate_previous_sog_same_team'], 'categorical_names': ['previous_event_type'], 'version': 'fixture'}


def event(eid, code=506, clock='00:01', x=2, player=1000001):
    return {'eventId': eid, 'sortOrder': eid, 'typeCode': code, 'timeInPeriod': clock,
        'periodDescriptor': {'number': 1, 'periodType': 'REG'},
        'details': {'eventOwnerTeamId': 1, 'xCoord': x, 'yCoord': 1,
            ('scoringPlayerId' if code == 505 else 'shootingPlayerId'): player}}


def body(plays):
    return {'id': 2019020001, 'season': 20192020, 'gameType': 2, 'gameDate': '2019-10-02',
            'homeTeam': {'id': 1}, 'awayTeam': {'id': 2}, 'plays': plays}


def row(eid=2, state=1, previous='506', goal=False):
    values, categories = [state], {'previous_event_type': previous}
    return {'game_id': 2019020001, 'event_id': eid, 'game_date': '2019-10-02', 'label': goal,
        'split': 'development', 'features': values, 'categorical': categories, 'source_sha256': 'c'*64,
        'feature_sha256': audit.fingerprint({'schema_sha256': audit.fingerprint(SCHEMA), 'values': values, 'categorical': categories})}


def run_game(plays, selected=None):
    return audit.audit_game(body(plays), selected or [row()], SCHEMA, 'a'*64, 'b'*64, 'c'*64)


def test_sameclock_coordinates_actor_are_diagnostics_not_predictors():
    rows = run_game([event(1), event(2)])
    r = rows[0]
    assert r['state'] == '1' and r['gap_seconds'] == 0 and r['gap_band'] == 'same_clock'
    assert r['same_raw_coordinates'] is True and r['same_actor'] is True
    assert r['actor_diagnostic_retrospective_not_predictor'] is True
    assert r['source_event_sha256'] == audit.fingerprint(event(2))
    assert 'predictions' not in r


def test_signed_coordinates_and_unknown_actors_not_fabricated():
    r = run_game([event(1, x=-2), event(2, player=None)])[0]
    assert r['same_raw_coordinates'] is False and r['same_actor'] is None
    assert r['previous_coordinates'] == [-2, 1]
    assert audit.coordinates({'details': {'xCoord': 10**1000, 'yCoord': True}}) == [None, None]
    r = run_game([event(1, x=101), event(2, x=101)])[0]
    assert r['same_raw_coordinates'] is None
    assert r['current_coordinates'] == [101, 1] and r['previous_coordinates'] == [101, 1]


def test_current_miss_retained_and_prior_miss_state_zero():
    assert run_game([event(1), event(2, 507)])[0]['target'] == 0
    assert run_game([event(1, 507), event(2)], [row(state=0, previous='507')])[0]['state'] == '0'


def test_goal_actor_uses_scoring_field():
    r = run_game([event(1), event(2, 505)], [row(goal=True)])[0]
    assert r['current_actor'] == 1000001 and r['target'] == 1
    assert audit.actor(event(3, 503)) is None


def test_no_predecessor_and_other_period_category_explicit_null():
    assert run_game([event(2)], [row(state=None, previous=None)])[0]['previous_event_id'] is None
    plays = [event(1), event(2)]; plays[1]['periodDescriptor']['number'] = 2
    r = run_game(plays, [row(state=None, previous=None)])[0]
    assert r['gap_seconds'] is None and r['previous_type'] == 506


@pytest.mark.parametrize('change', [lambda r: r.update(label=0), lambda r: r.update(source_sha256='d'*64),
    lambda r: r.update(game_date='2024-10-01'), lambda r: r['features'].__setitem__(0, 0),
    lambda r: r['categorical'].update(previous_event_type=None), lambda r: r.update(feature_sha256='e'*64)])
def test_original_export_contract_rejects_changes(change):
    r = row(); change(r)
    with pytest.raises(ValueError): run_game([event(1), event(2)], [r])


@pytest.mark.parametrize('change', [lambda p: p.reverse(), lambda p: p[1].update(sortOrder=1),
    lambda p: p[1].update(timeInPeriod='00:00'), lambda p: p[1].update(eventId=1),
    lambda p: p[1]['periodDescriptor'].update(periodType='OT')])
def test_fullraw_order_is_validated(change):
    plays = [event(1), event(2)]; change(plays)
    with pytest.raises(ValueError): run_game(plays)


def test_export_stream_unique_contiguous_games_and_season_gate():
    encode = lambda rows: [(json.dumps(r)+'\n').encode() for r in rows]
    assert list(audit.game_batches(encode([row(1), row(2)])))[0][0] == 2019020001
    with pytest.raises(ValueError): list(audit.game_batches(encode([row(), row()])))
    r = row(); r['game_id'] = 2024020001
    with pytest.raises(ValueError): list(audit.game_batches(encode([r])))
    r['game_id'] = 2020020001
    with pytest.raises(ValueError): list(audit.game_batches(encode([row(), r, row(3)])))


def test_all_rollup_counts_goals_and_nulls_conserve():
    rows = run_game([event(1), event(2)], [row(1, None, None), row()])
    accounting = audit.Accounting(); accounting.add(rows); result = accounting.finish()
    assert result['events'] == 2 and result['games'] == 1
    for cells in result['rollups'].values():
        assert sum(r['events'] for r in cells) == 2
        assert sum(r['goals'] for r in cells) == 0
    assert any(None in r['cell'] for r in result['rollups']['season_state_gap'])


def test_genuine_first_development_game_hash_domains_and_all_rows():
    def read(name, sha):
        raw = (audit.ROOT/name).read_bytes(); assert hashlib.sha256(raw).hexdigest() == sha; return json.loads(raw)
    health = read(audit.SOURCE+'/health.json', audit.SOURCE_SHA)
    checked = read(audit.SOURCE+'/checked-file-sha256.json', health['files']['checked-file-sha256.json'])
    manifest = read(audit.EXPORT+'/manifest.json', checked[audit.EXPORT+'/manifest.json'])
    with (audit.ROOT/audit.EXPORT/'development.jsonl').open('rb') as stream:
        gid, selected = next(audit.game_batches(stream))
    # Full stream SHA was independently bound by the retained complete-source health closure;
    # this smoke exercises the first game's source/row semantic hash domains, not a new full export certification.
    stem = f'{audit.FREEZE}/{gid//1000000}/pbp/{gid}'
    raw = (audit.ROOT/(stem+'.body.json')).read_bytes(); assert hashlib.sha256(raw).hexdigest() == checked[stem+'.body.json']
    receipt = read(stem+'.receipt.json', checked[stem+'.receipt.json'])
    adapted = audit.adapt_frozen_feature_source(raw, receipt, now=manifest['observed_at'])
    rows = audit.audit_game(json.loads(raw), selected, manifest['schema'], checked[stem+'.body.json'], checked[stem+'.receipt.json'], audit.fingerprint(adapted))
    assert len(rows) == len(selected) and any(r['current_type'] == 507 for r in rows)
