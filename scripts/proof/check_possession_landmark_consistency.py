"""Diagnostic against prior provisional intervals, NOT a held-out benchmark."""
import argparse
import hashlib
import json
from pathlib import Path
from projections.possession_candidates import infer

ROOT = Path(__file__).resolve().parents[2]


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    alignment_path=ROOT/'scripts/proof/results/passing-landmarks-20260907/reconciliation-v2.json'
    alignment=json.loads(alignment_path.read_bytes())
    raw=(ROOT/'scripts/proof/results/linked-replay-pilot-20260907/2025030416-117.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest()==alignment['replay_sha256']
    predictions=infer(json.loads(raw))
    anchors={a['name']:a['replay_ticks'] for a in alignment['anchors']}
    flight=range(anchors['pass_departure'][1]+1, anchors['receiver_acquisition'][0])
    carry=range(anchors['receiver_acquisition'][1]+1, anchors['shot_departure'][0])
    report=dict(status='same_clip_provisional_consistency_only',
                source_sha256=alignment['replay_sha256'],
                alignment_sha256=hashlib.sha256(alignment_path.read_bytes()).hexdigest(),
                flight=dict(frames=list(flight),unexpected_control_frames=[i for i in flight if predictions[i]['player_id'] is not None]),
                carry=dict(frames=list(carry),expected_player_id=8475791,
                           disagreement_frames=[i for i in carry if predictions[i]['player_id']!=8475791]),
                independent_validation=False,calibrated_probability=None,training_eligible=False,production_eligible=False)
    with args.output.open('x') as f: json.dump(report,f,indent=2)
    print(json.dumps(report))


if __name__=='__main__': run()
