from copy import deepcopy
import pytest
import reconcile_finishing_exposure as c


def fixture(excluded=False):
    plays=[{'eventId':i,'typeCode':code,'periodDescriptor':{'periodType':period},
        'details':{'scoringPlayerId' if code==505 else 'shootingPlayerId':8470001,'eventOwnerTeamId':1}}
        for i,code,period in [(1,505,'REG'),(2,506,'REG'),(3,507,'REG'),(4,505,'SO')]]
    payload={'id':2022020001,'gameDate':'2022-10-07','gameType':2,'plays':plays,
        'homeTeam':{'id':1},'awayTeam':{'id':2},'rosterSpots':[{'playerId':8470001,'teamId':1}]}
    stream=[{'event_id':p['eventId'],'source_event_sha256':c.fingerprint(p),
        'is_unblocked_attempt':p['eventId']!=4,'cohort_eligibility':{'geometry_baseline':p['eventId']!=3},
        'cohort_exclusions':{'geometry_baseline':['missing_geometry'] if p['eventId']==3 else []}}
        for p in plays]
    game={'game_id':payload['id'],'game_date':payload['gameDate'],'source_body_bytes_sha256':'a'*64,
        'source_excluded_game':excluded,'source_reason':'receipt_not_complete' if excluded else 'verified',
        'stream_inventory':stream}
    modeled={} if excluded else {i:{'player_id':8470001,'team_id':1,'is_goal':i==1,
        'source_event_sha256':stream[i-1]['source_event_sha256']} for i in (1,2)}
    return game,payload,modeled


def test_geometry_missing_and_shootouts_separate():
    rows=c.reconcile(*fixture());assert len(rows)==3
    out=c.totals(rows)[0]
    assert out['captured_source']=={'attempts':3,'goals':1,'sog':2}
    assert out['not_modeled']=={'attempts':1,'goals':0,'sog':0}
    assert rows[2]['exclusion_reasons']==['missing_geometry']
    assert out['talent_training_authorized'] is False


def test_whole_game_withheld_and_no_promotion():
    rows=c.reconcile(*fixture(True));out=c.totals(rows)[0]
    assert out['not_modeled']==out['captured_source']
    assert all(r['exclusion_reasons']==['source_gate:receipt_not_complete'] for r in rows)
    assert all(r['source_accepted'] is False for r in rows)


def test_unknown_actor_preserved_not_dropped():
    g,p,m=fixture(True);p['rosterSpots']=[]
    rows=c.reconcile(g,p,m)
    assert len(rows)==3 and all(r['player_id'] is None for r in rows)
    assert c.totals(rows)[0]['captured_source']['attempts']==3


def test_order_invariant_and_population_partition():
    rows=c.reconcile(*fixture());other=deepcopy(rows)
    for r in other:r['game_type']='playoff'
    assert c.totals(rows+other)==c.totals((rows+other)[::-1])
    assert len(c.totals(rows+other))==2


@pytest.mark.parametrize('bad',['missing_model','extra_model','hash','identity','duplicate','actor','outcome','unexplained','attempt'])
def test_fail_closed(bad):
    g,p,m=fixture()
    if bad=='missing_model':m.pop(1)
    elif bad=='extra_model':m[3]=deepcopy(m[1])
    elif bad=='hash':g['stream_inventory'][0]['source_event_sha256']='b'*64
    elif bad=='identity':p['id']=2022020002
    elif bad=='duplicate':p['plays'].append(p['plays'][0])
    elif bad=='actor':m[1]['player_id']=8470002
    elif bad=='outcome':m[1]['is_goal']=False
    elif bad=='unexplained':g['stream_inventory'][2]['cohort_exclusions']['geometry_baseline']=[]
    else:g['stream_inventory'][3]['is_unblocked_attempt']=True
    with pytest.raises(ValueError):c.reconcile(g,p,m)
