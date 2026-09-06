"""Development-only chronological experiments; no late-period reader API.

Membership hashes attest consistency, not source authenticity. The integrator
must replay official source inputs before calling this additive evaluator.
"""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
import math
import pickle
import platform
from datetime import datetime,timezone

import numpy as np
import sklearn
import scipy
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import StandardScaler
from scipy.special import expit
from threadpoolctl import threadpool_limits

from projections.analytics_publication import fingerprint
from projections import chronological_fit,probability_scorecard
from projections.chronological_fit import _day, _sha, cohort_digests, _fit_logistic
from projections.chronological_experiment import _persist

VERSION='citrus-chronological-development-experiment-v1'
CUTOFF='2024-07-01'
MAX_CATEGORIES_PER_FIELD=256
MAX_DESIGN_CELLS=100_000_000
MAX_ROWS_PER_FOLD=1_000_000
MAX_NUMERIC_FEATURES=64
MAX_CATEGORICAL_FEATURES=8
OPERATIONAL_LIMITS={'categories_per_field':MAX_CATEGORIES_PER_FIELD,'design_cells_per_fold':MAX_DESIGN_CELLS,
    'rows_per_fold':MAX_ROWS_PER_FOLD,'numeric_features':MAX_NUMERIC_FEATURES,'categorical_features':MAX_CATEGORICAL_FEATURES,
    'row_scope':'sum of train/calibration/validation rows within each of two fixed folds',
    'design_scope':'sum of final dense cells across three splits and geometry/base/enhanced families'}
FOLD_WINDOWS={
    'fold1':{'train':{'start':'2019-07-01','end':'2021-06-30'},
             'calibration':{'start':'2021-07-01','end':'2022-06-30'},
             'validation':{'start':'2022-07-01','end':'2023-06-30'}},
    'fold2':{'train':{'start':'2019-07-01','end':'2022-06-30'},
             'calibration':{'start':'2022-07-01','end':'2023-06-30'},
             'validation':{'start':'2023-07-01','end':'2024-06-30'}}}


def _preflight_bounds(folds,schema,groups):
    """Bound caller-owned containers before copying or building dense matrices."""
    if not isinstance(schema,dict):raise ValueError('Explicit bounded schema required')
    for key,limit in (('names',MAX_NUMERIC_FEATURES),('categorical_names',MAX_CATEGORICAL_FEATURES)):
        if not isinstance(schema.get(key),list) or len(schema[key])>limit:raise ValueError('Feature-count operational bound exceeded')
    if not isinstance(folds,dict) or set(folds)!=set(FOLD_WINDOWS):raise ValueError('Exact bounded folds required')
    for name,parts in folds.items():
        if not isinstance(parts,dict) or set(parts)!=set(FOLD_WINDOWS[name]):raise ValueError('Exact bounded partitions required')
        count=0
        for cohort in parts.values():
            if not isinstance(cohort,dict) or not isinstance(cohort.get('rows'),list):raise ValueError('Bounded row lists required')
            count+=len(cohort['rows'])
        if count>MAX_ROWS_PER_FOLD:raise ValueError('Row-count operational bound exceeded')
    if groups is not None:
        if not isinstance(groups,dict) or set(groups)!=set(FOLD_WINDOWS):raise ValueError('Bounded group mapping required')
        for name,entry in groups.items():
            if (not isinstance(entry,dict) or not isinstance(entry.get('rows'),list)
                    or len(entry['rows'])!=len(folds[name]['validation']['rows'])):raise ValueError('Bounded exact validation group membership required')


def _vocabulary_and_design_bound(rows,schema,config):
    vocab={}
    for name in config['views']['enhanced_categorical_names']:
        values=set()
        for row in rows['train']:
            value=row['categorical'][name]
            if value is not None:values.add(value)
            if len(values)>MAX_CATEGORIES_PER_FIELD:raise ValueError('Categorical vocabulary operational bound exceeded')
        vocab[name]=sorted(values)
    widths={'geometry':7,'base_context':2*len(config['views']['base_numeric_names']),
        'enhanced_context':2*len(config['views']['enhanced_numeric_names'])+sum(len(v)+2 for v in vocab.values())}
    cells=sum(len(rr) for rr in rows.values())*sum(widths.values())
    if cells>MAX_DESIGN_CELLS:raise ValueError('Dense design-cell operational bound exceeded')
    return vocab,{'family_widths':widths,'total_cells':cells}


def validate_memberships(folds, schema):
    """Exact immutable repeated membership, not an invented completeness proof."""
    if not isinstance(folds,dict) or set(folds)!=set(FOLD_WINDOWS):raise ValueError('Two explicit development folds required')
    shared={};all_games={};schema_sha=fingerprint(schema)
    for name,windows in FOLD_WINDOWS.items():
        if not isinstance(folds[name],dict) or set(folds[name])!=set(windows):raise ValueError('Exact development partitions required')
        occupied=set()
        for split,window in windows.items():
            cohort=folds[name][split]
            if (not isinstance(cohort,dict) or set(cohort)!={'split','window','rows','membership_sha256','source_sha256','feature_sha256'}
                    or cohort['split']!=split or cohort['window']!=window
                    or not isinstance(cohort['rows'],list) or not cohort['rows']):raise ValueError('Exact nonempty fixed development window required')
            seen=set();games=set()
            for row in cohort['rows']:
                if not isinstance(row,dict) or set(row)!={'split','game_id','event_id','game_date','label','features','categorical','source_sha256','feature_sha256'}:
                    raise ValueError('Exact development row fields required')
                gid,eid,day=row['game_id'],row['event_id'],_day(row['game_date'])
                if (row['split']!=split or day>=_day(CUTOFF) or not _day(window['start'])<=day<=_day(window['end'])
                        or type(gid) is not int or len(str(gid))!=10 or gid//10000%100 not in (2,3) or gid%10000==0
                        or day.year not in (gid//1000000,gid//1000000+1) or type(eid) is not int or eid<0
                        or (gid,eid) in seen or gid in occupied or type(row['label']) not in (int,bool) or row['label'] not in (0,1)):
                    raise ValueError('Invalid, overlapping or late development membership')
                _sha(row['source_sha256'])
                if row['feature_sha256']!=fingerprint({'schema_sha256':schema_sha,'values':row['features'],'categorical':row['categorical']}):raise ValueError('Feature hash mismatch')
                if (not isinstance(row['features'],list) or len(row['features'])!=len(schema['names'])
                        or any(v is not None and (type(v) not in (int,float) or not math.isfinite(v)) for v in row['features'])
                        or not isinstance(row['categorical'],dict) or set(row['categorical'])!=set(schema['categorical_names'])
                        or any(v is not None and (not isinstance(v,str) or not v.strip()) for v in row['categorical'].values())):
                    raise ValueError('Exact finite numeric and explicit categorical vectors required')
                identity=(row['game_date'],row['source_sha256'])
                if gid in all_games and all_games[gid]!=identity:raise ValueError('Conflicting whole-game source/date')
                all_games[gid]=identity
                content={k:v for k,v in row.items() if k!='split'}
                if (gid,eid) in shared and shared[gid,eid]!=content:raise ValueError('Across-fold event revision conflict')
                shared[gid,eid]=content;seen.add((gid,eid));games.add(gid)
            if cohort['rows']!=sorted(cohort['rows'],key=lambda r:(r['game_date'],r['game_id'],r['event_id'])):raise ValueError('Canonical membership order required')
            for key,value in cohort_digests(cohort['rows']).items():
                if cohort[key]!=value:raise ValueError('Cohort membership digest mismatch')
            occupied.update(games)
    # Expanding windows must contain the exact previously declared populations.
    def members(*cohorts):
        return {(r['game_id'],r['event_id']) for c in cohorts for r in c['rows']}
    if members(folds['fold2']['train'])!=members(folds['fold1']['train'],folds['fold1']['calibration']):
        raise ValueError('Expanding fit population is not exact')
    if members(folds['fold2']['calibration'])!=members(folds['fold1']['validation']):
        raise ValueError('Repeated calibration population is not exact')


def validate_configuration(schema,config):
    if (not isinstance(schema,dict) or set(schema)!={'version','names','categorical_names'}
            or not isinstance(schema['version'],str) or not schema['version'].strip()):raise ValueError('Explicit schema required')
    for field in ('names','categorical_names'):
        names=schema[field]
        if not isinstance(names,list) or any(not isinstance(n,str) or not n.strip() for n in names) or len(names)!=len(set(names)):
            raise ValueError('Ordered unique feature names required')
    if not {'distance_to_goal_ft','signed_angle_deg'}<=set(schema['names']) or set(schema['names'])&set(schema['categorical_names']):raise ValueError('Disjoint schema with geometry required')
    if (set(config)!={'seed','threads','logistic','context','sigmoid','views','scorecard'}
            or type(config['seed']) is not int or config['seed']!=60906 or type(config['threads']) is not int or config['threads']!=1
            or config['logistic']!=chronological_fit.CONFIG['logistic'] or config['context']!=chronological_fit.CONFIG['context']
            or config['sigmoid']!={'C':1.0,'epsilon':1e-6}):raise ValueError('Fixed declared development architecture required')
    if (any(type(v) is bool for v in config['logistic'].values())
            or any(type(v) is bool for k,v in config['context'].items() if k!='early_stopping')
            or config['context']['early_stopping'] is not False
            or any(type(v) is bool for v in config['sigmoid'].values())):raise ValueError('Boolean is not a numeric fit parameter')
    views=config['views']
    if set(views)!={'base_numeric_names','enhanced_numeric_names','enhanced_categorical_names'}:raise ValueError('Explicit feature views required')
    for name,values in views.items():
        allowed=schema['categorical_names'] if name=='enhanced_categorical_names' else schema['names']
        if not isinstance(values,list) or not values or any(v not in allowed for v in values) or len(set(values))!=len(values):raise ValueError('Invalid explicit feature view')
    if not set(views['base_numeric_names'])<=set(views['enhanced_numeric_names']):raise ValueError('Enhanced view must preserve base numeric features')
    probability_scorecard._config(config['scorecard'])


def _numeric(rows,schema):
    return np.asarray([[np.nan if v is None else v for v in row['features']] for row in rows],dtype=float)


def _design(rows,schema,medians,vocab,config):
    raw=_numeric(rows,schema);missing=np.isnan(raw).astype(float);filled=np.where(np.isnan(raw),medians,raw)
    d,a=(filled[:,schema['names'].index(name)] for name in ('distance_to_goal_ft','signed_angle_deg'))
    if np.any(d<0) or np.any(np.abs(a)>180):raise ValueError('Invalid geometry domain')
    a=np.abs(a)
    geometry=np.column_stack((d,a,d*d,a*a,d*a,missing[:,schema['names'].index('distance_to_goal_ft')],missing[:,schema['names'].index('signed_angle_deg')]))
    result={'geometry':geometry}
    for family,key in (('base_context','base_numeric_names'),('enhanced_context','enhanced_numeric_names')):
        indices=[schema['names'].index(n) for n in config['views'][key]]
        parts=[filled[:,indices],missing[:,indices]]
        if family=='enhanced_context':
            for name in config['views']['enhanced_categorical_names']:
                values=vocab[name];matrix=np.zeros((len(rows),len(values)+2))
                lookup={v:i for i,v in enumerate(values)}
                for i,row in enumerate(rows):
                    value=row['categorical'][name]
                    matrix[i,len(values) if value is None else lookup.get(value,len(values)+1)]=1
                parts.append(matrix)
        result[family]=np.column_stack(parts)
    if any(not np.isfinite(v).all() for v in result.values()):raise ValueError('Nonfinite feature design')
    return result


def _code_hashes():
    paths=[Path(__file__),Path(chronological_fit.__file__),Path(probability_scorecard.__file__),
           Path(__file__).with_name('chronological_experiment.py'),Path(__file__).with_name('analytics_publication.py')]
    return {str(p.resolve()):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def run_development_experiment(*,folds,schema,config,provenance,output,groups=None):
    """No test reader/path exists. Caller owns source replay and experiment choice."""
    directory=Path(output);directory.mkdir(exist_ok=False)
    files={};completed=[]
    try:
        _persist(directory,'attempt-started.json',{'contract':VERSION,'started_at':datetime.now(timezone.utc).isoformat(),
            'status':'started-development-only','publishable':False})
        code=_code_hashes()
        _preflight_bounds(folds,schema,groups)
        folds,schema,config,provenance=deepcopy((folds,schema,config,provenance))
        validate_configuration(schema,config);validate_memberships(folds,schema)
        groups=deepcopy(groups)
        group_maps={name:{} for name in FOLD_WINDOWS};dimensions=None
        if groups is not None:
            if set(groups)!=set(FOLD_WINDOWS):raise ValueError('Exact fold group mapping required')
            for name,entry in groups.items():
                if set(entry)!={'rows','sha256'} or fingerprint(entry['rows'])!=entry['sha256']:raise ValueError('Detached group receipt')
                for row in entry['rows']:
                    if (set(row)!={'game_id','event_id','groups'} or type(row['game_id']) is not int or type(row['event_id']) is not int
                            or not isinstance(row['groups'],dict) or len(row['groups'])>8
                            or any(not isinstance(k,str) or not k.strip() or (v is not None and (not isinstance(v,str) or not v.strip())) for k,v in row['groups'].items())):
                        raise ValueError('Invalid group identity or values')
                    if dimensions is None:dimensions=set(row['groups'])
                    if set(row['groups'])!=dimensions or (row['game_id'],row['event_id']) in group_maps[name]:raise ValueError('Conflicting group dimensions or membership')
                    group_maps[name][row['game_id'],row['event_id']]=row['groups']
                if entry['rows']!=sorted(entry['rows'],key=lambda r:(r['game_id'],r['event_id'])) or set(group_maps[name])!={(r['game_id'],r['event_id']) for r in folds[name]['validation']['rows']}:
                    raise ValueError('Groups require exact canonical validation membership')
        if set(provenance)!={'source_manifest_sha256','execution_plan_sha256','evidence_kind'} or provenance['evidence_kind'] not in ('real','synthetic'):
            raise ValueError('Explicit source and plan provenance required')
        _sha(provenance['source_manifest_sha256']);_sha(provenance['execution_plan_sha256'])
        declaration={'contract':VERSION,'schema':schema,'config':config,'provenance':provenance,'code_sha256':code,
            'operational_limits':deepcopy(OPERATIONAL_LIMITS),
            'fold_windows':FOLD_WINDOWS,'input_sha256':fingerprint(folds),'cutoff_exclusive':CUTOFF,
            'environment':{'python':platform.python_version(),'numpy':np.__version__,'scipy':scipy.__version__,'sklearn':sklearn.__version__},
            'source_authentication':'upstream-required','selection':'none','publishable':False}
        files['declaration.json']=_persist(directory,'declaration.json',declaration)
        if groups is not None:files['groups.json']=_persist(directory,'groups.json',groups)
        for fold_name in FOLD_WINDOWS:
            parts=folds[fold_name]
            folder=directory/fold_name;folder.mkdir()
            _persist(folder,'attempt-started.json',{'fold':fold_name,'status':'started','publishable':False})
            rows={name:cohort['rows'] for name,cohort in parts.items()}
            vocab,design_bound=_vocabulary_and_design_bound(rows,schema,config)
            labels={name:np.asarray([int(r['label']) for r in rr]) for name,rr in rows.items()}
            if any(len(np.unique(labels[s]))!=2 for s in ('train','calibration')):raise ValueError('Both fit and calibration classes required')
            x=_numeric(rows['train'],schema)
            used=set(config['views']['base_numeric_names'])|set(config['views']['enhanced_numeric_names'])|{'distance_to_goal_ft','signed_angle_deg'}
            if any(np.isnan(x[:,schema['names'].index(n)]).all() for n in used):raise ValueError('All-missing fit feature')
            # Unused numeric fields remain excluded, never assigned artificial medians.
            medians=np.asarray([float(np.nanmedian(x[:,i])) if not np.isnan(x[:,i]).all() else np.nan for i in range(x.shape[1])])
            designs={s:_design(rr,schema,medians,vocab,config) for s,rr in rows.items()}
            scaler=StandardScaler();models={}
            with threadpool_limits(limits=1):
                models['geometry']=_fit_logistic(scaler.fit_transform(designs['train']['geometry']),labels['train'],{**config['logistic'],'random_state':config['seed']})
                for family in ('base_context','enhanced_context'):
                    models[family]=HistGradientBoostingClassifier(**config['context'],random_state=config['seed']).fit(designs['train'][family],labels['train'])
            raw={}
            with threadpool_limits(limits=1):
                for s in ('calibration','validation'):
                    raw[s]={family:model.predict_proba(scaler.transform(designs[s][family]) if family=='geometry' else designs[s][family])[:,1] for family,model in models.items()}
            predictions={'prevalence_raw':np.full(len(rows['validation']),labels['train'].mean()),
                         'prevalence_calibrated':np.full(len(rows['validation']),labels['calibration'].mean())}
            artifacts={};calibrators={};epsilon=config['sigmoid']['epsilon']
            for family,model in models.items():
                artifacts[family+'.pickle']=pickle.dumps({'model':model,'scaler':scaler if family=='geometry' else None,
                    'schema':schema,'medians':medians,'vocabulary':vocab,'config':config},protocol=5)
                cp,vp=raw['calibration'][family],raw['validation'][family]
                predictions[family+'_raw']=vp
                logits=lambda p:np.log(np.clip(p,epsilon,1-epsilon))-np.log1p(-np.clip(p,epsilon,1-epsilon))
                if np.ptp(cp)==0:
                    rate=float(labels['calibration'].mean());intercept=math.log(rate)-math.log1p(-rate);slope=0.
                else:
                    with threadpool_limits(limits=1):
                        sigmoid=_fit_logistic(logits(cp).reshape(-1,1),labels['calibration'],{**config['logistic'],'C':config['sigmoid']['C'],'random_state':config['seed']})
                    intercept=float(sigmoid.intercept_[0]);slope=float(sigmoid.coef_[0,0])
                with threadpool_limits(limits=1):
                    isotonic=IsotonicRegression(increasing=True,out_of_bounds='clip',y_min=0,y_max=1).fit(cp,labels['calibration'])
                    predictions[family+'_isotonic']=isotonic.predict(vp)
                predictions[family+'_sigmoid']=expit(intercept+slope*logits(vp))
                calibrators[family]={'sigmoid':{'intercept':intercept,'slope':slope,'epsilon':epsilon},
                    'isotonic':{'x':isotonic.X_thresholds_.tolist(),'y':isotonic.y_thresholds_.tolist(),'out_of_bounds':'clip'},
                    'raw_model_sha256':hashlib.sha256(artifacts[family+'.pickle']).hexdigest(),
                    'calibration_membership_sha256':parts['calibration']['membership_sha256']}
            for name,body in artifacts.items():files[fold_name+'/'+name]=_persist(folder,name,body)
            receipt={'fold':fold_name,'schema':schema,'config_sha256':fingerprint(config),'code_sha256':code,
                'design_bound':design_bound,
                'cohorts':{s:{k:v for k,v in c.items() if k!='rows'} for s,c in parts.items()},
                'train_medians':{n:None if np.isnan(medians[i]) else float(medians[i]) for i,n in enumerate(schema['names'])},
                'train_vocabulary':vocab,'categorical_policy':'one-hot-known-plus-fixed-missing-and-unknown',
                'validation_groups_sha256':groups[fold_name]['sha256'] if groups is not None else None,
                'calibrators':calibrators,'prevalence':{'raw':float(labels['train'].mean()),'calibrated':float(labels['calibration'].mean())},
                'artifact_sha256':{n:hashlib.sha256(b).hexdigest() for n,b in artifacts.items()},'publishable':False}
            files[fold_name+'/fit-receipt.json']=_persist(folder,'fit-receipt.json',receipt)
            prediction_rows=[{'game_id':r['game_id'],'event_id':r['event_id'],'target':int(r['label']),
                'groups':group_maps[fold_name].get((r['game_id'],r['event_id']),{}),
                'predictions':{name:float(values[i]) for name,values in predictions.items()}} for i,r in enumerate(rows['validation'])]
            prediction_rows.sort(key=lambda r:(r['game_id'],r['event_id']))
            files[fold_name+'/predictions.json']=_persist(folder,'predictions.json',prediction_rows)
            batches={'base':['prevalence_raw','prevalence_calibrated']+[f+'_'+v for f in ('geometry','base_context') for v in ('raw','sigmoid','isotonic')],
                     'enhanced':['prevalence_raw','prevalence_calibrated']+[f+'_'+v for f in ('geometry','enhanced_context') for v in ('raw','sigmoid','isotonic')],
                     'context_ablation':[f+'_'+v for f in ('base_context','enhanced_context') for v in ('raw','sigmoid','isotonic')]}
            for batch,names in batches.items():
                selected=[{**r,'predictions':{n:r['predictions'][n] for n in names}} for r in prediction_rows]
                lineage={'prediction_rows_sha256':fingerprint(selected),'source_manifest_sha256':provenance['source_manifest_sha256'],
                    'split_sha256':fingerprint(receipt['cohorts']),'pipelines':{n:fingerprint({'fit':fingerprint(receipt),'predictor':n}) for n in names}}
                with threadpool_limits(limits=1):
                    report=probability_scorecard.probability_scorecard(selected,config=config['scorecard'],evidence_kind=provenance['evidence_kind'],lineage=lineage)
                files[fold_name+'/'+batch+'-scorecard.json']=_persist(folder,batch+'-scorecard.json',report)
            files[fold_name+'/health.json']=_persist(folder,'health.json',{'status':'completed-development-not-selected','batches':batches,
                'validation_membership_sha256':parts['validation']['membership_sha256'],'publishable':False})
            completed.append(fold_name)
        if _code_hashes()!=code:raise ValueError('Development code changed')
        for name,sha in files.items():
            if hashlib.sha256((directory/name).read_bytes()).hexdigest()!=sha:raise ValueError('Development artifact changed')
        health={'status':'completed-development-not-selected-not-publishable','folds':completed,'files':files,
                'code_drift_verified':True,'publishable':False,'no_late_period_access':True}
        _persist(directory,'health.json',health)
        return health
    except BaseException as error:
        failure={'status':'failed-development-not-selected','error_type':type(error).__name__,'completed_folds':completed,'retained_files':files,'publishable':False}
        try:_persist(directory,'failure.json',failure)
        except OSError:pass
        print(json.dumps({'event':'development_experiment.failed',**failure}),flush=True)
        raise
