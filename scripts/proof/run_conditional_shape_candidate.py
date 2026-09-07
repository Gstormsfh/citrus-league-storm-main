"""Create-only source-replayed movement ablation with saved JSON inference."""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import math
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from projections import pre_shot_history as history
from projections import pre_shot_movement as movement
from projections import conditional_calibration_shape as conditional
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

PLAN = 'docs/analytics-conditional-shape-plan-20260906.json'
MOVEMENT = 'scripts/proof/results/official-movement-20260906-full'
MOVEMENT_HEALTH_SHA = 'efc58de50aefff913948e624324b97db7ebc57d9edaa1a1c243eb277c925ac22'
CODE = ['data-pipeline/projections/conditional_calibration_shape.py', 'data-pipeline/tests/test_conditional_calibration_shape.py',
        'data-pipeline/tests/test_conditional_calibration_shape_review.py',
        'scripts/proof/run_conditional_shape_candidate.py', 'scripts/proof/test_run_conditional_shape_candidate.py', 'data-pipeline/projections/pre_shot_history.py', 'data-pipeline/projections/pre_shot_movement.py',
        'data-pipeline/tests/test_pre_shot_history.py', 'data-pipeline/tests/test_pre_shot_movement.py',
        'scripts/proof/run_movement_candidate.py', 'scripts/proof/test_run_movement_candidate.py',
        'data-pipeline/projections/strength_partition_candidate.py', 'scripts/proof/run_strength_partition_candidate.py',
        'scripts/proof/archive_development_checkpoint.py']


VERSION = 'citrus-matched-conditional-shape-v1'
CONTEXTS = ('immediate_recorded_live_event', 'prior_same_team_unblocked_attempt')
NAMES = tuple(context + '__' + name for context in CONTEXTS
              for name in (*movement.NAMES, 'same_team_indicator'))


def flatten(record):
    result = []
    for context in CONTEXTS:
        pair = record[context]
        relation = pair['prior_owner_relation']
        if relation not in (None, 'same_team', 'opponent'):
            raise ValueError('Unknown owner relation')
        if set(pair['values']) != set(movement.NAMES):
            raise ValueError('Exact movement measurements required')
        result += [pair['values'][name] for name in movement.NAMES]
        result.append(None if relation is None else int(relation == 'same_team'))
    return result


def project(events, **kwargs):
    return {eid: flatten(record) for eid, record in history.project(events, **kwargs).items()}


def augment(rows, extra, schema):
    result=[]
    for r in rows:
        values=extra[r['game_id'],r['event_id']]
        if len(values)!=len(NAMES) or any(v is not None and (type(v) not in (int,float) or not np.isfinite(v)) for v in values):
            raise ValueError('Exact finite appended features required')
        row={**r,'features':r['features']+values}
        row['feature_sha256']=fingerprint({'schema_sha256':fingerprint(schema),
            'values':row['features'],'categorical':row['categorical']})
        result.append(row)
    return result


def scalar_predictions(model, probabilities, contexts):
    """Separate scalar arithmetic; no conditional module predictor/basis calls."""
    if len(probabilities)!=len(contexts):raise ValueError('Exact scalar prediction membership required')
    settings = model['settings']
    def logit(p):
        return math.log(p) - math.log1p(-p)
    knots = [logit(p) for p in settings['knots']]
    reference = logit(settings['reference_probability'])
    result = []
    for p, context in zip(probabilities, contexts):
        x = logit(min(1-settings['epsilon'], max(settings['epsilon'], float(p))))
        state = context['prior_sog_same_team']
        slopes = model['context_slopes'][model['states'].index(state)] if state in model['states'] else model['shared_slopes']
        z = model['intercept']
        for index, (left, right) in enumerate(zip(knots, knots[1:])):
            basis = min(right-left, max(0., x-left)) - min(right-left, max(0., reference-left))
            z += basis * slopes[index]
        offset = 0
        for field in calibration_candidate.CONTEXT_FIELDS:
            vocabulary = model['vocabulary'][field]
            if context[field] in vocabulary:
                z += model['offsets'][offset + vocabulary.index(context[field])]
            offset += len(vocabulary)
        p = 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))
        result.append(min(1-settings['epsilon'], max(settings['epsilon'], p)))
    return np.asarray(result)


def primary_passed(losses):
    return all(losses['conditional_shape'][metric] <= losses[control][metric]
               for control in ('frozen_monotone_group', 'frozen_movement_monotone_group')
               for metric in ('brier', 'log_loss_clipped'))


def run(output):
    output=Path(output).absolute()
    if (output.parent!=ROOT/'scripts/proof/results' or not output.name.startswith('official-conditional-shape-')
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
        if (plan['contract']!=VERSION+':plan' or plan['primary']!='conditional_shape'
                or plan['publishable'] is not False or plan['automatic_acceptance'] is not False
                or datetime.fromisoformat(plan['declared_at'])>datetime.fromisoformat(now)):
            raise ValueError('Exact earlier nonpromoting plan required')
        for name in CODE: read(name,parse=False)
        review=read(REVIEW,REVIEW_SHA)
        for name,sha in review['bound_file_sha256'].items(): read(name,sha,False)
        movement_health = read(f'{MOVEMENT}/health.json', MOVEMENT_HEALTH_SHA)
        for name, sha in movement_health['files'].items(): read(f'{MOVEMENT}/{name}', sha, False)
        movement_declaration = read(f'{MOVEMENT}/declaration.json')
        for name, sha in movement_declaration['code_and_reference_sha256'].items(): read(name, sha, False)
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
            vectors=project(payload['plays'],**kwargs)
            selected_index=next(j for j,e in enumerate(payload['plays']) if e['eventId'] in eids)
            selected=payload['plays'][selected_index];eid=selected['eventId']
            prefix=payload['plays'][:selected_index+1]
            if project(prefix,**kwargs)[eid]!=vectors[eid]: raise ValueError('Future input leakage')
            changed=[*prefix[:-1],{**selected,'typeCode':506 if selected['typeCode']==505 else 505}]
            if project(changed,**kwargs)[eid]!=vectors[eid]: raise ValueError('Current outcome leakage')
            samples+=1
            counts=availability.setdefault(str(gid//1000000),{n:{'available':0,'missing':0} for n in NAMES})
            for eid in eids:
                extra[gid,eid]=vectors[eid]
                for name,value in zip(NAMES,vectors[eid]): counts[name]['missing' if value is None else 'available']+=1
            if (i+1)%1000==0: print(json.dumps({'event':'movement.project','games':i+1}),flush=True)
        save('feature-audit.json',{'names':NAMES,'availability':availability,'sampled_games_prefix_and_outcome_invariant':samples,
             'vectors':[{'game_id':g,'event_id':e,'values':v} for (g,e),v in sorted(extra.items())],
             'publishable':False})
        saved_features=read(f'{MOVEMENT}/feature-audit.json')
        seen_features=set()
        for item in saved_features['vectors']:
            key=item['game_id'],item['event_id']
            if key in seen_features or extra.get(key)!=item['values']:
                raise ValueError('Frozen movement feature values changed')
            seen_features.add(key)
        if seen_features!=set(extra):raise ValueError('Frozen movement feature population changed')
        del saved_features,seen_features
        schema=deepcopy(replay.plan['schema']);schema['version']='citrus-matched-pre-shot-movement-v1';schema['names']+=list(NAMES)
        config=deepcopy(replay.plan['config']);config['views']['enhanced_numeric_names']+=list(NAMES)
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
            print(json.dumps({'event':'conditional.fit','fold':fold}),flush=True)
            rows={s:p['rows'] for s,p in parts.items()}
            portable = read(f'{MOVEMENT}/{fold}/model.json')
            if portable['design']['schema'] != schema:
                raise ValueError('Exact frozen movement schema required')
            vocab,bound=development._vocabulary_and_design_bound(rows,schema,config)
            labels={s:np.asarray([int(r['label']) for r in rr]) for s,rr in rows.items()}
            with threadpool_limits(limits=1):
                pp={s:portable_context_model.predict_rows(portable,rows[s]) for s in ('calibration','validation')}
                contexts={s:[calibration_candidate.context_from_row(r,schema) for r in rows[s]] for s in pp}
                shape=conditional.fit(pp['calibration'],labels['calibration'],contexts['calibration'])
                shape=strict_json(json.dumps(shape,allow_nan=False).encode('utf-8'))
                conditional.validate(shape)
                candidate={s:conditional.predict(shape,pp[s],contexts[s]) for s in pp}
                errors={s:float(np.max(np.abs(scalar_predictions(shape,pp[s],contexts[s])-candidate[s]))) for s in pp}
                if any(e>1e-12 for e in errors.values()):raise ValueError('Independent conditional JSON inference mismatch')
                baseline_model=read(f'{CAL}/{fold}/model.json')
                baseline_map=read(f'{SHAPE}/{fold}/calibrators.json')['monotone_logit_group']
                base_raw=portable_context_model.predict_rows(baseline_model,folds[fold]['validation']['rows'])
                base=calibration_shape.predict(baseline_map,base_raw,contexts['validation'])
                movement_map=read(f'{MOVEMENT}/{fold}/calibrators.json')['monotone_logit_group']
                movement_base=calibration_shape.predict(movement_map,pp['validation'],contexts['validation'])
            movement_prior={(r['game_id'],r['event_id']):r for r in read(f'{MOVEMENT}/{fold}/predictions.json')}
            if set(movement_prior)!={(r['game_id'],r['event_id']) for r in rows['validation']}:
                raise ValueError('Movement baseline population mismatch')
            for i,r in enumerate(rows['validation']):
                saved=movement_prior[r['game_id'],r['event_id']]
                if (saved['target']!=int(r['label']) or saved['predictions']['movement_raw']!=float(pp['validation'][i])
                        or saved['predictions']['movement_monotone_group']!=float(movement_base[i])):
                    raise ValueError('Movement baseline values changed')
            baseline_audit=verify_vectors(folds[fold]['validation']['rows'],base_raw,
                read(f'{CAL}/{fold}/predictions.json'),'validation')
            old=read(f'{SHAPE}/{fold}/predictions.json');prior={(r['game_id'],r['event_id']):r for r in old}
            gm={(g['game_id'],g['event_id']):g['groups'] for g in groups[fold]['rows']}
            if set(prior)!={(r['game_id'],r['event_id']) for r in rows['validation']}:raise ValueError('Baseline membership changed')
            predictions={'frozen_monotone_group':base,'movement_raw':pp['validation'],
                'frozen_movement_monotone_group':movement_base,'conditional_shape':candidate['validation']}
            evaluated=[]
            for i,r in enumerate(rows['validation']):
                key=r['game_id'],r['event_id'];before=prior[key]
                if (before['target']!=int(r['label']) or before['groups']!=gm[key] or movement_prior[key]['groups']!=gm[key]
                        or float(base[i])!=before['predictions']['monotone_logit_group']):raise ValueError('Frozen baseline values changed')
                evaluated.append({'game_id':key[0],'event_id':key[1],'target':int(r['label']),
                    'groups':gm[key],'predictions':{n:float(v[i]) for n,v in predictions.items()}})
            evaluated.sort(key=lambda r:(r['game_id'],r['event_id']))
            save(f'{fold}/model.json',portable);save(f'{fold}/calibrators.json',{'frozen_movement_monotone_group':movement_map,'conditional_shape':shape})
            save(f'{fold}/fit-receipt.json',{'schema':schema,'config':config,'bound':bound,'independent_prediction_errors':errors,
                'raw_model_refitted':False,'calibrator_training_split':'calibration_only',
                'cohorts':{s:{k:v for k,v in p.items() if k!='rows'} for s,p in parts.items()},
                'baseline_raw_audit':baseline_audit,'publishable':False})
            save(f'{fold}/predictions.json',evaluated)
            lineage={'prediction_rows_sha256':fingerprint(evaluated),'source_manifest_sha256':REVIEW_SHA,
                'split_sha256':fingerprint({s:{k:v for k,v in p.items() if k!='rows'} for s,p in parts.items()}),
                'pipelines':{n:fingerprint({'model_sha256':fingerprint(baseline_model if n=='frozen_monotone_group' else portable),
                    'map_sha256':fingerprint({'frozen_monotone_group':baseline_map,'movement_raw':None,
                        'frozen_movement_monotone_group':movement_map,'conditional_shape':shape}[n]),
                    'predictor':n,'declaration':files['declaration.json']}) for n in predictions}}
            with threadpool_limits(limits=1): card=probability_scorecard(evaluated,config=config['scorecard'],evidence_kind='real',lineage=lineage)
            save(f'{fold}/scorecard.json',card)
            losses={n:{m:card['overall']['models'][n]['metrics'][m]['value'] for m in ('brier','log_loss_clipped')} for n in predictions}
            summaries[fold]={'losses':losses,'primary_guard_passed':primary_passed(losses),'events':len(evaluated)}
            save(f'{fold}/summary.json',summaries[fold]);completed.append(fold)
            print(json.dumps({'event':'conditional.complete','fold':fold,**summaries[fold]}),flush=True)
        replay.verify()
        save('source-replay.json',{'checked':replay.checked,'publishable':False})
        for name,sha in checked.items():
            if file_sha(safe(ROOT,name))!=sha:raise ValueError('End input drift')
        save('consumed-file-sha256.json',checked)
        save('result.json',{'folds':summaries,'primary_guard_passed':all(s['primary_guard_passed'] for s in summaries.values()),
            'limitations':plan['limitations'],'publishable':False,'model_accepted':False,'production_changed':False})
        for name,sha in files.items():
            if file_sha(output/name)!=sha:raise ValueError('Output drift')
        persist(output,'health.json',{'status':'complete-conditional-shape-development-not-accepted','files':files,'publishable':False})
    except BaseException as error:
        persist(output,'failure.json',{'error_type':type(error).__name__,'error':str(error),'completed_folds':completed,'files':files,'publishable':False})
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True)
    run(parser.parse_args().output)
