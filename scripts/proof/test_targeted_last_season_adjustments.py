"""Earlier-only fitted timestamp and 5v4 residual adjustments; development retest.

Hypotheses chosen after 2025-26 inspection, which is no longer untouched data.
No shot/event deletion and no 2025-26 outcome fitting.
"""
import json
from pathlib import Path
import numpy as np
from scipy.special import expit
from projections import verified_movement_reuse_v2 as reuse
from run_bounded_xg_refresh import ROOT,sha,timing_band
from run_pass_factor_percentages import score

TRAIN=ROOT/'scripts/proof/results/refresh-ensemble-20260907'
TEST=ROOT/'scripts/proof/results/frozen-last-season-evaluation-20260907'
OUT=ROOT/'scripts/proof/results/targeted-earlier-adjustments-20260907'


def logit(p):
    p=np.clip(p,1e-6,1-1e-6);return np.log(p)-np.log1p(-p)


def offset(p,y):
    if len(y)<100 or len(set(y))<2:return 0.
    z=logit(p);lo,hi=-10.,10.
    for _ in range(80):
        mid=(lo+hi)/2
        if np.sum(expit(z+mid)-y)+10*mid>0:hi=mid
        else:lo=mid
    return (lo+hi)/2


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def metrics(p,y):return {**score(p,y),'correlation':float(np.corrcoef(p,y)[0,1])}


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json',{'training':'Original chronological fold2 prequential ensemble predictions, 2023-24 only',
        'candidates':['same_timestamp_only','five_on_four_only','both'],
        'method':'Fixed ridge10 intercept adjustments; both adds the two learned offsets to log odds on overlapping events',
        'test_status':'2025-26 is now adaptively inspected development; not untouched confirmation',
        'no_event_deletion':True,'production_changed':False,'code_sha256':sha(Path(__file__))})
    pins={}
    for folder in (TRAIN,TEST):
        h=json.loads((folder/'health.json').read_bytes());pins[str(folder/'health.json')]=sha(folder/'health.json')
        for name,digest in h['files'].items():assert sha(folder/name)==digest
    data=reuse.load(ROOT)
    earlier=json.loads((TRAIN/'fold2-predictions.json').read_bytes())
    features=data.folds['fold2']['validation']['rows'];index={(r['game_id'],r['event_id']):r for r in features}
    assert len(earlier)==len(index)
    features=[index[r['game_id'],r['event_id']] for r in earlier]
    assert all(r['target']==int(f['label']) and r['game_date']==f['game_date'] for r,f in zip(earlier,features))
    names=data.schema['names'];si=names.index('shooting_skaters');di=names.index('defending_skaters')
    masks={'same_timestamp':timing_band(features,names)==0,
        'five_on_four':np.array([r['features'][si]==5 and r['features'][di]==4 for r in features])}
    p=np.array([r['symmetric_geometry'] for r in earlier]);y=np.array([r['target'] for r in earlier],dtype=float)
    fits={}
    for name,mask in masks.items():
        fitted=offset(p[mask],y[mask]);z=logit(p[mask])
        gradient=float(np.sum(expit(z+fitted)-y[mask])+10*fitted)
        assert abs(gradient)<1e-8
        subset=[r for r,m in zip(earlier,mask) if m]
        fits[name]={'offset':fitted,'ridge':10,'events':len(subset),'goals':int(y[mask].sum()),'xg':float(p[mask].sum()),
            'training_end':max(r['game_date'] for r in subset),'keys':[[r['game_id'],r['event_id']] for r in subset],
            'training_predictions':[float(v) for v in p[mask]],'gradient':gradient}
    write('fits.json',fits)
    rows=json.loads((TEST/'predictions.json').read_bytes())
    assert max(r['game_date'] for r in earlier)<min(r['game_date'] for r in rows)
    assert not {r['game_id'] for r in earlier}&{r['game_id'] for r in rows}
    test_masks={'same_timestamp':np.array([r['timing_band']=='same_clock' for r in rows]),
        'five_on_four':np.array([r['strength']=='5v4' for r in rows])}
    base=np.array([r['ensemble'] for r in rows]);labels=np.array([r['target'] for r in rows],dtype=float)
    candidates={'frozen_ensemble':base};definitions={'same_timestamp_only':['same_timestamp'],'five_on_four_only':['five_on_four'],'both':['same_timestamp','five_on_four']}
    for name,groups in definitions.items():
        delta=sum(test_masks[g]*fits[g]['offset'] for g in groups)
        candidate=base.copy();changed=delta!=0
        candidate[changed]=np.clip(expit(logit(base[changed])+delta[changed]),1e-6,1-1e-6)
        candidates[name]=candidate
        assert np.array_equal(candidate[~changed],base[~changed])
    scores={n:metrics(q,labels) for n,q in candidates.items()};slices={}
    for group,mask in test_masks.items():
        slices[group]={n:{'events':int(mask.sum()),'goals':int(labels[mask].sum()),'xg':float(q[mask].sum()),**metrics(q[mask],labels[mask])} for n,q in candidates.items()}
    games=np.array([r['game_id'] for r in rows]);unique,inverse=np.unique(games,return_inverse=True);sizes=np.bincount(inverse)
    draws=np.random.default_rng(20260907).integers(0,len(unique),size=(2000,len(unique)))
    for n,q in candidates.items():
        delta=(q-labels)**2-(base-labels)**2;sums=np.bincount(inverse,weights=delta)
        scores[n]['paired_game_brier_delta_interval_95']=np.quantile(sums[draws].sum(1)/sizes[draws].sum(1),[.025,.975]).tolist()
    write('predictions.json',[{**{k:r[k] for k in ('game_id','event_id','game_date','target','timing_band','strength')},
        **{n:float(q[i]) for n,q in candidates.items()}} for i,r in enumerate(rows)])
    data.verify()
    write('summary.json',{'scores':scores,'slices':slices,'production_changed':False,'publishable':False,
        'no_test_outcomes_used_in_fit':True,'test_hypothesis_chosen_after_inspection':True})
    write('source-sha256.json',{**data.closure.checked,**pins})
    write('health.json',{'status':'complete-targeted-earlier-adjustments','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({'fits':{n:{k:v for k,v in f.items() if k not in ('keys','training_predictions')} for n,f in fits.items()},
        'scores':{n:{k:v for k,v in s.items() if k!='reliability'} for n,s in scores.items()},
        'slice_xg':{g:{n:round(s['xg'],6) for n,s in ss.items()} for g,ss in slices.items()}},flush=True)


if __name__=='__main__':run()
