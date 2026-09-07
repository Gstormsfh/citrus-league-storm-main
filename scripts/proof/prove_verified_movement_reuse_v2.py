"""Create-only fast/slow full-cohort equivalence receipts, no model fitting."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import resource
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from projections import verified_movement_reuse_v2 as reuse
from projections import development_feature_export as exporter
from projections import pre_shot_history as history
from projections.development_replay import Replay
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests
from projections.verified_export_experiment import strict_json
from archive_development_checkpoint import persist,snapshot
from run_movement_candidate import project,augment


def row_digest(rows):
    h=hashlib.sha256()
    for row in rows:
        h.update(json.dumps(row,sort_keys=True,separators=(',',':'),allow_nan=False).encode()+b'\n')
    return h.hexdigest()


def summary(folds,groups):
    return {'folds':{f:{s:{'rows':len(p['rows']),'all_row_fields_sha256':row_digest(p['rows']),
            'cohort':{k:v for k,v in p.items() if k!='rows'}} for s,p in parts.items()} for f,parts in folds.items()},
            'groups_sha256':fingerprint(groups)}


def run(mode,output,reference=None):
    output=Path(output).absolute()
    if (output.parent!=ROOT/'scripts/proof/results' or not output.name.startswith('verified-movement-reuse-')
            or any(p.is_symlink() for p in (output,*output.parents))):
        raise ValueError('Create-only scoped proof required')
    output.mkdir(exist_ok=False)
    persist(output,'attempt-started.json',{'mode':mode,'started_at':datetime.now(timezone.utc).isoformat(),'publishable':False})
    start=time.perf_counter()
    names=['data-pipeline/projections/verified_movement_reuse_v2.py','data-pipeline/tests/test_verified_movement_reuse_v2.py',
           'scripts/proof/prove_verified_movement_reuse_v2.py']
    pinned=snapshot(ROOT,names)
    try:
        if mode=='fast':
            def forbidden(*args,**kwargs):raise AssertionError('Feature projector called on verified fast path')
            exporter.project_development_game=forbidden
            exporter.adapt_frozen_feature_source=forbidden
            history.project=forbidden
            Replay.replay=forbidden
            result=reuse.load(ROOT)
            proof=summary(result.folds,result.groups)
            result.verify()
            closure=result.closure.checked
            cache_key=result.cache_key
        elif mode=='slow':
            certified=reuse.Closure(ROOT)
            certified.pin(reuse.CONDITIONAL+'/health.json',reuse.CERTIFICATES[reuse.CONDITIONAL][0])
            health=certified.read(reuse.CONDITIONAL+'/health.json')
            certified.inventory(reuse.CONDITIONAL,[*health['files'],'health.json'])
            for name,sha in health['files'].items():certified.pin(reuse.CONDITIONAL+'/'+name,sha)
            certified.mapping(certified.read(reuse.CONDITIONAL+'/declaration.json')['code_and_reference_sha256'])
            certified.mapping(certified.read(reuse.CONDITIONAL+'/source-replay.json')['checked'])
            replay=Replay(ROOT/'scripts/proof/results/historical-official-freeze-20260906',ROOT/reuse.EXPORT,
                          ROOT/'docs/analytics-development-ablation-plan-20260906.json')
            folds,groups=replay.replay()
            ids={}
            for parts in folds.values():
                for part in parts.values():
                    for row in part['rows']:ids.setdefault(row['game_id'],set()).add(row['event_id'])
            extra={}
            for gid in sorted(ids):
                payload=strict_json(replay.read(replay.paths(gid)[0]))
                values=project(payload['plays'],home=payload['homeTeam']['id'],away=payload['awayTeam']['id'])
                extra.update({(gid,eid):values[eid] for eid in ids[gid]})
            schema=certified.read(reuse.CONDITIONAL+'/fold1/fit-receipt.json')['schema']
            enriched={}
            for fold,parts in folds.items():
                enriched[fold]={}
                for split,part in parts.items():
                    rows=augment(part['rows'],extra,schema)
                    enriched[fold][split]={**part,'rows':rows,**cohort_digests(rows)}
            proof=summary(enriched,groups)
            replay.verify();certified.verify();closure={**certified.checked,**replay.checked};cache_key=None
        else:raise ValueError('Explicit fast or slow mode required')
        elapsed=time.perf_counter()-start
        if snapshot(ROOT,names)!=pinned:raise ValueError('Proof code drift')
        equivalent=None
        if reference:
            reference=Path(reference).absolute()
            if not reference.is_relative_to(ROOT/'scripts/proof/results') or reference.name!='report.json':raise ValueError('Safe proof reference required')
            reference_guard=reuse.Closure(ROOT)
            reference_guard.safe(str(reference))
            reference_health=reference_guard.read(str(reference.parent/'health.json'))
            if reference_health.get('status')!='complete-verified-feature-reuse-proof-not-acceptance' or reference_health.get('publishable') is not False:
                raise ValueError('Completed opposite-mode reference required')
            reference_guard.inventory(str(reference.parent.relative_to(ROOT)),['attempt-started.json','report.json','health.json'])
            reference_guard.pin(str(reference),reference_health['report_sha256'])
            prior=reference_guard.read(str(reference))
            if prior.get('status')!=reference_health['status'] or prior.get('publishable') is not False:
                raise ValueError('Reference status mismatch')
            if prior['comparison']!=proof or prior['mode']==mode:raise ValueError('Fast/slow full-row equivalence failed')
            equivalent=True
            reference_guard.verify()
            closure.update(reference_guard.checked)
        report={'status':'complete-verified-feature-reuse-proof-not-acceptance','mode':mode,'comparison':proof,
                'opposite_mode_equivalent':equivalent,'wall_seconds':elapsed,
                'peak_process_rss_bytes_macos':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                'cache_key':cache_key,'checked_sha256':closure,'code':pinned,'publishable':False,
                'limitations':['Local retrospective certified feature reuse, not a new source freshness or historical-as-of claim.',
                               'No model fitting or calibration selection; timings are one local process run, not a general benchmark.']}
        persist(output,'report.json',report)
        persist(output,'health.json',{'status':report['status'],'report_sha256':hashlib.sha256((output/'report.json').read_bytes()).hexdigest(),'publishable':False})
        print(json.dumps({'mode':mode,'wall_seconds':elapsed,'equivalent':equivalent}),flush=True)
    except BaseException as error:
        persist(output,'failure.json',{'type':type(error).__name__,'error':str(error),'publishable':False})
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['fast','slow'],required=True)
    parser.add_argument('--output',required=True);parser.add_argument('--reference')
    args=parser.parse_args();run(args.mode,args.output,args.reference)
