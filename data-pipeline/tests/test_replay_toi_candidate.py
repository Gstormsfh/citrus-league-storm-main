from copy import deepcopy
import json

import pytest

from monitoring.appearance_contract import SUMMARY_URL
from monitoring.replay_toi_candidate import replay_candidate, file_sha256
from projections.verified_toi_publication import build_candidate
from monitoring.collect_toi_receipts import (
    CATALOG_CONTRACT, DIGEST_CONTRACT, STORED_COLUMNS, compact_rows,
    load_stored_snapshot, retain_export_provenance,
)
from projections.analytics_publication import fingerprint


def frozen_directory(path):
    path.mkdir()
    observed='2026-09-05T00:00:00Z'
    log=[{'gameId':2024020001,'toi':'10:00'}]
    evidence={1:{'observed_at':observed,'game_log':deepcopy(log),'source_receipt':{
        'url':'https://api-web.nhle.com/v1/player/1/game-log/20242025/2','params':{},
        'status':'ok','http_status':200,'requested_at':observed,'observed_at':observed,
        'payload':{'seasonId':20242025,'gameTypeId':2,'gameLog':deepcopy(log)}}}}
    pages=[{'url':SUMMARY_URL,'status':'ok','http_status':200,
            'requested_at':observed,'observed_at':observed,
            'params':{'isAggregate':'false','isGame':'false','start':0,'limit':100,
                      'sort':'[{"property":"playerId","direction":"ASC"}]',
                      'cayenneExp':'seasonId=20242025 and gameTypeId=2'},
            'payload':{'total':1,'data':[{'playerId':1,'seasonId':20242025,'gamesPlayed':1}]}}]
    rows=[{'season':2024,'player_id':1,'game_id':2024020001,'is_goalie':False,'nhl_toi_seconds':600}]
    original=build_candidate([1],rows,evidence,2024,'2026-09-05T00:01:00Z','0'*40,
                              summary_receipts=pages,stored_observed_at=observed)
    artifacts={'candidate.json':original,'stored.json':{'rows':rows,'observed_at':observed},
               'expected-players.json':[1],'summary-0.json':pages[0],'player-1.json':evidence[1]}
    for name,payload in artifacts.items():
        (path / name).write_text(json.dumps(payload))
    return original


def test_offline_replay_preserves_original_and_source_age_but_creates_new_code_revision(tmp_path):
    source=tmp_path / 'frozen'
    original=frozen_directory(source)
    digest=file_sha256(source / 'candidate.json')
    output=tmp_path / 'revision'
    health=replay_candidate(source,output,'a'*40)
    replayed=json.loads((output / 'candidate.json').read_text())
    assert replayed[1]['code_revision']=='a'*40
    assert replayed[1]['id'] != original[1]['id']
    assert replayed[1]['data_cutoff']==original[1]['data_cutoff']
    assert replayed[1]['validation']['freshness_observed_at']==original[1]['validation']['freshness_observed_at']
    assert file_sha256(source / 'candidate.json')==digest
    assert health['original_files_sha256']['candidate.json']==digest
    assert health['available']==1 and not health['network_used'] and not health['database_modified']
    assert 'monitoring/toi_source_receipt.py' in health['validator_files_sha256']


def test_offline_replay_refuses_overwrite_or_modified_frozen_receipt(tmp_path):
    source=tmp_path / 'frozen'
    frozen_directory(source)
    with pytest.raises(ValueError,match='new directory'):
        replay_candidate(source,source,'a'*40)
    player=json.loads((source / 'player-1.json').read_text())
    player['source_receipt']['payload']['gameLog'][0]['toi']='10:01'
    (source / 'player-1.json').write_text(json.dumps(player))
    output=tmp_path / 'revision'
    with pytest.raises(ValueError,match='differ from the original'):
        replay_candidate(source,output,'a'*40)
    assert not output.exists()


def provenance_directory(tmp_path, mode):
    source = tmp_path / 'frozen'
    original = frozen_directory(source)
    stored = json.loads((source / 'stored.json').read_text())
    manifest_path = None
    project = 'a' * 20
    if mode == 'legacy':
        stored = load_stored_snapshot(source / 'stored.json',2024)
    else:
        observed = stored['observed_at']
        boundary = {'row_count':1,'rows_sha256':fingerprint(compact_rows(stored['rows'])),
                    'observed_at':observed}
        provenance = {'mode':mode,'catalog_verified':False,'project_ref':project,
                      'season':2024,'consistency':'paged-observation-not-transactional',
                      'observed_at':observed,'export_completed_at':observed,
                      'boundary_before':deepcopy(boundary),'boundary_after':deepcopy(boundary),
                      'digest_contract':DIGEST_CONTRACT}
        if mode == 'catalog':
            catalog = tmp_path / 'catalog'
            catalog.mkdir()
            part = catalog / 'part-0.json'
            part.write_text(json.dumps(compact_rows(stored['rows'])))
            manifest = {key:value for key,value in provenance.items()
                        if key not in ('mode','catalog_verified')}
            manifest.update(contract=CATALOG_CONTRACT,columns=STORED_COLUMNS,
                            parts=[part.name],parts_sha256={part.name:file_sha256(part)},
                            expected_rows=1)
            manifest_path = catalog / 'manifest.json'
            manifest_path.write_text(json.dumps(manifest))
            stored = load_stored_snapshot(manifest_path,2024,mode='catalog',
                                          expected_project_ref=project)
        else:
            stored.update(project_ref=project,season=2024,export_completed_at=observed,
                          export_provenance=provenance)
    original = retain_export_provenance(original,stored['export_provenance'])
    (source / 'stored.json').write_text(json.dumps(stored))
    (source / 'candidate.json').write_text(json.dumps(original))
    return source,original,manifest_path,project


@pytest.mark.parametrize('mode',['legacy','rest-double-read','catalog'])
def test_replay_retains_bound_provenance_without_refresh(tmp_path,mode):
    source,original,manifest,project = provenance_directory(tmp_path,mode)
    kwargs = {'catalog_manifest':manifest,'expected_project_ref':project} if manifest else {}
    health = replay_candidate(source,tmp_path / 'revision','a'*40,**kwargs)
    replayed = json.loads((tmp_path / 'revision' / 'candidate.json').read_text())
    assert replayed[0]['payload']['stored_export_provenance'] == original[0]['payload']['stored_export_provenance']
    assert replayed[1]['data_cutoff'] == original[1]['data_cutoff']
    assert replayed[1]['validation']['freshness_observed_at'] == original[1]['validation']['freshness_observed_at']
    assert not health['online_export_repeated'] and not health['network_used']
    if manifest:
        assert health['catalog_files_sha256'] == {
            str(manifest):file_sha256(manifest),
            str(manifest.parent / 'part-0.json'):file_sha256(manifest.parent / 'part-0.json')}
    elif mode == 'rest-double-read':
        assert health['stored_export_lineage'] == 'retained-frozen-rest-double-read-no-new-online-observation'


@pytest.mark.parametrize('mode',['legacy','rest-double-read','catalog'])
@pytest.mark.parametrize('change',['drop','edit'])
def test_replay_rejects_dropped_or_edited_stored_provenance(tmp_path,mode,change):
    source,_,_,_ = provenance_directory(tmp_path,mode)
    stored = json.loads((source / 'stored.json').read_text())
    if change == 'drop':
        del stored['export_provenance']
    else:
        stored['export_provenance']['observed_at'] = '2026-09-05T00:00:01Z'
    (source / 'stored.json').write_text(json.dumps(stored))
    with pytest.raises(ValueError,match='provenance differs'):
        replay_candidate(source,tmp_path / 'revision','a'*40)
    assert not (tmp_path / 'revision').exists()


@pytest.mark.parametrize('evidence',['missing','missing-project','edited-part','edited-manifest'])
def test_catalog_replay_requires_exact_original_evidence(tmp_path,evidence):
    source,_,manifest,project = provenance_directory(tmp_path,'catalog')
    kwargs = {'catalog_manifest':manifest,'expected_project_ref':project}
    if evidence == 'missing':
        kwargs = {}
    elif evidence == 'missing-project':
        del kwargs['expected_project_ref']
    elif evidence == 'edited-part':
        with (manifest.parent / 'part-0.json').open('a') as stream:
            stream.write(' ')
    else:
        with manifest.open('a') as stream:
            stream.write(' ')
    with pytest.raises(ValueError):
        replay_candidate(source,tmp_path / 'revision','a'*40,**kwargs)
    assert not (tmp_path / 'revision').exists()


@pytest.mark.parametrize('change',['digest','count','future','project'])
def test_frozen_rest_provenance_must_bind_rows_and_original_cutoff(tmp_path,change):
    source,original,_,_ = provenance_directory(tmp_path,'rest-double-read')
    stored = json.loads((source / 'stored.json').read_text())
    provenance = stored['export_provenance']
    if change == 'digest':
        provenance['boundary_after']['rows_sha256'] = '0'*64
    elif change == 'count':
        provenance['boundary_before']['row_count'] = True
    elif change == 'future':
        provenance['export_completed_at'] = '2026-09-05T00:02:00Z'
        stored['export_completed_at'] = provenance['export_completed_at']
    else:
        provenance['project_ref'] = 'not-a-project'
        stored['project_ref'] = provenance['project_ref']
    # Even jointly edited metadata must not bypass structural/row/time checks.
    original = retain_export_provenance(original,provenance)
    (source / 'stored.json').write_text(json.dumps(stored))
    (source / 'candidate.json').write_text(json.dumps(original))
    with pytest.raises(ValueError):
        replay_candidate(source,tmp_path / 'revision','a'*40)


def test_catalog_part_changed_during_replay_refuses_output(tmp_path,monkeypatch):
    import monitoring.replay_toi_candidate as replay
    source,_,manifest,project = provenance_directory(tmp_path,'catalog')
    build = replay.build_candidate
    def changing_build(*args,**kwargs):
        candidate = build(*args,**kwargs)
        with (manifest.parent / 'part-0.json').open('a') as stream:
            stream.write(' ')
        return candidate
    monkeypatch.setattr(replay,'build_candidate',changing_build)
    with pytest.raises(ValueError,match='catalog files changed'):
        replay_candidate(source,tmp_path / 'revision','a'*40,
                         catalog_manifest=manifest,expected_project_ref=project)
    assert not (tmp_path / 'revision').exists()


def test_candidate_cannot_drop_provenance_present_in_stored_artifact(tmp_path):
    source,original,_,_ = provenance_directory(tmp_path,'rest-double-read')
    del original[0]['payload']['stored_export_provenance']
    (source / 'candidate.json').write_text(json.dumps(original))
    with pytest.raises(ValueError,match='provenance differs'):
        replay_candidate(source,tmp_path / 'revision','a'*40)
