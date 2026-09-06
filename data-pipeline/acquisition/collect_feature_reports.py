"""Create-only bounded official PL freeze from an existing frozen schedule/PBP.

No model, database or legacy trainer imports. One HTTP attempt per selected game;
no retries, redirected sources, overwrite/resume, or implicit season selection.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

from projections.frozen_feature_source import adapt_frozen_feature_source
from projections.report_feature_source import parse_report, report_url


def _now():return datetime.now(timezone.utc).isoformat()
def _digest(body):return hashlib.sha256(body).hexdigest()


def _write(path, value):
    with path.open('x') as stream:json.dump(value,stream,sort_keys=True,allow_nan=False,separators=(',',':'))


def select_inventory(freeze_dir, seasons, *, max_games, game_ids=None):
    """Validate every selected immutable source before any network/output work."""
    if (not isinstance(seasons,list) or not seasons or any(type(s) is not int for s in seasons)
            or len(set(seasons))!=len(seasons) or type(max_games) is not int or not 1<=max_games<=10000):
        raise ValueError('Explicit unique seasons and bounded maximum games required')
    freeze_dir=Path(freeze_dir)
    manifest_bytes=(freeze_dir/'schedule-manifest.json').read_bytes();manifest=json.loads(manifest_bytes)
    selected={}
    for season in seasons:
        entry=manifest[str(season)]
        if entry['season']!=season or not isinstance(entry['terminal_game_ids'],list):
            raise ValueError('Frozen schedule season conflict')
        for gid in entry['terminal_game_ids']:
            report_url(gid)
            if gid//1000000!=season or gid in selected:raise ValueError('Conflicting scheduled game identity')
            selected[gid]=entry['games'][str(gid)]
    if game_ids is not None:
        if (not isinstance(game_ids,list) or not game_ids or any(type(gid) is not int for gid in game_ids)
                or len(set(game_ids))!=len(game_ids) or not set(game_ids)<=set(selected)):
            raise ValueError('Requested game identities outside frozen inventory')
        selected={gid:selected[gid] for gid in game_ids}
    if not selected or len(selected)>max_games:raise ValueError('Selected inventory exceeds explicit max-games or is empty')
    rows=[]
    for gid,expected in sorted(selected.items()):
        folder=freeze_dir/str(gid//1000000)/'pbp'
        receipt_bytes=(folder/f'{gid}.receipt.json').read_bytes()
        receipt=json.loads(receipt_bytes)
        body=(folder/f'{gid}.body.json').read_bytes()
        if receipt['schedule_identity']!=expected:raise ValueError('PBP schedule receipt conflict')
        adapted=adapt_frozen_feature_source(body,receipt)
        payload=adapted['prepared'][0]['payload']['pbp']
        rows.append({'game_id':gid,'game_date':expected['date'],
                     'away_abbrev':payload['awayTeam']['abbrev'],'home_abbrev':payload['homeTeam']['abbrev'],
                     'pbp_body_sha256':receipt['body_sha256'],'pbp_source_receipt_sha256':adapted['source_receipt_sha256'],
                     'pbp_receipt_bytes_sha256':_digest(receipt_bytes),
                     'pbp_observed_at':receipt['observed_at'],'schedule_identity':expected})
    return rows,_digest(manifest_bytes)


def collect_reports(freeze_dir, output, seasons, *, max_games, request, game_ids=None,
                    delay=0.5, max_body_bytes=4000000, sleep=time.sleep):
    if (type(delay) not in (int,float) or not 0.1<=delay<=60
            or type(max_body_bytes) is not int or not 1000<=max_body_bytes<=8000000):
        raise ValueError('Bounded positive delay/body limit required')
    rows,manifest_sha=select_inventory(freeze_dir,seasons,max_games=max_games,game_ids=game_ids)
    pipeline=Path(__file__).resolve().parents[1]
    code_paths=[Path(__file__).resolve()]+[pipeline/name for name in (
        'projections/report_feature_source.py','projections/frozen_feature_source.py',
        'projections/causal_feature_contract.py','acquisition/observed_sequences.py',
        'monitoring/appearance_contract.py','monitoring/toi_source_receipt.py',
        'acquisition/canonical_events.py','acquisition/event_observation_service.py',
        'monitoring/final_game_evidence.py','projections/analytics_publication.py')]
    code_hashes={str(path):_digest(path.read_bytes()) for path in code_paths}
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    result={'contract':'citrus-official-feature-report-freeze-v1','status':'incomplete',
            'source_freeze':str(Path(freeze_dir).resolve()),'schedule_manifest_sha256':manifest_sha,
            'selected_game_ids':[r['game_id'] for r in rows],'max_body_bytes':max_body_bytes,'delay_seconds':delay,
            'started_at':_now(),'games':[],'training_ready':False,'publishable':False,'historical_as_of_verified':False}
    result['code_sha256']=code_hashes
    try:
        _write(output/'request-inventory.json',{'schedule_manifest_sha256':manifest_sha,'games':rows})
        result['request_inventory_sha256']=_digest((output/'request-inventory.json').read_bytes())
        for expected in rows:
            gid=expected['game_id'];url=report_url(gid)
            receipt={**expected,'url':url,'requested_at':_now(),'status':'unavailable',
                     'body_file':f'{gid}-PL.HTM','historical_as_of_verified':False,
                     'byte_contract':'requests-content-after-decompression-not-wire-bytes','timing_semantics':'per-response'}
            response=None;chunks=[];size=0
            try:
                response=request(url,timeout=30,allow_redirects=False,stream=True)
                receipt.update(http_status=response.status_code,response_url=response.url)
                for chunk in response.iter_content(chunk_size=65536):
                    remaining=max_body_bytes-size
                    if len(chunk)>remaining:
                        chunks.append(chunk[:remaining]);size+=remaining
                        receipt['body_truncated_at_limit']=True
                        raise ValueError('Report body exceeds explicit byte limit')
                    chunks.append(chunk);size+=len(chunk)
                receipt['observed_at']=_now()
                body=b''.join(chunks)
                if response.status_code!=200 or response.url!=url:raise ValueError('Report HTTP status/redirect conflict')
                parsed=parse_report(body,game_id=gid,game_date=expected['game_date'],
                                    away_abbrev=expected['away_abbrev'],home_abbrev=expected['home_abbrev'])
                receipt.update(status='captured_header_verified',report_rows=len(parsed))
            except Exception as exc:
                receipt.update(error_type=type(exc).__name__,reason='report_transport_or_parse_failure')
            finally:
                if response is not None:
                    try:response.close()
                    except Exception as exc:
                        receipt.update(status='unavailable',error_type=type(exc).__name__,reason='response_close_failure')
                receipt.setdefault('observed_at',_now())
                body=b''.join(chunks)
                receipt.update(body_bytes=len(body),body_sha256=_digest(body))
                # Even failed/truncated responses remain explicit evidence, never
                # reused as a successful report or retried with a weaker gate.
                with (output/receipt['body_file']).open('xb') as stream:stream.write(body)
                _write(output/f'{gid}.receipt.json',receipt)
            result['games'].append({'game_id':gid,'status':receipt['status'],'body_sha256':receipt['body_sha256']})
            print(json.dumps({'event':'feature_report.captured','game_id':gid,'status':receipt['status']}),flush=True)
            sleep(delay)
        if _digest((Path(freeze_dir)/'schedule-manifest.json').read_bytes())!=manifest_sha:
            raise ValueError('Source schedule manifest changed during collection')
        for expected in rows:
            gid=expected['game_id'];folder=Path(freeze_dir)/str(gid//1000000)/'pbp'
            if (_digest((folder/f'{gid}.body.json').read_bytes())!=expected['pbp_body_sha256']
                    or _digest((folder/f'{gid}.receipt.json').read_bytes())!=expected['pbp_receipt_bytes_sha256']):
                raise ValueError('Frozen source pair changed during collection')
        if any(_digest(Path(path).read_bytes())!=digest for path,digest in code_hashes.items()):
            raise ValueError('Report collector dependency changed during collection')
        if _digest((output/'request-inventory.json').read_bytes())!=result['request_inventory_sha256']:
            raise ValueError('Bound request inventory changed during collection')
        result['source_and_code_drift_check']='passed'
        if all(r['status']=='captured_header_verified' for r in result['games']):result['status']='collection_complete_not_model_acceptance'
    except BaseException as exc:
        result.update(error_type=type(exc).__name__,reason='collection_incomplete_or_source_drift')
    finally:
        result['completed_at']=_now()
        try:_write(output/'health.json',result)
        except Exception as exc:result.update(status='incomplete',health_persistence_error=type(exc).__name__)
        print(json.dumps({'event':'feature_report.health',**result}),flush=True)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze-dir',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--seasons',required=True,help='Explicit comma-separated season start years')
    parser.add_argument('--game-ids',help='Optional explicit subset; never inferred from missing files')
    parser.add_argument('--max-games',type=int,required=True)
    parser.add_argument('--delay',type=float,default=0.5)
    parser.add_argument('--max-body-bytes',type=int,default=4000000)
    args=parser.parse_args()
    try:
        import requests
        result=collect_reports(args.freeze_dir,args.output,[int(s) for s in args.seasons.split(',')],
                               game_ids=[int(g) for g in args.game_ids.split(',')] if args.game_ids else None,
                               max_games=args.max_games,delay=args.delay,max_body_bytes=args.max_body_bytes,request=requests.get)
        return 0 if result['status']=='collection_complete_not_model_acceptance' else 1
    except BaseException as exc:
        print(json.dumps({'event':'feature_report.health','status':'incomplete','error_type':type(exc).__name__}),flush=True)
        return 1


if __name__=='__main__':raise SystemExit(main())
