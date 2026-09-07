from copy import deepcopy
from pathlib import Path
import sys

import pytest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import run_selective_calibration as c


def fixture():
    settings={**c.candidate.SETTINGS,'min_events':2,'min_games':2}
    def row(gid,day):
        return {'game_id':2022020000+gid,'event_id':1,'game_date':f'2022-10-{day:02d}','probability':.2,'target':0}
    seed=[row(i,1) for i in range(1,101)]
    validation=[row(101,4),row(102,4),row(103,7)]
    return seed,validation,c.candidate.simulate(seed,validation,settings=settings)


def test_independent_variance_root_and_predictions_agree():
    audit=c.audit(*fixture())
    assert audit['events']==3 and audit['states']==2
    assert audit['max_offset_error_vs_brent']<1e-10 and audit['max_probability_error']<1e-10


@pytest.mark.parametrize('field', ['penalty','cluster_variance','bernoulli_variance_floor','gradient_at_zero','objective',
                                  'kkt_violation','offset','history_events'])
def test_self_rehashed_mathematical_forgery_fails(field):
    seed,validation,result=fixture();state=result['states'][0];old=state['state_sha256'];state[field]+=.1
    state['state_sha256']=c.fingerprint({k:v for k,v in state.items() if k!='state_sha256'})
    for r in result['rows']:
        if r['state_sha256']==old:r['state_sha256']=state['state_sha256']
    with pytest.raises(ValueError):c.audit(seed,validation,result)


@pytest.mark.parametrize('bad',['missing_day','missing_row','duplicate','wrong_day','unknown_state','target','base',
                              'probability','history_hash','history_ids','cutoff','start','latest','hash','status','publishable','as_of'])
def test_source_state_and_output_detachment_fails(bad):
    seed,validation,result=fixture();state=result['states'][0]
    if bad=='missing_day':result['states'].pop()
    elif bad=='missing_row':result['rows'].pop()
    elif bad=='duplicate':result['rows'].append(deepcopy(result['rows'][0]))
    elif bad=='wrong_day':result['rows'][0]['state_sha256']=result['states'][1]['state_sha256']
    elif bad=='unknown_state':result['rows'][0]['state_sha256']='0'*64
    elif bad=='target':result['rows'][0]['target']=1
    elif bad=='base':result['rows'][0]['probability']=.3
    elif bad=='probability':result['rows'][0]['adapted_probability']=float('nan')
    elif bad=='history_hash':state['history_rows_sha256']='0'*64
    elif bad=='history_ids':state['history_game_ids'].pop()
    elif bad=='cutoff':state['history_through_inclusive']='2022-10-04'
    elif bad=='start':state['history_after_exclusive']='2020-01-01'
    elif bad=='latest':state['latest_included_game_date']='2022-10-04'
    elif bad=='hash':state['state_sha256']='0'*64
    elif bad=='status':state['status']='zero_selected_by_penalty'
    elif bad=='publishable':result['publishable']=True
    else:result['historical_as_of_verified']=True
    with pytest.raises(ValueError):c.audit(seed,validation,result)


def test_sparse_audit():
    seed,validation,_=fixture();result=c.candidate.simulate(seed,validation)
    assert c.audit(seed,validation,result)['max_offset_error_vs_brent']==0


def test_zero_selected_audit():
    seed,validation,_=fixture();seed=seed[:10]
    result=c.candidate.simulate(seed,validation,settings={**c.candidate.SETTINGS,'min_events':2,'min_games':2})
    assert result['states'][0]['status']=='zero_selected_by_penalty'
    assert c.audit(seed,validation,result)['max_offset_error_vs_brent']==0


def test_source_gate_before_any_real_read(tmp_path):
    target=tmp_path/'outside'
    with pytest.raises(ValueError):c.run(target)
    assert not target.exists()
