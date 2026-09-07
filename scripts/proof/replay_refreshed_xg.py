"""Hash-pinned full-feature inference for saved refreshed XGBoost candidates."""
import json
from pathlib import Path
import numpy as np
from scipy.special import expit
from xgboost import XGBClassifier
from projections import verified_movement_reuse_v2 as reuse
from projections import development_experiment as development
from projections import conditional_calibration_shape as conditional
from projections.calibration_candidate import context_from_row
from run_bounded_xg_refresh import ROOT,sha,symmetrize,timing_band

SOURCE=ROOT/'scripts/proof/results/bounded-xg-refresh-20260907'
OUT=ROOT/'scripts/proof/results/refreshed-xg-replay-20260907'


class RefreshedXG:
    def __init__(self,folder,fold,health_sha):
        folder=Path(folder).absolute()
        if any(p.is_symlink() for p in (folder,*folder.parents)):raise ValueError('Regular model directory required')
        if sha(folder/'health.json')!=health_sha:raise ValueError('Health hash mismatch')
        health=json.loads((folder/'health.json').read_bytes())
        if health['status']!='complete-bounded-xg-refresh' or health['publishable'] is not False:raise ValueError('Offline candidate required')
        self.pins={str(folder/'health.json'):health_sha}
        def read(name):
            p=folder/name
            if p.is_symlink() or not p.is_file() or p.stat().st_size>64*1024*1024 or sha(p)!=health['files'][name]:raise ValueError('Bounded hash-pinned model file required')
            self.pins[str(p)]=health['files'][name]
            return json.loads(p.read_bytes())
        prefix=fold+'-symmetric_geometry'
        self.design=read(prefix+'-design.json')
        if self.design['symmetry'] is not True:raise ValueError('Exact symmetry contract required')
        self.cal=read(prefix+'-calibrator.json');conditional.validate(self.cal)
        self.timing={(r['month'],r['band']):r for r in read(prefix+'-timing.json')}
        stages=read(fold+'-stages.json');self.window=stages['validation']
        self.training_games={k[0] for stage in ('train','stop','calibrate') for k in stages[stage]['keys']}
        read(prefix+'.json')
        self.model=XGBClassifier();self.model.load_model(folder/(prefix+'.json'))
        if self.model.best_iteration!=self.design['best_iteration']:raise ValueError('Tree range mismatch')
        for (month,band),r in self.timing.items():
            if not 0<=band<=3 or not np.isfinite(r['offset']) or abs(r['offset'])>10:raise ValueError('Bounded timing map required')
            if r['training_end'] is not None and r['training_end']>=month+'-01':raise ValueError('Future timing fit')

    def predict(self,rows):
        keys=[(r['game_id'],r['event_id']) for r in rows]
        if len(keys)!=len(set(keys)):raise ValueError('Duplicate prediction event')
        for r in rows:
            if r['game_id'] in self.training_games or not self.window['start']<=r['game_date']<=self.window['end']:
                raise ValueError('Only dated held-out replay allowed')
        d=self.design;raw=development._numeric(rows,d['schema'])
        if np.isinf(raw).any():raise ValueError('Infinite feature')
        raw=symmetrize(raw,d['schema']['names'])
        x=development._design(rows,d['schema'],np.array(d['median']),d['vocabulary'],d['config'])['enhanced_context']
        x[:,:len(d['schema']['names'])]=raw
        p=self.model.predict_proba(x)[:,1].astype(float)
        q=conditional.predict(self.cal,p,[context_from_row(r,d['schema']) for r in rows])
        result=[]
        for r,raw_p,base,band in zip(rows,p,q,timing_band(rows,d['schema']['names'])):
            final=float(base)
            if band>=0:
                t=self.timing[r['game_date'][:7],int(band)]
                # A zero supported fit is also the identity to floating precision.
                if t['offset']!=0:
                    clipped=np.clip(base,1e-6,1-1e-6)
                    final=float(np.clip(expit(np.log(clipped)-np.log1p(-clipped)+t['offset']),1e-6,1-1e-6))
            result.append({'game_id':r['game_id'],'event_id':r['event_id'],'raw_xg':float(raw_p),
                'conditional_xg':float(base),'neutral_xg':final,'publishable':False})
        return result


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False);data=reuse.load(ROOT);reports={};pins={}
    for fold in ('fold1','fold2'):
        model=RefreshedXG(SOURCE,fold,sha(SOURCE/'health.json'));pins.update(model.pins)
        rows=data.folds[fold]['validation']['rows'];predictions=model.predict(rows)
        expected=json.loads((SOURCE/f'{fold}-predictions.json').read_bytes())
        assert len(expected)==len(predictions)
        error=0.
        for r,p,e in zip(rows,predictions,expected):
            assert all(p[k]==e[k]==r[k] for k in ('game_id','event_id')) and e['target']==int(r['label'])
            for a,b in [('raw_xg','symmetric_geometry_raw'),('conditional_xg','symmetric_geometry_conditional'),('neutral_xg','symmetric_geometry_timing')]:error=max(error,abs(p[a]-e[b]))
        assert error<1e-12
        changed=[{**rows[0],'label':1-int(rows[0]['label'])}]
        assert model.predict(changed)==model.predict(rows[:1])
        for invalid in ([rows[0],rows[0]],[{**rows[0],'game_date':'2099-01-01'}],data.folds[fold]['train']['rows'][:1]):
            try:model.predict(invalid)
            except ValueError:pass
            else:raise AssertionError('Invalid replay accepted')
        reports[fold]={'events':len(rows),'max_prediction_error':error,'target_invariance_and_replay_rejections':True}
        write(fold+'-predictions.json',predictions);print({fold:reports[fold]},flush=True)
    data.verify()
    for name,digest in pins.items():assert sha(Path(name))==digest
    write('summary.json',{'folds':reports,'publishable':False,'production_changed':False})
    write('source-sha256.json',{**data.closure.checked,**pins,str(Path(__file__)):sha(Path(__file__))})
    write('health.json',{'status':'complete-refreshed-xg-full-feature-replay','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})


if __name__=='__main__':run()
