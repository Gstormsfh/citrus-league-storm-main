"""2025-26 frozen forward evaluation; latest 2024 parameters held constant.

Separate evaluation adapter: does not extend certified replay windows or refit
any model/map from 2025-26 outcomes. Original date-bound serving gates unchanged.
"""
from pathlib import Path
from collections import defaultdict
import json
import numpy as np
from scipy.special import expit
from projections import portable_context_model as portable
from projections import conditional_calibration_shape as conditional
from projections import development_experiment as development
from projections.calibration_candidate import context_from_row
from projections.xg_candidate_inference import XGCandidate,calibrate,BANDS
from projections.analytics_publication import fingerprint
from replay_refreshed_xg import RefreshedXG,SOURCE as REFRESHED
from run_bounded_xg_refresh import ROOT,sha,symmetrize,timing_band
from run_pass_factor_percentages import score

FEATURES=ROOT/'scripts/proof/results/last-season-candidate-features-20260907'
OLD=ROOT/'scripts/proof/results/selected-timing-replay-20260907-v2-full'
RECENT=ROOT/'scripts/proof/results/recent-candidate-replay-20260907-full'
OUT=ROOT/'scripts/proof/results/frozen-last-season-evaluation-20260907'


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


class FrozenForward:
    def __init__(self):
        self.pins={}
        def verified(folder,name,health_hash=None):
            hp=folder/'health.json'
            if health_hash is not None and sha(hp)!=health_hash:raise ValueError('Pinned source health mismatch')
            h=json.loads(hp.read_bytes());p=folder/name
            if sha(p)!=h['files'][name]:raise ValueError('Pinned artifact mismatch')
            self.pins[str(hp)]=sha(hp);self.pins[str(p)]=sha(p)
            return json.loads(p.read_bytes())
        self.selected=verified(OLD,'fold2-2024-06-receipt.json','f295d9ab4f2eba2d3627b832b3709d8ee58ac7dbe002f370863d1be0bd40f78b')
        self.recent=verified(RECENT,'fold2-2024-06-sidecar.json','9105778a28608d4993d7817730dfc80320205b4bbf1c69d635addab927670f99')
        basepath=ROOT/'scripts/proof/results/composed-xg-replay-20260907-full/fold2/2024-06/bundle.json'
        self.base=XGCandidate.load(basepath,'d59a79d9016655b3f302efdf313d16f4efb8934abf27989025d8a201b16d451c')._bundle
        self.pins[str(basepath)]=sha(basepath)
        assert fingerprint(self.base)==self.recent['base_fingerprint']
        assert self.selected['recent_fingerprint']==fingerprint(self.recent)
        summary=verified(ROOT/'scripts/proof/results/refresh-ensemble-20260907','summary.json')
        self.new=RefreshedXG(REFRESHED,'fold2',summary['source_health_sha256']);self.pins.update(self.new.pins)
        self.schema=self.base['raw_model']['design']['schema']
        assert self.schema==self.new.design['schema']
        assert self.selected['shape']['month']=='2024-06' and self.base['train_through']<'2024-06-01'

    def predict(self,rows):
        for r in rows:
            if not '2025-07-01'<=r['game_date']<='2026-08-31':raise ValueError('Exact forward evaluation period required')
            if r['feature_sha256']!=fingerprint({'schema_sha256':fingerprint(self.schema),'values':r['features'],'categorical':r['categorical']}):raise ValueError('Feature drift')
        contexts=[context_from_row(r,self.schema) for r in rows]
        gap_index=self.schema['names'].index('seconds_since_immediate_event')
        raw=portable.predict_rows(self.base['raw_model'],rows)
        base=np.array(calibrate(self.base['calibrator'],raw,contexts,[r['features'][gap_index] for r in rows]))
        bands=timing_band(rows,self.schema['names']);existing=base.copy()
        for i,band in enumerate(bands):
            if band<0:continue
            z=np.log(np.clip(base[i],1e-6,1-1e-6))-np.log1p(-np.clip(base[i],1e-6,1-1e-6))
            if self.selected['use_shape']:
                b=self.selected['shape']['bands'][BANDS[band]]
                delta=b['intercept']+b['slope_delta']*(z-b['mean_logit'])
            else:delta=self.recent['fit']['bands'][BANDS[band]]['offset']
            if delta!=0:existing[i]=np.clip(expit(z+delta),1e-6,1-1e-6)
        d=self.new.design;numeric=symmetrize(development._numeric(rows,self.schema),self.schema['names'])
        x=development._design(rows,self.schema,np.array(d['median']),d['vocabulary'],d['config'])['enhanced_context']
        x[:,:len(self.schema['names'])]=numeric
        freshraw=self.new.model.predict_proba(x)[:,1].astype(float)
        refreshed=conditional.predict(self.new.cal,freshraw,contexts)
        for i,band in enumerate(bands):
            if band<0:continue
            offset=self.new.timing['2024-06',int(band)]['offset']
            if offset!=0:
                q=np.clip(refreshed[i],1e-6,1-1e-6)
                refreshed[i]=np.clip(expit(np.log(q)-np.log1p(-q)+offset),1e-6,1-1e-6)
        return existing,refreshed,(existing+refreshed)/2,contexts,bands


def metrics(rows,field):
    p=np.array([r[field] for r in rows]);y=np.array([r['target'] for r in rows],dtype=float)
    if not rows or len(set(y))<2:return {'events':len(rows),'status':'insufficient_outcome_classes'}
    return {'events':len(rows),'goals':int(y.sum()),**score(p,y),'correlation':float(np.corrcoef(p,y)[0,1])}


def run():
    OUT.mkdir(exist_ok=False);model=FrozenForward()
    write('declaration.json',{'season':'2025-26','frozen_parameter_month':'2024-06',
        'protocol':'Forward evaluation of last frozen snapshot, not rolling recalibration. No 2025-26 targets enter inference or fitting.',
        'arms':['existing','refreshed','ensemble'],'ensemble_weights':[.5,.5],
        'model_pins':model.pins,'code_sha256':sha(Path(__file__)),'publishable':False,
        'not_production_replay':True,'untouched_validation_claimed':False})
    health=json.loads((FEATURES/'health.json').read_bytes());assert health['status']=='complete-last-season-candidate-features'
    schema=json.loads((FEATURES/'schema.json').read_bytes());assert schema==model.schema
    inventory=json.loads((FEATURES/'game-inventory.json').read_bytes());results=[];expected=set()
    for i,game in enumerate(inventory):
        path=FEATURES/f"{game['game_id']}.json";assert sha(path)==health['files'][path.name]
        rows=json.loads(path.read_bytes())
        if not rows:continue
        assert not expected & {(r['game_id'],r['event_id']) for r in rows};expected.update((r['game_id'],r['event_id']) for r in rows)
        a,b,c,contexts,bands=model.predict(rows)
        for r,p,q,e,ctx,band in zip(rows,a,b,c,contexts,bands):
            names=schema['names'];distance=r['features'][names.index('distance_to_goal_ft')]
            gap=r['features'][names.index('seconds_since_immediate_event')]
            lateral=r['features'][names.index('immediate_recorded_live_event__event_lateral_displacement_ft')]
            same=r['features'][names.index('immediate_recorded_live_event__same_team_indicator')]
            results.append({'game_id':r['game_id'],'event_id':r['event_id'],'game_date':r['game_date'],
                'target':int(r['label']),'existing':float(p),'refreshed':float(q),'ensemble':float(e),
                'shot_type':ctx['shot_type'],'strength':ctx['strength'],'timing_band':BANDS[band] if band>=0 else 'other',
                'distance_band':'under10' if distance<10 else '10to20' if distance<20 else '20to35' if distance<35 else '35to60' if distance<60 else '60plus',
                'game_type':str(r['game_type']),'fast_lateral':str(same==1 and gap is not None and 0<=gap<=3 and lateral is not None and lateral>=10)})
        if (i+1)%100==0:print({'games_scored':i+1,'shots':len(results)},flush=True)
    assert len(results)==len(expected)
    fields=('existing','refreshed','ensemble');summary={f:metrics(results,f) for f in fields};breakdowns={}
    for group in ('shot_type','strength','timing_band','distance_band','game_type','fast_lateral'):
        groups=defaultdict(list)
        for r in results:groups[r[group]].append(r)
        breakdowns[group]={k:{f:metrics(rr,f) for f in fields} for k,rr in groups.items()}
    write('predictions.json',results);write('breakdowns.json',breakdowns)
    write('summary.json',{'scores':summary,'coverage':json.loads((FEATURES/'summary.json').read_bytes()),
        'production_changed':False,'publishable':False,'feature_health_sha256':sha(FEATURES/'health.json')})
    for name,digest in model.pins.items():assert sha(Path(name))==digest
    write('health.json',{'status':'complete-frozen-last-season-evaluation','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({f:{k:v for k,v in s.items() if k!='reliability'} for f,s in summary.items()},flush=True)


if __name__=='__main__':run()
