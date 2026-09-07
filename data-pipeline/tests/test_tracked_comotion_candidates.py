import copy
import pytest
from projections.tracked_comotion_candidates import extract, extract_before_shot

def frames():
    # Held by A, travels past C for one frame, settles beside B.
    puck=[0,1,2,42,82,122,162,163,164,165]
    result=[]
    for i,x in enumerate(puck):
        actors={'1':dict(x=x,y=0),
                'a':dict(playerId=11,teamId=1,x=i,y=20),
                'b':dict(playerId=22,teamId=1,x=156+i,y=20),
                'c':dict(playerId=33,teamId=1,x=82,y=20)}
        result.append(dict(timeStamp=i,onIce=actors))
    return result

def test_flyby_not_control():
    r=extract(frames(),radius=36,relative_step_limit=12)
    assert len(r['candidates'])==1
    assert r['candidates'][0]['from_player_id']==11
    assert r['candidates'][0]['to_player_id']==22
    assert not r['candidates'][0]['confirmed_pass']

def test_missing_puck_and_clock_gap_rejected():
    f=frames();del f[4]['onIce']['1']
    assert extract(f,radius=36,relative_step_limit=12)['candidates']==[]
    f=frames();f[4]['timeStamp']=100
    with pytest.raises(ValueError):extract(f)

def test_labels_do_not_enter_and_opponent_not_pass():
    f=frames();changed=copy.deepcopy(f)
    for frame in changed:frame['goal']=True;frame['assist1PlayerId']=999
    assert extract(f)==extract(changed)
    for frame in f:frame['onIce']['b']['teamId']=2
    assert extract(f,radius=36,relative_step_limit=12)['candidates']==[]

def test_reception_cannot_borrow_postshot_frames():
    f=frames()
    assert extract(f,radius=36,relative_step_limit=12)['candidates']
    assert not extract_before_shot(f,shot_frame=8,radius=36,relative_step_limit=12)['candidates']
    before=extract_before_shot(f,shot_frame=9,radius=36,relative_step_limit=12)
    f[9]['onIce']={}
    f.append({'timeStamp':999,'onIce':{}})
    assert extract_before_shot(f,shot_frame=9,radius=36,relative_step_limit=12)==before

def test_cutoff_must_be_explicit_inside_clip():
    for cutoff in (None,0,True,1.5,10):
        with pytest.raises(ValueError):extract_before_shot(frames(),shot_frame=cutoff)
