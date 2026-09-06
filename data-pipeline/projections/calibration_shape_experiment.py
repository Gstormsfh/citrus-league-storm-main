"""Create-only calibration-shape comparison on exactly replayed development data.

Pinned JSON raw models are reused, never refitted or deserialized as objects.
This is adaptive development, not untouched or prospective confirmation.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import signal
import subprocess

import numpy as np
from threadpoolctl import threadpool_limits
from projections import calibration_shape as shape,calibration_candidate as prior,portable_context_model as portable
from projections import probability_scorecard
from projections.analytics_publication import fingerprint
from projections.chronological_experiment import _persist
from projections.development_replay import Replay,_safe,_canonical
from projections.verified_export_experiment import strict_json,file_sha
from projections.calibration_experiment import parity

VERSION='citrus-source-replayed-calibration-shape-v1'
PLAN_VERSION='citrus-calibration-shape-experiment-plan-v1'
REFERENCES=['reference_sigmoid','reference_beta_group']
NAMES=REFERENCES+shape.KINDS
SELECTION={'baseline':'reference_beta_group','guard':'no_worse_brier_and_log_loss_in_each_fold',
    'ranking':['equal_fold_mean_log_loss','equal_fold_mean_brier','reference_then_declared_candidate_order'],'automatic_acceptance':False}
REPO=Path(__file__).resolve().parents[2]
CAL_ROOT=REPO/'scripts/proof/results/official-calibration-experiment-20260906'
TS_ROOT=REPO/'scripts/proof/results/official-calibration-typescript-parity-20260906'
CAL_HEALTH='9e16e047848ade1d02611312be285f14fec48d5de9dadae7afd2dab36d895642'
TS_HEALTH='87ca44d99785b58ebac45aef36ef1bf427fa57def3b2aa210e6b45a31a00144c'
PRIOR_PLAN='f2ea437a51bd316f9b45ff8ba69dbc77fa7cc7bdb5845528d05a27fb267bc3a2'
BRIDGE=REPO/'scripts/proof/score_calibration_shape.mjs'
TYPESCRIPT=REPO/'packages/shared/src/utils/calibrationShape.ts'


def validate_plan(plan,now):
    if (set(plan)!={'contract','declared_at','publishable','historical_as_of_verified','untouched_test_claim','evidence_claim',
            'prior_development_plan_sha256','prior_calibration_health_sha256','prior_typescript_health_sha256','source_policy','raw_model_policy',
            'references','candidates','fit_policy','settings','selection','evaluation','parity','limitations','research'}
            or plan['contract']!=PLAN_VERSION or any(plan[k] is not False for k in ('publishable','historical_as_of_verified','untouched_test_claim'))
            or plan['evidence_claim']!='adaptive_already_inspected_retrospective_development'
            or plan['prior_development_plan_sha256']!=PRIOR_PLAN or plan['prior_calibration_health_sha256']!=CAL_HEALTH
            or plan['prior_typescript_health_sha256']!=TS_HEALTH or plan['references']!=REFERENCES or plan['candidates']!=shape.KINDS
            or fingerprint(plan['settings'])!=fingerprint(shape.SETTINGS) or plan['selection']!=SELECTION
            or plan['source_policy']!='full_unchanged_prior_development_source_replay_before_2024-07-01'
            or plan['raw_model_policy']!='reuse_pinned_json_model_and_verify_all_calibration_validation_vectors_no_refit_no_deserialization'
            or plan['fit_policy']!='calibration_rows_and_labels_only_no_validation_tuning'
            or plan['evaluation']!='unchanged_eight_dimensions_bins_and_256_whole_game_resamples_all_six_predictors'
            or plan['parity']!={'absolute_tolerance':1e-12,'scope':'all_validation_new_maps_python_vs_typescript_on_exact_pinned_source_raw_probabilities'}):
        raise ValueError('Exact fixed shape experiment plan required')
    declared=datetime.fromisoformat(plan['declared_at'].replace('Z','+00:00'))
    if declared.tzinfo is None or declared>datetime.fromisoformat(now.replace('Z','+00:00')):raise ValueError('Plan must precede fit')


def select(reports):
    if set(reports)!={'fold1','fold2'}:raise ValueError('Exact two-fold scores required')
    candidates=[]
    for name in NAMES:
        failures=[];losses={}
        for fold,report in reports.items():
            models=report['overall']['models']
            if set(models)!=set(NAMES):raise ValueError('All declared models required')
            losses[fold]={k:models[name]['metrics'][k]['value'] for k in ('brier','log_loss_clipped')}
            for key,value in losses[fold].items():
                baseline=models[SELECTION['baseline']]['metrics'][key]['value']
                if any(not prior._finite(v) or v<0 for v in (value,baseline)):raise ValueError('Finite measured losses required')
                if value>baseline:failures.append(fold+':'+key)
        candidates.append({'candidate':name,'eligible':not failures,'guard_failures':failures,'fold_losses':losses,
            'mean_fold_brier':sum(v['brier'] for v in losses.values())/2,
            'mean_fold_log_loss':sum(v['log_loss_clipped'] for v in losses.values())/2})
    ranked=sorted((c for c in candidates if c['eligible']),key=lambda c:(c['mean_fold_log_loss'],c['mean_fold_brier'],NAMES.index(c['candidate'])))
    return {'selected_for_further_development':ranked[0]['candidate'] if ranked else None,
        'candidates':candidates,'policy':SELECTION,'publishable':False}


def fit_and_compare(cp,cy,cc,vp,vc,identity,folder):
    """Only calibration labels cross the fitting boundary; validation labels absent."""
    models={k:shape.fit(k,cp,cy,cc) for k in shape.KINDS}
    files={'calibrators.json':_persist(folder,'calibrators.json',models)}
    loaded=strict_json((folder/'calibrators.json').read_bytes())
    with threadpool_limits(limits=1):predictions={k:shape.predict(loaded[k],vp,vc) for k in shape.KINDS}
    if len(identity)!=len(vp) or len(vc)!=len(vp):raise ValueError('Exact validation identities/context required')
    requests=[{'game_id':r['game_id'],'event_id':r['event_id'],'raw_probability':float(vp[i]),'context':vc[i]} for i,r in enumerate(identity)]
    request_bytes=b''.join((json.dumps(r,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode() for r in requests)
    files['typescript-input.jsonl']=_persist(folder,'typescript-input.jsonl',request_bytes)
    process=subprocess.run(['node',str(BRIDGE),str((folder/'calibrators.json').resolve())],input=request_bytes,capture_output=True,timeout=300)
    files['typescript-output.jsonl']=_persist(folder,'typescript-output.jsonl',process.stdout)
    files['typescript-stderr.txt']=_persist(folder,'typescript-stderr.txt',process.stderr)
    if process.returncode!=0:raise ValueError('Independent TypeScript inference failed')
    outputs=[strict_json(line) for line in process.stdout.splitlines()]
    if len(outputs)!=len(requests):raise ValueError('Incomplete independent predictions')
    for request,row in zip(requests,outputs):
        if (set(row)!={'game_id','event_id','predictions'} or row['game_id']!=request['game_id'] or row['event_id']!=request['event_id']
                or set(row['predictions'])!=set(shape.KINDS)):
            raise ValueError('Detached TypeScript probability row')
    receipts={k:parity([r['predictions'][k] for r in outputs],predictions[k],k) for k in shape.KINDS}
    files['typescript-parity.json']=_persist(folder,'typescript-parity.json',{'models':receipts,'publishable':False,
        'scope':'all_new_validation_calibration_maps_on_source_bound_raw_inputs'})
    return files,predictions,models


def run(freeze_dir,export_dir,prior_plan,plan_path,output):
    output=_canonical(output);output.mkdir(exist_ok=False);files={};completed=[]
    try:
        now=datetime.now(timezone.utc).isoformat()
        files['attempt-started.json']=_persist(output,'attempt-started.json',{'contract':VERSION,'started_at':now,'publishable':False})
        replay=Replay(freeze_dir,export_dir,prior_plan,now=now)
        if replay.checked[str(replay.plan_path)]!=PRIOR_PLAN:raise ValueError('Pinned prior development plan required')
        plan=strict_json(replay.read(plan_path));validate_plan(plan,now);plan_sha=replay.checked[str(_safe(plan_path))]
        def pinned(path,expected):
            body=replay.read(path)
            if hashlib.sha256(body).hexdigest()!=expected:raise ValueError('Pinned calibration evidence drift')
            return strict_json(body)
        old_health=pinned(CAL_ROOT/'health.json',CAL_HEALTH);ts_health=pinned(TS_ROOT/'health.json',TS_HEALTH)
        if old_health['status']!='completed-calibration-development-not-accepted' or old_health['publishable'] is not False:
            raise ValueError('Prior complete nonpublishing calibration required')
        if ts_health['status']!='complete-full-cohort-typescript-parity-not-accepted' or ts_health['publishable'] is not False:
            raise ValueError('Prior completed TypeScript parity required')
        for root,health in ((CAL_ROOT,old_health),(TS_ROOT,ts_health)):
            if (root/'failure.json').exists():raise ValueError('Prior failure evidence present')
            for name,digest in health['files'].items():pinned(root/name,digest)
        ts_result=pinned(TS_ROOT/'result.json',ts_health['files']['result.json'])
        for path,digest in ts_result['consumed_file_sha256'].items():
            if file_sha(_safe(path))!=digest:raise ValueError('Preserved source/code/prior artifact changed')
            if path in replay.checked and replay.checked[path]!=digest:raise ValueError('Conflicting source evidence')
            replay.checked[path]=digest
        for module in (shape,prior,portable,probability_scorecard):replay.read(module.__file__)
        for path in (__file__,BRIDGE,TYPESCRIPT):replay.read(path)
        folds,groups=replay.replay()
        files['declaration.json']=_persist(output,'declaration.json',{'contract':VERSION,'plan':plan,'plan_sha256':plan_sha,
            'consumed_file_sha256':replay.checked,'folds_sha256':fingerprint(folds),'groups_sha256':fingerprint(groups),'publishable':False})
        reports={}
        for fold,parts in folds.items():
            print(json.dumps({'event':'shape.prepare','fold':fold,'publishable':False}),flush=True)
            folder=output/fold;folder.mkdir();files[fold+'/attempt-started.json']=_persist(folder,'attempt-started.json',{'fold':fold,'publishable':False})
            def old(name):return pinned(CAL_ROOT/fold/name,old_health['files'][fold+'/'+name])
            model=old('model.json');receipt=old('fit-receipt.json')
            cohorts={s:{k:v for k,v in c.items() if k!='rows'} for s,c in parts.items()}
            if receipt['cohorts']!=cohorts or model['design']['schema']!=replay.plan['schema']:raise ValueError('Exact prior fit/source lineage required')
            rows={s:parts[s]['rows'] for s in ('calibration','validation')}
            with threadpool_limits(limits=1):raw={s:portable.predict_rows(model,rr) for s,rr in rows.items()}
            contexts={s:[prior.context_from_row(r,replay.plan['schema']) for r in rr] for s,rr in rows.items()}
            before_cal=old('calibration-predictions.json');before_val=old('predictions.json')
            prior_rows={'calibration':before_cal,'validation':before_val};maps={}
            raw_parity={}
            group_map={(r['game_id'],r['event_id']):r['groups'] for r in groups[fold]['rows']}
            for split,rr in rows.items():
                previous={(r['game_id'],r['event_id']):r for r in prior_rows[split]};maps[split]=previous
                if len(previous)!=len(rr) or len(previous)!=len(prior_rows[split]):raise ValueError('Exact reference membership required')
                values=[]
                for i,r in enumerate(rr):
                    old_row=previous[r['game_id'],r['event_id']]
                    if old_row['target']!=int(r['label']):raise ValueError('Reference target differs')
                    if split=='calibration':
                        if old_row['context']!=contexts[split][i]:raise ValueError('Reference calibration context differs')
                    elif old_row['groups']!=group_map[r['game_id'],r['event_id']]:raise ValueError('Reference subgroup differs')
                    values.append(old_row['raw_probability'] if split=='calibration' else old_row['predictions']['raw'])
                raw_parity[split]=parity(raw[split],values,'pinned_raw_'+split)
            print(json.dumps({'event':'shape.fit','fold':fold,'publishable':False}),flush=True)
            produced,predictions,models=fit_and_compare(raw['calibration'],[r['label'] for r in rows['calibration']],contexts['calibration'],
                raw['validation'],contexts['validation'],rows['validation'],folder)
            files.update({fold+'/'+n:d for n,d in produced.items()})
            for name,old_kind in zip(REFERENCES,['logit_sigmoid','beta_group']):
                previous=old('calibrator-'+old_kind+'.json')
                with threadpool_limits(limits=1):predictions[name]=prior.predict_calibrator(previous,raw['validation'],contexts['validation'])
                parity(predictions[name],[maps['validation'][r['game_id'],r['event_id']]['predictions'][old_kind] for r in rows['validation']],name)
            fitted_receipt={'contract':VERSION,'cohorts':cohorts,'model_sha256':old_health['files'][fold+'/model.json'],
                'calibration_membership_sha256':parts['calibration']['membership_sha256'],'calibrators_sha256':produced['calibrators.json'],
                'raw_parity':raw_parity,'group_vocabulary':models['monotone_logit_group']['vocabulary'],
                'context_counts':{s:{f:{'missing':sum(r[f] is None for r in cc),
                    'unseen':sum(r[f] not in models['monotone_logit_group']['vocabulary'][f] for r in cc),'rows':len(cc)} for f in prior.CONTEXT_FIELDS} for s,cc in contexts.items()},
                'publishable':False}
            files[fold+'/fit-receipt.json']=_persist(folder,'fit-receipt.json',fitted_receipt)
            evaluated=[{'game_id':r['game_id'],'event_id':r['event_id'],'target':int(r['label']),
                'groups':group_map[r['game_id'],r['event_id']],'predictions':{k:float(predictions[k][i]) for k in NAMES}} for i,r in enumerate(rows['validation'])]
            evaluated.sort(key=lambda r:(r['game_id'],r['event_id']))
            files[fold+'/predictions.json']=_persist(folder,'predictions.json',evaluated)
            lineage={'prediction_rows_sha256':fingerprint(evaluated),'source_manifest_sha256':replay.checked[str(replay.manifest_path)],
                'split_sha256':fingerprint(cohorts),'pipelines':{k:fingerprint({'fit_receipt':files[fold+'/fit-receipt.json'],'predictor':k}) for k in NAMES}}
            print(json.dumps({'event':'shape.scorecard','fold':fold,'publishable':False}),flush=True)
            with threadpool_limits(limits=1):reports[fold]=probability_scorecard.probability_scorecard(evaluated,config=replay.plan['config']['scorecard'],evidence_kind='real',lineage=lineage)
            files[fold+'/scorecard.json']=_persist(folder,'scorecard.json',reports[fold]);completed.append(fold)
        result={'contract':VERSION,'status':'complete-calibration-shape-development-not-accepted','selection':select(reports),
            'plan_sha256':plan_sha,'publishable':False,'historical_as_of_verified':False,'untouched_test_claim':False}
        files['result.json']=_persist(output,'result.json',result);replay.verify()
        for name,digest in files.items():
            if file_sha(_safe(output/name))!=digest:raise ValueError('Shape experiment artifact drift')
        if {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}!=set(files):raise ValueError('Unindexed shape artifact')
        health={'status':result['status'],'files':files,'completed_folds':completed,'source_code_and_prior_reverified':True,'publishable':False}
        _persist(output,'health.json',health);return health
    except BaseException as error:
        failure={'status':'failed-calibration-shape','error_type':type(error).__name__,'completed_folds':completed,'indexed_files':files,'partial_files_preserved':True,'publishable':False}
        try:_persist(output,'failure.json',failure)
        except OSError:pass
        print(json.dumps({'event':'shape.failed',**failure}),flush=True);raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('freeze-dir','export-dir','prior-plan','plan','output'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    def stop(signum,frame):raise KeyboardInterrupt('Shape experiment interrupted')
    previous={s:signal.signal(s,stop) for s in (signal.SIGINT,signal.SIGTERM)}
    try:print(json.dumps(run(args.freeze_dir,args.export_dir,args.prior_plan,args.plan,args.output)),flush=True)
    finally:
        for s,handler in previous.items():signal.signal(s,handler)


if __name__=='__main__':main()
