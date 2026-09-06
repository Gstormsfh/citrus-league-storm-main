"""Offline terminal-marker v2 proposal; no active parser or raw PBP repair.

Only a terminal PEND/GEND/GOFF triple at one period/clock can extend v1.
All other v1 failures (including historical team spelling) stay unavailable.
Every six-cell report event row and raw-body hash is preserved for review.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from projections.report_feature_source import _ReportParser, parse_report, validate_report_transport


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def review_terminal(body, *, game_id, game_date, away_abbrev, home_abbrev):
    identity = dict(game_id=game_id,game_date=game_date,away_abbrev=away_abbrev,home_abbrev=home_abbrev)
    parser = _ReportParser()
    parser.feed(body.decode('latin-1'));parser.close()
    result = {'contract':'citrus-pl-terminal-review-v2-proposal', 'body_sha256':sha(body),
              'raw_report_rows':parser.rows,'activated':False,'raw_pbp_modified':False}
    try:
        parse_report(body, **identity)
        return {**result,'status':'passes_existing_v1','reason':None}
    except ValueError as exc:
        reason = str(exc)
    # Reaching v1's final terminal check proves its header, sequential row count,
    # clock and chronology checks passed on the SAME unchanged report bytes.
    tail = parser.rows[-3:]
    valid = (reason == 'Incomplete report stream' and parser.row_depth is None
             and len(tail)==3 and [r[4] for r in tail]==['PEND','GEND','GOFF']
             and len({(r[1],r[3].split('|')[0].strip()) for r in tail})==1
             and sum(r[4]=='GEND' for r in parser.rows)==1
             and sum(r[4]=='GOFF' for r in parser.rows)==1)
    return {**result,'status':'eligible_terminal_v2_review' if valid else 'unresolved',
            'reason':'terminal_game_official_marker_after_game_end' if valid else reason,
            'original_v1_failure':reason,
            'proposal_scope':'No row removed; only same-clock PEND/GEND/GOFF ending recognized. Requires independent integration approval.'}


def audit(folder, output):
    paths = sorted(Path(folder).glob('*.receipt.json'))
    snapshot, cases, pending = [], [], []
    clock = datetime.now(timezone.utc)
    for path in paths:
        raw = path.read_bytes()
        try:
            receipt = json.loads(raw)
        except ValueError:
            pending.append(str(path));continue
        if 'observed_at' not in receipt or 'body_sha256' not in receipt:
            pending.append(str(path));continue
        body_path = path.parent / receipt['body_file']
        if body_path.name != receipt['body_file'] or path.is_symlink() or body_path.is_symlink():
            raise ValueError('Unsafe frozen report path')
        body = body_path.read_bytes()
        binding = {'game_id':receipt['game_id'],'receipt_path':str(path.resolve()),
                   'receipt_sha256':sha(raw),'body_path':str(body_path.resolve()),'body_sha256':sha(body)}
        snapshot.append(binding)
        try:
            validate_report_transport(body,receipt,game_id=receipt['game_id'],now=clock.isoformat())
            review = review_terminal(body, **{k:receipt[k] for k in ('game_id','game_date','away_abbrev','home_abbrev')})
        except (ValueError,KeyError,TypeError) as exc:
            review = {'status':'unresolved','reason':str(exc)}
        if path.read_bytes()!=raw or body_path.read_bytes()!=body:
            raise ValueError('Frozen input changed during bounded review')
        cases.append({**binding,**review})
    result = {'contract':'citrus-completed-report-review-snapshot-v1','snapshot_at':clock.isoformat(),
              'scope':'Paths enumerated once from actively growing collection; no full-collection completeness claim',
              'snapshot':snapshot,'pending_receipt_paths':pending,'cases':cases,
              'status_counts':dict(Counter(c['status'] for c in cases)),
              'reason_counts':dict(Counter(c.get('original_v1_failure') or c.get('reason') or 'v1_pass' for c in cases))}
    with Path(output).open('x') as stream:
        json.dump(result,stream,sort_keys=True,indent=2,allow_nan=False)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();result=audit(args.folder,args.output)
    print(json.dumps({'status_counts':result['status_counts'],'reason_counts':result['reason_counts']}))


if __name__=='__main__':main()
