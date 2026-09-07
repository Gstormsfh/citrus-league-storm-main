"""Hash-bound, date-bounded offline candidate and complete feature-vector replay."""
import json
from pathlib import Path
import numpy as np
from evaluate_frozen_last_season import FrozenForward,FEATURES
from test_joint_residual_adjustments import OUT as FITS,GROUPS,indicators,adjust
from run_bounded_xg_refresh import ROOT,sha
from review_last_season_evaluation import evaluate

OUT=ROOT/'scripts/proof/results/joint-residual-full-replay-20260907'


class JointResidualXG:
    def __init__(self,health_sha256):
        if sha(FITS/'health.json')!=health_sha256:raise ValueError('Exact fit binding required')
        h=json.loads((FITS/'health.json').read_bytes())
        if h['status']!='complete-joint-residual-adjustments' or h['publishable'] is not False:raise ValueError('Offline completed fit required')
        if sha(FITS/'fits.json')!=h['files']['fits.json']:raise ValueError('Fit hash drift')
        self.fit=json.loads((FITS/'fits.json').read_bytes())['joint_four']
        f=self.fit
        if f['groups']!=GROUPS or f['ridge']!=1 or f['training_end']>='2025-07-01':raise ValueError('Earlier joint fit required')
        self.beta=np.array(f['offsets'])
        if self.beta.shape!=(4,) or not np.isfinite(self.beta).all() or np.max(np.abs(self.beta))>=10:raise ValueError('Bounded coefficients required')
        self.base=FrozenForward()

    def predict(self,rows):
        if not rows:return []
        keys=[(r['game_id'],r['event_id']) for r in rows]
        if len(set(keys))!=len(keys):raise ValueError('Unique event identities required')
        _,_,base,_,_=self.base.predict(rows)
        x=np.array([indicators(r,self.base.schema['names']) for r in rows],dtype=float)
        if not np.isfinite(base).all() or np.any((base<0)|(base>1)):raise ValueError('Finite probabilities required')
        prediction=adjust(base,x,self.beta)
        return [{'game_id':r['game_id'],'event_id':r['event_id'],'neutral_xg':float(p),
            'reference_xg':float(b),'publishable':False} for r,p,b in zip(rows,prediction,base)]


def run():
    OUT.mkdir(exist_ok=False)
    health=json.loads((FITS/'health.json').read_bytes())
    for name,digest in health['files'].items():assert sha(FITS/name)==digest
    expected=json.loads((FITS/'predictions.json').read_bytes())
    saved=json.loads((FITS/'summary.json').read_bytes())
    independent={field:evaluate(expected,field) for field in saved['scores']}
    for field,metrics in independent.items():
        for k,v in metrics.items():assert abs(v-saved['scores'][field][k])<1e-11
    index={(r['game_id'],r['event_id']):r for r in expected};assert len(index)==len(expected)
    model=JointResidualXG(sha(FITS/'health.json'))
    h=json.loads((FEATURES/'health.json').read_bytes())
    assert sha(FEATURES/'game-inventory.json')==h['files']['game-inventory.json']
    inventory=json.loads((FEATURES/'game-inventory.json').read_bytes())
    results=[];seen=set();error=0.;unchanged=0
    for i,game in enumerate(inventory):
        path=FEATURES/f"{game['game_id']}.json";assert sha(path)==h['files'][path.name]
        rows=json.loads(path.read_bytes());predictions=model.predict(rows)
        for r,p in zip(rows,predictions):
            key=(r['game_id'],r['event_id']);assert key not in seen;seen.add(key)
            e=index[key];assert int(r['label'])==e['target'] and r['game_date']==e['game_date']
            error=max(error,abs(p['neutral_xg']-e['joint_four']))
            unchanged+=p['neutral_xg']==p['reference_xg']
        results.extend(predictions)
        if (i+1)%300==0:print({'replayed_games':i+1},flush=True)
    assert seen==set(index) and error<1e-12
    for name,value in [('predictions.json',results),('summary.json',{'events':len(results),'max_probability_error':error,
        'exactly_unchanged_events':int(unchanged),'independent_metrics':independent,'publishable':False,'production_changed':False}),
        ('bindings.json',{'fit_health_sha256':sha(FITS/'health.json'),'features_health_sha256':sha(FEATURES/'health.json'),
            'base_pins':model.base.pins,'code_sha256':sha(Path(__file__))})]:
        with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)
    with (OUT/'health.json').open('x') as f:json.dump({'status':'complete-joint-residual-full-feature-replay','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}},f,allow_nan=False)
    print({'events':len(results),'max_probability_error':error,'unchanged':int(unchanged),'independent_metrics':independent},flush=True)


if __name__=='__main__':run()
