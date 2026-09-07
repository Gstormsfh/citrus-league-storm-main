from copy import deepcopy
import pytest
from run_event_memory_candidate import augment, primary_passed


def test_append_preserves_source_target_identity_and_original():
    rows=[{'game_id':2022020001,'event_id':1,'label':True,'features':[4.],
           'categorical':{},'source_sha256':'a'*64,'feature_sha256':'old'}]
    before=deepcopy(rows);schema={'version':'test','names':['base']+[str(i) for i in range(8)],'categorical_names':[]}
    out=augment(rows,{(2022020001,1):[None,0,1,2,3,4,5,6]},schema)
    assert rows==before and out[0]['label'] is True
    assert out[0]['features']==[4.,None,0,1,2,3,4,5,6]
    assert out[0]['source_sha256']==rows[0]['source_sha256']


@pytest.mark.parametrize('values', [[0]*7,[float('nan')]*8,[True]*8])
def test_bad_appended_vector_rejected(values):
    with pytest.raises(ValueError):augment([{'game_id':1,'event_id':1}],{(1,1):values},{})


def test_primary_requires_both_losses_not_a_tradeoff():
    losses={'frozen_monotone_group':{'brier':.06,'log_loss_clipped':.22},
            'memory_monotone_group':{'brier':.0601,'log_loss_clipped':.21}}
    assert primary_passed(losses) is False
    losses['memory_monotone_group']['brier']=.059
    assert primary_passed(losses) is True
