import pytest
from projections.verified_toi_publication import build_candidate


def fixture():
    rows=[{'season':2025,'player_id':1,'game_id':2025020001,'nhl_toi_seconds':600},
          {'season':2025,'player_id':2,'game_id':2025020001,'nhl_toi_seconds':599}]
    receipt={'observed_at':'2026-09-05T00:00:00Z',
             'landing':{'featuredStats':{'season':20252026,'regularSeason':{'subSeason':{'gamesPlayed':1}}}},
             'game_log':[{'gameId':2025020001,'toi':'10:00'}]}
    return rows,{1:receipt,2:receipt}


def test_candidate_keeps_verified_and_unavailable_players_with_source_provenance():
    rows,evidence=fixture()
    source,batch,values=build_candidate([1,2],rows,evidence,2025,'2026-09-05T00:00:01Z','0'*40)
    assert source['payload']['official_receipts']['1']['game_log'][0]['toi']=='10:00'
    assert batch['validation']['entity_ids']==[1,2]
    assert values[0]['value']==10
    assert values[1]['value'] is None and values[1]['reason']=='toi_mismatch'
    assert batch['model_version']=='none'


def test_missing_receipt_and_mixed_populations_refuse_candidate():
    rows,evidence=fixture()
    with pytest.raises(ValueError,match='receipt'):
        build_candidate([1,2],rows,{1:evidence[1]},2025,'2026-09-05T00:00:01Z','0'*40)
    rows[0]['game_id']=2025030001
    with pytest.raises(ValueError,match='populations'):
        build_candidate([1,2],rows,evidence,2025,'2026-09-05T00:00:01Z','0'*40)


def test_fractional_receipt_seconds_are_compared_chronologically():
    rows,evidence=fixture()
    evidence[1]={**evidence[1],'observed_at':'2026-09-05T00:00:00.1Z'}
    evidence[2]={**evidence[2],'observed_at':'2026-09-05T00:00:00Z'}
    source,batch,_=build_candidate([1,2],rows,evidence,2025,'2026-09-05T00:00:01Z','0'*40)
    assert source['observed_at']=='2026-09-05T00:00:00.100000+00:00'
    assert batch['validation']['freshness_observed_at']=='2026-09-05T00:00:00+00:00'
