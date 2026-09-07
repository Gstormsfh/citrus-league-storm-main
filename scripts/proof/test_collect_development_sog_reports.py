import pytest
from collect_development_sog_reports import goal_candidates


def test_all_affected_goals_retained_shottype_not_classifier():
    p={'rosterSpots':[{'playerId':8470001}], 'plays':[
        {'eventId':i,'typeCode':505,'timeInPeriod':'01:00','periodDescriptor':{'number':1,'periodType':period},
         'details':dict(scoringPlayerId=8470001,eventOwnerTeamId=team,**extra)}
        for i,period,team,extra in [(1,'REG',1,{}),(2,'REG',1,{'shotType':'wrist'}),(3,'SO',1,{}),(4,'REG',2,{})]]}
    rows=goal_candidates(p,{1})
    assert [r['event_id'] for r in rows]==[1,2]
    assert all(r['sog_contribution'] is None for r in rows)
    assert all(len(r['source_event_sha256'])==64 for r in rows)


def test_missing_roster_actor_cannot_be_invented():
    p={'rosterSpots':[],'plays':[{'eventId':1,'typeCode':505,'timeInPeriod':'01:00',
        'periodDescriptor':{'number':1,'periodType':'REG'},'details':{'scoringPlayerId':8470001,'eventOwnerTeamId':1}}]}
    with pytest.raises(KeyError):goal_candidates(p,{1})
