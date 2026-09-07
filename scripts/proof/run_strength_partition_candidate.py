"""Fresh full-source replay and fixed neutral specialist comparison. No loads."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import pickle
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
import numpy as np
from threadpoolctl import threadpool_limits
from projections import strength_partition_candidate as candidate
from projections import calibration_shape, calibration_candidate, portable_context_model
from projections.analytics_publication import fingerprint
from projections.development_replay import Replay
from projections.chronological_experiment import _persist
from projections.probability_scorecard import probability_scorecard
from projections.verified_export_experiment import strict_json,file_sha

PLAN='docs/analytics-strength-partition-plan-20260906.json'
REVIEW='scripts/proof/results/official-calibration-shape-review-20260906/review.json'
REVIEW_SHA='eef47805687e40df9b92c02947672c71a5ec4d4701b3d9b776c77de316b88c3c'
SHAPE='scripts/proof/results/official-calibration-shape-experiment-20260906'
CAL='scripts/proof/results/official-calibration-experiment-20260906'


def verify_vectors(rows, predicted, old, split):
    indexed={(r['game_id'],r['event_id']):r for r in old}
    if len(indexed)!=len(old) or set(indexed)!={(r['game_id'],r['event_id']) for r in rows}:
        raise ValueError('Exact frozen reference membership required')
    error=0.
    for row,p in zip(rows,predicted):
        before=indexed[row['game_id'],row['event_id']]
        value=before['raw_probability'] if split=='calibration' else before['predictions']['raw']
        if before['target']!=int(row['label']):raise ValueError('Reference label mismatch')
        error=max(error,abs(float(p)-value))
    if len(rows)!=len(predicted) or not np.isfinite(predicted).all() or error>1e-12:
        raise ValueError('Fresh pooled reference differs from frozen raw vector')
    return {'events':len(rows),'max_raw_absolute_drift':error,'tolerance':1e-12}


def run(output):
    output=Path(output).absolute()
    if (output.parent!=ROOT/'scripts/proof/results' or not output.name.startswith('official-strength-partition-')
            or any(p.is_symlink() for p in (output,*output.parents))):raise ValueError('Scoped nonsymlink output required')
    output.mkdir(exist_ok=False);checked={};files={};completed=[]
    def read(name,sha=None,parse=True):
        path=ROOT/name
        if any(p.is_symlink() for p in (path,*path.parents)):raise ValueError('Nonsymlink evidence required')
        raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest()
        if (sha is not None and sha!=digest) or (name in checked and checked[name]!=digest):raise ValueError('Evidence drift')
        checked[name]=digest
        return strict_json(raw) if parse else raw
    def save(name,obj):
        path=output/name;path.parent.mkdir(parents=True,exist_ok=True)
        files[name]=_persist(path.parent,path.name,obj)
    try:
        now=datetime.now(timezone.utc).isoformat()
        save('attempt-started.json',{'started_at':now,'publishable':False})
        plan=read(PLAN)
        if (plan['contract']!=candidate.VERSION+':plan' or plan['settings']!=candidate.SETTINGS
                or plan['publishable'] is not False or plan['automatic_acceptance'] is not False
                or datetime.fromisoformat(plan['declared_at'])>datetime.fromisoformat(now)):
            raise ValueError('Exact predeclared plan required')
        for name in plan['code_files']:read(name,parse=False)
        review=read(REVIEW,REVIEW_SHA)
        for name,sha in review['bound_file_sha256'].items():read(name,sha,False)
        save('declaration.json',{'plan':plan,'code_and_reference_sha256':dict(checked),'publishable':False})
        replay=Replay(ROOT/plan['freeze_dir'],ROOT/plan['export_dir'],ROOT/plan['source_plan'])
        folds,groups=replay.replay()
        save('source-replay.json',{'checked':replay.checked,'folds_sha256':fingerprint(folds),
             'groups_sha256':fingerprint(groups),'publishable':False})
        summaries={}
        for fold,parts in folds.items():
            print(json.dumps({'event':'strength.fit','fold':fold}),flush=True)
            fitted=candidate.fit_candidate(parts['train'],parts['calibration'],replay.plan['schema'],replay.plan['config'])
            save(f'{fold}/fit-receipt.json',fitted.receipt)
            save(f'{fold}/fresh-artifact.pickle',pickle.dumps(fitted,protocol=5))
            design={'schema':fitted.schema,'numeric_names':fitted.config['views']['enhanced_numeric_names'],
                    'categorical_names':fitted.config['views']['enhanced_categorical_names'],
                    'medians':{n:float(fitted.medians[fitted.schema['names'].index(n)]) for n in fitted.config['views']['enhanced_numeric_names']},
                    'vocabulary':fitted.vocabulary}
            portable={n:portable_context_model.export_model(m,design) for n,m in fitted.models.items()}
            save(f'{fold}/fresh-models.json',portable)
            shape=read(f'{SHAPE}/{fold}/calibrators.json')['monotone_logit_group']
            audit={};predictions={}
            for split in ('calibration','validation'):
                rows=parts[split]['rows'];pred=fitted.predict(rows)
                old=read(f'{CAL}/{fold}/'+('calibration-predictions.json' if split=='calibration' else 'predictions.json'))
                audit[split]=verify_vectors(rows,pred['pooled_raw'],old,split)
                # Reordered inference must recover every identical event probability.
                reverse=fitted.predict(list(reversed(rows)))
                if any(not np.array_equal(v,reverse[n][::-1]) for n,v in pred.items()):raise ValueError('Inference order changes predictions')
                independent=portable_context_model.predict_rows(portable['pooled'],rows)
                if np.max(np.abs(independent-pred['pooled_raw']))>1e-12:raise ValueError('Independent pooled tree inference differs')
                specialist=independent.copy();mapped=candidate.apply_map(independent,fitted.maps['pooled'])
                for name,model in portable.items():
                    if name=='pooled':continue
                    mask=np.asarray([candidate.state(r,fitted.schema)==name for r in rows])
                    if mask.any():
                        values=portable_context_model.predict_rows(model,[r for r,m in zip(rows,mask) if m])
                        specialist[mask]=values;mapped[mask]=candidate.apply_map(values,fitted.maps[name])
                audit[split]['independent_tree_max_absolute_drift']=float(np.max(np.abs(specialist-pred['partition_raw'])))
                if (audit[split]['independent_tree_max_absolute_drift']>1e-12
                        or np.max(np.abs(mapped-pred['partition_sigmoid']))>1e-12):raise ValueError('Independent specialist inference differs')
                contexts=[calibration_candidate.context_from_row(r,replay.plan['schema']) for r in rows]
                pred['frozen_monotone_logit_group']=calibration_shape.predict(shape,pred['pooled_raw'],contexts)
                predictions[split]=pred
            rows=parts['validation']['rows'];pred=predictions['validation']
            old=read(f'{SHAPE}/{fold}/predictions.json');oldmap={(r['game_id'],r['event_id']):r for r in old}
            if set(oldmap)!={(r['game_id'],r['event_id']) for r in rows}:raise ValueError('Shape cohort differs')
            shape_error=max(abs(pred['frozen_monotone_logit_group'][i]-oldmap[r['game_id'],r['event_id']]['predictions']['monotone_logit_group']) for i,r in enumerate(rows))
            if shape_error>1e-12:raise ValueError('Frozen map vector differs')
            audit['shape_max_absolute_drift']=float(shape_error)
            gm={(g['game_id'],g['event_id']):g['groups'] for g in groups[fold]['rows']}
            evaluated=sorted([{'game_id':r['game_id'],'event_id':r['event_id'],'target':int(r['label']),
                 'groups':gm[r['game_id'],r['event_id']], 'predictions':{n:float(v[i]) for n,v in pred.items()}} for i,r in enumerate(rows)],key=lambda r:(r['game_id'],r['event_id']))
            save(f'{fold}/predictions.json',evaluated);save(f'{fold}/independent-audit.json',audit)
            lineage={'prediction_rows_sha256':fingerprint(evaluated),'source_manifest_sha256':replay.checked[str(replay.manifest_path)],
                     'split_sha256':fingerprint({s:{k:v for k,v in c.items() if k!='rows'} for s,c in parts.items()}),
                     'pipelines':{n:fingerprint({'fit':fitted.receipt,'predictor':n,'shape':shape if n=='frozen_monotone_logit_group' else None}) for n in pred}}
            with threadpool_limits(limits=1):card=probability_scorecard(evaluated,config=replay.plan['config']['scorecard'],evidence_kind='real',lineage=lineage)
            save(f'{fold}/scorecard.json',card)
            losses={n:{m:card['overall']['models'][n]['metrics'][m]['value'] for m in ('brier','log_loss_clipped')} for n in pred}
            summaries[fold]={'losses':losses,'decisions':fitted.receipt['decisions'],'events':len(rows),
                  'comparison':'partition_sigmoid against both pooled_sigmoid and frozen_monotone_logit_group','publishable':False}
            save(f'{fold}/summary.json',summaries[fold]);completed.append(fold)
            print(json.dumps({'event':'strength.complete','fold':fold,'losses':losses}),flush=True)
        replay.verify()
        for name,sha in checked.items():
            if file_sha(ROOT/name)!=sha:raise ValueError('End evidence/code drift')
        for name,sha in files.items():
            if file_sha(output/name)!=sha:raise ValueError('Output drift')
        save('result.json',{'folds':summaries,'publishable':False,'status':'measured-not-accepted'})
        _persist(output,'health.json',{'files':files,'completed_folds':completed,'publishable':False,
                 'status':'complete-strength-development-not-accepted'})
        return summaries
    except BaseException as error:
        try:_persist(output,'failure.json',{'error_type':type(error).__name__,'message':str(error),
                       'completed_folds':completed,'publishable':False})
        except BaseException:pass
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True)
    args=parser.parse_args();run(args.output)
