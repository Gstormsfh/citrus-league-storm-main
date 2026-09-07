"""Full-source replay of geometry/prior-reason challenger and paired uncertainty."""
import json
from pathlib import Path
import numpy as np
from scipy.special import expit
from run_bounded_xg_refresh import ROOT,sha
from evaluate_frozen_last_season import FrozenForward,FEATURES
from test_continuous_event_movement import OUT as BASE,design as base_design
from test_prior_reason_geometry import OUT as FITS,prior_reasons,design,logit,FREEZE

OUT=ROOT/'scripts/proof/results/prior-reason-geometry-replay-20260907'


def run():
    OUT.mkdir(exist_ok=False);pins={}
    for folder in (BASE,FITS,FEATURES):
        h=json.loads((folder/'health.json').read_bytes());pins[str(folder/'health.json')]=sha(folder/'health.json')
        for name,digest in h['files'].items():assert sha(folder/name)==digest
    sources=json.loads((FITS/'source-sha256.json').read_bytes())
    bf=json.loads((BASE/'fit.json').read_bytes());fits=json.loads((FITS/'fits.json').read_bytes())
    expected=json.loads((FITS/'predictions.json').read_bytes());index={(r['game_id'],r['event_id']):r for r in expected}
    assert len(index)==len(expected) and all(f['training_end']<'2025-07-01' for f in [bf,*fits.values()])
    model=FrozenForward();names=model.schema['names'];seen=set();errors={k:0. for k in ['continuous',*fits]};output=[]
    for i,g in enumerate(json.loads((FEATURES/'game-inventory.json').read_bytes())):
        rows=json.loads((FEATURES/f"{g['game_id']}.json").read_bytes())
        if not rows:continue
        path=FREEZE/f"2025/pbp/{g['game_id']}.body.json";assert sha(path)==sources[str(path)]
        reasons=prior_reasons(json.loads(path.read_bytes()));rr=[reasons[r['event_id']] for r in rows]
        _,_,raw,_,_=model.predict(rows)
        bx=np.column_stack((np.ones(len(rows)),logit(raw),base_design(rows,names,bf['vocabulary'],bf['priors'])))
        base=np.clip(expit(bx@np.array(bf['coefficients'])),1e-6,1-1e-6);pp={'continuous':base}
        for arm,f in fits.items():
            delta=design(rows,names,rr,f['vocabulary'])@np.array(f['coefficients']);q=base.copy();mask=delta!=0
            q[mask]=np.clip(expit(logit(base[mask])+delta[mask]),1e-6,1-1e-6);pp[arm]=q
        for j,r in enumerate(rows):
            key=r['game_id'],r['event_id'];assert key not in seen;seen.add(key);e=index[key]
            assert e['target']==int(r['label']) and e['game_date']==r['game_date'] and e['prior_reason']==rr[j]
            for arm,p in pp.items():errors[arm]=max(errors[arm],abs(p[j]-e[arm]))
            output.append({'game_id':key[0],'event_id':key[1],**{arm:float(p[j]) for arm,p in pp.items()},'publishable':False})
        if (i+1)%400==0:print({'replayed_games':i+1},flush=True)
    assert seen==set(index) and max(errors.values())<1e-12
    _,inv=np.unique([r['game_id'] for r in expected],return_inverse=True);sizes=np.bincount(inv)
    draws=np.random.default_rng(20260907).integers(0,len(sizes),size=(2000,len(sizes)));intervals={}
    for reference in ('continuous','geometry'):
        delta=np.array([(r['geometry_and_prior_reason']-r['target'])**2-(r[reference]-r['target'])**2 for r in expected])
        sums=np.bincount(inv,weights=delta);intervals[reference]=np.quantile(sums[draws].sum(1)/sizes[draws].sum(1),[.025,.975]).tolist()
    summary={'events':len(output),'maximum_probability_error':errors,'paired_game_brier_delta_interval_95_vs':intervals,
        'uncertainty_scope':'Fixed-fit exploratory bootstrap, not adjusted for adaptive selection','publishable':False,'production_changed':False}
    for name,value in [('predictions.json',output),('summary.json',summary),('bindings.json',{'health_pins':pins,'base_pins':model.pins,
        'code_sha256':sha(Path(__file__)),'source_module_sha256':sha(ROOT/'scripts/proof/test_prior_reason_geometry.py')})]:
        with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)
    with (OUT/'health.json').open('x') as f:json.dump({'status':'complete-prior-reason-geometry-replay','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}},f,allow_nan=False)
    print(summary,flush=True)


if __name__=='__main__':run()
