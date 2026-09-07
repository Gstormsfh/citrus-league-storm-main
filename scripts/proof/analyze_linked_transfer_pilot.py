"""Deterministic replay sensitivity analysis; no goal/non-goal xG fitting."""
import json,hashlib
from pathlib import Path
from projections.tracked_transfer_candidates import extract

ROOT=Path(__file__).resolve().parents[2]
DIR=ROOT/'scripts/proof/results/linked-replay-pilot-20260907'


def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()


def run():
    h=json.loads((DIR/'health.json').read_bytes())
    for name,digest in h['files'].items():assert sha(DIR/name)==digest
    results=[]
    for path in sorted(DIR.glob('*.json.receipt.json')):
        receipt=json.loads(path.read_bytes());frames=json.loads(path.with_name(path.name.replace('.receipt.json','')).read_bytes())
        goalies=[r['playerId'] for r in receipt['roster'] if r['positionCode']=='G']
        outputs={str(radius):extract(frames,goalie_ids=goalies,radius=radius) for radius in (36,60,84)}
        assert outputs=={str(radius):extract(frames,goalie_ids=goalies,radius=radius) for radius in (36,60,84)}
        pairs=[{(c['from_player_id'],c['to_player_id']) for c in o['candidates']} for o in outputs.values()]
        stable=set.intersection(*pairs)
        roster={r['playerId']:r for r in receipt['roster']}
        def name(pid):
            r=roster.get(pid,{})
            return (r.get('firstName',{}).get('default','')+' '+r.get('lastName',{}).get('default','')).strip()
        trajectories=[]
        for pid in goalies:
            samples=[(i,a) for i,f in enumerate(frames) for a in f['onIce'].values() if a.get('playerId')==pid]
            if samples:
                trajectories.append({'player_id':pid,'name':name(pid),'frames_observed':len(samples),
                    'lateral_span_renderer_units':max(a['y'] for _,a in samples)-min(a['y'] for _,a in samples),
                    'scope':'Full replay, not pass-aligned or asserted pre-shot-only'})
        result={'game':receipt['game'],'event':receipt['event'],'frames':len(frames),'candidate_counts':{k:len(v['candidates']) for k,v in outputs.items()},
            'stable_pairs_across_radius_settings':[{'from':a,'to':b,'from_name':name(a),'to_name':name(b)} for a,b in sorted(stable)],
            'outputs':outputs,'goalie_trajectories':trajectories,
            'goal_metadata_for_retrospective_comparison_only':{k:receipt['goal_details'].get(k) for k in ('scoringPlayerId','assist1PlayerId','assist2PlayerId')},
            'confirmed_passes':None,'production_changed':False}
        results.append(result)
    summary={'games':len(results),'results':results,'deterministic_repeat':True,'independent_pass_labels_available':False,
        'source_health_sha256':sha(DIR/'health.json'),'detector_sha256':sha(ROOT/'data-pipeline/projections/tracked_transfer_candidates.py'),
        'code_sha256':sha(Path(__file__)),'coordinate_units':'renderer units, not physical feet','trained_xg':False,'publishable':False}
    with (DIR/'transfer-analysis.json').open('x') as f:json.dump(summary,f,allow_nan=False)
    print([{k:v for k,v in r.items() if k not in ('outputs','goalie_trajectories')} for r in results])


if __name__=='__main__':run()
