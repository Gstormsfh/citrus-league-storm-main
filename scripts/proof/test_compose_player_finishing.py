from copy import deepcopy
import json
import pytest
import compose_player_finishing as c
import test_player_goalie_attribution as actor


def rows():
    return [{'game_id':2022020001,'event_id':i,'season':2022,'game_type':'regular','player_id':8470001,
        'team_id':1,'event_type':t,'is_goal':t=='goal','neutral_xg':p}
        for i,t,p in [(1,'goal',.2),(2,'shot-on-goal',.1),(3,'missed-shot',.2)]]


def test_descriptive_quantities_not_talent_or_official_rates():
    result=c.aggregate(rows(),'a'*64)[0]
    assert (result['eligible_event_goals'],result['eligible_event_sog'],result['eligible_event_attempts'])==(1,2,3)
    assert result['rates']['shooting_percentage']==50
    assert result['rates']['goals_over_neutral_xg_ratio']==2
    assert result['rates']['finishing_above_expected_percentage']==100
    assert result['rates']['estimated_talent'] is None
    assert result['appearance_games'] is result['toi_seconds'] is result['xg_per60'] is None


def test_team_stints_and_playoffs_do_not_merge():
    r=rows();r[1]['team_id']=2
    extra=deepcopy(r[0]);extra.update(game_id=2022030001,game_type='playoff');r.append(extra)
    out=c.aggregate(r,'a'*64)
    assert out==c.aggregate(r[::-1],'a'*64)
    assert len(out)==2
    regular=next(x for x in out if x['game_type']=='regular')
    assert len(regular['team_stints'])==2
    assert sum(x['eligible_event_attempts'] for x in regular['team_stints'])==3


def test_zero_denominators_not_zero_talent():
    r=rows()[2:];r[0]['neutral_xg']=0
    rates=c.aggregate(r,'a'*64)[0]['rates']
    assert rates['shooting_percentage'] is rates['goals_over_neutral_xg_ratio'] is rates['estimated_talent'] is None


@pytest.mark.parametrize('change',[{'neutral_xg':float('nan')},{'neutral_xg':True},{'is_goal':0},
    {'event_type':'blocked-shot'},{'player_id':None},{'game_type':'unknown'},{'team_id':None}])
def test_bad_events_rejected(change):
    r=rows();r[0].update(change)
    with pytest.raises(ValueError):c.aggregate(r,'a'*64)


def test_duplicate_rejected():
    r=rows()
    with pytest.raises(ValueError):c.aggregate(r+[r[0]],'a'*64)


def joined_fixture():
    p=actor.payload();p['gameDate']='2022-10-07';g=actor.build(p)
    predictions={(g['game_id'],e['event_id']):{'neutral_xg':.1,'publishable':False,'bundle_fingerprint':'a'*64} for e in g['events']}
    bundles={'a'*64:{'valid_from':'2022-10-07','valid_to':'2022-10-31'}}
    return g,json.dumps(p).encode(),predictions,bundles


def test_raw_actor_join_uses_new_not_old_probabilities():
    out=c.join_game(*joined_fixture())
    assert [r['neutral_xg'] for r in out]==[.1]*3
    assert [r['event_type'] for r in out]==['goal','shot-on-goal','missed-shot']


@pytest.mark.parametrize('bad',['missing','extra','bundle','date','promoted','miss'])
def test_join_guards(bad):
    g,body,p,b=joined_fixture();first=next(iter(p))
    if bad=='missing':p.pop(first)
    elif bad=='extra':p[(1,2)]=p[first]
    elif bad=='bundle':b.clear()
    elif bad=='date':b['a'*64]['valid_to']='2022-10-06'
    elif bad=='promoted':p[first]['publishable']=True
    else:
        g['events'][1]['event_type']='missed-shot'
        g['receipt_sha256']=c.fingerprint({k:v for k,v in g.items() if k!='receipt_sha256'})
    with pytest.raises(ValueError):c.join_game(g,body,p,b)
