"""Explicit legacy-style composite percentage comparison on recorded-event proxies."""
import json
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from threadpoolctl import threadpool_limits
from projections import verified_movement_reuse_v2 as reuse
from projections import development_experiment as development
from run_raw_learning_logic import ROOT, BASE, sha

OUT = ROOT/'scripts/proof/results/pass-factor-percentages-20260907'
MIXES = {'legacy_mix':[.4,.3,.2,.1], 'movement_mix':[.3,.3,.3,.1], 'immediacy_mix':[.3,.4,.2,.1]}


def components(raw, names):
    def c(n): return raw[:,names.index(n)]
    px,py = c('previous_x_in_shooting_frame_ft'), c('previous_y_in_shooting_frame_ft')
    distance = np.hypot(89-px,py)
    angle = np.degrees(np.arctan2(np.abs(py),np.abs(89-px)))
    zone = np.select([distance<10,distance<20,distance<35,distance<60,distance>=60],
        [1.,np.where(angle<30,.9,.7),np.where(angle<30,.6,.5),np.where(angle<45,.4,.3),.2],default=np.nan)
    elapsed = c('seconds_since_immediate_event')
    immediacy = np.maximum(0,1-elapsed/3)
    lateral = np.abs(c('y_attacking')-py)
    movement = np.minimum(1,lateral/50)*immediacy
    proximity = np.maximum(0,1-distance/100)
    values = np.column_stack((zone,immediacy,movement,proximity))
    owner = c('immediate_previous_event_same_team')
    valid = (owner==1)&np.isfinite(values).all(axis=1)&(elapsed>=0)
    # Explicit different population: immediate recorded same-team event, NOT tracked pass.
    values[owner==0] = 0
    values[(owner!=0)&~valid] = np.nan
    return values


def score(p,y):
    q=np.clip(p,1e-6,1-1e-6)
    bins=np.minimum((p*10).astype(int),9)
    calibration=[]
    for b in range(10):
        m=bins==b
        calibration.append({'events':int(m.sum()),'predicted':float(p[m].mean()) if m.any() else None,'observed':float(y[m].mean()) if m.any() else None})
    ece=sum(r['events']*abs(r['predicted']-r['observed']) for r in calibration if r['events'])/len(p)
    return {'auc':float(roc_auc_score(y,p)), 'brier':float(np.mean((p-y)**2)),
        'log_loss':float(np.mean(-y*np.log(q)-(1-y)*np.log1p(-q))),
        'ece_10_equal_width':ece, 'calibration_bias':float(p.mean()-y.mean()), 'reliability':calibration}


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json',{'mixes':MIXES,'component_order':['zone','immediacy','movement','distance'],
        'design':'Append one composite and missing flag to identical original inputs; change percentages only across composite arms.',
        'proxy_boundary':'Immediate recorded event, not verified legacy pass attribution. Explicit shooting frame; no sign-based coordinate flip.',
        'code_sha256':sha(Path(__file__)),'production_changed':False})
    health=json.loads((BASE/'health.json').read_bytes())
    for name,digest in health['files'].items():assert sha(BASE/name)==digest
    data=reuse.load(ROOT);summary={}
    for fold,parts in data.folds.items():
        rows={s:p['rows'] for s,p in parts.items()}
        raw={s:development._numeric(r,data.schema) for s,r in rows.items()}
        vocab,_=development._vocabulary_and_design_bound(rows,data.schema,data.config)
        medians=np.nanmedian(raw['train'],axis=0)
        xx={s:development._design(r,data.schema,medians,vocab,data.config)['enhanced_context'] for s,r in rows.items()}
        cc={s:components(r,data.schema['names']) for s,r in raw.items()}
        yy={s:np.array([int(r['label']) for r in rr]) for s,rr in rows.items()}
        saved=json.loads((BASE/f'{fold}-predictions.json').read_bytes())
        assert len(saved)==len(rows['validation'])
        for a,b in zip(saved,rows['validation']):
            assert all(a[k]==b[k] for k in ('game_id','event_id','game_date')) and a['target']==int(b['label'])
        predictions={'original_raw':np.array([r['reference_raw'] for r in saved])}
        for name,mix in MIXES.items():
            value={s:v@np.array(mix) for s,v in cc.items()}
            median=float(np.nanmedian(value['train']))
            assert np.isfinite(median)
            design={s:np.column_stack((xx[s],np.where(np.isnan(v),median,v),np.isnan(v).astype(float))) for s,v in value.items()}
            with threadpool_limits(limits=1):
                model=HistGradientBoostingClassifier(**data.config['context'],random_state=data.config['seed']).fit(design['train'],yy['train'])
                predictions[name]=model.predict_proba(design['validation'])[:,1]
            print(f'{fold}/{name}: percentage mix retrained',flush=True)
        report={name:score(p,yy['validation']) for name,p in predictions.items()}
        summary[fold]=report
        write(f'{fold}-predictions.json',[{**{k:r[k] for k in ('game_id','event_id','game_date')},'target':int(r['label']),
            **{name:float(p[i]) for name,p in predictions.items()}} for i,r in enumerate(rows['validation'])])
        print({fold:{n:{k:v for k,v in r.items() if k!='reliability'} for n,r in report.items()}},flush=True)
    data.verify()
    write('source-sha256.json',data.closure.checked)
    write('summary.json',{'folds':summary,'production_changed':False,'model_accepted':False,
        'limitations':['Previously inspected historical development, not untouched validation.','Recorded-event proxy test, not legacy deployed-model replay.','ECE depends on chosen bins; report reliability and bias alongside it.']})
    write('health.json',{'status':'complete-pass-factor-percentages','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})


if __name__=='__main__':run()
