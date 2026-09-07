"""Create-only source-replayed event-memory ablation with saved JSON inference."""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from projections import event_memory_features as memory
from projections import development_experiment as development
from projections import calibration_shape, calibration_candidate, portable_context_model
from projections.development_replay import Replay
from projections.chronological_fit import cohort_digests
from projections.analytics_publication import fingerprint
from projections.probability_scorecard import probability_scorecard
from projections.strength_partition_candidate import _map, apply_map
from projections.verified_export_experiment import strict_json, file_sha
from archive_development_checkpoint import safe, persist
from run_strength_partition_candidate import REVIEW, REVIEW_SHA, SHAPE, CAL, verify_vectors

PLAN = 'docs/analytics-event-memory-plan-20260906.json'
CODE = ['data-pipeline/projections/event_memory_features.py', 'data-pipeline/tests/test_event_memory_features.py',
        'scripts/proof/run_event_memory_candidate.py', 'scripts/proof/test_run_event_memory_candidate.py',
        'data-pipeline/projections/strength_partition_candidate.py', 'scripts/proof/run_strength_partition_candidate.py',
        'scripts/proof/archive_development_checkpoint.py']


def augment(rows, extra, schema):
    result=[]
    for r in rows:
        values=extra[r['game_id'],r['event_id']]
        if len(values)!=len(memory.NAMES) or any(v is not None and (type(v) not in (int,float) or not np.isfinite(v)) for v in values):
            raise ValueError('Exact finite appended features required')
        row={**r,'features':r['features']+values}
        row['feature_sha256']=fingerprint({'schema_sha256':fingerprint(schema),
            'values':row['features'],'categorical':row['categorical']})
        result.append(row)
    return result


def primary_passed(losses):
    return all(losses['memory_monotone_group'][m] <= losses['frozen_monotone_group'][m]
               for m in ('brier','log_loss_clipped'))


def run(output):
    output=Path(output).absolute()
    if (output.parent!=ROOT/'scripts/proof/results' or not output.name.startswith('official-event-memory-')
            or any(p.is_symlink() for p in (output,*output.parents))): raise ValueError('New scoped output required')
    output.mkdir(exist_ok=False); checked={}; files={}; completed=[]
    def read(name,expected=None,parse=True):
        raw=safe(ROOT,name).read_bytes();sha=hashlib.sha256(raw).hexdigest()
        if expected is not None and sha!=expected or name in checked and checked[name]!=sha:
            raise ValueError('Source/reference/code drift: '+name)
        checked[name]=sha
        return strict_json(raw) if parse else raw
    def save(name,body):
        path=output/name;path.parent.mkdir(exist_ok=True,parents=True)
        persist(path.parent,path.name,body);files[name]=file_sha(path)
    try:
        now=datetime.now(timezone.utc).isoformat()
        save('attempt-started.json',{'started_at':now,'publishable':False})
        plan=read(PLAN)
        if (plan['contract']!=memory.VERSION+':plan' or plan['primary']!='memory_monotone_group'
                or plan['publishable'] is not False or plan['automatic_acceptance'] is not False
                or datetime.fromisoformat(plan['declared_at'])>datetime.fromisoformat(now)):
            raise ValueError('Exact earlier nonpromoting plan required')
        for name in CODE: read(name,parse=False)
        review=read(REVIEW,REVIEW_SHA)
        for name,sha in review['bound_file_sha256'].items(): read(name,sha,False)
        save('declaration.json',{'plan':plan,'plan_sha256':checked[PLAN],'code_and_reference_sha256':dict(checked)})
        replay=Replay(ROOT/plan['freeze_dir'],ROOT/plan['export_dir'],ROOT/plan['source_plan'])
        folds,groups=replay.replay()
        unique={r['game_id']:set() for parts in folds.values() for part in parts.values() for r in part['rows']}
        for parts in folds.values():
            for part in parts.values():
                for r in part['rows']: unique[r['game_id']].add(r['event_id'])
        extra={};availability={};samples=0
        for i,(gid,eids) in enumerate(sorted(unique.items())):
            path,_=replay.paths(gid);payload=strict_json(replay.read(path))
            kwargs={'home':payload['homeTeam']['id'],'away':payload['awayTeam']['id']}
            vectors=memory.project(payload['plays'],**kwargs)
            selected_index=next(j for j,e in enumerate(payload['plays']) if e['eventId'] in eids)
            selected=payload['plays'][selected_index];eid=selected['eventId']
            prefix=payload['plays'][:selected_index+1]
            if memory.project(prefix,**kwargs)[eid]!=vectors[eid]: raise ValueError('Future input leakage')
            changed=[*prefix[:-1],{**selected,'typeCode':506 if selected['typeCode']==505 else 505}]
            if memory.project(changed,**kwargs)[eid]!=vectors[eid]: raise ValueError('Current outcome leakage')
            samples+=1
            counts=availability.setdefault(str(gid//1000000),{n:{'available':0,'missing':0} for n in memory.NAMES})
            for eid in eids:
                extra[gid,eid]=vectors[eid]
                for name,value in zip(memory.NAMES,vectors[eid]): counts[name]['missing' if value is None else 'available']+=1
            if (i+1)%1000==0: print(json.dumps({'event':'memory.project','games':i+1}),flush=True)
        save('feature-audit.json',{'names':memory.NAMES,'availability':availability,'sampled_games_prefix_and_outcome_invariant':samples,
             'vectors':[{'game_id':g,'event_id':e,'values':v} for (g,e),v in sorted(extra.items())],
             'publishable':False})
        schema=deepcopy(replay.plan['schema']);schema['version']=memory.VERSION;schema['names']+=list(memory.NAMES)
        config=deepcopy(replay.plan['config']);config['views']['enhanced_numeric_names']+=list(memory.NAMES)
        development.validate_configuration(schema,config)
        enriched={}
        for fold,parts in folds.items():
            enriched[fold]={}
            for split,part in parts.items():
                rows=augment(part['rows'],extra,schema)
                enriched[fold][split]={**part,'rows':rows,**cohort_digests(rows)}
        development.validate_memberships(enriched,schema)
        summaries={}
        for fold,parts in enriched.items():
            print(json.dumps({'event':'memory.fit','fold':fold}),flush=True)
            rows={s:p['rows'] for s,p in parts.items()}
            vocab,bound=development._vocabulary_and_design_bound(rows,schema,config)
            raw=development._numeric(rows['train'],schema)
            if np.isnan(raw).all(axis=0).any(): raise ValueError('All-missing training feature')
            medians=np.nanmedian(raw,axis=0)
            design={'schema':schema,'numeric_names':config['views']['enhanced_numeric_names'],
                'categorical_names':config['views']['enhanced_categorical_names'],
                'medians':{n:float(medians[schema['names'].index(n)]) for n in config['views']['enhanced_numeric_names']},'vocabulary':vocab}
            xx={s:development._design(rr,schema,medians,vocab,config)['enhanced_context'] for s,rr in rows.items()}
            labels={s:np.asarray([int(r['label']) for r in rr]) for s,rr in rows.items()}
            with threadpool_limits(limits=1):
                model=HistGradientBoostingClassifier(**config['context'],random_state=config['seed']).fit(xx['train'],labels['train'])
                pp={s:model.predict_proba(xx[s])[:,1] for s in ('calibration','validation')}
                contexts={s:[calibration_candidate.context_from_row(r,schema) for r in rows[s]] for s in pp}
                sigmoid=_map(pp['calibration'],labels['calibration'],config)
                shape=calibration_shape.fit('monotone_logit_group',pp['calibration'],labels['calibration'],contexts['calibration'])
                portable=portable_context_model.export_model(model,design)
                errors={s:float(np.max(np.abs(portable_context_model.predict_rows(portable,rows[s])-pp[s]))) for s in pp}
                if any(e>1e-12 for e in errors.values()):raise ValueError('Independent JSON inference mismatch')
                baseline_model=read(f'{CAL}/{fold}/model.json')
                baseline_map=read(f'{SHAPE}/{fold}/calibrators.json')['monotone_logit_group']
                base_raw=portable_context_model.predict_rows(baseline_model,folds[fold]['validation']['rows'])
                base=calibration_shape.predict(baseline_map,base_raw,contexts['validation'])
            baseline_audit=verify_vectors(folds[fold]['validation']['rows'],base_raw,
                read(f'{CAL}/{fold}/predictions.json'),'validation')
            old=read(f'{SHAPE}/{fold}/predictions.json');prior={(r['game_id'],r['event_id']):r for r in old}
            gm={(g['game_id'],g['event_id']):g['groups'] for g in groups[fold]['rows']}
            if set(prior)!={(r['game_id'],r['event_id']) for r in rows['validation']}:raise ValueError('Baseline membership changed')
            predictions={'frozen_monotone_group':base,'memory_raw':pp['validation'],
                'memory_sigmoid':apply_map(pp['validation'],sigmoid),
                'memory_monotone_group':calibration_shape.predict(shape,pp['validation'],contexts['validation'])}
            evaluated=[]
            for i,r in enumerate(rows['validation']):
                key=r['game_id'],r['event_id'];before=prior[key]
                if (before['target']!=int(r['label']) or before['groups']!=gm[key]
                        or float(base[i])!=before['predictions']['monotone_logit_group']):raise ValueError('Frozen baseline values changed')
                evaluated.append({'game_id':key[0],'event_id':key[1],'target':int(r['label']),
                    'groups':gm[key],'predictions':{n:float(v[i]) for n,v in predictions.items()}})
            evaluated.sort(key=lambda r:(r['game_id'],r['event_id']))
            save(f'{fold}/model.json',portable);save(f'{fold}/calibrators.json',{'sigmoid':sigmoid,'monotone_logit_group':shape})
            save(f'{fold}/fit-receipt.json',{'schema':schema,'config':config,'bound':bound,'independent_prediction_errors':errors,
                'cohorts':{s:{k:v for k,v in p.items() if k!='rows'} for s,p in parts.items()},
                'baseline_raw_audit':baseline_audit,'publishable':False})
            save(f'{fold}/predictions.json',evaluated)
            lineage={'prediction_rows_sha256':fingerprint(evaluated),'source_manifest_sha256':REVIEW_SHA,
                'split_sha256':fingerprint({s:{k:v for k,v in p.items() if k!='rows'} for s,p in parts.items()}),
                'pipelines':{n:fingerprint({'model_sha256':fingerprint(baseline_model if n=='frozen_monotone_group' else portable),
                    'map_sha256':fingerprint({'frozen_monotone_group':baseline_map,'memory_raw':None,
                        'memory_sigmoid':sigmoid,'memory_monotone_group':shape}[n]),
                    'predictor':n,'declaration':files['declaration.json']}) for n in predictions}}
            with threadpool_limits(limits=1): card=probability_scorecard(evaluated,config=config['scorecard'],evidence_kind='real',lineage=lineage)
            save(f'{fold}/scorecard.json',card)
            losses={n:{m:card['overall']['models'][n]['metrics'][m]['value'] for m in ('brier','log_loss_clipped')} for n in predictions}
            summaries[fold]={'losses':losses,'primary_guard_passed':primary_passed(losses),'events':len(evaluated)}
            save(f'{fold}/summary.json',summaries[fold]);completed.append(fold)
            print(json.dumps({'event':'memory.complete','fold':fold,**summaries[fold]}),flush=True)
        replay.verify()
        save('source-replay.json',{'checked':replay.checked,'publishable':False})
        for name,sha in checked.items():
            if file_sha(safe(ROOT,name))!=sha:raise ValueError('End input drift')
        save('consumed-file-sha256.json',checked)
        save('result.json',{'folds':summaries,'primary_guard_passed':all(s['primary_guard_passed'] for s in summaries.values()),
            'limitations':plan['limitations'],'publishable':False,'model_accepted':False,'production_changed':False})
        for name,sha in files.items():
            if file_sha(output/name)!=sha:raise ValueError('Output drift')
        persist(output,'health.json',{'status':'complete-event-memory-development-not-accepted','files':files,'publishable':False})
    except BaseException as error:
        persist(output,'failure.json',{'error_type':type(error).__name__,'error':str(error),'completed_folds':completed,'files':files,'publishable':False})
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True)
    run(parser.parse_args().output)
