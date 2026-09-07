"""Bounded hysteresis challenger; development diagnostics, not accuracy."""
import argparse
import hashlib
import json
from pathlib import Path
from projections.possession_candidates import infer

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/proof/results'


def run():
    parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);args=parser.parse_args()
    audit=json.loads((BASE/'body-possession-review-20260907/possession-sensitivity-v2.json').read_bytes())
    results=[]
    for entry in audit['replays']:
        raw=(ROOT/entry['replay']).read_bytes()
        assert hashlib.sha256(raw).hexdigest()==entry['source_sha256']
        frames=json.loads(raw)
        baseline=infer(frames,radius=60)
        challenger=infer(frames,radius=60,retention_radius=84)
        changed=[dict(frame=i,before=a['player_id'],after=b['player_id']) for i,(a,b) in enumerate(zip(baseline,challenger)) if a['player_id']!=b['player_id']]
        result=dict(replay=entry['replay'],source_sha256=entry['source_sha256'],changed_frames=changed,reviewed_correctness=None)
        if '2025030416-117' in entry['replay']:
            result['same_clip_provisional_diagnostic']=dict(
                carry_frames=list(range(72,92)),
                baseline_carry_abstentions=[i for i in range(72,92) if baseline[i]['player_id']!=8475791],
                challenger_carry_abstentions=[i for i in range(72,92) if challenger[i]['player_id']!=8475791],
                baseline_flight_control=[i for i in range(62,69) if baseline[i]['player_id'] is not None],
                challenger_flight_control=[i for i in range(62,69) if challenger[i]['player_id'] is not None],
                baseline_shot_boundary=[baseline[i]['player_id'] for i in range(92,95)],
                challenger_shot_boundary=[challenger[i]['player_id'] for i in range(92,95)])
        results.append(result)
    result=dict(baseline=dict(radius=60,retention_radius=60),challenger=dict(radius=60,retention_radius=84),
                unchanged=dict(relative_step_limit=24,separation=12,minimum_hold=3),replays=results,
                default_radius_84_changed=False,selected_after_inspecting_hall=True,
                independent_validation=False,production_changed=False,
                code_sha256={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in (
                    'data-pipeline/projections/possession_candidates.py', 'scripts/proof/evaluate_possession_retention.py')})
    with args.output.open('x') as f: json.dump(result,f,indent=2)
    print(json.dumps([dict(replay=r['replay'],changes=len(r['changed_frames']),diagnostic=r.get('same_clip_provisional_diagnostic')) for r in results]))


if __name__=='__main__':run()
