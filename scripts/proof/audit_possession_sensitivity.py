"""Audit threshold stability on all saved pilot replays; never accuracy."""
import argparse
import hashlib
import itertools
import json
from collections import Counter
from pathlib import Path
from projections.possession_candidates import infer

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'scripts/proof/results'
SETTINGS = [dict(radius=r, relative_step_limit=m, minimum_hold=h)
            for r, m, h in itertools.product((60,84,108), (12,24,36), (2,3,4))]


def run():
    parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);args=parser.parse_args()
    reports=[]
    for directory in ('linked-replay-pilot-20260907','tracked-comotion-unseen-20260907'):
        for path in sorted((BASE/directory).glob('20*-*.json')):
            if 'receipt' in path.name: continue
            receipt_path=path.with_suffix('.json.receipt.json')
            if not receipt_path.exists(): receipt_path=path.with_suffix('.receipt.json')
            receipt=json.loads(receipt_path.read_bytes());raw=path.read_bytes()
            digest=hashlib.sha256(raw).hexdigest()
            if digest!=receipt['sha256']: raise ValueError('Replay hash mismatch')
            frames=json.loads(raw)
            baseline=infer(frames)
            variants=[infer(frames,**setting) for setting in SETTINGS]
            sensitive=[];stable_control=0;abstained=0;review=[]
            for i, b in enumerate(baseline):
                votes=Counter(v[i]['player_id'] for v in variants)
                if len(votes)>1:
                    sensitive.append(i)
                    review.append(dict(frame=i, baseline_owner=b['player_id'],
                        variants=[dict(player_id=p,count=n) for p,n in votes.items()],
                        reason='parameter_sensitive',label=None))
                elif b['player_id'] is not None: stable_control+=1
                else: abstained+=1
            # Deterministic review order includes disagreement, stable control,
            # and abstention; do not evaluate only convenient positive examples.
            sampled=[]
            for kind,predicate in [('sensitive',lambda i: i in sensitive),
                                   ('stable_control',lambda i: i not in sensitive and baseline[i]['player_id'] is not None),
                                   ('stable_abstention',lambda i: i not in sensitive and baseline[i]['player_id'] is None)]:
                candidates=[i for i in range(len(frames)) if predicate(i)]
                if candidates:
                    for i in sorted({candidates[0], candidates[len(candidates)//2], candidates[-1]}):
                        sampled.append(dict(frame=i,stratum=kind,label=None))
            reports.append(dict(replay=str(path.relative_to(ROOT)),source_sha256=digest,
                frames=len(frames),baseline_control_frames=sum(r['player_id'] is not None for r in baseline),
                unanimous_control_frames=stable_control,unanimous_abstention_frames=abstained,
                parameter_sensitive_frames=len(sensitive),review_samples=sampled,
                disagreements=review))
    result=dict(settings=SETTINGS,replays=reports,
        code_sha256={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in (
            'scripts/proof/audit_possession_sensitivity.py',
            'data-pipeline/projections/possession_candidates.py',
            'data-pipeline/projections/possession_source_validation.py')},
        totals={k:sum(r[k] for r in reports) for k in ('frames','baseline_control_frames','unanimous_control_frames',
                                                    'unanimous_abstention_frames','parameter_sensitive_frames')},
        interpretation='Agreement across chosen thresholds is robustness, not correctness or calibrated probability',
        sampling_limit='Goal-linked saved replays only; no non-goal or population-representative validation',
        labels_collected=0,production_changed=False)
    with args.output.open('x') as out: json.dump(result,out,indent=2)
    print(json.dumps(dict(replays=len(reports),totals=result['totals'])))


if __name__=='__main__': run()
