from copy import deepcopy
import json

import pytest

from monitoring.appearance_contract import SUMMARY_URL
from monitoring.replay_toi_candidate import replay_candidate, file_sha256
from projections.verified_toi_publication import build_candidate


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
