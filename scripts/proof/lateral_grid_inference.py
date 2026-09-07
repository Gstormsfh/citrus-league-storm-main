"""Offline challenger only: frozen base plus hash-bound distance/time grid."""
import json
from pathlib import Path
import numpy as np
from test_lateral_time_grid import OUT as FITS,NAMES,design
from test_joint_residual_adjustments import adjust
from evaluate_frozen_last_season import FrozenForward,FEATURES
from run_bounded_xg_refresh import ROOT,sha

OUT=ROOT/'scripts/proof/results/lateral-time-grid-replay-20260907'


class LateralGridXG:
    def __init__(self,health_sha256):
        if sha(FITS/'health.json')!=health_sha256:raise ValueError('Exact fit binding required')
        health=json.loads((FITS/'health.json').read_bytes())
        if health['status']!='complete-lateral-time-grid' or health['publishable'] is not False:raise ValueError('Completed offline fit required')
        if sha(FITS/'fit.json')!=health['files']['fit.json']:raise ValueError('Fit drift')
        self.fit=json.loads((FITS/'fit.json').read_bytes());self.beta=np.array(self.fit['offsets'])
        if self.fit['names']!=NAMES or self.fit['training_end']>='2025-07-01':raise ValueError('Earlier compatible fit required')
        if self.beta.shape!=(23,) or not np.isfinite(self.beta).all() or np.max(np.abs(self.beta))>=10:raise ValueError('Bounded finite offsets required')
        self.base=FrozenForward()

    def predict(self,rows):
        if not rows:return []
        keys=[(r['game_id'],r['event_id']) for r in rows]
        if len(set(keys))!=len(keys):raise ValueError('Unique event identities required')
        _,_,p,_,_=self.base.predict(rows);x,_=design(rows,self.base.schema['names'])
        q=adjust(p,x,self.beta)
        return [{'game_id':r['game_id'],'event_id':r['event_id'],'neutral_xg':float(v),'publishable':False} for r,v in zip(rows,q)]


def run():
    OUT.mkdir(exist_ok=False);model=LateralGridXG(sha(FITS/'health.json'))
    h=json.loads((FITS/'health.json').read_bytes())
    for name,digest in h['files'].items():assert sha(FITS/name)==digest
    expected=json.loads((FITS/'predictions.json').read_bytes());index={(r['game_id'],r['event_id']):r for r in expected}
    assert len(index)==len(expected)
    health=json.loads((FEATURES/'health.json').read_bytes())
    assert sha(FEATURES/'game-inventory.json')==health['files']['game-inventory.json']
    inventory=json.loads((FEATURES/'game-inventory.json').read_bytes());seen=set();error=0.;results=[]
    for i,game in enumerate(inventory):
        path=FEATURES/f"{game['game_id']}.json";assert sha(path)==health['files'][path.name]
        rows=json.loads(path.read_bytes());predictions=model.predict(rows)
        for row,p in zip(rows,predictions):
            key=row['game_id'],row['event_id'];assert key not in seen;seen.add(key)
            e=index[key];assert e['target']==int(row['label']) and e['game_date']==row['game_date']
            error=max(error,abs(e['lateral_time_grid']-p['neutral_xg']))
        results.extend(predictions)
        if (i+1)%400==0:print({'replayed_games':i+1},flush=True)
    assert seen==set(index) and error<1e-12
    for name,value in [('predictions.json',results),('summary.json',{'events':len(results),'max_probability_error':error,
        'production_changed':False,'publishable':False}),('bindings.json',{'fit_health_sha256':sha(FITS/'health.json'),
        'feature_health_sha256':sha(FEATURES/'health.json'),'base_pins':model.base.pins,'code_sha256':sha(Path(__file__))})]:
        with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)
    with (OUT/'health.json').open('x') as f:json.dump({'status':'complete-lateral-grid-full-feature-replay','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}},f,allow_nan=False)
    print({'events':len(results),'max_probability_error':error},flush=True)


if __name__=='__main__':run()
