import numpy as np
import pytest
from refreshed_xg_ensemble import Ensemble
from run_bounded_xg_refresh import symmetrize,metrics


class Stub:
    def __init__(self,p,wrong=False):self.p,self.wrong=p,wrong
    def predict(self,rows):
        return [{'game_id':r['game_id']+int(self.wrong),'event_id':r['event_id'],'neutral_xg':self.p} for r in rows]


def test_exact_equal_weight_and_target_ignored():
    rows=[{'game_id':1,'event_id':2,'target':0}]
    model=Ensemble(Stub(.2),Stub(.4))
    p=model.predict(rows)[0]
    assert p['neutral_xg']==(.2+.4)/2 and p['publishable'] is False
    assert model.predict([{**rows[0],'target':1}])==[p]


def test_identity_mismatch_rejected():
    with pytest.raises(ValueError):Ensemble(Stub(.2),Stub(.4,True)).predict([{'game_id':1,'event_id':2}])


def test_reflection_preserves_distance_and_pools_mirror():
    names=['y_attacking','previous_y_in_shooting_frame_ft','signed_angle_deg','distance_to_goal_ft']
    x=np.array([[10.,-20.,30.,25.],[-10.,20.,-30.,25.]])
    before=x.copy();out=symmetrize(x,names)
    np.testing.assert_array_equal(out[0],out[1]);np.testing.assert_array_equal(out[:,3],x[:,3])
    np.testing.assert_array_equal(x,before)


def test_requested_metrics_have_correct_direction():
    y=np.array([0.,1.,0.,1.])
    better=metrics(np.array([.1,.9,.2,.8]),y);worse=metrics(np.array([.4,.6,.7,.3]),y)
    assert better['auc']>worse['auc'] and better['brier']<worse['brier'] and better['correlation']>worse['correlation']
