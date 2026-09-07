from copy import deepcopy
import pytest
from projections.tracked_transfer_candidates import extract


def sample():
    return [{'timeStamp':i,'onIce':{'1':{'id':1,'x':x,'y':0},'a':{'playerId':10,'teamId':2,'x':0,'y':0},
        'b':{'playerId':11,'teamId':2,'x':200,'y':0}}} for i,x in enumerate([0,0,100,200,200])]


def test_candidate_and_units():
    result=extract(sample());c=result['candidates'][0]
    assert c['from_player_id']==10 and c['to_player_id']==11 and c['elapsed_seconds']==.2
    assert c['longitudinal_renderer_units']==200 and not c['confirmed_pass']


def test_intervening_opponent_touch_rejected():
    frames=sample();frames[2]['onIce']['c']={'playerId':12,'teamId':3,'x':100,'y':0}
    assert not extract(frames)['candidates']


def test_missing_puck_and_goalies_not_bridged():
    frames=sample();frames[2]['onIce'].pop('1');assert not extract(frames)['candidates']
    assert not extract(sample(),goalie_ids=[11])['candidates']


def test_outcome_independence_and_clock_gaps():
    frames=sample();changed=deepcopy(frames)
    for f in changed:f['goal']=True;f['assists']=[10,11]
    assert extract(frames)==extract(changed)
    changed[2]['timeStamp']=99
    with pytest.raises(ValueError):extract(changed)
