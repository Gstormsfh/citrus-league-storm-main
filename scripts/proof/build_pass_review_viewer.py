"""Package an offline-only local review app using verified saved evidence."""
import hashlib,json,shutil
from pathlib import Path
from projections.tracked_comotion_candidates import extract

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/proof/results'
OUT=BASE/'pass-review-viewer-20260907'

def run():
    OUT.mkdir()
    raw=(BASE/'linked-replay-pilot-20260907/2025030416-117.json').read_bytes()
    receipt=json.loads((BASE/'linked-replay-pilot-20260907/2025030416-117.json.receipt.json').read_bytes())
    assert hashlib.sha256(raw).hexdigest()==receipt['sha256']
    alignment=json.loads((BASE/'passing-landmarks-20260907/reconciliation-v2.json').read_bytes())
    video=BASE/'passing-video-review-20260907/highlight.mp4'
    assert hashlib.sha256(video.read_bytes()).hexdigest()==alignment['video_sha256']
    assert alignment['replay_sha256']==receipt['sha256']
    frames=json.loads(raw);actors=[a for f in frames for a in f['onIce'].values()]
    xs=[a['x'] for a in actors];ys=[a['y'] for a in actors]
    names={str(p['playerId']):p['firstName']['default']+' '+p['lastName']['default'] for p in receipt['roster']}
    goalie_ids=[p['playerId'] for p in receipt['roster'] if p['positionCode']=='G']
    runs=extract(frames,goalie_ids=goalie_ids,radius=84,relative_step_limit=24)['stable_contacts']
    data={'game':2025030416,'event':117,'frames':frames,'names':names,'controlRuns':runs,
          'bounds':dict(minX=min(xs)-25,maxX=max(xs)+25,minY=min(ys)-25,maxY=max(ys)+25),
          'anchors':alignment['anchors'],
          'offset_interval':alignment['alignment_relative_to_first_replay_frame']['video_minus_replay_seconds'],
          'source_sha256':receipt['sha256'],'video_sha256':alignment['video_sha256']}
    (OUT/'data.json').write_text(json.dumps(data,allow_nan=False))
    shutil.copyfile(video,OUT/'highlight.mp4')
    shutil.copyfile(ROOT/'scripts/proof/pass-review-viewer.html',OUT/'index.html')
    shutil.copyfile(ROOT/'scripts/proof/pass-review-viewer.js',OUT/'viewer.js')
    (OUT/'build-receipt.json').write_text(json.dumps({'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()
        for p in OUT.iterdir() if p.is_file()},'production_changed':False}))
    print(OUT)

if __name__=='__main__':run()
