import pytest
from copy import deepcopy
from monitoring.appearance_contract import SUMMARY_URL
from projections.verified_toi_publication import build_candidate


def fixture():
    rows=[{'season':2025,'player_id':1,'game_id':2025020001,'nhl_toi_seconds':600},
          {'season':2025,'player_id':2,'game_id':2025020001,'nhl_toi_seconds':599}]
    log=[{'gameId':2025020001,'toi':'10:00'}]
    evidence={pid:{'observed_at':'2026-09-05T00:00:00Z','game_log':deepcopy(log),
                   'source_receipt':{'url':f'https://api-web.nhle.com/v1/player/{pid}/game-log/20252026/2',
                       'params':{},'status':'ok','http_status':200,
                       'requested_at':'2026-09-05T00:00:00Z','observed_at':'2026-09-05T00:00:00Z',
                       'payload':{'seasonId':20252026,'gameTypeId':2,'gameLog':deepcopy(log)}}}
              for pid in (1,2)}
    pages=[{'url':SUMMARY_URL,'status':'ok','http_status':200,
            'requested_at':'2026-09-05T00:00:00Z','observed_at':'2026-09-05T00:00:00Z',
            'params':{'isAggregate':'false','isGame':'false','start':0,'limit':100,
                      'sort':'[{"property":"playerId","direction":"ASC"}]',
                      'cayenneExp':'seasonId=20252026 and gameTypeId=2'},
            'payload':{'total':2,'data':[{'playerId':pid,'gamesPlayed':1,'seasonId':20252026} for pid in (1,2)]}}]
    return rows,evidence,pages


def test_candidate_keeps_verified_and_unavailable_players_with_source_provenance():
    rows,evidence,pages=fixture()
    source,batch,values=build_candidate([1,2],rows,evidence,2025,'2026-09-05T00:00:01Z','0'*40,summary_receipts=pages)
    assert source['payload']['official_receipts']['1']['game_log'][0]['toi']=='10:00'
    assert batch['validation']['entity_ids']==[1,2]
    assert values[0]['value']==10
    assert values[1]['value'] is None and values[1]['reason']=='toi_mismatch'
    assert batch['model_version']=='none'


def test_missing_receipt_and_mixed_populations_refuse_candidate():
    rows,evidence,_=fixture()
    with pytest.raises(ValueError,match='receipt'):
        build_candidate([1,2],rows,{1:evidence[1]},2025,'2026-09-05T00:00:01Z','0'*40)
    rows[0]['game_id']=2025030001
    with pytest.raises(ValueError,match='populations'):
        build_candidate([1,2],rows,evidence,2025,'2026-09-05T00:00:01Z','0'*40)


def test_fractional_receipt_seconds_are_compared_chronologically():
    rows,evidence,pages=fixture()
    evidence[1]={**evidence[1],'observed_at':'2026-09-05T00:00:00.1Z'}
    evidence[2]={**evidence[2],'observed_at':'2026-09-05T00:00:00Z'}
    evidence[1]['source_receipt']['observed_at']=evidence[1]['observed_at']
    source,batch,_=build_candidate([1,2],rows,evidence,2025,'2026-09-05T00:00:01Z','0'*40,summary_receipts=pages)
    assert source['observed_at']=='2026-09-05T00:00:00.100000+00:00'
    assert batch['validation']['freshness_observed_at']=='2026-09-05T00:00:00+00:00'


def test_inline_landing_gp_without_complete_raw_summary_cannot_verify_publication():
    rows,evidence,_=fixture()
    for receipt in evidence.values():
        receipt['landing']={'featuredStats':{'season':20252026,'regularSeason':{'subSeason':{'gamesPlayed':1}}}}
    _,batch,values=build_candidate([1,2],rows,evidence,2025,'2026-09-05T00:00:01Z','0'*40)
    assert all(row['availability']=='unavailable' for row in values)
    assert batch['validation']['coverage']['official_population_complete'] is False
