from copy import deepcopy
import inspect
import json
from pathlib import Path
import pytest
from projections import calibration_shape_experiment as c
from tests.test_calibration_shape import sample

@pytest.fixture
def plan():return json.loads((c.REPO/'docs/analytics-calibration-shape-plan-20260906.json').read_bytes())

def test_declared_plan(plan):c.validate_plan(plan,'2026-09-06T10:00:00Z')

@pytest.mark.parametrize('bad',['settings','selection','candidates','late_plan','old_pin','publishable'])
def test_bad_plan(plan,bad):
    if bad=='settings':plan['settings']['slope_identity_ridge']=1
    elif bad=='selection':plan['selection']['baseline']='reference_sigmoid'
    elif bad=='candidates':plan['candidates'].append('new')
    elif bad=='late_plan':plan['declared_at']='2027-01-01T00:00:00Z'
    elif bad=='old_pin':plan['prior_calibration_health_sha256']='0'*64
    else:plan[bad]=True
    with pytest.raises(ValueError):c.validate_plan(plan,'2026-09-06T10:00:00Z')

def test_selection_requires_each_fold_both_losses():
    reports={f:{'overall':{'models':{k:{'metrics':{'brier':{'value':.1},'log_loss_clipped':{'value':.2}}} for k in c.NAMES}}} for f in ('fold1','fold2')}
    reports['fold1']['overall']['models']['monotone_logit']['metrics']['log_loss_clipped']['value']=.1
    reports['fold2']['overall']['models']['monotone_logit']['metrics']['brier']['value']=.1001
    result=c.select(reports);candidate=next(v for v in result['candidates'] if v['candidate']=='monotone_logit')
    assert candidate['eligible'] is False and candidate['guard_failures']==['fold2:brier']
    assert result['publishable'] is False

def test_fit_boundary_and_full_bridge(tmp_path,sample):
    p,y,ctx=sample;rows=[{'game_id':2023020001,'event_id':i} for i in range(500)]
    files,predictions,models=c.fit_and_compare(p,y,ctx,p[:500],ctx[:500],rows,tmp_path)
    assert set(predictions)==set(c.shape.KINDS)
    assert all(c.file_sha(tmp_path/n)==s for n,s in files.items())
    receipt=json.loads((tmp_path/'typescript-parity.json').read_bytes())
    assert all(v['passed'] and v['rows']==500 for v in receipt['models'].values())
    assert not any('label' in name or 'target' in name for name in inspect.signature(c.fit_and_compare).parameters if name.startswith('v'))
    with pytest.raises(FileExistsError):c.fit_and_compare(p,y,ctx,p[:500],ctx[:500],rows,tmp_path)

@pytest.mark.parametrize('error',[ValueError,KeyboardInterrupt,OSError])
def test_outer_failures_are_retained(tmp_path,monkeypatch,error):
    def fail(*args,**kwargs):raise error('unavailable source')
    monkeypatch.setattr(c,'Replay',fail);output=tmp_path/'run'
    with pytest.raises(error):c.run('a','b','c','d',output)
    assert (output/'failure.json').exists() and not (output/'health.json').exists()
    with pytest.raises(FileExistsError):c.run('a','b','c','d',output)

def test_no_late_test_api_or_pickle_reader():
    source=inspect.getsource(c)
    assert 'pickle.load' not in source and 'joblib.load' not in source
    assert not any('test' in n for n in inspect.signature(c.run).parameters)
