"""Create-only offline review packets from the seven already collected clips."""
import hashlib
import json
from pathlib import Path
from projections.passing_sequence_review import build_packet

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/proof/results'
OUT=BASE/'passing-review-packets-20260907'


def run():
    OUT.mkdir()
    inventory=[]
    for dirname in ('linked-replay-pilot-20260907','tracked-comotion-unseen-20260907'):
        for receipt_path in sorted((BASE/dirname).glob('*.json.receipt.json')):
            receipt=json.loads(receipt_path.read_bytes())
            filename=receipt_path.name.removesuffix('.receipt.json')
            body=(receipt_path.parent/filename).read_bytes()
            assert hashlib.sha256(body).hexdigest()==receipt['sha256']
            game,event=receipt['game'],receipt['event']
            raw=(BASE/f'historical-official-freeze-20260906/2025/pbp/{game}.body.json').read_bytes()
            pbp=json.loads(raw)
            source_event=next(p for p in pbp['plays'] if p['eventId']==event)
            assert source_event['pptReplayUrl']==receipt.get('replay_url',receipt.get('url'))
            goalies=[p['playerId'] for p in pbp['rosterSpots'] if p['positionCode']=='G']
            packet=build_packet(body,game_id=game,event_id=event,goalie_ids=goalies)
            packet['pbp_sha256']=hashlib.sha256(raw).hexdigest()
            packet['replay_page']=f'https://www.nhl.com/ppt-replay/goal/{game}/{event}'
            packet['video_reference']=source_event['details'].get('highlightClipSharingUrl')
            with (OUT/filename).open('x') as f:json.dump(packet,f,allow_nan=False)
            inventory.append({'game':game,'event':event,'candidate_variants':len(packet['candidates']),
                              'file':filename,'source_sha256':packet['source_sha256']})
    # Unseen receipts use a different filename convention; handled explicitly below.
    unseen=BASE/'tracked-comotion-unseen-20260907'
    for receipt_path in sorted(unseen.glob('*.receipt.json')):
        if receipt_path.name.endswith('.json.receipt.json'):continue
        receipt=json.loads(receipt_path.read_bytes());game,event=receipt['game'],receipt['event']
        filename=f'{game}-{event}.json';body=(unseen/filename).read_bytes()
        assert hashlib.sha256(body).hexdigest()==receipt['sha256']
        raw=(BASE/f'historical-official-freeze-20260906/2025/pbp/{game}.body.json').read_bytes();pbp=json.loads(raw)
        source_event=next(p for p in pbp['plays'] if p['eventId']==event)
        assert source_event['pptReplayUrl']==receipt['url']
        packet=build_packet(body,game_id=game,event_id=event,
                            goalie_ids=[p['playerId'] for p in pbp['rosterSpots'] if p['positionCode']=='G'])
        packet.update(pbp_sha256=hashlib.sha256(raw).hexdigest(),
                      replay_page=f'https://www.nhl.com/ppt-replay/goal/{game}/{event}',
                      video_reference=source_event['details'].get('highlightClipSharingUrl'))
        with (OUT/filename).open('x') as f:json.dump(packet,f,allow_nan=False)
        inventory.append({'game':game,'event':event,'candidate_variants':len(packet['candidates']),
                          'file':filename,'source_sha256':packet['source_sha256']})
    assert len(inventory)==7 and len({(r['game'],r['event']) for r in inventory})==7
    summary={'clips':len(inventory),'inventory':inventory,'reviewed_passes':0,
             'candidate_variants_are_not_unique_passes':True,'production_changed':False}
    with (OUT/'summary.json').open('x') as f:json.dump(summary,f,allow_nan=False)
    print(summary)

if __name__=='__main__':run()
