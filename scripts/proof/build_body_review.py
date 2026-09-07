"""Create a new offline review bundle, preserving the earlier viewer evidence."""
import hashlib
import argparse
import json
import shutil
from pathlib import Path
from projections.possession_candidates import infer
from projections.possession_evidence import extract

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'scripts/proof/results'


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=BASE/'body-possession-review-20260907')
    parser.add_argument('--detections', type=Path, default=BASE/'body-possession-review-20260907/body-detections-torchvision.json')
    args = parser.parse_args()
    source = BASE/'pass-review-viewer-20260907'
    out = args.out
    data = json.loads((source/'data.json').read_bytes())
    video = source/'highlight.mp4'
    assert hashlib.sha256(video.read_bytes()).hexdigest() == data['video_sha256']
    bodies = json.loads(args.detections.read_bytes())
    assert bodies['video_sha256'] == data['video_sha256']
    receipt=json.loads((BASE/'linked-replay-pilot-20260907/2025030416-117.json.receipt.json').read_bytes())
    replay_raw=(BASE/'linked-replay-pilot-20260907/2025030416-117.json').read_bytes()
    if hashlib.sha256(replay_raw).hexdigest()!=receipt['sha256'] or receipt['sha256']!=data['source_sha256'] or json.loads(replay_raw)!=data['frames']:
        raise ValueError('Review frames do not match frozen source replay')
    data['goalie_ids']=[r['playerId'] for r in receipt['roster'] if r['positionCode']=='G']
    data['possession'] = infer(data['frames'], goalie_ids=data['goalie_ids'])
    roles={r['playerId']: 'goalie' if r['positionCode']=='G' else 'skater'
           for r in receipt['roster'] if r['positionCode'] in ('G','C','L','R','D','LW','RW')}
    observed_ids={a['playerId'] for f in data['frames'] for a in f['onIce'].values() if a.get('playerId')}
    if observed_ids-set(roles):
        raise ValueError('Incomplete roster roles for observed players')
    data['controlEvidence'] = extract(data['frames'], player_roles=roles)
    out.mkdir()
    (out/'role-source.json').write_text(json.dumps(receipt,allow_nan=False))
    shutil.copyfile(video, out/'highlight.mp4')
    shutil.copyfile(args.detections, out/'body-detections.json')
    for src, dst in [('pass-review-viewer.html','index.html'), ('pass-review-viewer.js','viewer.js')]:
        shutil.copyfile(ROOT/'scripts/proof'/src, out/dst)
    shutil.copyfile(ROOT/'scripts/proof/possession-review.js', out/'possession-review.js')
    page = (out/'index.html').read_text().replace('</body>', '<script src="possession-review.js"></script></body>')
    (out/'index.html').write_text(page)
    (out/'data.json').write_text(json.dumps(data, allow_nan=False))
    receipt = dict(files={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir()},
                   production_changed=False, image_detections_not_registered_to_replay=True,
                   possession_ground_truth=False)
    (out/'build-receipt.json').write_text(json.dumps(receipt, indent=2))
    print(out)


if __name__ == '__main__':
    run()
