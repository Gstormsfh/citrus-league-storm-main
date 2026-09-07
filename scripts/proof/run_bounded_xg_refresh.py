"""Bounded chronological training refresh; full inputs, saved native models.

Never loads legacy third-party model/data artifacts. Offline development only.
"""
from pathlib import Path
from datetime import date,timedelta
import json,hashlib,time
import numpy as np
from xgboost import XGBClassifier
from scipy.special import expit
from sklearn.metrics import roc_auc_score
from projections import verified_movement_reuse_v2 as reuse
from projections import development_experiment as development
from projections import conditional_calibration_shape as conditional
from projections.calibration_candidate import context_from_row

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'scripts/proof/results/bounded-xg-refresh-20260907'
REFERENCE=ROOT/'scripts/proof/results/selected-timing-replay-20260907-v2-full'
SETTINGS=dict(n_estimators=600,max_depth=4,learning_rate=.05,min_child_weight=20,
    reg_lambda=10,subsample=.85,colsample_bytree=.9,tree_method='hist',n_jobs=1,
    random_state=60906,objective='binary:logistic',eval_metric='logloss',early_stopping_rounds=40)


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def metrics(p,y):
    p=np.asarray(p,dtype=float);y=np.asarray(y,dtype=float);q=np.clip(p,1e-6,1-1e-6)
    assert np.isfinite(p).all() and ((p>=0)&(p<=1)).all() and set(y)=={0.,1.}
    return {'auc':float(roc_auc_score(y,p)),'brier':float(np.mean((p-y)**2)),
        'correlation':float(np.corrcoef(p,y)[0,1]),'log_loss':float(np.mean(-y*np.log(q)-(1-y)*np.log1p(-q))),
        'calibration_bias':float(p.mean()-y.mean())}


def symmetrize(x,names):
    x=x.copy();yi=names.index('y_attacking');sign=np.where(x[:,yi]<0,-1.,1.)
    for name in ('y_attacking','previous_y_in_shooting_frame_ft','signed_angle_deg'):
        x[:,names.index(name)]*=sign
    return x


def timing_band(rows,names):
    out=[];gi=names.index('seconds_since_immediate_event');si=names.index('immediate_previous_sog_same_team')
    for r in rows:
        g=r['features'][gi];same=r['features'][si]
        out.append(-1 if same!=1 or g is None or g<0 or g>10 else 0 if g==0 else 1 if g<=1 else 2 if g<3 else 3)
    return np.array(out)


def timing_adjust(p,y,rows,names):
    dates=np.array([r['game_date'] for r in rows]);bands=timing_band(rows,names)
    games=np.array([r['game_id'] for r in rows]);q=p.copy();receipts=[]
    z=np.log(np.clip(p,1e-6,1-1e-6))-np.log1p(-np.clip(p,1e-6,1-1e-6))
    for month in sorted({d[:7] for d in dates}):
        cutoff=month+'-01';start=(date.fromisoformat(cutoff)-timedelta(days=90)).isoformat()
        for band in range(4):
            train=(dates>=start)&(dates<cutoff)&(bands==band)
            test=np.array([d[:7]==month for d in dates])&(bands==band)
            assert not set(games[train])&set(games[test])
            offset=0.
            if train.sum()>=30 and len(set(games[train]))>=10:
                lo,hi=-10.,10.
                for _ in range(60):
                    mid=(lo+hi)/2
                    if 10*mid+np.sum(expit(z[train]+mid)-y[train])>0:hi=mid
                    else:lo=mid
                offset=(lo+hi)/2;q[test]=np.clip(expit(z[test]+offset),1e-6,1-1e-6)
            receipts.append({'month':month,'band':band,'events':int(train.sum()),'offset':offset,
                'training_end':max(dates[train]) if train.any() else None})
    return q,receipts


def run():
    started=time.monotonic();OUT.mkdir(exist_ok=False)
    write('declaration.json',{'settings':SETTINGS,'arms':['original_geometry','symmetric_geometry'],
        'chronology':'Original training plus first half of calibration dates train; next quarter stop; final quarter calibrate; original validation untouched by fitting except explicitly earlier-only timing updates.',
        'reference':'Strongest saved selected-timing candidate on exact original validation membership',
        'metrics':['auc','brier','shot_probability_goal_Pearson_correlation'],
        'code_sha256':sha(Path(__file__)),'publishable':False})
    assert sha(REFERENCE/'health.json')=='f295d9ab4f2eba2d3627b832b3709d8ee58ac7dbe002f370863d1be0bd40f78b'
    health=json.loads((REFERENCE/'health.json').read_bytes())
    for name,digest in health['files'].items():assert sha(REFERENCE/name)==digest
    data=reuse.load(ROOT);reports={}
    print('Frozen full-input cohorts and strongest reference verified',flush=True)
    for fold,parts in data.folds.items():
        rows={s:p['rows'] for s,p in parts.items()}
        days=sorted({r['game_date'] for r in rows['calibration']});split1=days[len(days)//2];split2=days[3*len(days)//4]
        stages={'train':rows['train']+[r for r in rows['calibration'] if r['game_date']<split1],
            'stop':[r for r in rows['calibration'] if split1<=r['game_date']<split2],
            'calibrate':[r for r in rows['calibration'] if r['game_date']>=split2], 'validation':rows['validation']}
        keys=list(stages)
        for i,a in enumerate(keys):
            for b in keys[i+1:]:
                assert max(r['game_date'] for r in stages[a])<min(r['game_date'] for r in stages[b])
                assert not {r['game_id'] for r in stages[a]}&{r['game_id'] for r in stages[b]}
        vocab={n:sorted({r['categorical'][n] for r in stages['train'] if r['categorical'][n] is not None}) for n in data.config['views']['enhanced_categorical_names']}
        original_raw={s:development._numeric(r,data.schema) for s,r in stages.items()}
        yy={s:np.array([int(r['label']) for r in rr]) for s,rr in stages.items()}
        reference_rows=json.loads((REFERENCE/f'{fold}-predictions.json').read_bytes())
        reference={(r['game_id'],r['event_id']):r for r in reference_rows}
        targets={(r['game_id'],r['event_id']):r for r in stages['validation']}
        assert set(targets)<=set(reference)
        baseline=np.array([reference[r['game_id'],r['event_id']]['neutral_xg'] for r in stages['validation']])
        predictions={'reference':baseline};fold_report={'reference':metrics(baseline,yy['validation'])}
        write(f'{fold}-stages.json',{s:{'events':len(rr),'start':min(r['game_date'] for r in rr),'end':max(r['game_date'] for r in rr),
            'keys':[[r['game_id'],r['event_id']] for r in rr]} for s,rr in stages.items()})
        for arm in ('original_geometry','symmetric_geometry'):
            raw={s:symmetrize(v,data.schema['names']) if arm=='symmetric_geometry' else v for s,v in original_raw.items()}
            # Same categorical vocabulary; native missing routing for numeric predictors.
            median=np.nanmedian(raw['train'],axis=0)
            xx={s:development._design(rr,data.schema,median,vocab,data.config)['enhanced_context'] for s,rr in stages.items()}
            for s in xx:xx[s][:,:len(data.schema['names'])]=raw[s]
            model=XGBClassifier(**SETTINGS)
            model.fit(xx['train'],yy['train'],eval_set=[(xx['stop'],yy['stop'])],verbose=False)
            model.save_model(OUT/f'{fold}-{arm}.json')
            print(f'{fold}/{arm}: trained, best iteration {model.best_iteration}',flush=True)
            pp={s:model.predict_proba(xx[s])[:,1].astype(float) for s in ('calibrate','validation')}
            contexts={s:[context_from_row(r,data.schema) for r in stages[s]] for s in pp}
            cal=conditional.fit(pp['calibrate'],yy['calibrate'],contexts['calibrate'])
            write(f'{fold}-{arm}-calibrator.json',cal)
            q=conditional.predict(cal,pp['validation'],contexts['validation'])
            adjusted,receipt=timing_adjust(q,yy['validation'],stages['validation'],data.schema['names'])
            write(f'{fold}-{arm}-timing.json',receipt)
            write(f'{fold}-{arm}-design.json',{'schema':data.schema,'vocabulary':vocab,'config':data.config,
                'symmetry':arm=='symmetric_geometry','median':median.tolist(),'best_iteration':model.best_iteration})
            for suffix,p in [('raw',pp['validation']),('conditional',q),('timing',adjusted)]:
                name=arm+'_'+suffix;predictions[name]=p;fold_report[name]=metrics(p,yy['validation'])
            print({fold:arm,'scores':{n:v for n,v in fold_report.items() if n=='reference' or n.startswith(arm)}},flush=True)
        reports[fold]=fold_report
        write(f'{fold}-predictions.json',[{**{k:r[k] for k in ('game_id','event_id','game_date')},'target':int(r['label']),
            **{n:float(p[i]) for n,p in predictions.items()}} for i,r in enumerate(stages['validation'])])
    data.verify()
    passes=[n for n in reports['fold1'] if n!='reference' and all(reports[f][n]['auc']>reports[f]['reference']['auc']
        and reports[f][n]['brier']<reports[f]['reference']['brier'] and reports[f][n]['correlation']>reports[f]['reference']['correlation'] for f in reports)]
    write('summary.json',{'folds':reports,'all_three_both_periods':passes,'elapsed_seconds':time.monotonic()-started,
        'production_changed':False,'publishable':False,'limitations':['Adaptively inspected historical development, not untouched validation.',
        'Correlation means shot probability versus binary goal, not player-season forecast correlation.']})
    write('source-sha256.json',data.closure.checked)
    write('health.json',{'status':'complete-bounded-xg-refresh','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({'all_three_both_periods':passes,'elapsed_seconds':time.monotonic()-started},flush=True)


if __name__=='__main__':run()
