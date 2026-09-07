"""Earlier-only test of prior recorded outcomes and geometry interactions."""
import json,math
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from projections import verified_movement_reuse_v2 as reuse
from projections.pre_shot_history import project as history
from run_bounded_xg_refresh import ROOT,sha
from test_targeted_last_season_adjustments import TRAIN,logit,metrics
from test_continuous_event_movement import OUT as BASE,design as base_design
from evaluate_frozen_last_season import FEATURES,OUT as FROZEN
from export_last_season_candidate_features import FREEZE
from review_last_season_evaluation import evaluate

OUT=ROOT/'scripts/proof/results/prior-reason-geometry-20260907'
GEOMETRY=['crossing_decay','noncrossing_decay','angle_decay','angle_close_decay','lateral_close_decay','behind_net_origin_decay']


def prior_reasons(payload):
    context=history(payload['plays'],home=payload['homeTeam']['id'],away=payload['awayTeam']['id'])
    index={r['eventId']:r for r in payload['plays']};out={}
    for eid,c in context.items():
        previous=c['immediate_recorded_live_event'];pid=previous['prior_event_id']
        if pid is None or previous['prior_owner_relation']!='same_team':out[eid]=None;continue
        p=index[pid];reason=p.get('details',{}).get('reason')
        out[eid]=str(p['typeCode'])+'|'+reason if p['typeCode'] in (507,508) and isinstance(reason,str) and reason else None
    return out


def numeric(row,names):
    def f(n):return row['features'][names.index(n)]
    t=f('seconds_since_immediate_event');a=f('immediate_recorded_live_event__event_angle_change_deg')
    c=f('immediate_recorded_live_event__event_crossed_centerline');d=f('distance_to_goal_ft')
    lateral=f('immediate_recorded_live_event__event_lateral_displacement_ft');origin=f('previous_x_in_shooting_frame_ft')
    if f('immediate_recorded_live_event__same_team_indicator')!=1 or t is None or t<0:return [0.]*6,0.
    decay=math.exp(-t/3);close=math.exp(-d/20) if d is not None else 0.
    return [decay if c==1 else 0.,decay if c==0 else 0.,(a/90)*decay if a is not None else 0.,
        (a/90)*close*decay if a is not None else 0.,(lateral/40)*close*decay if lateral is not None else 0.,
        decay if origin is not None and origin>89 else 0.],decay


def design(rows,names,reasons,vocabulary):
    lookup={v:i for i,v in enumerate(vocabulary)};x=np.zeros((len(rows),6+len(vocabulary)))
    for i,(r,reason) in enumerate(zip(rows,reasons)):
        values,decay=numeric(r,names);x[i,:6]=values
        if reason in lookup:x[i,6+lookup[reason]]=decay
    return x


def write(n,v):
    with (OUT/n).open('x') as f:json.dump(v,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False);write('declaration.json',{'arms':['geometry','geometry_and_prior_reason'],'ridge':10,
        'geometry_names':GEOMETRY,'reason_support':'at least 100 events and five goals/non-goals in earlier fit data',
        'training':'2023-24 only, frozen continuous candidate plus residual fit','test_status':'Adaptive 2025-26 development, not untouched holdout',
        'current_outcome_reason_never_used':True,'production_changed':False,'code_sha256':sha(Path(__file__))})
    pins={}
    for folder in (TRAIN,BASE,FROZEN,FEATURES):
        h=json.loads((folder/'health.json').read_bytes());pins[str(folder/'health.json')]=sha(folder/'health.json')
        for name,digest in h['files'].items():assert sha(folder/name)==digest
    assert sha(FREEZE/'manifest.json')=='2dd3b6851e75fe004d47ea0a10f7a98cf13a46776729f00ab6f14a881ce154a9'
    manifest={g['game_id']:g for g in json.loads((FREEZE/'manifest.json').read_bytes())['games']}
    data=reuse.load(ROOT);names=data.schema['names'];earlier=json.loads((TRAIN/'fold2-predictions.json').read_bytes())
    idx={(r['game_id'],r['event_id']):r for r in data.folds['fold2']['validation']['rows']};assert len(idx)==len(earlier)
    train=[idx[r['game_id'],r['event_id']] for r in earlier]
    assert all(int(f['label'])==r['target'] and f['game_date']==r['game_date'] for f,r in zip(train,earlier))
    cache={}
    def load_reasons(rows):
        for gid in sorted({r['game_id'] for r in rows}):
            if gid in cache:continue
            path=FREEZE/f'{gid//1000000}/pbp/{gid}.body.json';digest=sha(path);assert digest==manifest[gid]['body_sha256'];pins[str(path)]=digest
            cache[gid]=prior_reasons(json.loads(path.read_bytes()))
        return [cache[r['game_id']][r['event_id']] for r in rows]
    reasons=load_reasons(train);labels=np.array([r['target'] for r in earlier],float)
    fit=json.loads((BASE/'fit.json').read_bytes());basep=np.array([r['symmetric_geometry'] for r in earlier])
    bx=np.column_stack((np.ones(len(train)),logit(basep),base_design(train,names,fit['vocabulary'],fit['priors'])))
    p=np.clip(expit(bx@np.array(fit['coefficients'])),1e-6,1-1e-6)
    vocabulary=sorted({v for v in reasons if v is not None});support=[];kept=[]
    for reason in vocabulary:
        m=np.array([r==reason for r in reasons]);n=int(m.sum());g=int(labels[m].sum());ok=n>=100 and g>=5 and n-g>=5
        support.append({'reason':reason,'events':n,'goals':g,'supported':ok})
        if ok:kept.append(reason)
    x=design(train,names,reasons,kept);fits={}
    for arm,k in [('geometry',6),('geometry_and_prior_reason',x.shape[1])]:
        active=x[:,:k].any(1);xx=x[active,:k];z=logit(p[active]);y=labels[active]
        def obj(beta):
            eta=z+xx@beta
            return float(np.sum(np.logaddexp(0,eta)-np.logaddexp(0,z)-y*(eta-z))+5*(beta@beta)),xx.T@(expit(eta)-y)+10*beta
        opt=minimize(obj,np.zeros(k),jac=True,method='BFGS',options={'gtol':1e-6,'maxiter':250});gradient=obj(opt.x)[1]
        assert np.max(np.abs(gradient))<1e-4 and np.max(np.abs(opt.x))<10
        fits[arm]={'coefficients':opt.x.tolist(),'vocabulary':kept if k>6 else [],'ridge':10,'training_end':max(r['game_date'] for r in earlier),'gradient_max':float(np.max(np.abs(gradient)))}
    write('fits.json',fits);write('reason-support.json',support);print({'fits':fits,'support':support},flush=True)
    rows=json.loads((BASE/'predictions.json').read_bytes());fi={}
    for game in json.loads((FEATURES/'game-inventory.json').read_bytes()):
        for r in json.loads((FEATURES/f"{game['game_id']}.json").read_bytes()):
            key=r['game_id'],r['event_id'];assert key not in fi;fi[key]=r
    assert len(fi)==len(rows);test=[fi[r['game_id'],r['event_id']] for r in rows]
    assert all(int(f['label'])==r['target'] and f['game_date']==r['game_date'] for f,r in zip(test,rows))
    assert max(r['game_date'] for r in earlier)<min(r['game_date'] for r in rows)
    assert not {r['game_id'] for r in earlier}&{r['game_id'] for r in rows}
    tr=load_reasons(test);base=np.array([r['continuous'] for r in rows]);y=np.array([r['target'] for r in rows],float)
    candidates={'continuous':base}
    for arm,f in fits.items():
        tx=design(test,names,tr,f['vocabulary']);delta=tx@np.array(f['coefficients']);q=base.copy();m=delta!=0
        q[m]=np.clip(expit(logit(base[m])+delta[m]),1e-6,1-1e-6);assert np.array_equal(q[~m],base[~m]);candidates[arm]=q
    output=[{**{k:r[k] for k in ('game_id','event_id','game_date','target','cell')},'prior_reason':tr[i],**{n:float(v[i]) for n,v in candidates.items()}} for i,r in enumerate(rows)]
    scores={n:metrics(v,y) for n,v in candidates.items()};independent={n:evaluate(output,n) for n in candidates}
    for n,m in independent.items():
        for k,v in m.items():assert abs(v-scores[n][k])<1e-11
    fast=np.array([r['cell']>=0 and r['cell']//5<3 and r['cell']%5>=2 for r in rows])
    write('predictions.json',output);summary={'scores':scores,'independent_metrics':independent,'fast_lateral':{'goals':int(y[fast].sum()),**{n:float(v[fast].sum()) for n,v in candidates.items()}},'production_changed':False,'publishable':False}
    write('summary.json',summary);data.verify();write('source-sha256.json',{**data.closure.checked,**pins})
    write('health.json',{'status':'complete-prior-reason-geometry','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({**summary,'scores':{n:{k:v for k,v in m.items() if k!='reliability'} for n,m in scores.items()},'independent_metrics':'verified'},flush=True)


if __name__=='__main__':run()
