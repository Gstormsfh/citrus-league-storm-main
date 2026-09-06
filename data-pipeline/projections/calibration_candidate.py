"""Bounded calibration-only fitting and JSON inference; never serving approval.

Beta map: Kull, Silva Filho, Flach (2017), https://proceedings.mlr.press/v54/kull17a.html.
Identity-centred ridge and additive context offsets are Citrus development
choices, not parameters or performance results taken from that publication.
"""
from copy import deepcopy
import json
import math

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from sklearn.isotonic import IsotonicRegression
from threadpoolctl import threadpool_limits

from projections.chronological_fit import CONFIG, _fit_logistic

VERSION = 'citrus-probability-calibrator-v1'
KINDS = ['raw','logit_sigmoid','isotonic','beta','beta_group']
CONTEXT_FIELDS = ['shot_type','prior_sog_same_team','strength']
SETTINGS = {'epsilon':1e-6,'shape_ridge':1.0,'group_ridge':100.0,
    'optimizer':'L-BFGS-B','maxiter':2000,'ftol':1e-12,'gtol':1e-8,
    'max_rows':1_000_000,'max_categories_per_field':64,'max_context_cells':32_000_000,
    'unknown_group_policy':'zero_offset_with_explicit_context_receipt', 'seed':60906}


def _finite(value):
    return type(value) in (int,float) and math.isfinite(value)


def _probabilities(values):
    if not isinstance(values,(list,np.ndarray)) or np.ndim(values) != 1 or not 0 < len(values) <= SETTINGS['max_rows']:
        raise ValueError('Bounded nonempty probability vector required')
    if isinstance(values,list) and any(not _finite(p) for p in values):
        raise ValueError('Numeric finite probabilities required')
    if isinstance(values,np.ndarray) and values.dtype.kind not in 'fi':
        raise ValueError('Numeric probability array required')
    result = np.asarray(values,dtype=float)
    if not np.isfinite(result).all() or np.any((result < 0) | (result > 1)):
        raise ValueError('Probabilities must be within zero and one')
    return result


def context_from_row(row, schema):
    """Pre-outcome feature context only; no identity, label or future fields."""
    if (not isinstance(row,dict) or not isinstance(schema,dict)
            or not isinstance(schema.get('names'),list) or not isinstance(row.get('features'),list)
            or len(row['features'])!=len(schema['names']) or len(set(schema['names']))!=len(schema['names'])
            or not {'immediate_previous_sog_same_team','shooting_skaters','defending_skaters'}<=set(schema['names'])
            or not isinstance(row.get('categorical'),dict) or 'shot_type' not in row['categorical']):
        raise ValueError('Exact feature context schema required')
    values = dict(zip(schema['names'],row['features']))
    previous = values['immediate_previous_sog_same_team']
    if previous not in (None,0,1) or type(previous) is bool:
        raise ValueError('Explicit prior-SOG feature required')
    counts = [values[n] for n in ('shooting_skaters','defending_skaters')]
    if any(v is not None and (not _finite(v) or int(v) != v or not 0 <= v <= 7) for v in counts):
        raise ValueError('Explicit skater-count features required')
    strength = None if None in counts else str(int(counts[0])) + 'v' + str(int(counts[1]))
    result = {'shot_type':row['categorical']['shot_type'],
        'prior_sog_same_team':None if previous is None else str(int(previous)), 'strength':strength}
    _contexts([result],1)
    return result


def _contexts(contexts, n):
    if not isinstance(contexts,list) or len(contexts) != n:
        raise ValueError('Exact bounded context membership required')
    for row in contexts:
        if (not isinstance(row,dict) or set(row) != set(CONTEXT_FIELDS)
                or any(v is not None and (not isinstance(v,str) or not v.strip() or len(v)>128) for v in row.values())):
            raise ValueError('Explicit calibration context fields required')


def _group_matrix(contexts, vocabulary):
    width = sum(len(v) for v in vocabulary.values())
    # The fit also holds a three-column base and a concatenated design copy.
    if len(contexts) * (2 * width + 6) > SETTINGS['max_context_cells']:
        raise ValueError('Calibration design-cell bound exceeded')
    matrix = np.zeros((len(contexts),width)); offset = 0
    for name in CONTEXT_FIELDS:
        lookup = {v:i for i,v in enumerate(vocabulary[name])}
        for i, row in enumerate(contexts):
            j = lookup.get(row[name])
            if j is not None:
                matrix[i,offset+j] = 1
        offset += len(lookup)
    return matrix


def fit_calibrator(kind, probabilities, labels, contexts=None):
    """Caller must prove calibration membership disjoint from fit/validation."""
    if kind not in KINDS:
        raise ValueError('Undeclared calibrator')
    p = _probabilities(probabilities)
    if (not isinstance(labels,(list,np.ndarray)) or np.ndim(labels)!=1 or len(labels)!=len(p)
            or any(type(v) not in (int,bool,np.int64,np.int32) or v not in (0,1) for v in labels)):
        raise ValueError('Exact binary calibration labels required')
    y = np.asarray(labels,dtype=float)
    if len(np.unique(y)) != 2:
        raise ValueError('Both calibration outcomes required')
    result = {'contract':VERSION,'kind':kind,'settings':deepcopy(SETTINGS),'publishable':False}
    if kind == 'raw':
        return result
    clipped = np.clip(p,SETTINGS['epsilon'],1-SETTINGS['epsilon'])
    logs = np.column_stack((np.log(clipped),-np.log1p(-clipped)))
    if kind == 'logit_sigmoid':
        if np.ptp(p)==0:
            rate=float(y.mean()); intercept=math.log(rate)-math.log1p(-rate); slope=0.
        else:
            with threadpool_limits(limits=1):
                fitted=_fit_logistic(logs.sum(axis=1).reshape(-1,1),y,
                    {**CONFIG['logistic'],'C':1.0,'random_state':SETTINGS['seed']})
            intercept=float(fitted.intercept_[0]);slope=float(fitted.coef_[0,0])
        return {**result,'intercept':intercept,'slope':slope}
    if kind == 'isotonic':
        with threadpool_limits(limits=1):
            fitted=IsotonicRegression(increasing=True,out_of_bounds='clip',y_min=0,y_max=1).fit(p,y)
        return {**result,'x':fitted.X_thresholds_.tolist(),'y':fitted.y_thresholds_.tolist()}
    vocabulary = {}
    if kind == 'beta_group':
        _contexts(contexts,len(p))
        for name in CONTEXT_FIELDS:
            values=set()
            for row in contexts:
                values.add(row[name])
                if len(values)>SETTINGS['max_categories_per_field']:
                    raise ValueError('Calibration vocabulary bound exceeded')
            vocabulary[name]=sorted(values,key=lambda v:(v is not None,v or ''))
        group = _group_matrix(contexts,vocabulary)
    else:
        group = np.empty((len(p),0))
    design = np.column_stack((logs,np.ones(len(p)),group))
    initial = np.zeros(design.shape[1]);initial[:2]=1
    penalty = np.full(design.shape[1],SETTINGS['group_ridge']);penalty[:2]=SETTINGS['shape_ridge'];penalty[2]=0
    def objective(theta):
        z=design@theta; delta=theta-initial
        loss=(np.logaddexp(0,z)-y*z).sum()+.5*np.dot(penalty*delta,delta)
        gradient=design.T@(expit(z)-y)+penalty*delta
        return float(loss/len(y)),gradient/len(y)
    with threadpool_limits(limits=1):
        fitted=minimize(objective,initial,jac=True,method=SETTINGS['optimizer'],
            bounds=[(0,None),(0,None)]+[(None,None)]*(design.shape[1]-2),
            options={k:SETTINGS[k] for k in ('maxiter','ftol','gtol')})
    if not fitted.success or not np.isfinite(fitted.x).all() or not math.isfinite(fitted.fun):
        raise ValueError('Calibrator optimization did not converge')
    theta=fitted.x
    return {**result,'a':float(theta[0]),'b':float(theta[1]),'intercept':float(theta[2]),
        'vocabulary':vocabulary,'offsets':theta[3:].tolist(),
        'optimization':{'converged':True,'iterations':int(fitted.nit),'objective':float(fitted.fun)}}


def validate_calibrator(model):
    if (not isinstance(model,dict) or model.get('contract') != VERSION or model.get('kind') not in KINDS
            or json.dumps(model.get('settings'),sort_keys=True) != json.dumps(SETTINGS,sort_keys=True)
            or model.get('publishable') is not False):
        raise ValueError('Unsupported calibration contract')
    base={'contract','kind','settings','publishable'}; kind=model['kind']
    extra={'raw':set(),'logit_sigmoid':{'intercept','slope'},'isotonic':{'x','y'},
        'beta':{'a','b','intercept','vocabulary','offsets','optimization'},
        'beta_group':{'a','b','intercept','vocabulary','offsets','optimization'}}[kind]
    if set(model)!=base|extra:
        raise ValueError('Exact calibrator fields required')
    if kind=='logit_sigmoid' and any(not _finite(model[k]) for k in ('intercept','slope')):
        raise ValueError('Finite sigmoid parameters required')
    if kind=='isotonic':
        x,y=model['x'],model['y']
        if (not isinstance(x,list) or not isinstance(y,list) or not 0<len(x)==len(y)<=SETTINGS['max_rows']
                or any(not _finite(v) or not 0<=v<=1 for v in x+y)
                or any(a>=b for a,b in zip(x,x[1:])) or any(a>b for a,b in zip(y,y[1:]))):
            raise ValueError('Bounded ordered isotonic knots required')
    if kind in ('beta','beta_group'):
        if any(not _finite(model[k]) for k in ('a','b','intercept')) or min(model['a'],model['b'])<0:
            raise ValueError('Finite monotonic beta parameters required')
        vocab=model['vocabulary']; offsets=model['offsets']
        if not isinstance(vocab,dict) or set(vocab)!=(set(CONTEXT_FIELDS) if kind=='beta_group' else set()):
            raise ValueError('Exact beta group vocabulary required')
        for values in vocab.values():
            if (not isinstance(values,list) or not 0<len(values)<=SETTINGS['max_categories_per_field']
                    or any(v is not None and (not isinstance(v,str) or not v.strip() or len(v)>128) for v in values)
                    or values!=sorted(set(values),key=lambda v:(v is not None,v or ''))):
                raise ValueError('Canonical bounded group vocabulary required')
        if not isinstance(offsets,list) or len(offsets)!=sum(map(len,vocab.values())) or any(not _finite(v) for v in offsets):
            raise ValueError('Exact finite group offsets required')
        optimization=model['optimization']
        if (not isinstance(optimization,dict) or set(optimization)!={'converged','iterations','objective'}
                or optimization['converged'] is not True or type(optimization['iterations']) is not int
                or not 0<=optimization['iterations']<=SETTINGS['maxiter'] or not _finite(optimization['objective'])):
            raise ValueError('Converged calibration receipt required')


def predict_calibrator(model, probabilities, contexts=None):
    validate_calibrator(model);p=_probabilities(probabilities);kind=model['kind']
    if kind=='raw':return p.copy()
    if kind=='isotonic':return np.interp(p,model['x'],model['y'])
    clipped=np.clip(p,SETTINGS['epsilon'],1-SETTINGS['epsilon'])
    if kind=='logit_sigmoid':
        z=model['intercept']+model['slope']*(np.log(clipped)-np.log1p(-clipped))
    else:
        z=model['intercept']+model['a']*np.log(clipped)-model['b']*np.log1p(-clipped)
        if kind=='beta_group':
            _contexts(contexts,len(p))
            z+=_group_matrix(contexts,model['vocabulary'])@np.asarray(model['offsets'])
    if not np.isfinite(z).all():raise ValueError('Nonfinite calibration logit')
    result=expit(z)
    if not np.isfinite(result).all():raise ValueError('Nonfinite calibrated probability')
    return result


def context_receipt(model, contexts):
    """Missing (None) is distinct from an unseen explicit category; no coercion."""
    validate_calibrator(model)
    if model['kind']!='beta_group':raise ValueError('Group calibrator required')
    if not isinstance(contexts,list) or not 0<len(contexts)<=SETTINGS['max_rows']:
        raise ValueError('Bounded context list required')
    _contexts(contexts,len(contexts))
    return {name:{'missing':sum(r[name] is None for r in contexts),
        'unseen':sum(r[name] not in model['vocabulary'][name] for r in contexts),
        'rows':len(contexts)} for name in CONTEXT_FIELDS}
