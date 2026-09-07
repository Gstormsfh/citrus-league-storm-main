"""Replay both event-context and continuous movement challengers from full inputs."""
import json
from pathlib import Path
import numpy as np
from scipy.special import expit
from run_bounded_xg_refresh import ROOT,sha
from evaluate_frozen_last_season import FrozenForward,FEATURES
from test_lateral_time_grid import OUT as GRID,design as grid_design
from test_joint_residual_adjustments import adjust
from test_grid_context_calibration import OUT as CONTEXT,matrix,calibrated
from test_continuous_event_movement import OUT as CONTINUOUS,design,logit

OUT=ROOT/'scripts/proof/results/movement-challengers-replay-20260907'


def run():
    OUT.mkdir(exist_ok=False);model=FrozenForward();pins={}
    for folder in (GRID,CONTEXT,CONTINUOUS,FEATURES):
        h=json.loads((folder/'health.json').read_bytes());pins[str(folder/'health.json')]=sha(folder/'health.json')
        for name,digest in h['files'].items():assert sha(folder/name)==digest
    gf=json.loads((GRID/'fit.json').read_bytes());cf=json.loads((CONTEXT/'fits.json').read_bytes())['event_context']
    sf=json.loads((CONTINUOUS/'fit.json').read_bytes())
    for fit in (gf,cf,sf):assert fit['training_end']<'2025-07-01'
    expected=json.loads((CONTINUOUS/'predictions.json').read_bytes());index={(r['game_id'],r['event_id']):r for r in expected}
    assert len(index)==len(expected)
    results=[];seen=set();error={'event_context':0.,'continuous':0.}
    for i,game in enumerate(json.loads((FEATURES/'game-inventory.json').read_bytes())):
        rows=json.loads((FEATURES/f"{game['game_id']}.json").read_bytes())
        if not rows:continue
        _,_,p,_,_=model.predict(rows);names=model.schema['names']
        gx,_=grid_design(rows,names);grid=adjust(p,gx,np.array(gf['offsets']))
        context=calibrated(grid,matrix(rows,names,cf['vocabulary']),cf)
        x=np.column_stack((np.ones(len(rows)),logit(p),design(rows,names,sf['vocabulary'],sf['priors'])))
        smooth=np.clip(expit(x@np.array(sf['coefficients'])),1e-6,1-1e-6)
        for r,a,b in zip(rows,context,smooth):
            key=r['game_id'],r['event_id'];assert key not in seen;seen.add(key)
            e=index[key];assert int(r['label'])==e['target'] and r['game_date']==e['game_date']
            error['event_context']=max(error['event_context'],abs(a-e['event_context']))
            error['continuous']=max(error['continuous'],abs(b-e['continuous']))
            results.append({'game_id':r['game_id'],'event_id':r['event_id'],'event_context':float(a),'continuous':float(b),'publishable':False})
        if (i+1)%400==0:print({'replayed_games':i+1},flush=True)
    assert seen==set(index) and max(error.values())<1e-12
    for path,digest in pins.items():assert sha(Path(path))==digest
    for name,value in [('predictions.json',results),('summary.json',{'events':len(results),'max_probability_errors':error,
        'production_changed':False,'publishable':False}),('bindings.json',{'source_health_pins':pins,'base_pins':model.pins,'code_sha256':sha(Path(__file__))})]:
        with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)
    with (OUT/'health.json').open('x') as f:json.dump({'status':'complete-movement-challengers-replay','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}},f,allow_nan=False)
    print({'events':len(results),'max_probability_errors':error},flush=True)


if __name__=='__main__':run()
