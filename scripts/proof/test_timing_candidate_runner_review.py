"""Independent runner contracts; synthetic fixtures, no real fitting."""
from copy import deepcopy
import ast
import inspect
import math
import json
import numpy as np
import pytest
import run_timing_candidate as runner


def sources():
    rows = [{'game_id': 2022020001+i//4, 'event_id': i, 'game_date': '2022-09-01',
        'target': i % 2, 'raw_probability': .1, 'context': {'shot_type': None, 'strength': '5v5', 'prior_sog_same_team': '1'}} for i in range(120)]
    rows += [{'game_id': 2023020001+i, 'event_id': i, 'game_date': day, 'target': i % 2,
        'raw_probability': .1, 'context': {'shot_type': None, 'strength': '5v5', 'prior_sog_same_team': '1'}}
        for i, day in enumerate(('2022-10-01','2022-11-01'))]
    originals = {(r['game_id'],r['event_id']): {'game_id':r['game_id'],'event_id':r['event_id'],
        'label':bool(r['target']),'game_date':r['game_date'],'source_sha256':'a'*64} for r in rows}
    timing = {(r['game_id'],r['event_id']): {'game_id':r['game_id'],'event_id':r['event_id'],
        'target':r['target'],'month':r['game_date'][:7], 'state':'1','source_envelope_sha256':'a'*64,
        'gap_seconds':1,'gap_band':'up_to_1s','current_type':505 if r['target'] else 506,
        'same_actor':True} for r in rows}
    return rows,timing,originals


def prepared():
    rows,timing,originals=sources(); blocks=runner.transfer_blocks(rows[:120],rows[120:])
    item={'blocks':blocks,'raw_by_key':{k:.1 for k in timing},
        'contexts_by_key':{(r['game_id'],r['event_id']):r['context'] for r in rows},
        'timing_by_key':runner.join_timing(rows,timing,originals)}
    return {f:deepcopy(item) for f in ('fold1','fold2')},{f:[deepcopy(b['receipt']) for b in blocks] for f in ('fold1','fold2')}


def test_join_is_narrow_nonmutating_and_permutation_invariant():
    r,t,o=sources(); before=deepcopy((r,t,o)); joined=runner.join_timing(r,t,o)
    assert joined==runner.join_timing(r[::-1],t,o)
    assert all(set(x)=={'gap_seconds','gap_band'} for x in joined.values())
    assert (r,t,o)==before


@pytest.mark.parametrize('mutation',['target','month','state','envelope','missing_timing','missing_original','timing_key','original_key','boolean_target','bad_hash'])
def test_join_corruption(mutation):
    r,t,o=sources();k=next(iter(t))
    if mutation=='target':t[k]['target']=1-r[0]['target']
    if mutation=='month':t[k]['month']='2021-01'
    if mutation=='state':t[k]['state']=None
    if mutation=='envelope':t[k]['source_envelope_sha256']='b'*64
    if mutation=='missing_timing':del t[k]
    if mutation=='missing_original':del o[k]
    if mutation=='timing_key':t[k]['event_id']=999999
    if mutation=='original_key':o[k]['event_id']=999999
    if mutation=='boolean_target':t[k]['target']=False
    if mutation=='bad_hash':t[k]['source_envelope_sha256']=o[k]['source_sha256']='not-a-sha'
    with pytest.raises(ValueError):runner.join_timing(r,t,o)


def test_every_first_month_fits_new_candidate(monkeypatch):
    p,_=prepared();item=p['fold1']; calls=[]
    def fit(raw,y,contexts,gaps,**kw):calls.append((raw,y,contexts,gaps,kw));return {'synthetic':True}
    monkeypatch.setattr(runner.engine,'fit',fit)
    result=runner.fit_block(item['blocks'][0],item['raw_by_key'],item['contexts_by_key'],item['timing_by_key'])
    assert result=={'synthetic':True} and len(calls)==1
    assert len(calls[0][1])==120 and calls[0][-1]=={'chunk_rows':4096}


def test_current_future_labels_do_not_reach_fit(monkeypatch):
    p,_=prepared();item=p['fold1']; block=item['blocks'][1];calls=[]
    monkeypatch.setattr(runner.engine,'fit',lambda raw,y,c,g,**kw:calls.append(deepcopy(y)) or {})
    runner.fit_block(block,item['raw_by_key'],item['contexts_by_key'],item['timing_by_key'])
    block['test_records'][0]['target']=object()
    runner.fit_block(block,item['raw_by_key'],item['contexts_by_key'],item['timing_by_key'])
    assert calls[0]==calls[1] and len(calls[0])==121


def test_all_folds_all_blocks_preflight_without_fit(monkeypatch):
    p,e=prepared();monkeypatch.setattr(runner.engine,'fit',lambda *a,**kw:pytest.fail('Fit in preflight'))
    result=runner.preflight_study(p,e)
    assert set(result)=={'fold1','fold2'} and len(result['fold2'])==2


def test_unseen_test_category_does_not_expand_training_vocabulary():
    p,e=prepared();item=p['fold1'];item['timing_by_key'][(2023020001,0)]={'gap_seconds':0,'gap_band':'same_clock'}
    info=runner.preflight_study(p,e)['fold1']['2022-10']
    assert info['train_timing']['timing_categories']==['up_to_1s']
    assert info['test_timing']['timing_categories']==['same_clock']
    assert info['test_timing_is_support_diagnostic_not_fitted_vocabulary'] is True


def test_gap_band_mismatch_rejected():
    r,t,o=sources();t[next(iter(t))]['gap_band']='same_clock'
    with pytest.raises(ValueError):runner.join_timing(r,t,o)


@pytest.mark.parametrize('mutation',['late_missing_gap','late_bad_probability','stale_receipt','missing_fold','missing_month','late_one_class'])
def test_preflight_failures(mutation):
    p,e=prepared();item=p['fold2']
    if mutation=='late_missing_gap':item['timing_by_key'][(2023020002,1)]['gap_seconds']=None
    if mutation=='late_bad_probability':item['raw_by_key'][(2023020002,1)]=float('nan')
    if mutation=='stale_receipt':item['blocks'][-1]['train_records'].pop()
    if mutation=='missing_fold':del p['fold2']
    if mutation=='missing_month':item['blocks'].pop()
    if mutation=='late_one_class':
        for r in item['blocks'][-1]['train_records']:r['target']=0
    with pytest.raises((ValueError,KeyError)):runner.preflight_study(p,e)


@pytest.mark.parametrize('invalid',[float('inf'),float('nan'),True])
def test_primary_guard_fails_nonfinite_or_boolean(invalid):
    losses={n:{m:invalid for m in runner.METRICS} for n in runner.OUTPUTS}
    with pytest.raises(ValueError):runner.primary_passed(losses)


def test_primary_both_losses_not_secondary_compensation():
    losses={n:{m:.1 for m in runner.METRICS} for n in runner.OUTPUTS}
    assert runner.primary_passed(losses)
    losses['timing']['brier']=.100001;losses['timing']['log_loss_clipped']=.01
    assert not runner.primary_passed(losses)


def test_source_order_preflights_before_any_fit_and_no_rawfit():
    tree=ast.parse(inspect.getsource(runner.run));calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call)]
    pre=[n.lineno for n in calls if isinstance(n.func,ast.Name) and n.func.id=='preflight_study']
    fits=[n.lineno for n in calls if isinstance(n.func,ast.Name) and n.func.id=='fit_block']
    assert len(pre)==len(fits)==1 and pre[0]<fits[0]
    assert not any(isinstance(n.func,ast.Attribute) and n.func.attr=='fit' for n in calls)


def test_scalar_independent_nonzero_offsets_clips_and_unseen_categories():
    # Explicit synthetic parameter fixture, not a fitted or accepted model.
    s=runner.engine.dense.SLOPES
    model={'contract':runner.engine.VERSION,'settings':deepcopy(runner.engine.SETTINGS),'publishable':False,
        'shared_slopes':[1.]*s,'states':['1'],'context_slopes':[[1.]*s],
        'intercept':math.log(.1/.9),'vocabulary':{'shot_type':['wrist'],'strength':['5v5'],'prior_sog_same_team':['1']},
        'offsets':[.15,-.2,.1],'timing_categories':['same_clock','up_to_1s'],
        'timing_offsets':[.7,-.6],'timing_ridge':100.,
        'optimization':{'converged':True,'iterations':0,'objective':0.,'projected_gradient':0.}}
    model=json.loads(json.dumps(model,allow_nan=False))
    p=[0.,1.,.1,.1,.3,.7]
    contexts=[{'shot_type':'wrist','strength':'5v5','prior_sog_same_team':'1'} for _ in p]
    contexts[-1]={'shot_type':'unseen','strength':None,'prior_sog_same_team':None}
    gaps=[0,1,2,11,0,None]
    expected=runner.engine.predict(model,p,contexts,gaps)
    actual=runner.scalar_predictions(model,p,contexts,gaps)
    np.testing.assert_allclose(actual,expected,rtol=0,atol=1e-12)
    assert actual[2]==pytest.approx(actual[3],abs=1e-12) # unseen timing and reference both zero
