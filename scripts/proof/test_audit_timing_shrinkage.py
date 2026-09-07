import pytest
from audit_timing_shrinkage import summarize, penalty_check

def row(i,gap,state='1'):
    return {'game_id':2023020001,'event_id':i,'target':i%2,'gap_seconds':gap,'context':{'prior_sog_same_team':state}}

def test_complete_accounting_keeps_zero_reference_and_unknown():
    rows=[row(0,0),row(1,1),row(2,2),row(3,3),row(4,11),row(5,None,None)]
    c=summarize(rows,[.1]*6)
    assert len(c)==6 and sum(x['events'] for x in c.values())==6
    assert sum(x['goals'] for x in c.values())==3
    assert c['same_clock']['observed_minus_expected']==-.1
    assert c['other_state']['years']=={'2023':1}

@pytest.mark.parametrize('mutation',['duplicate','target','probability','gap','length'])
def test_invalid_membership_fails(mutation):
    rows=[row(0,0),row(1,1)];p=[.1,.2]
    if mutation=='duplicate':rows[1]=rows[0]
    if mutation=='target':rows[0]['target']=True
    if mutation=='probability':p[0]=float('nan')
    if mutation=='gap':rows[0]['gap_seconds']=None
    if mutation=='length':p.pop()
    with pytest.raises(ValueError):summarize(rows,p)

def test_penalty_identity_sign_and_failure():
    model={'timing_categories':['same_clock'],'timing_offsets':[-.5],'timing_ridge':100.,'settings':{'projected_gradient_tolerance':1e-5,'epsilon':1e-6}}
    c={'same_clock':{'observed_minus_expected':-50.}}
    assert penalty_check(model,c,100)['same_clock']['score_equation_abs_error']==0
    c['same_clock']['observed_minus_expected']=50.
    with pytest.raises(ValueError):penalty_check(model,c,100)
