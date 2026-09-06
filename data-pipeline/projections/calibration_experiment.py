"""Additive calibration refinement with full frozen-source replay and JSON parity.

This consumes only already-inspected development windows. A completed run is
not an independent confirmation or authorization to serve any model.
"""
import argparse
from copy import deepcopy
from datetime import datetime,timezone
import json
from pathlib import Path
import platform
import signal

import numpy as np
import scipy
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits

from projections import calibration_candidate as calibrators
from projections import portable_context_model as portable
from projections import development_experiment as development
from projections import probability_scorecard
from projections.analytics_publication import fingerprint
from projections.chronological_experiment import _persist
from projections.development_replay import Replay, _canonical, _safe
from projections.verified_export_experiment import file_sha, strict_json

VERSION='citrus-source-replayed-calibration-experiment-v1'
PLAN_VERSION='citrus-calibration-refinement-plan-v1'
TOLERANCE=1e-12
SELECTION={'guard':'no_worse_brier_and_log_loss_than_prior_selected_sigmoid_in_each_fold',
    'ranking':['equal_fold_mean_log_loss','equal_fold_mean_brier','declared_calibrator_order'],
    'automatic_acceptance_or_promotion':False,'later_observed_test_used':False,'prospective_reservations_changed':False}


def validate_plan(plan, prior_plan_sha, prior_result_sha, *, now):
    required={'contract','declared_at','publishable','historical_as_of_verified','untouched_test_claim','evidence_claim',
        'prior_plan_sha256','prior_result_sha256','source_scope','raw_family','raw_model_policy','calibrators',
        'calibration_policy','context_fields','settings','beta_group_scope','scorecard','parity','selection','limitations'}
    if (not isinstance(plan,dict) or set(plan)!=required or plan['contract']!=PLAN_VERSION
            or any(plan[k] is not False for k in ('publishable','historical_as_of_verified','untouched_test_claim'))
            or plan['evidence_claim']!='retrospective_current_source_revisions_already_inspected_development'
            or plan['prior_plan_sha256']!=prior_plan_sha or plan['prior_result_sha256']!=prior_result_sha
            or plan['source_scope']!='exact_prior_development_replay_before_2024-07-01'
            or plan['raw_family']!='enhanced_context'
            or plan['calibrators']!=calibrators.KINDS or plan['context_fields']!=calibrators.CONTEXT_FIELDS
            or fingerprint(plan['settings'])!=fingerprint(calibrators.SETTINGS)
            or plan['selection']!=SELECTION
            or plan['calibration_policy']!='fit_only_disjoint_calibration_partition_never_validation_labels'
            or plan['scorecard']!='unchanged_prior_config_all_eight_group_dimensions_all_five_candidates'
            or plan['parity']!={'absolute_tolerance':TOLERANCE,'reference':'fresh_sklearn_1.5.2_binary_numeric_hgb',
                'scope':'all_calibration_and_validation_rows_independent_python_json_design_and_inference',
                'prior_validation_vectors':['enhanced_context_raw','enhanced_context_sigmoid','enhanced_context_isotonic'],
                'pickle_or_joblib_deserialization':False}):
        raise ValueError('Exact nonpublishing calibration plan required')
    declared=datetime.fromisoformat(plan['declared_at'].replace('Z','+00:00'))
    observed=datetime.fromisoformat(now.replace('Z','+00:00'))
    if declared.tzinfo is None or observed.tzinfo is None or declared>observed:
        raise ValueError('Calibration plan must precede execution')


def parity(actual,expected, label):
    actual,expected=np.asarray(actual),np.asarray(expected)
    if (actual.shape!=expected.shape or actual.ndim!=1 or not len(actual)
            or not np.isfinite(actual).all() or not np.isfinite(expected).all()):
        raise ValueError('Exact finite parity vectors required: '+label)
    error=float(np.max(np.abs(actual-expected)))
    if error>TOLERANCE:raise ValueError('Portable/reference prediction mismatch: '+label)
    return {'rows':len(actual),'max_absolute_error':error,'tolerance':TOLERANCE,'passed':True}


def rank_candidates(reports):
    if set(reports)!=set(development.FOLD_WINDOWS):raise ValueError('Both scorecard folds required')
    candidates=[]
    for kind in calibrators.KINDS:
        losses={};failures=[]
        for fold,report in reports.items():
            m=report['overall']['models'];metrics=m[kind]['metrics'];baseline=m['logit_sigmoid']['metrics']
            losses[fold]={key:metrics[key]['value'] for key in ('brier','log_loss_clipped')}
            for key in losses[fold]:
                value=losses[fold][key];reference=baseline[key]['value']
                if type(value) not in (int,float) or not np.isfinite(value) or value<0:
                    raise ValueError('Finite measured losses required')
                if type(reference) not in (int,float) or not np.isfinite(reference) or reference<0:
                    raise ValueError('Finite reference losses required')
                if value>reference:failures.append(fold+':'+key)
        candidates.append({'candidate':kind,'eligible':not failures,'guard_failures':failures,'fold_losses':losses,
            'mean_fold_brier':sum(v['brier'] for v in losses.values())/2,
            'mean_fold_log_loss':sum(v['log_loss_clipped'] for v in losses.values())/2})
    ranked=sorted((c for c in candidates if c['eligible']),key=lambda c:(c['mean_fold_log_loss'],c['mean_fold_brier'],calibrators.KINDS.index(c['candidate'])))
    return {'selected_for_further_development':ranked[0]['candidate'] if ranked else None,
        'all_candidates':candidates,'policy':deepcopy(SELECTION),'publishable':False}


def fit_fold(parts,schema,config,prior_receipt,prior_predictions,groups,folder,source_sha,plan_sha,*,evidence_kind):
    if evidence_kind not in ('real','synthetic'):raise ValueError('Explicit evidence kind required')
    rows={s:c['rows'] for s,c in parts.items()}
    vocab,bound=development._vocabulary_and_design_bound(rows,schema,config)
    x=development._numeric(rows['train'],schema)
    if any(np.isnan(x[:,schema['names'].index(n)]).all() for n in config['views']['enhanced_numeric_names']):
        raise ValueError('All-missing fitted numeric feature')
    medians=np.asarray([float(np.nanmedian(x[:,i])) if not np.isnan(x[:,i]).all() else np.nan for i in range(x.shape[1])])
    train_medians={n:None if np.isnan(medians[i]) else float(medians[i]) for i,n in enumerate(schema['names'])}
    cohorts={s:{k:v for k,v in c.items() if k!='rows'} for s,c in parts.items()}
    if (prior_receipt['train_medians']!=train_medians or prior_receipt['train_vocabulary']!=vocab
            or prior_receipt['cohorts']!=cohorts or prior_receipt['schema']!=schema
            or prior_receipt['config_sha256']!=fingerprint(config)):
        raise ValueError('Refit lineage differs from frozen enhanced model')
    design={'schema':deepcopy(schema),'numeric_names':config['views']['enhanced_numeric_names'],
        'categorical_names':config['views']['enhanced_categorical_names'],
        'medians':{n:train_medians[n] for n in config['views']['enhanced_numeric_names']},'vocabulary':vocab}
    designs={s:development._design(rr,schema,medians,vocab,config)['enhanced_context'] for s,rr in rows.items()}
    labels={s:np.asarray([int(r['label']) for r in rr]) for s,rr in rows.items()}
    if any(len(np.unique(labels[s]))!=2 for s in ('train','calibration')):raise ValueError('Both fitting/calibration classes required')
    with threadpool_limits(limits=1):
        fitted=HistGradientBoostingClassifier(**config['context'],random_state=config['seed']).fit(designs['train'],labels['train'])
        raw={s:fitted.predict_proba(designs[s])[:,1] for s in ('calibration','validation')}
    model=portable.export_model(fitted,design)
    files={'model.json':_persist(folder,'model.json',model)}
    decoded=strict_json((folder/'model.json').read_bytes())
    parity_receipt={}
    for split in ('calibration','validation'):
        independent=portable.design_rows(decoded['design'],rows[split])
        if not np.array_equal(independent,designs[split]):raise ValueError('Independent feature design parity failed')
        with threadpool_limits(limits=1):predicted=portable.predict_design(decoded,independent)
        parity_receipt[split]=parity(predicted,raw[split],'json_'+split)
    previous={(r['game_id'],r['event_id']):r for r in prior_predictions}
    group_map={(r['game_id'],r['event_id']):r['groups'] for r in groups['rows']}
    expected_ids={(r['game_id'],r['event_id']) for r in rows['validation']}
    if (len(previous)!=len(prior_predictions) or set(previous)!=expected_ids
            or len(group_map)!=len(groups['rows']) or set(group_map)!=expected_ids
            or fingerprint(groups['rows'])!=groups['sha256']):raise ValueError('Exact prior prediction/group membership required')
    for row in rows['validation']:
        old=previous[row['game_id'],row['event_id']]
        if old['target']!=int(row['label']) or old['groups']!=group_map[row['game_id'],row['event_id']]:
            raise ValueError('Prior target/group revision differs')
    contexts={s:[calibrators.context_from_row(r,schema) for r in rows[s]] for s in ('calibration','validation')}
    fitted_cal={};predictions={}
    for kind in calibrators.KINDS:
        fitted_cal[kind]=calibrators.fit_calibrator(kind,raw['calibration'],labels['calibration'],contexts['calibration'])
        files['calibrator-'+kind+'.json']=_persist(folder,'calibrator-'+kind+'.json',fitted_cal[kind])
        loaded=strict_json((folder/('calibrator-'+kind+'.json')).read_bytes())
        with threadpool_limits(limits=1):predictions[kind]=calibrators.predict_calibrator(loaded,raw['validation'],contexts['validation'])
        if kind in ('raw','logit_sigmoid','isotonic'):
            name='enhanced_context_'+('sigmoid' if kind=='logit_sigmoid' else kind)
            reference=[previous[r['game_id'],r['event_id']]['predictions'][name] for r in rows['validation']]
            parity_receipt[name]=parity(predictions[kind],reference,name)
    receipt={'contract':VERSION,'cohorts':cohorts,'source_manifest_sha256':source_sha,'plan_sha256':plan_sha,
        'train_medians':train_medians,'train_vocabulary':vocab,'design_bound':bound,'model_sha256':files['model.json'],
        'calibration_membership_sha256':parts['calibration']['membership_sha256'],
        'calibrator_sha256':{k:files['calibrator-'+k+'.json'] for k in calibrators.KINDS},
        'parity':parity_receipt,'context_receipts':{s:calibrators.context_receipt(fitted_cal['beta_group'],contexts[s]) for s in contexts},
        'publishable':False}
    files['fit-receipt.json']=_persist(folder,'fit-receipt.json',receipt)
    calibration_rows=[{'game_id':r['game_id'],'event_id':r['event_id'],'target':int(r['label']),
        'raw_probability':float(raw['calibration'][i]),'context':contexts['calibration'][i]} for i,r in enumerate(rows['calibration'])]
    files['calibration-predictions.json']=_persist(folder,'calibration-predictions.json',calibration_rows)
    prediction_rows=[{'game_id':r['game_id'],'event_id':r['event_id'],'target':int(r['label']),
        'groups':group_map[r['game_id'],r['event_id']],
        'predictions':{kind:float(p[i]) for kind,p in predictions.items()}} for i,r in enumerate(rows['validation'])]
    prediction_rows.sort(key=lambda r:(r['game_id'],r['event_id']))
    files['predictions.json']=_persist(folder,'predictions.json',prediction_rows)
    lineage={'prediction_rows_sha256':fingerprint(prediction_rows),'source_manifest_sha256':source_sha,
        'split_sha256':fingerprint(cohorts),'pipelines':{k:fingerprint({'fit':files['fit-receipt.json'],'calibrator':k}) for k in calibrators.KINDS}}
    print(json.dumps({'event':'calibration.scorecard','fold':folder.name,'publishable':False}),flush=True)
    with threadpool_limits(limits=1):
        report=probability_scorecard.probability_scorecard(prediction_rows,config=config['scorecard'],evidence_kind=evidence_kind,lineage=lineage)
    files['scorecard.json']=_persist(folder,'scorecard.json',report)
    return files,report,parity_receipt


def run(freeze_dir,export_dir,prior_plan_path,prior_result_path,plan_path,output):
    output=_canonical(output);output.mkdir(exist_ok=False);files={};completed=[]
    try:
        now=datetime.now(timezone.utc).isoformat()
        files['attempt-started.json']=_persist(output,'attempt-started.json',{'contract':VERSION,'started_at':now,'publishable':False})
        replay=Replay(freeze_dir,export_dir,prior_plan_path,now=now)
        plan=strict_json(replay.read(plan_path));prior=strict_json(replay.read(prior_result_path))
        plan_sha=replay.checked[str(_safe(plan_path))]
        validate_plan(plan,replay.checked[str(replay.plan_path)],replay.checked[str(_safe(prior_result_path))],now=now)
        if (prior['publishable'] is not False or prior['status']!='completed-development-result-not-accepted'
                or prior['plan_file_sha256']!=replay.checked[str(replay.plan_path)]
                or prior['shortlist']['selected_candidate']!='enhanced_context_sigmoid'):
            raise ValueError('Pinned prior nonaccepted result required')
        for module in (calibrators,portable,probability_scorecard):replay.read(module.__file__)
        replay.read(__file__)
        # Rehash retained evidence, including model BYTES only. Never deserialize.
        for path,digest in prior['verified_file_sha256'].items():
            if file_sha(_safe(path))!=digest:raise ValueError('Preserved prior result evidence drift')
            if path in replay.checked and replay.checked[path]!=digest:raise ValueError('Prior source/code differs')
            replay.checked[path]=digest
        folds,groups=replay.replay()
        development._preflight_bounds(folds,replay.plan['schema'],groups)
        files['declaration.json']=_persist(output,'declaration.json',{'contract':VERSION,'plan':plan,'plan_sha256':plan_sha,
            'source_manifest_sha256':replay.checked[str(replay.manifest_path)],'consumed_file_sha256':replay.checked,
            'folds_sha256':fingerprint(folds),'groups_sha256':fingerprint(groups),
            'environment':{'python':platform.python_version(),'numpy':np.__version__,'scipy':scipy.__version__,'sklearn':sklearn.__version__},
            'publishable':False})
        reports={};parities={}
        for fold,parts in folds.items():
            folder=output/fold;folder.mkdir()
            files[fold+'/attempt-started.json']=_persist(folder,'attempt-started.json',{'fold':fold,'publishable':False})
            def previous(suffix):
                endings='/official-development-experiment-20260906/experiment/'+fold+'/'+suffix
                paths=[p for p in prior['verified_file_sha256'] if p.endswith(endings)]
                if len(paths)!=1:raise ValueError('Unique pinned prior fold artifact required')
                return strict_json(replay.read(paths[0]))
            print(json.dumps({'event':'calibration.fit','fold':fold,'publishable':False}),flush=True)
            produced,reports[fold],parities[fold]=fit_fold(parts,replay.plan['schema'],replay.plan['config'],
                previous('fit-receipt.json'),previous('predictions.json'),groups[fold],folder,
                replay.checked[str(replay.manifest_path)],plan_sha,evidence_kind='real')
            files.update({fold+'/'+name:digest for name,digest in produced.items()});completed.append(fold)
        result={'contract':VERSION,'status':'completed-calibration-development-not-accepted','publishable':False,
            'plan_sha256':plan_sha,'parity':parities,'selection':rank_candidates(reports),
            'historical_as_of_verified':False,'untouched_test_claim':False,'existing_reservations_changed':False}
        files['result.json']=_persist(output,'result.json',result)
        replay.verify()
        for name,digest in files.items():
            if file_sha(_safe(output/name))!=digest:raise ValueError('Calibration output drift')
        expected=set(files)
        if {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}!=expected:
            raise ValueError('Unexpected calibration artifact')
        health={'status':result['status'],'publishable':False,'completed_folds':completed,
            'files':files,'source_code_and_prior_evidence_reverified':True}
        _persist(output,'health.json',health)
        return health
    except BaseException as error:
        failure={'status':'failed-calibration-development','publishable':False,'error_type':type(error).__name__,
            'completed_folds':completed,'indexed_files':files,'partial_files_preserved':True}
        try:_persist(output,'failure.json',failure)
        except OSError:pass
        print(json.dumps({'event':'calibration.failed',**failure}),flush=True)
        raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('freeze-dir','export-dir','prior-plan','prior-result','plan','output'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    def interrupted(signum,frame):raise KeyboardInterrupt('Signal '+str(signum))
    previous={s:signal.signal(s,interrupted) for s in (signal.SIGINT,signal.SIGTERM)}
    try:print(json.dumps(run(args.freeze_dir,args.export_dir,args.prior_plan,args.prior_result,args.plan,args.output)),flush=True)
    finally:
        for s,handler in previous.items():signal.signal(s,handler)


if __name__=='__main__':main()
