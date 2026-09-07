"""Earlier-only grid recalibration and event-context residual experiment."""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from projections import verified_movement_reuse_v2 as reuse
from run_bounded_xg_refresh import ROOT,sha
from test_lateral_time_grid import OUT as GRID,design
from test_targeted_last_season_adjustments import TRAIN,TEST,logit,metrics
from test_joint_residual_adjustments import adjust
from evaluate_frozen_last_season import FEATURES
from review_last_season_evaluation import evaluate

OUT=ROOT/'scripts/proof/results/grid-context-calibration-20260907'


def tokens(row,names):
    def f(n):return row['features'][names.index(n)]
    gap=f('seconds_since_immediate_event');d=f('distance_to_goal_ft')
    prior=str(row['categorical']['previous_event_type']);shot=str(row['categorical']['shot_type'])
    distance='missing' if d is None else 'lt10' if d<10 else '10to20' if d<20 else '20to35' if d<35 else '35to60' if d<60 else '60plus'
    time='missing' if gap is None or gap<0 else 'zero' if gap==0 else 'to1' if gap<=1 else 'to3' if gap<=3 else 'to10' if gap<=10 else 'over10'
    return ['prior='+prior,'shot='+shot,'distance='+distance,'prior_time='+prior+'|'+time]


def matrix(rows,names,vocabulary):
    lookup={v:i for i,v in enumerate(vocabulary)};x=np.zeros((len(rows),len(vocabulary)))
    for i,r in enumerate(rows):
        for t in tokens(r,names):
            if t in lookup:x[i,lookup[t]]=1
    return x


def calibrated(p,x,fit):
    beta=np.array(fit['coefficients']);z=logit(np.asarray(p))
    return np.clip(expit(beta[0]+beta[1]*z+x@beta[2:]),1e-6,1-1e-6)


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json',{'arms':['global_logistic','event_context'],
        'event_context':'Prior event type, shot type, distance bands, prior event type crossed with elapsed-time bands',
        'ridge':10,'minimum_context_events':500,'minimum_context_goals_and_non_goals':20,
        'training':'2023-24 prequential base probabilities; grid and residual fits share that training season',
        'test_status':'Adaptively inspected 2025-26 development retest','production_changed':False,
        'continuous_base_inputs_unchanged':True,'code_sha256':sha(Path(__file__))})
    pins={}
    for folder in (TRAIN,TEST,GRID,FEATURES):
        h=json.loads((folder/'health.json').read_bytes());pins[str(folder/'health.json')]=sha(folder/'health.json')
        for name,digest in h['files'].items():assert sha(folder/name)==digest
    data=reuse.load(ROOT);names=data.schema['names']
    earlier=json.loads((TRAIN/'fold2-predictions.json').read_bytes())
    index={(r['game_id'],r['event_id']):r for r in data.folds['fold2']['validation']['rows']}
    assert len(index)==len(earlier)
    train=[index[r['game_id'],r['event_id']] for r in earlier]
    assert all(r['target']==int(f['label']) and r['game_date']==f['game_date'] for r,f in zip(earlier,train))
    y=np.array([r['target'] for r in earlier],float);base=np.array([r['symmetric_geometry'] for r in earlier])
    gridfit=json.loads((GRID/'fit.json').read_bytes());gx,_=design(train,names)
    p=adjust(base,gx,np.array(gridfit['offsets']));z=logit(p)
    vocabulary=sorted({t for r in train for t in tokens(r,names)})
    xx=matrix(train,names,vocabulary);counts=xx.sum(0);goals=xx.T@y
    supported=(counts>=500)&(goals>=20)&((counts-goals)>=20)
    kept=[v for v,s in zip(vocabulary,supported) if s];xx=xx[:,supported]
    fits={}
    for arm in ('global_logistic','event_context'):
        context=xx if arm=='event_context' else np.zeros((len(p),0))
        x=np.column_stack((np.ones(len(p)),z,context));prior=np.zeros(x.shape[1]);prior[1]=1
        penalty=np.full(x.shape[1],10.);penalty[0]=0.
        def obj(beta):
            eta=x@beta;delta=beta-prior
            return float(np.sum(np.logaddexp(0,eta)-np.logaddexp(0,z)-y*(eta-z))+.5*np.sum(penalty*delta**2)),x.T@(expit(eta)-y)+penalty*delta
        opt=minimize(obj,prior,jac=True,method='BFGS',options={'gtol':1e-6,'maxiter':300})
        grad=obj(opt.x)[1];assert np.max(np.abs(grad))<1e-4 and 0<opt.x[1]<5 and np.max(np.abs(opt.x))<10
        fits[arm]={'coefficients':opt.x.tolist(),'vocabulary':kept if arm=='event_context' else [],
            'gradient_max':float(np.max(np.abs(grad))),'training_end':max(r['game_date'] for r in earlier),
            'training_events':len(y),'ridge':10,'intercept_unpenalized':True}
    write('fits.json',fits)
    write('context-support.json',[{'token':v,'events':int(n),'goals':int(g),'supported':bool(s)} for v,n,g,s in zip(vocabulary,counts,goals,supported)])
    print({'fits':{k:{'intercept':v['coefficients'][0],'slope':v['coefficients'][1],'contexts':len(v['vocabulary']),'gradient_max':v['gradient_max']} for k,v in fits.items()}},flush=True)
    rows=json.loads((GRID/'predictions.json').read_bytes());fi={}
    for game in json.loads((FEATURES/'game-inventory.json').read_bytes()):
        for r in json.loads((FEATURES/f"{game['game_id']}.json").read_bytes()):
            key=r['game_id'],r['event_id'];assert key not in fi;fi[key]=r
    assert len(fi)==len(rows)
    test=[fi[r['game_id'],r['event_id']] for r in rows]
    assert all(int(f['label'])==r['target'] and f['game_date']==r['game_date'] for f,r in zip(test,rows))
    assert max(r['game_date'] for r in earlier)<min(r['game_date'] for r in rows)
    assert not {r['game_id'] for r in earlier}&{r['game_id'] for r in rows}
    labels=np.array([r['target'] for r in rows],float);q=np.array([r['lateral_time_grid'] for r in rows])
    candidates={'previous_joint_four':np.array([r['previous_joint_four'] for r in rows]),'grid':q}
    for arm,f in fits.items():candidates[arm]=calibrated(q,matrix(test,names,f['vocabulary']),f)
    output=[{**{k:r[k] for k in ('game_id','event_id','game_date','target','cell')},**{n:float(v[i]) for n,v in candidates.items()}} for i,r in enumerate(rows)]
    scores={n:metrics(v,labels) for n,v in candidates.items()};independent={n:evaluate(output,n) for n in candidates}
    for n,m in independent.items():
        for k,v in m.items():assert abs(v-scores[n][k])<1e-11
    _,inv=np.unique([r['game_id'] for r in rows],return_inverse=True);sizes=np.bincount(inv)
    draws=np.random.default_rng(20260907).integers(0,len(sizes),size=(2000,len(sizes)))
    for arm in fits:
        sums=np.bincount(inv,weights=(candidates[arm]-labels)**2-(q-labels)**2)
        scores[arm]['paired_game_brier_delta_interval_95_vs_grid']=np.quantile(sums[draws].sum(1)/sizes[draws].sum(1),[.025,.975]).tolist()
    fast=np.array([r['cell']>=0 and r['cell']//5<3 and r['cell']%5>=2 for r in rows])
    slices={'fast_lateral':{'events':int(fast.sum()),'goals':int(labels[fast].sum()),**{n:float(v[fast].sum()) for n,v in candidates.items()}}}
    write('predictions.json',output);write('summary.json',{'scores':scores,'independent_metrics':independent,'slices':slices,
        'events':len(rows),'production_changed':False,'publishable':False})
    data.verify();write('source-sha256.json',{**data.closure.checked,**pins})
    write('health.json',{'status':'complete-grid-context-calibration','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({'scores':{n:{k:v for k,v in m.items() if k!='reliability'} for n,m in scores.items()},'slices':slices},flush=True)


if __name__=='__main__':run()
