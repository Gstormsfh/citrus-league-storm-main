"""Executable offline ensemble of old full-feature inference and refreshed model.

No score-table input, outcome input, production publication or weight tuning.
"""
import json
from pathlib import Path
from run_bounded_xg_refresh import ROOT,sha
from replay_refreshed_xg import RefreshedXG,SOURCE as REFRESHED
from recent_timing_inference import RecentCandidate
from selected_timing_candidate import SelectedCandidate
from projections import verified_movement_reuse_v2 as reuse

RECENT=ROOT/'scripts/proof/results/recent-candidate-replay-20260907-full'
SHAPE=ROOT/'scripts/proof/results/timing-shape-20260907-full'
EXPECTED=ROOT/'scripts/proof/results/refresh-ensemble-20260907'
OUT=ROOT/'scripts/proof/results/refreshed-ensemble-full-replay-20260907'


class Ensemble:
    def __init__(self,old,new):
        self.old,self.new=old,new

    def predict(self,rows):
        a,b=self.old.predict(rows),self.new.predict(rows)
        if len(a)!=len(rows) or len(b)!=len(rows):raise ValueError('Exact prediction count required')
        out=[]
        for r,x,y in zip(rows,a,b):
            if any(r[k]!=x[k] or r[k]!=y[k] for k in ('game_id','event_id')):raise ValueError('Exact prediction identity required')
            out.append({'game_id':r['game_id'],'event_id':r['event_id'],
                'neutral_xg':(x['neutral_xg']+y['neutral_xg'])/2,
                'reference_xg':x['neutral_xg'],'refreshed_xg':y['neutral_xg'],'publishable':False})
        return out


def read(folder,name,health):
    p=folder/name
    if p.is_symlink() or sha(p)!=health['files'][name]:raise ValueError('Pinned file mismatch')
    return json.loads(p.read_bytes())


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    assert sha(RECENT/'health.json')=='9105778a28608d4993d7817730dfc80320205b4bbf1c69d635addab927670f99'
    assert sha(SHAPE/'health.json')=='6080f762775b5486d1561bf42935ddcc8b4a62f678a696c960c42474ffeeead5'
    recent_health=json.loads((RECENT/'health.json').read_bytes());shape_health=json.loads((SHAPE/'health.json').read_bytes())
    expected_health=json.loads((EXPECTED/'health.json').read_bytes())
    expected_summary=read(EXPECTED,'summary.json',expected_health)
    refresh_hash=expected_summary['source_health_sha256']
    data=reuse.load(ROOT);report={};manifest=[]
    entries=read(RECENT,'manifest.json',recent_health)['sidecars']
    for fold in ('fold1','fold2'):
        new=RefreshedXG(REFRESHED,fold,refresh_hash)
        history=read(SHAPE,fold+'-predictions.json',shape_health)
        expected={(r['game_id'],r['event_id']):r for r in read(EXPECTED,fold+'-predictions.json',expected_health)}
        result=[];error=0.
        for entry in (e for e in entries if e['fold']==fold):
            month=entry['month'];sidecar=RECENT/entry['sidecar']
            old_recent=RecentCandidate.load(ROOT/entry['base_bundle'],entry['base_sha256'],sidecar,entry['sidecar_sha256'])
            old_shape=read(SHAPE,f'{fold}-{month}-fit.json',shape_health)
            earlier=[r for r in history if r['population']=='original' and r['game_date']<month+'-01']
            old=SelectedCandidate(old_recent,old_shape,earlier)
            candidate=Ensemble(old,new)
            rows=[r for r in data.folds[fold]['validation']['rows'] if r['game_date'][:7]==month]
            predictions=candidate.predict(rows)
            for p in predictions:
                r=expected[p['game_id'],p['event_id']]
                error=max(error,abs(p['neutral_xg']-r['symmetric_geometry']),abs(p['reference_xg']-r['reference']))
            result.extend(predictions)
            manifest.append({'fold':fold,'month':month,'reference_entry':entry,
                'shape_fit_sha256':shape_health['files'][f'{fold}-{month}-fit.json'],
                'earlier_selection_receipt':old.receipt,'refresh_health_sha256':refresh_hash,'weight':.5})
            print(f'{fold}/{month}: complete ensemble full-feature replay verified',flush=True)
        assert {(r['game_id'],r['event_id']) for r in result}==set(expected) and len(result)==len(expected) and error<1e-12
        report[fold]={'events':len(result),'max_probability_error':error}
        write(fold+'-predictions.json',result)
    data.verify()
    write('manifest.json',{'entries':manifest,'publishable':False,'usage':'offline_dated_replay_only'})
    write('summary.json',{'folds':report,'production_changed':False,'publishable':False})
    write('source-sha256.json',{**data.closure.checked,str(Path(__file__)):sha(Path(__file__)),
        str(REFRESHED/'health.json'):refresh_hash,str(EXPECTED/'health.json'):sha(EXPECTED/'health.json'),
        str(RECENT/'health.json'):sha(RECENT/'health.json'),str(SHAPE/'health.json'):sha(SHAPE/'health.json')})
    write('health.json',{'status':'complete-refreshed-ensemble-full-feature-replay','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print(report,flush=True)


if __name__=='__main__':run()
