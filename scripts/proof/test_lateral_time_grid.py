"""Earlier-only distance/time residual grid; adaptive development, not production."""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from projections import verified_movement_reuse_v2 as reuse
from run_bounded_xg_refresh import ROOT,sha
from test_targeted_last_season_adjustments import TRAIN,TEST,logit,metrics
from test_joint_residual_adjustments import indicators,adjust,OUT as PRIOR
from evaluate_frozen_last_season import FEATURES
from review_last_season_evaluation import evaluate

OUT=ROOT/'scripts/proof/results/lateral-time-grid-20260907'
DIST=['lt5','5to10','10to20','20to40','40plus']
TIME=['same_clock','positive_to1','over1_to3','over3_to10']
NAMES=['same_timestamp','five_on_four','under10']+[f'{t}__{d}' for t in TIME for d in DIST]


def cell(row,names):
    def f(n):return row['features'][names.index(n)]
    t=f('seconds_since_immediate_event');d=f('immediate_recorded_live_event__event_lateral_displacement_ft')
    if f('immediate_recorded_live_event__same_team_indicator')!=1 or t is None or d is None:return -1
    if not np.isfinite(t) or not np.isfinite(d) or not 0<=t<=10 or d<0:return -1
    ti=0 if t==0 else 1 if t<=1 else 2 if t<=3 else 3
    di=0 if d<5 else 1 if d<10 else 2 if d<20 else 3 if d<40 else 4
    return ti*5+di


def design(rows,names):
    x=np.zeros((len(rows),23));cells=[]
    for i,r in enumerate(rows):
        old=indicators(r,names);x[i,:3]=[old[0],old[1],old[3]]
        c=cell(r,names);cells.append(c)
        if c>=0:x[i,3+c]=1
    return x,np.array(cells)


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json',{'arm':'joint distance-by-time residual grid','names':NAMES,'ridge_to_previous_fit':3,
        'minimum_cell_events':100,'minimum_cell_goals_and_non_goals':5,
        'sparse_cell_behavior':'retain previous coarse correction; no category deletion',
        'training':'2023-24 prequential ensemble only','test_status':'Adaptively inspected 2025-26 development',
        'continuous_base_inputs_unchanged':True,'production_changed':False,'code_sha256':sha(Path(__file__))})
    pins={}
    for folder in (TRAIN,TEST,PRIOR,FEATURES):
        h=json.loads((folder/'health.json').read_bytes());pins[str(folder/'health.json')]=sha(folder/'health.json')
        for name,digest in h['files'].items():assert sha(folder/name)==digest
    data=reuse.load(ROOT)
    earlier=json.loads((TRAIN/'fold2-predictions.json').read_bytes())
    idx={(r['game_id'],r['event_id']):r for r in data.folds['fold2']['validation']['rows']}
    assert len(idx)==len(earlier)
    train=[idx[r['game_id'],r['event_id']] for r in earlier]
    assert all(r['target']==int(f['label']) and r['game_date']==f['game_date'] for r,f in zip(earlier,train))
    x,tc=design(train,data.schema['names']);y=np.array([r['target'] for r in earlier],float)
    base=np.array([r['symmetric_geometry'] for r in earlier])
    old=json.loads((PRIOR/'fits.json').read_bytes())['joint_four']['offsets']
    prior=np.array([old[0],old[1],old[3]]+[old[2] if ti<3 and di>=2 else 0. for ti in range(4) for di in range(5)])
    counts=x.sum(0);goals=x.T@y
    supported=(counts>=100)&(goals>=5)&((counts-goals)>=5)
    active=x.any(axis=1);xx=x[active][:,supported];yy=y[active]
    z=logit(base[active])+x[active]@prior
    def objective(delta):
        eta=z+xx@delta
        return float(np.sum(np.logaddexp(0,eta)-np.logaddexp(0,z)-yy*(eta-z))+1.5*(delta@delta)),xx.T@(expit(eta)-yy)+3*delta
    opt=minimize(objective,np.zeros(int(supported.sum())),jac=True,method='BFGS',options={'gtol':1e-7,'maxiter':250})
    gradient=objective(opt.x)[1];assert np.max(np.abs(gradient))<1e-5
    beta=prior.copy();beta[supported]+=opt.x
    assert np.isfinite(beta).all() and np.max(np.abs(beta))<10 and np.array_equal(beta[~supported],prior[~supported])
    fit={'names':NAMES,'offsets':beta.tolist(),'prior_offsets':prior.tolist(),'supported':supported.tolist(),
        'events':counts.astype(int).tolist(),'goals':goals.astype(int).tolist(),'gradient_max':float(np.max(np.abs(gradient))),
        'training_end':max(r['game_date'] for r in earlier),'ridge_to_prior':3}
    write('fit.json',fit);print({'fit':fit},flush=True)
    rows=json.loads((TEST/'predictions.json').read_bytes());previous=json.loads((PRIOR/'predictions.json').read_bytes())
    assert len(rows)==len(previous) and all((r['game_id'],r['event_id'],r['target'])==(s['game_id'],s['event_id'],s['target']) for r,s in zip(rows,previous))
    feature_index={}
    for game in json.loads((FEATURES/'game-inventory.json').read_bytes()):
        for r in json.loads((FEATURES/f"{game['game_id']}.json").read_bytes()):
            key=r['game_id'],r['event_id'];assert key not in feature_index;feature_index[key]=r
    assert len(feature_index)==len(rows)
    test=[feature_index[r['game_id'],r['event_id']] for r in rows]
    assert all(int(f['label'])==r['target'] and f['game_date']==r['game_date'] for f,r in zip(test,rows))
    assert max(r['game_date'] for r in earlier)<min(r['game_date'] for r in rows)
    assert not {r['game_id'] for r in earlier}&{r['game_id'] for r in rows}
    tx,cells=design(test,data.schema['names']);p=np.array([r['ensemble'] for r in rows]);labels=np.array([r['target'] for r in rows],float)
    reference=np.array([r['joint_four'] for r in previous]);assert np.max(np.abs(adjust(p,tx,prior)-reference))<1e-12
    q=adjust(p,tx,beta);candidates={'previous_joint_four':reference,'lateral_time_grid':q}
    scores={name:metrics(v,labels) for name,v in candidates.items()}
    output=[{**{k:r[k] for k in ('game_id','event_id','game_date','target')},'cell':int(cells[i]),**{n:float(v[i]) for n,v in candidates.items()}} for i,r in enumerate(rows)]
    independent={n:evaluate(output,n) for n in candidates}
    for n,mm in independent.items():
        for k,v in mm.items():assert abs(v-scores[n][k])<1e-11
    _,inv=np.unique([r['game_id'] for r in rows],return_inverse=True);sizes=np.bincount(inv)
    draws=np.random.default_rng(20260907).integers(0,len(sizes),size=(2000,len(sizes)))
    sums=np.bincount(inv,weights=(q-labels)**2-(reference-labels)**2)
    interval=np.quantile(sums[draws].sum(1)/sizes[draws].sum(1),[.025,.975]).tolist()
    slices={}
    for i in range(20):
        mask=cells==i
        slices[NAMES[i+3]]={'events':int(mask.sum()),'goals':int(labels[mask].sum()),'earlier_events':int(counts[i+3]),
            'earlier_goals':int(goals[i+3]),'supported':bool(supported[i+3]),'offset':float(beta[i+3]),
            'previous_xg':float(reference[mask].sum()),'new_xg':float(q[mask].sum()),
            'brier_delta':float(np.mean((q[mask]-labels[mask])**2-(reference[mask]-labels[mask])**2)) if mask.any() else None}
    fast=np.array([r['fast_lateral']=='True' for r in rows])
    summary={'scores':scores,'independent_metrics':independent,'paired_game_brier_delta_interval_95':interval,
        'events':len(rows),'fast_lateral':{'events':int(fast.sum()),'goals':int(labels[fast].sum()),
        'previous_xg':float(reference[fast].sum()),'new_xg':float(q[fast].sum())},
        'production_changed':False,'publishable':False}
    write('predictions.json',output);write('summary.json',summary);write('cells.json',slices)
    data.verify();write('source-sha256.json',{**data.closure.checked,**pins})
    write('health.json',{'status':'complete-lateral-time-grid','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({'scores':{n:{k:v for k,v in s.items() if k!='reliability'} for n,s in scores.items()},'interval':interval,'fast_lateral':summary['fast_lateral']},flush=True)


if __name__=='__main__':run()
