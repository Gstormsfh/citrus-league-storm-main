"""Deterministic sensitivity check; not pass ground truth or xG training."""
import hashlib,json
from pathlib import Path
from projections.tracked_comotion_candidates import extract

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'scripts/proof/results/linked-replay-pilot-20260907'
OUT=ROOT/'scripts/proof/results/tracked-comotion-pilot-20260907'

def run():
    OUT.mkdir()
    declaration={'radii':[60,84],'relative_step_limits':[12,24,36],
                 'minimum_hold':2,'max_gap_frames':20,
                 'selection':'Same three saved replay clips; all combinations reported',
                 'adaptive':True,'scope':'Hypothesis informed by inspected failed transfer; no accuracy claim'}
    (OUT/'declaration.json').write_text(json.dumps(declaration))
    results=[]
    for item in json.loads((SOURCE/'declaration.json').read_text())['selected']:
        name=f"{item['game']}-{item['event']}.json"
        body=(SOURCE/name).read_bytes()
        receipt=json.loads((SOURCE/(name+'.receipt.json')).read_text())
        assert hashlib.sha256(body).hexdigest()==receipt['sha256']
        frames=json.loads(body)
        goalies=[p['playerId'] for p in receipt['roster'] if p['positionCode']=='G']
        outputs={}
        for radius in declaration['radii']:
            for limit in declaration['relative_step_limits']:
                r=extract(frames,goalie_ids=goalies,radius=radius,relative_step_limit=limit)
                assert r==extract(frames,goalie_ids=goalies,radius=radius,relative_step_limit=limit)
                outputs[f'{radius}/{limit}']=r
        results.append({'game':item['game'],'event':item['event'],'source_sha256':receipt['sha256'],'outputs':outputs})
    payload={'results':results,'production_changed':False,'confirmed_passes':False,
             'detector_sha256':hashlib.sha256((ROOT/'data-pipeline/projections/tracked_comotion_candidates.py').read_bytes()).hexdigest()}
    (OUT/'summary.json').write_text(json.dumps(payload,allow_nan=False))
    for r in results:
        print(r['game'],{k:v['candidates'] for k,v in r['outputs'].items()})

if __name__=='__main__':run()
