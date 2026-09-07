from copy import deepcopy
import json
import numpy as np
import pytest
from run_conditional_shape_candidate import scalar_predictions, primary_passed
from projections import conditional_calibration_shape as module


def context(state):
    return {'shot_type':'wrist','strength':'5v5','prior_sog_same_team':state}


def test_independent_scalar_json_predictions_including_absent_context():
    model=module.fit([.05,.2,.6,.9]*4,[0,0,1,1]*4,[context('0')]*16)
    model=json.loads(json.dumps(model,allow_nan=False))
    probabilities=[0,.001,.025,.1,.35,.75,1]
    contexts=[context(state) for state in [None,'0','1','0',None,'1','0']]
    contexts[0]['shot_type']=None
    contexts[1]['shot_type']='unseen-shot'
    contexts[2]['strength']='unseen-strength'
    contexts[3]['strength']=None
    expected=module.predict(model,probabilities,contexts)
    assert np.max(np.abs(expected-scalar_predictions(model,probabilities,contexts)))<1e-12


def test_guard_requires_both_controls_both_metrics():
    losses={name:{'brier':.06,'log_loss_clipped':.22} for name in (
        'conditional_shape','frozen_monotone_group','frozen_movement_monotone_group')}
    assert primary_passed(losses)
    for control in ('frozen_monotone_group','frozen_movement_monotone_group'):
        for metric in ('brier','log_loss_clipped'):
            changed=deepcopy(losses);changed[control][metric]-=.001
            assert not primary_passed(changed)


def test_scalar_rejects_truncated_contexts():
    with pytest.raises(ValueError):
        scalar_predictions({}, [.1], [])
