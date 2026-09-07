"""Targeted development scoring: frozen ensemble plus earlier-only offsets.

Additive, date-bounded offline adapter; not production publication authority.
"""
import json
import math
from pathlib import Path
from evaluate_frozen_last_season import FrozenForward,FEATURES
from run_bounded_xg_refresh import ROOT,sha

FITS=ROOT/'scripts/proof/results/targeted-earlier-adjustments-20260907'
OUT=ROOT/'scripts/proof/results/targeted-full-feature-replay-20260907'


def adjust(p,features,names,parameters):
    if not math.isfinite(p) or not 0<=p<=1:raise ValueError('Finite probability required')
    def f(n):return features[names.index(n)]
    delta=0.
    if f('immediate_previous_sog_same_team')==1 and f('seconds_since_immediate_event')==0:
        delta+=parameters['same_timestamp']['offset']
    if f('shooting_skaters')==5 and f('defending_skaters')==4:
        delta+=parameters['five_on_four']['offset']
    if delta==0:return p
    q=min(1-1e-6,max(1e-6,p));z=math.log(q)-math.log1p(-q)+delta
    result=1/(1+math.exp(-z)) if z>=0 else math.exp(z)/(1+math.exp(z))
    return min(1-1e-6,max(1e-6,result))


class TargetedXG:
    def __init__(self,expected_health_sha256):
        if sha(FITS/'health.json')!=expected_health_sha256:raise ValueError('Exact fitted adjustment binding required')
        health=json.loads((FITS/'health.json').read_bytes())
        if health['status']!='complete-targeted-earlier-adjustments' or health['publishable'] is not False:raise ValueError('Offline fitted artifact required')
        if sha(FITS/'fits.json')!=health['files']['fits.json']:raise ValueError('Fitted parameter drift')
        self.parameters=json.loads((FITS/'fits.json').read_bytes());self.base=FrozenForward()
        if set(self.parameters)!={'same_timestamp','five_on_four'}:raise ValueError('Exact groups required')
        for p in self.parameters.values():
            if not math.isfinite(p['offset']) or abs(p['offset'])>10 or p['ridge']!=10 or p['events']<100 or p['training_end']>='2025-07-01':
                raise ValueError('Bounded earlier-supported adjustment required')

    def predict(self,rows):
        keys=[(r['game_id'],r['event_id']) for r in rows]
        if len(set(keys))!=len(keys):raise ValueError('Unique shot identities required')
        _,_,base,_,_=self.base.predict(rows)
        return [{'game_id':r['game_id'],'event_id':r['event_id'],'reference_xg':float(p),
            'neutral_xg':adjust(float(p),r['features'],self.base.schema['names'],self.parameters),
            'publishable':False} for r,p in zip(rows,base)]


def run():
    OUT.mkdir(exist_ok=False);candidate=TargetedXG(sha(FITS/'health.json'))
    expected=json.loads((FITS/'predictions.json').read_bytes());expected={(r['game_id'],r['event_id']):r for r in expected}
    h=json.loads((FEATURES/'health.json').read_bytes());inventory=json.loads((FEATURES/'game-inventory.json').read_bytes())
    results=[];error=0.;unchanged=0
    for game in inventory:
        p=FEATURES/f"{game['game_id']}.json";assert sha(p)==h['files'][p.name]
        rows=json.loads(p.read_bytes())
        if not rows:continue
        predictions=candidate.predict(rows)
        for r,o in zip(rows,predictions):
            e=expected[r['game_id'],r['event_id']];assert int(r['label'])==e['target']
            error=max(error,abs(o['neutral_xg']-e['both']),abs(o['reference_xg']-e['frozen_ensemble']))
            if o['neutral_xg']==o['reference_xg']:unchanged+=1
        results.extend(predictions)
    assert len(results)==len(expected) and error<1e-12
    for name,value in [('predictions.json',results),('summary.json',{'events':len(results),'max_probability_error':error,
        'exactly_unchanged_events':unchanged,'publishable':False,'production_changed':False}),
        ('bindings.json',{'fit_health_sha256':sha(FITS/'health.json'),'feature_health_sha256':sha(FEATURES/'health.json'),
            'base_model_pins':candidate.base.pins,'code_sha256':sha(Path(__file__))})]:
        with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)
    with (OUT/'health.json').open('x') as f:json.dump({'status':'complete-targeted-full-feature-replay','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}},f,allow_nan=False)
    print({'events':len(results),'max_probability_error':error,'exactly_unchanged_events':unchanged},flush=True)


if __name__=='__main__':run()
