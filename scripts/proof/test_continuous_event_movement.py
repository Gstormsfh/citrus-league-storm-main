"""Replace lateral/time correction buckets with continuous event-specific bases.

Earlier-only residual fit; frozen ensemble unchanged; adaptive development test.
"""
import json,math
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from projections import verified_movement_reuse_v2 as reuse
from run_bounded_xg_refresh import ROOT,sha
from test_targeted_last_season_adjustments import TRAIN,logit,metrics
from test_grid_context_calibration import OUT as CONTEXT,tokens,matrix
from evaluate_frozen_last_season import FEATURES,OUT as FROZEN
from review_last_season_evaluation import evaluate

OUT=ROOT/'scripts/proof/results/continuous-event-movement-20260907'
TAUS=(.5,1.5,4.)


def movement(row,names):
    def f(n):return row['features'][names.index(n)]
    t=f('seconds_since_immediate_event');d=f('immediate_recorded_live_event__event_lateral_displacement_ft')
    longitudinal=f('immediate_recorded_live_event__event_longitudinal_displacement_ft')
    out=np.zeros(27)
    if f('immediate_recorded_live_event__same_team_indicator')!=1:return out
    if any(v is None or not math.isfinite(v) for v in (t,d,longitudinal)):return out
    if t<=0 or d<0 or longitudinal<0:return out
    prior=str(row['categorical']['previous_event_type']);group=0 if prior=='506' else 1 if prior=='507' else 2
    lateral=d/40.;fraction=d/(d+longitudinal) if d+longitudinal else 0.
    out[group*9:(group+1)*9]=[b*math.exp(-t/tau) for b in (lateral,lateral*lateral,fraction) for tau in TAUS]
    return out


def temporal(row,names,priors):
    out=np.zeros(len(priors)*4);p=str(row['categorical']['previous_event_type'])
    gap=row['features'][names.index('seconds_since_immediate_event')]
    if p not in priors or gap is None or not math.isfinite(gap) or gap<0:return out
    i=priors.index(p)*4
    out[i:i+4]=[1.,0.,0.,0.] if gap==0 else [0.]+[math.exp(-gap/t) for t in TAUS]
    return out


def design(rows,names,vocabulary,priors):
    return np.column_stack((matrix(rows,names,vocabulary),np.array([temporal(r,names,priors) for r in rows]),
        np.array([movement(r,names) for r in rows])))


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json',{'arm':'continuous event-specific residual movement','ridge':10,
        'movement':'lateral/40, squared lateral/40, lateral share of lateral+longitudinal, crossed with exp(-elapsed/tau)',
        'tau_seconds':TAUS,'groups':['prior code506','prior code507','other recorded event'],
        'temporal':'Prior-event-specific smooth decay plus separate recorded-zero indicator',
        'no_lateral_or_positive_time_buckets':True,'no_monotonicity_claim_for_unverified_passes':True,
        'training':'2023-24 prequential ensemble only','test_status':'Adaptively inspected 2025-26 development',
        'production_changed':False,'code_sha256':sha(Path(__file__))})
    pins={}
    for folder in (TRAIN,CONTEXT,FEATURES,FROZEN):
        h=json.loads((folder/'health.json').read_bytes());pins[str(folder/'health.json')]=sha(folder/'health.json')
        for name,digest in h['files'].items():assert sha(folder/name)==digest
    data=reuse.load(ROOT);names=data.schema['names']
    earlier=json.loads((TRAIN/'fold2-predictions.json').read_bytes())
    idx={(r['game_id'],r['event_id']):r for r in data.folds['fold2']['validation']['rows']};assert len(idx)==len(earlier)
    train=[idx[r['game_id'],r['event_id']] for r in earlier]
    assert all(r['target']==int(f['label']) and r['game_date']==f['game_date'] for r,f in zip(earlier,train))
    y=np.array([r['target'] for r in earlier],float);p=np.array([r['symmetric_geometry'] for r in earlier]);z=logit(p)
    vocabulary=sorted({t for r in train for t in tokens(r,names) if not t.startswith('prior_time=')})
    xx=matrix(train,names,vocabulary);counts=xx.sum(0);goals=xx.T@y
    supported=(counts>=500)&(goals>=20)&((counts-goals)>=20);vocabulary=[v for v,s in zip(vocabulary,supported) if s]
    priors=[v.split('=',1)[1] for v in vocabulary if v.startswith('prior=')]
    x=np.column_stack((np.ones(len(p)),z,design(train,names,vocabulary,priors)))
    prior=np.zeros(x.shape[1]);prior[1]=1;penalty=np.full(x.shape[1],10.);penalty[0]=0
    def obj(beta):
        eta=x@beta;delta=beta-prior
        return float(np.sum(np.logaddexp(0,eta)-np.logaddexp(0,z)-y*(eta-z))+.5*np.sum(penalty*delta**2)),x.T@(expit(eta)-y)+penalty*delta
    opt=minimize(obj,prior,jac=True,method='BFGS',options={'gtol':1e-6,'maxiter':400})
    grad=obj(opt.x)[1];assert np.max(np.abs(grad))<1e-4 and 0<opt.x[1]<5 and np.max(np.abs(opt.x))<10
    fit={'coefficients':opt.x.tolist(),'vocabulary':vocabulary,'priors':priors,'tau_seconds':TAUS,
        'gradient_max':float(np.max(np.abs(grad))),'training_end':max(r['game_date'] for r in earlier),'ridge':10}
    write('fit.json',fit);print({'fit_parameters':len(opt.x),'gradient_max':fit['gradient_max']},flush=True)
    rows=json.loads((CONTEXT/'predictions.json').read_bytes());frozen=json.loads((FROZEN/'predictions.json').read_bytes())
    assert len(rows)==len(frozen) and all((r['game_id'],r['event_id'],r['target'])==(s['game_id'],s['event_id'],s['target']) for r,s in zip(rows,frozen))
    fi={}
    for game in json.loads((FEATURES/'game-inventory.json').read_bytes()):
        for r in json.loads((FEATURES/f"{game['game_id']}.json").read_bytes()):
            key=r['game_id'],r['event_id'];assert key not in fi;fi[key]=r
    assert len(fi)==len(rows);test=[fi[r['game_id'],r['event_id']] for r in rows]
    assert all(int(f['label'])==r['target'] and f['game_date']==r['game_date'] for f,r in zip(test,rows))
    assert max(r['game_date'] for r in earlier)<min(r['game_date'] for r in rows)
    assert not {r['game_id'] for r in earlier}&{r['game_id'] for r in rows}
    tx=np.column_stack((np.ones(len(rows)),logit(np.array([r['ensemble'] for r in frozen])),design(test,names,vocabulary,priors)))
    q=np.clip(expit(tx@opt.x),1e-6,1-1e-6);labels=np.array([r['target'] for r in rows],float)
    candidates={n:np.array([r[n] for r in rows]) for n in ('previous_joint_four','grid','event_context')};candidates['continuous']=q
    scores={n:metrics(v,labels) for n,v in candidates.items()}
    output=[{**{k:r[k] for k in ('game_id','event_id','game_date','target','cell')},**{n:float(v[i]) for n,v in candidates.items()}} for i,r in enumerate(rows)]
    independent={n:evaluate(output,n) for n in candidates}
    for n,m in independent.items():
        for k,v in m.items():assert abs(v-scores[n][k])<1e-11
    fast=np.array([r['cell']>=0 and r['cell']//5<3 and r['cell']%5>=2 for r in rows])
    slices={'fast_lateral':{'events':int(fast.sum()),'goals':int(labels[fast].sum()),**{n:float(v[fast].sum()) for n,v in candidates.items()}}}
    write('predictions.json',output);write('summary.json',{'scores':scores,'independent_metrics':independent,'slices':slices,
        'events':len(rows),'production_changed':False,'publishable':False})
    data.verify();write('source-sha256.json',{**data.closure.checked,**pins})
    write('health.json',{'status':'complete-continuous-event-movement','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({'scores':{n:{k:v for k,v in m.items() if k!='reliability'} for n,m in scores.items()},'slices':slices},flush=True)


if __name__=='__main__':run()
