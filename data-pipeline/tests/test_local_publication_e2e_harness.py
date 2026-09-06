"""Offline safeguards and proposed-correction preparation; no local server calls."""
import base64
from copy import deepcopy
import importlib.util
import json
from pathlib import Path

import pytest

from monitoring.appearance_contract import SUMMARY_URL
from projections.verified_toi_publication import build_candidate

path=Path(__file__).resolve().parents[2]/'scripts/local_analytics_publication_e2e.py'
spec=importlib.util.spec_from_file_location('local_publication_e2e',path)
harness=importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def token(issuer='citrus-local-integration',role='service_role'):
    payload=base64.urlsafe_b64encode(json.dumps({'iss':issuer,'role':role}).encode()).decode().rstrip('=')
    return 'fixture.'+payload+'.fixture'


@pytest.mark.parametrize('url',[
    'https://example.supabase.co','http://example.com:3000','http://127.0.0.1',
    'http://127.0.0.1:3000/rest/v1','http://user:password@localhost:3000',
    'http://localhost.evil.test:3000','http://127.0.0.1:3000?remote=1'])
def test_harness_refuses_hosted_or_ambiguous_endpoints(url):
    with pytest.raises(ValueError):
        harness.guard_local(url,token())


def test_harness_requires_explicit_synthetic_jwt_issuer_and_role():
    harness.guard_local('http://127.0.0.1:3000',token())
    for value in (token('supabase'),token(role='authenticated'),'not-a-jwt'):
        with pytest.raises(ValueError):
            harness.guard_local('http://127.0.0.1:3000',value)


def test_proposed_correction_changes_only_disposable_copy_and_keeps_frozen_source_age():
    pid=8476453
    observed='2026-09-05T00:00:00Z'
    log=[{'gameId':2025020001,'toi':'10:00'}]
    evidence={pid:{'observed_at':observed,'game_log':deepcopy(log),'source_receipt':{
        'url':f'https://api-web.nhle.com/v1/player/{pid}/game-log/20252026/2','params':{},
        'status':'ok','http_status':200,'requested_at':observed,'observed_at':observed,
        'payload':{'seasonId':20252026,'gameTypeId':2,'gameLog':deepcopy(log)}}}}
    pages=[{'url':SUMMARY_URL,'status':'ok','http_status':200,'requested_at':observed,'observed_at':observed,
            'params':{'isAggregate':'false','isGame':'false','start':0,'limit':100,
                      'sort':'[{"property":"playerId","direction":"ASC"}]',
                      'cayenneExp':'seasonId=20252026 and gameTypeId=2'},
            'payload':{'total':1,'data':[{'playerId':pid,'seasonId':20252026,'gamesPlayed':1}]}}]
    rows=[{'season':2025,'player_id':pid,'game_id':gid,'is_goalie':False,'nhl_toi_seconds':seconds}
          for gid,seconds in ((2025020001,600),(2025020538,0))]
    original=build_candidate([pid],rows,evidence,2025,'2026-09-05T00:01:00Z','a'*40,
                              summary_receipts=pages,stored_observed_at=observed)
    before=deepcopy(original)
    corrected=harness.correction_fixture(original)
    assert original==before
    assert corrected[0]['id'] != original[0]['id'] and corrected[1]['id'] != original[1]['id']
    assert corrected[2][0]['availability']=='available' and corrected[2][0]['value']==10
    assert corrected[1]['validation']['freshness_observed_at']==original[1]['validation']['freshness_observed_at']
    assert corrected[0]['payload']['local_integration_fixture']['removed_extra_appearance']==[pid,2025020538]
