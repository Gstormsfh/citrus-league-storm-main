from copy import deepcopy
from types import SimpleNamespace
import hashlib
import json
import pytest

from monitoring.appearance_contract import official_summary_population, SUMMARY_URL
from monitoring.collect_toi_receipts import capture, collect_summary, collect_player, export_stored, load_stored_snapshot, STORED_COLUMNS
from projections.verified_toi_publication import build_candidate
from monitoring.collect_toi_receipts import (CATALOG_CONTRACT,DIGEST_CONTRACT,compact_rows,
    export_stored_twice,retain_export_provenance,main)
from projections.analytics_publication import fingerprint


def summary(rows=None):
    if rows is None:
        rows = [{'playerId':1,'gamesPlayed':1,'seasonId':20242025,'teamAbbrevs':'COL,CAR,DAL'}]
    return {'url':SUMMARY_URL,'status':'ok','http_status':200,
            'requested_at':'2026-09-04T23:59:59Z','observed_at':'2026-09-05T00:00:00Z',
            'params':{'isAggregate':'false','isGame':'false','start':0,'limit':100,
                      'sort':'[{"property":"playerId","direction":"ASC"}]',
                      'cayenneExp':'seasonId=20242025 and gameTypeId=2'},
            'payload':{'data':rows,'total':len(rows)}}


def response(payload):
    return SimpleNamespace(status_code=200,json=lambda:payload,raise_for_status=lambda:None)


def player_receipt(pid,observed='2026-09-05T00:00:01Z'):
    log=[{'gameId':2024020001,'toi':'10:00'}]
    return {'observed_at':observed,'game_log':deepcopy(log),'source_receipt':{
        'url':f'https://api-web.nhle.com/v1/player/{pid}/game-log/20242025/2',
        'params':{},'status':'ok','http_status':200,'requested_at':observed,'observed_at':observed,
        'payload':{'gameLog':deepcopy(log),'seasonId':20242025,'gameTypeId':2}}}


def test_summary_treats_multiteam_player_as_one_independent_gp_row():
    assert official_summary_population([summary()],2024) == {1:1}
    assert official_summary_population([summary()],2025) is None


def test_incomplete_duplicate_wrong_season_or_unordered_summary_is_unavailable():
    for change in ('truncated','duplicate','wrong_season','failure','sort'):
        receipt = summary()
        if change == 'truncated':
            receipt['payload']['total'] = 2
        elif change == 'duplicate':
            receipt['payload']['data'] *= 2
            receipt['payload']['total'] = 2
        elif change == 'wrong_season':
            receipt['payload']['data'][0]['seasonId'] = 20252026
        elif change == 'failure':
            receipt['status'] = 'failed'
        else:
            receipt['params'].pop('sort')
        assert official_summary_population([receipt],2024) is None


def test_receipt_captures_failures_without_exception_secrets():
    def fail(*args,**kwargs):
        raise RuntimeError('sensitive proxy credentials')
    receipt = capture(SUMMARY_URL,{},fail)
    assert receipt['status'] == 'failed' and receipt['error_type'] == 'RuntimeError'
    assert 'sensitive' not in str(receipt)
    assert receipt['requested_at'] <= receipt['observed_at']


def test_summary_pagination_is_exact_and_retains_failed_page():
    rows = [{'playerId':pid,'gamesPlayed':1,'seasonId':20242025} for pid in range(1,102)]
    calls = []
    def request(url,params,**kwargs):
        calls.append(params)
        start = params['start']
        return response({'data':rows[start:start + 100],'total':101})
    pages = collect_summary(2024,request,lambda:None)
    assert len(official_summary_population(pages,2024)) == 101
    assert [p['start'] for p in calls] == [0,100]
    pages[1]['payload']['total'] = 102
    assert official_summary_population(pages,2024) is None


def test_player_failure_still_has_explicit_receipt_and_null_log():
    def request(*args,**kwargs):
        raise TimeoutError()
    receipt = collect_player(1,2024,request)
    assert receipt['game_log'] is None
    assert receipt['source_receipt']['error_type'] == 'TimeoutError'


def test_candidate_uses_summary_for_historical_traded_players_and_full_population():
    pages = [summary([{'playerId':pid,'gamesPlayed':1,'seasonId':20242025,
                       'teamAbbrevs':'COL,CAR,DAL'} for pid in (1,2)])]
    evidence = {pid:player_receipt(pid) for pid in (1,2)}
    stored = [{'season':2024,'player_id':1,'game_id':2024020001,'nhl_toi_seconds':600}]
    prepared = build_candidate([1,2],stored,evidence,2024,'2026-09-05T00:00:02Z','a'*40,
                               summary_receipts=pages,stored_observed_at='2026-09-04T00:00:00Z')
    assert prepared[2][0]['value'] == 10
    assert prepared[2][1]['reason'] == 'event_set_mismatch'
    assert prepared[1]['validation']['coverage'] == {
        'expected':2,'receipts':2,'available':1,'withheld':1,
        'official_population_complete':True,'official_players':2}
    assert prepared[1]['validation']['freshness_observed_at'] == '2026-09-04T00:00:00+00:00'
    import pytest
    with pytest.raises(ValueError,match='omits official'):
        build_candidate([1],stored,{1:evidence[1]},2024,'2026-09-05T00:00:02Z','a'*40,
                        summary_receipts=pages)


def test_freshness_includes_first_summary_receipt_before_player_logs():
    pages = [summary()]
    rows = [{'season':2024,'player_id':1,'game_id':2024020001,'nhl_toi_seconds':600}]
    evidence = {1:player_receipt(1,'2026-09-05T00:05:00Z')}
    prepared = build_candidate([1],rows,evidence,2024,'2026-09-05T00:06:00Z','a'*40,
                               summary_receipts=pages,stored_observed_at='2026-09-05T00:02:00Z')
    assert prepared[1]['validation']['freshness_observed_at'] == '2026-09-05T00:00:00+00:00'
    assert prepared[0]['observed_at'] == '2026-09-05T00:05:00+00:00'


def test_export_failure_aborts_instead_of_silently_freezing_partial_population():
    class Db:
        def select_exact(self,table,**kwargs):
            assert kwargs['select'] != '*'
            assert kwargs['order'] == 'game_id.asc,player_id.asc'
            if kwargs['offset'] == 0:
                return [{'is_goalie':False}] * 1000
            raise RuntimeError('incomplete page')
    import pytest
    with pytest.raises(RuntimeError,match='incomplete page'):
        export_stored(Db(),2024)


def test_compact_manifest_and_original_snapshot_load_with_exact_population(tmp_path):
    import json
    part = [[2024,1,2024020001,False,600],[2024,2,2024020001,False,None]]
    manifest = {'columns':STORED_COLUMNS,'parts':['part-0.json'],'expected_rows':2,
                'observed_at':'2026-09-05T00:00:00Z','consistency':'paged observation'}
    (tmp_path / 'part-0.json').write_text(json.dumps(part))
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(manifest))
    loaded = load_stored_snapshot(path,2024)
    assert loaded['rows'][0]['nhl_toi_seconds'] == 600
    assert loaded['rows'][1]['nhl_toi_seconds'] is None
    path.write_text(json.dumps({'rows':loaded['rows'],'observed_at':manifest['observed_at']}))
    assert len(load_stored_snapshot(path,2024)['rows']) == 2


def test_compact_manifest_rejects_escape_count_type_and_length_errors(tmp_path):
    import json
    import pytest
    base = {'columns':STORED_COLUMNS,'parts':['part-0.json'],'expected_rows':1,
            'observed_at':'2026-09-05T00:00:00Z'}
    path = tmp_path / 'manifest.json'
    for case in ('escape','absolute','duplicate_part','count','length','toi_bool','goalie','season','duplicate_row'):
        manifest = deepcopy(base)
        part = [[2024,1,2024020001,False,600]]
        if case == 'escape': manifest['parts'] = ['../part-0.json']
        elif case == 'absolute': manifest['parts'] = [str(tmp_path / 'part-0.json')]
        elif case == 'duplicate_part': manifest['parts'] *= 2
        elif case == 'count': manifest['expected_rows'] = 2
        elif case == 'length': part[0].pop()
        elif case == 'toi_bool': part[0][-1] = True
        elif case == 'goalie': part[0][3] = True
        elif case == 'season': part[0][0] = 2025
        else:
            part *= 2
            manifest['expected_rows'] = 2
        (tmp_path / 'part-0.json').write_text(json.dumps(part))
        path.write_text(json.dumps(manifest))
        with pytest.raises(ValueError):
            load_stored_snapshot(path,2024)


PROJECT='a'*20
REFERENCE='2026-09-06T00:00:00Z'


def catalog_fixture(tmp_path):
    part=[[2024,1,2024020001,False,600],[2024,2,2024020001,False,None]]
    data=json.dumps(part).encode()
    (tmp_path/'part.json').write_bytes(data)
    boundary={'row_count':2,'rows_sha256':fingerprint(part),'observed_at':'2026-09-05T00:00:01Z'}
    manifest={'contract':CATALOG_CONTRACT,'project_ref':PROJECT,'season':2024,
        'digest_contract':DIGEST_CONTRACT,'consistency':'paged-observation-not-transactional',
        'columns':STORED_COLUMNS,'parts':['part.json'],'parts_sha256':{'part.json':hashlib.sha256(data).hexdigest()},
        'expected_rows':2,'observed_at':'2026-09-05T00:00:00Z',
        'export_completed_at':'2026-09-05T00:00:03Z','boundary_before':deepcopy(boundary),
        'boundary_after':{**boundary,'observed_at':'2026-09-05T00:00:02Z'}}
    path=tmp_path/'manifest.json'
    path.write_text(json.dumps(manifest))
    return path,manifest


def load_catalog(path,**kwargs):
    return load_stored_snapshot(path,2024,mode='catalog',expected_project_ref=PROJECT,
                                reference_now=REFERENCE,**kwargs)


def test_catalog_proves_exact_recorded_boundaries_and_parts_without_transaction_claim(tmp_path):
    path,_=catalog_fixture(tmp_path)
    loaded=load_catalog(path)
    provenance=loaded['export_provenance']
    assert provenance['catalog_verified'] is True and provenance['mode']=='catalog'
    assert provenance['consistency']=='paged-observation-not-transactional'
    assert provenance['rows_sha256']==fingerprint(compact_rows(loaded['rows']))
    assert provenance['manifest_sha256']==hashlib.sha256(path.read_bytes()).hexdigest()
    materialized=tmp_path/'materialized.json'
    materialized.write_text(json.dumps(loaded))
    assert load_stored_snapshot(materialized,2024)['export_provenance']['catalog_verified'] is False


@pytest.mark.parametrize('case',['project','season','naive','future','reversed','boundary_time',
    'boundary_count','boundary_digest','part_hash','missing_hash','extra_hash','count_bool','order','contract'])
def test_catalog_rejects_false_provenance(tmp_path,case):
    path,manifest=catalog_fixture(tmp_path)
    if case=='project': manifest['project_ref']='b'*20
    elif case=='season': manifest['season']=2025
    elif case=='naive': manifest['observed_at']='2026-09-05T00:00:00'
    elif case=='future': manifest['export_completed_at']='2099-09-05T00:00:00Z'
    elif case=='reversed': manifest['export_completed_at']=manifest['observed_at']
    elif case=='boundary_time': manifest['boundary_after']['observed_at']='2026-09-04T00:00:00Z'
    elif case=='boundary_count': manifest['boundary_before']['row_count']=1
    elif case=='boundary_digest': manifest['boundary_after']['rows_sha256']='0'*64
    elif case=='part_hash': manifest['parts_sha256']['part.json']='0'*64
    elif case=='missing_hash': manifest.pop('parts_sha256')
    elif case=='extra_hash': manifest['parts_sha256']['other.json']='0'*64
    elif case=='count_bool': manifest['boundary_after']['row_count']=True
    elif case=='contract': manifest.pop('contract')
    else:
        rows=json.loads((tmp_path/'part.json').read_text())[::-1]
        data=json.dumps(rows).encode()
        (tmp_path/'part.json').write_bytes(data)
        manifest['parts_sha256']['part.json']=hashlib.sha256(data).hexdigest()
        for key in ('boundary_before','boundary_after'): manifest[key]['rows_sha256']=fingerprint(rows)
    path.write_text(json.dumps(manifest))
    with pytest.raises((ValueError,KeyError)):
        load_catalog(path)


def test_catalog_cannot_downgrade_mode_and_legacy_cannot_claim_catalog(tmp_path):
    path,manifest=catalog_fixture(tmp_path)
    with pytest.raises(ValueError,match='explicit catalog'):
        load_stored_snapshot(path,2024)
    manifest.pop('contract')
    manifest.pop('parts_sha256')
    manifest['export_provenance']={'catalog_verified':True}
    path.write_text(json.dumps(manifest))
    loaded=load_stored_snapshot(path,2024,mode='legacy')
    assert loaded['export_provenance']['catalog_verified'] is False
    assert 'parts_sha256' not in loaded['export_provenance']
    with pytest.raises(ValueError):
        load_catalog(path)


def test_catalog_rejects_part_symlink_and_duplicate_file_identity(tmp_path):
    path,manifest=catalog_fixture(tmp_path)
    (tmp_path/'link.json').symlink_to(tmp_path/'part.json')
    manifest['parts']=['link.json']
    manifest['parts_sha256']={'link.json':manifest['parts_sha256']['part.json']}
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError,match='local basenames'):
        load_catalog(path)


def test_catalog_rejects_hardlinked_duplicate_parts(tmp_path):
    import os
    path,manifest=catalog_fixture(tmp_path)
    os.link(tmp_path/'part.json',tmp_path/'alias.json')
    manifest['parts'].append('alias.json')
    manifest['parts_sha256']['alias.json']=manifest['parts_sha256']['part.json']
    manifest['expected_rows']=4
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError,match='unique local files'):
        load_catalog(path)


@pytest.mark.parametrize('changed',[False,True])
def test_direct_rest_requires_two_identical_full_reads(changed):
    class Db:
        url=f'https://{PROJECT}.supabase.co'
        calls=0
        def select_exact(self,*args,**kwargs):
            self.calls+=1
            assert ('is_goalie','eq',False) in kwargs['filters']
            return [{'season':2024,'player_id':1,'game_id':2024020001,'is_goalie':False,
                     'nhl_toi_seconds':601 if changed and self.calls==2 else 600}]
    db=Db()
    if changed:
        with pytest.raises(ValueError,match='changed between'):
            export_stored_twice(db,2024,PROJECT)
    else:
        stored=export_stored_twice(db,2024,PROJECT)
        assert stored['export_provenance']['mode']=='rest-double-read'
        assert stored['export_provenance']['catalog_verified'] is False
        assert stored['export_provenance']['consistency']=='paged-observation-not-transactional'
    assert db.calls==2


def test_wrong_project_fails_before_any_rest_read():
    db=SimpleNamespace(url='https://'+'b'*20+'.supabase.co',select_exact=lambda *args,**kwargs:pytest.fail('unexpected read'))
    with pytest.raises(ValueError,match='expected project'):
        export_stored_twice(db,2024,PROJECT)


def test_export_provenance_changes_immutable_identity_and_is_retained():
    rows=[{'season':2024,'player_id':1,'game_id':2024020001,'nhl_toi_seconds':600}]
    prepared=build_candidate([1],rows,{1:player_receipt(1)},2024,'2026-09-05T00:00:02Z','a'*40,summary_receipts=[summary()])
    provenance={'mode':'legacy','catalog_verified':False}
    enriched=retain_export_provenance(prepared,provenance)
    assert enriched[0]['payload']['stored_export_provenance']==provenance
    assert enriched[0]['id']!=prepared[0]['id'] and enriched[1]['id']!=prepared[1]['id']
    assert enriched[1]['validation']['freshness_observed_at']==prepared[1]['validation']['freshness_observed_at']


def test_top_level_validation_failure_records_health_without_exception_text(tmp_path,monkeypatch):
    import monitoring.collect_toi_receipts as collector
    monkeypatch.setattr(collector,'load_stored_snapshot',lambda *args,**kwargs:(_ for _ in ()).throw(ValueError('secret credentials')))
    output=tmp_path/'new-output'
    assert main(['--season','2024','--output-dir',str(output),'--code-revision','a'*40,
                 '--stored-snapshot',str(tmp_path/'bad.json')])==2
    health=(output/'failure-health.json').read_text()
    assert 'secret' not in health and json.loads(health)['snapshot_complete'] is False
    assert not (output/'candidate.json').exists()
