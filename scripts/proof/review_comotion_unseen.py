"""Fixed-rule check on four hash-selected unseen clips; not accuracy validation."""
import hashlib,json
from pathlib import Path
from projections.tracked_comotion_candidates import extract

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'scripts/proof/results/tracked-comotion-unseen-20260907'
RAW=ROOT/'scripts/proof/results/historical-official-freeze-20260906/2025/pbp'

def run():
    pool=[]
    for path in RAW.glob('*.body.json'):
        g=json.loads(path.read_bytes())
        if g['id'] in (2025020001,2025020698,2025030416):continue
        event=next((e for e in g['plays'] if e.get('pptReplayUrl')),None)
        if event:pool.append((hashlib.sha256(f"comotion-unseen-v1/{g['id']}".encode()).hexdigest(),g['id'],event['eventId']))
    selected=sorted(pool)[:4]
    results=[]
    for key,game,event in selected:
        body=(OUT/f'{game}-{event}.json').read_bytes()
        receipt=json.loads((OUT/f'{game}-{event}.receipt.json').read_bytes())
        assert receipt['sha256']==hashlib.sha256(body).hexdigest() and receipt['status']==200
        raw_body=(RAW/f'{game}.body.json').read_bytes();g=json.loads(raw_body)
        e=next(p for p in g['plays'] if p['eventId']==event)
        assert e['pptReplayUrl']==receipt['url']
        frames=json.loads(body)
        goalies=[p['playerId'] for p in g['rosterSpots'] if p['positionCode']=='G']
        outputs={}
        for radius in (60,84):
            for limit in (12,24,36):
                outputs[f'{radius}/{limit}']=extract(frames,goalie_ids=goalies,radius=radius,relative_step_limit=limit)
        # Identity metadata is used only AFTER extraction for weak corroboration.
        pair=(e['details'].get('assist1PlayerId'),e['details'].get('scoringPlayerId'))
        unique={}
        for setting,r in outputs.items():
            for c in r['candidates']:
                k=f"{c['from_player_id']}->{c['to_player_id']}"
                unique.setdefault(k,[]).append({'setting':setting,**c})
        results.append({'game':game,'event':event,'selection_hash':key,'source_sha256':receipt['sha256'],
                        'pbp_sha256':hashlib.sha256(raw_body).hexdigest(),'outputs':outputs,
                        'retrospective_primary_pair':pair,'unique_pairs':unique})
    report={'selection':'First linked event per game; lowest four SHA256(comotion-unseen-v1/game_id), excluding initial pilot games',
            'settings_unchanged_from_pilot':True,'results':results,'production_changed':False,
            'accuracy_validated':False,'limitation':'Additional goal-selected clips; assist identity is not frame-level pass ground truth'}
    with (OUT/'analysis.json').open('x') as f:json.dump(report,f,allow_nan=False)
    for r in results:
        print({'game':r['game'],'event':r['event'],'primary_pair':r['retrospective_primary_pair'],
               'pairs':{k:len(v) for k,v in r['unique_pairs'].items()}})

if __name__=='__main__':run()
