"""Read-only complete retained-corpus v2 replay; create-only compact proof."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from projections.report_feature_source_v2 import build_report_feature_source
from projections.frozen_feature_source import adapt_frozen_feature_source
from projections.analytics_publication import fingerprint


def sha(raw):return hashlib.sha256(raw).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reports',required=True,type=Path)
    parser.add_argument('--freeze',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    inventory_raw=(args.reports/'request-inventory.json').read_bytes()
    inventory=json.loads(inventory_raw)
    expected={r['game_id']:r for r in inventory['games']}
    paths=sorted(args.reports.glob('*.receipt.json'))
    if len(expected)!=len(inventory['games']) or {int(p.name.split('.')[0]) for p in paths}!=set(expected):
        raise ValueError('Exact completed requested receipt population required')
    pipeline=(ROOT/'data-pipeline').resolve()
    files=[Path(__file__).resolve()]+sorted({Path(m.__file__).resolve() for m in tuple(sys.modules.values())
        if getattr(m,'__file__',None) and str(Path(m.__file__).resolve()).startswith(str(pipeline)+'/')
        and str(m.__file__).endswith('.py')})
    code_hashes={str(p):sha(p.read_bytes()) for p in files}
    now=datetime.now(timezone.utc).isoformat();cases=[]
    for index,path in enumerate(paths,1):
        raw=path.read_bytes();r=json.loads(raw);gid=r['game_id'];target=expected[gid]
        if any(r[k]!=v for k,v in target.items()):raise ValueError('Receipt detached from requested identity')
        if Path(r['body_file']).name!=r['body_file']:raise ValueError('Unsafe body path')
        report_path=args.reports/r['body_file'];body=report_path.read_bytes()
        folder=args.freeze/str(gid//1000000)/'pbp'
        pbp_path=folder/f'{gid}.body.json';pbp_receipt_path=folder/f'{gid}.receipt.json'
        pbp_bytes=pbp_path.read_bytes();pbp_receipt_bytes=pbp_receipt_path.read_bytes()
        if (sha(pbp_bytes)!=r['pbp_body_sha256'] or sha(pbp_receipt_bytes)!=r['pbp_receipt_bytes_sha256']
                or sha(body)!=r['body_sha256']):raise ValueError('Frozen input byte mismatch')
        base={'game_id':gid,'report_body_path':str(report_path),'report_body_sha256':sha(body),
              'report_receipt_sha256':sha(raw),'pbp_body_sha256':sha(pbp_bytes),
              'pbp_receipt_sha256':sha(pbp_receipt_bytes),'original_capture_status':r['status']}
        try:
            source=adapt_frozen_feature_source(pbp_bytes,json.loads(pbp_receipt_bytes),now=now)
            out=build_report_feature_source(source,body,r,now=now)
            rawlabels=out['report_rows'][0]['header_team_labels_raw']
            base.update(status='v2_parsed_and_source_validated',feature_source_sha256=out['feature_source_sha256'],
                report_rows=len(out['report_rows']),report_rows_sha256=fingerprint(out['report_rows']),
                header_labels=rawlabels,report_type_counts=out['report_type_counts'],
                report_gameplay_type_counts=out['report_gameplay_type_counts'],
                excluded_administrative_report_rows=out['excluded_administrative_report_rows'],
                gameplay_type_counts_match=out['gameplay_type_counts_match'],
                attempt_population_matched=out['attempt_population_matched'],
                matched_attempts=len(out['features_in_report_order']),unresolved_identities=out['unresolved_identities'],
                unmatched_report_rows=out['unmatched_report_rows'])
        except (ValueError,KeyError,TypeError) as exc:
            base.update(status='unavailable',reason=str(exc))
        for p,b in [(path,raw),(report_path,body),(pbp_path,pbp_bytes),(pbp_receipt_path,pbp_receipt_bytes)]:
            if p.read_bytes()!=b:raise ValueError('Input changed during replay')
        cases.append(base)
        if index%100==0:print(json.dumps({'completed':index,'expected':len(paths)}),flush=True)
    if any(sha(Path(p).read_bytes())!=h for p,h in code_hashes.items()):raise ValueError('Replay code changed')
    if (args.reports/'request-inventory.json').read_bytes()!=inventory_raw:raise ValueError('Inventory changed')
    result={'contract':'citrus-official-report-v2-offline-replay-v1','observed_at':now,'code_sha256':code_hashes,
        'python_version':sys.version,'code_closure':'loaded first-party Python source closure plus this replay CLI',
        'request_inventory_sha256':sha(inventory_raw),'requested_games':len(expected),'cases':cases,
        'status_counts':dict(Counter(c['status'] for c in cases)),
        'failure_counts':dict(Counter(c['reason'] for c in cases if c['status']=='unavailable')),
        'attempt_population_matched_games':sum(c.get('attempt_population_matched',False) for c in cases),
        'training_performed':False,'old_cohorts_changed':False,'raw_source_changed':False,
        'limitation':'Parser and correspondence evidence only; no accuracy, independent-sensor or live-as-of claim'}
    with args.output.open('x') as stream:json.dump(result,stream,sort_keys=True,indent=2,allow_nan=False)
    print(json.dumps({k:v for k,v in result.items() if k.endswith('counts') or k=='attempt_population_matched_games'}))


if __name__=='__main__':main()
