"""Earlier-only joint residual correction; adaptively inspected development test.

Fixed ridge1 arms declared before execution, versus existing ridge10 corrections.
No event deletion, no current-season fitting, no production publication.
"""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize, check_grad
from scipy.special import expit
from projections import verified_movement_reuse_v2 as reuse
from run_bounded_xg_refresh import ROOT, sha
from test_targeted_last_season_adjustments import TRAIN, TEST, logit, metrics

PRIOR=ROOT/'scripts/proof/results/targeted-earlier-adjustments-20260907'
OUT=ROOT/'scripts/proof/results/joint-residual-adjustments-20260907'
GROUPS=['same_timestamp','five_on_four','fast_lateral','under10']


def indicators(row,names):
    def f(name):return row['features'][names.index(name)]
    gap=f('seconds_since_immediate_event')
    lateral=f('immediate_recorded_live_event__event_lateral_displacement_ft')
    distance=f('distance_to_goal_ft')
    return [f('immediate_previous_sog_same_team')==1 and gap==0,
        f('shooting_skaters')==5 and f('defending_skaters')==4,
        f('immediate_recorded_live_event__same_team_indicator')==1 and gap is not None and 0<=gap<=3 and lateral is not None and lateral>=10,
        distance is not None and distance<10]


def objective(beta,x,z,y,ridge=1.):
    eta=z+x@beta
    # Relative likelihood avoids an irrelevant large constant during optimization.
    value=np.sum(np.logaddexp(0,eta)-np.logaddexp(0,z)-y*(eta-z))+.5*ridge*(beta@beta)
    gradient=x.T@(expit(eta)-y)+ridge*beta
    return value,gradient


def adjust(base,x,beta):
    delta=x@beta;result=np.array(base,copy=True);mask=delta!=0
    result[mask]=np.clip(expit(logit(result[mask])+delta[mask]),1e-6,1-1e-6)
    assert np.array_equal(result[~mask],np.asarray(base)[~mask])
    return result


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json',{'arms':{'joint_two':GROUPS[:2],'joint_four':GROUPS},'ridge':1,
        'training':'2023-24 prequential frozen ensemble probabilities and original features',
        'comparison':'Current strongest both-ridge10 adjustment, not unadjusted baseline',
        'test_status':'Adaptively inspected 2025-26 development retest, not untouched holdout',
        'production_changed':False,'code_sha256':sha(Path(__file__))})
    pins={}
    for folder in (TRAIN,TEST,PRIOR):
        h=json.loads((folder/'health.json').read_bytes());pins[str(folder/'health.json')]=sha(folder/'health.json')
        for name,digest in h['files'].items():assert sha(folder/name)==digest
    data=reuse.load(ROOT)
    earlier=json.loads((TRAIN/'fold2-predictions.json').read_bytes())
    index={(r['game_id'],r['event_id']):r for r in data.folds['fold2']['validation']['rows']}
    assert len(index)==len(earlier)
    features=[index[r['game_id'],r['event_id']] for r in earlier]
    assert all(r['target']==int(f['label']) and r['game_date']==f['game_date'] for r,f in zip(earlier,features))
    x=np.array([indicators(r,data.schema['names']) for r in features],dtype=float)
    p=np.array([r['symmetric_geometry'] for r in earlier]);y=np.array([r['target'] for r in earlier],dtype=float)
    fits={}
    for name,k in [('joint_two',2),('joint_four',4)]:
        active=x[:,:k].any(axis=1);xx=x[active,:k];zz=logit(p[active]);yy=y[active]
        assert np.linalg.matrix_rank(xx)==k and np.all(xx.sum(0)>=100)
        assert np.all(xx.T@yy>0) and np.all(xx.T@(1-yy)>0)
        # Small deterministic numerical gradient check, independent of outcomes below.
        gx=np.array([[1,0,1,0],[0,1,1,1],[1,1,0,1]],dtype=float)[:,:k]
        gz=np.array([-2.,-1.,-.5]);gy=np.array([0.,1.,0.]);b=np.full(k,-.2)
        error=check_grad(lambda v:objective(v,gx,gz,gy)[0],lambda v:objective(v,gx,gz,gy)[1],b)
        assert error<1e-6
        opt=minimize(lambda b:objective(b,xx,zz,yy),np.zeros(k),jac=True,method='BFGS',options={'gtol':1e-7,'maxiter':200})
        grad=objective(opt.x,xx,zz,yy)[1]
        assert np.max(np.abs(grad))<1e-5 and np.max(np.abs(opt.x))<10
        fits[name]={'groups':GROUPS[:k],'offsets':opt.x.tolist(),'ridge':1,'gradient':grad.tolist(),
            'gradient_check_error':float(error),'training_end':max(r['game_date'] for r in earlier),
            'events':len(yy),'group_events':xx.sum(0).astype(int).tolist(),'group_goals':(xx.T@yy).astype(int).tolist()}
    write('fits.json',fits)
    print({'fits':fits},flush=True)
    rows=json.loads((TEST/'predictions.json').read_bytes());prior=json.loads((PRIOR/'predictions.json').read_bytes())
    assert len(rows)==len(prior) and all((r['game_id'],r['event_id'],r['target'])==(s['game_id'],s['event_id'],s['target']) for r,s in zip(rows,prior))
    assert max(r['game_date'] for r in earlier)<min(r['game_date'] for r in rows)
    assert not {r['game_id'] for r in earlier}&{r['game_id'] for r in rows}
    tx=np.array([[r['timing_band']=='same_clock',r['strength']=='5v4',r['fast_lateral']=='True',r['distance_band']=='under10'] for r in rows],dtype=float)
    base=np.array([r['ensemble'] for r in rows]);labels=np.array([r['target'] for r in rows],dtype=float)
    previous=np.array([r['both'] for r in prior]);candidates={'previous_ridge10':previous}
    for name,f in fits.items():candidates[name]=adjust(base,tx[:,:len(f['groups'])],np.array(f['offsets']))
    scores={name:metrics(q,labels) for name,q in candidates.items()}
    _,inverse=np.unique([r['game_id'] for r in rows],return_inverse=True);sizes=np.bincount(inverse)
    draws=np.random.default_rng(20260907).integers(0,len(sizes),size=(2000,len(sizes)))
    for name,q in candidates.items():
        sums=np.bincount(inverse,weights=(q-labels)**2-(previous-labels)**2)
        scores[name]['paired_game_brier_delta_interval_95']=np.quantile(sums[draws].sum(1)/sizes[draws].sum(1),[.025,.975]).tolist()
    slices={g:{name:{'events':int(tx[:,i].sum()),'goals':int(labels[tx[:,i]==1].sum()),'xg':float(q[tx[:,i]==1].sum())} for name,q in candidates.items()} for i,g in enumerate(GROUPS)}
    write('predictions.json',[{**{k:r[k] for k in ('game_id','event_id','game_date','target')},**{n:float(q[i]) for n,q in candidates.items()}} for i,r in enumerate(rows)])
    write('summary.json',{'scores':scores,'slices':slices,'events':len(rows),'publishable':False,'production_changed':False})
    data.verify()
    write('source-sha256.json',{**data.closure.checked,**pins})
    write('health.json',{'status':'complete-joint-residual-adjustments','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({'scores':{n:{k:v for k,v in s.items() if k!='reliability'} for n,s in scores.items()},'slices':slices},flush=True)


if __name__=='__main__':run()
