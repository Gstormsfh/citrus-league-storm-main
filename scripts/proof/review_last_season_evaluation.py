"""Independent scalar metric review, paired-game uncertainty and weak slices."""
import json,math
from pathlib import Path
import numpy as np
from run_bounded_xg_refresh import ROOT,sha

DIR=ROOT/'scripts/proof/results/frozen-last-season-evaluation-20260907'


def evaluate(rows,field):
    n=len(rows);pos=sum(r['target'] for r in rows)
    ordered=sorted(rows,key=lambda r:r[field]);ranks=0.;i=0
    while i<n:
        j=i+1
        while j<n and ordered[j][field]==ordered[i][field]:j+=1
        ranks+=sum(r['target'] for r in ordered[i:j])*(i+1+j)/2;i=j
    p=[r[field] for r in rows];y=[r['target'] for r in rows]
    mean=math.fsum(p)/n;rate=pos/n
    covariance=math.fsum((a-mean)*(b-rate) for a,b in zip(p,y))
    variance=math.fsum((a-mean)**2 for a in p)*math.fsum((b-rate)**2 for b in y)
    ece=0.
    for b in range(10):
        selected=[r for r in rows if min(9,int(r[field]*10))==b]
        if selected:ece+=abs(math.fsum(r[field]-r['target'] for r in selected))/n
    return {'auc':(ranks-pos*(pos+1)/2)/(pos*(n-pos)),
        'brier':math.fsum((a-b)**2 for a,b in zip(p,y))/n,
        'correlation':covariance/math.sqrt(variance),
        'log_loss':math.fsum(-b*math.log(min(1-1e-6,max(1e-6,a)))-(1-b)*math.log1p(-min(1-1e-6,max(1e-6,a))) for a,b in zip(p,y))/n,
        'ece_10_equal_width':ece,'calibration_bias':mean-rate}


def run():
    h=json.loads((DIR/'health.json').read_bytes())
    for name,digest in h['files'].items():assert sha(DIR/name)==digest
    rows=json.loads((DIR/'predictions.json').read_bytes());saved=json.loads((DIR/'summary.json').read_bytes())
    assert len({(r['game_id'],r['event_id']) for r in rows})==len(rows)
    actual={f:evaluate(rows,f) for f in ('existing','refreshed','ensemble')}
    for f in actual:
        for k,v in actual[f].items():assert abs(v-saved['scores'][f][k])<1e-11
    assert all(r['ensemble']==(r['existing']+r['refreshed'])/2 for r in rows)
    games=np.array([r['game_id'] for r in rows]);g,inverse=np.unique(games,return_inverse=True)
    sizes=np.bincount(inverse);delta=np.array([(r['ensemble']-r['target'])**2-(r['existing']-r['target'])**2 for r in rows])
    sums=np.bincount(inverse,weights=delta)
    draws=np.random.default_rng(20260907).integers(0,len(g),size=(2000,len(g)))
    interval=np.quantile(sums[draws].sum(1)/sizes[draws].sum(1),[.025,.975]).tolist()
    slices={}
    for name,field,value in [('same_clock','timing_band','same_clock'),('power_play_5v4','strength','5v4'),
        ('fast_lateral','fast_lateral','True'),('under10ft','distance_band','under10')]:
        rr=[r for r in rows if r[field]==value]
        slices[name]={'events':len(rr),'goals':sum(r['target'] for r in rr),
            'ensemble_xg':math.fsum(r['ensemble'] for r in rr),
            'total_brier_change':math.fsum((r['ensemble']-r['target'])**2-(r['existing']-r['target'])**2 for r in rr)}
    result={'metrics':actual,'events':len(rows),'paired_game_brier_change_interval_95':interval,
        'weaknesses':slices,'all_requested_point_metrics_improve':actual['ensemble']['auc']>actual['existing']['auc']
            and actual['ensemble']['brier']<actual['existing']['brier'] and actual['ensemble']['correlation']>actual['existing']['correlation'],
        'production_changed':False,'limitations':['Frozen 2024 snapshot forward evaluation, not current production replay.',
            'Game bootstrap interval is exploratory; no adjusted AUC/correlation significance claim.']}
    with (DIR/'independent-review.json').open('x') as f:json.dump(result,f,allow_nan=False)
    print(result,flush=True)


if __name__=='__main__':run()
