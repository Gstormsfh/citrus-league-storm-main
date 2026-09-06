"""Four fixed development-only shape calibrators; no source/model loader.

Smooth isotonic follows the plateau-representative/PCHIP idea in Jiang et al.
(2011), https://pmc.ncbi.nlm.nih.gov/articles/PMC3248752/. Midpoint selection,
clipped tails and the penalized piecewise-logit family are explicit Citrus
choices, not claimed reproductions of that paper's experiments.
"""
from copy import deepcopy
import json
import math
import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.optimize import minimize
from scipy.special import expit
from sklearn.isotonic import IsotonicRegression
from threadpoolctl import threadpool_limits
from projections import calibration_candidate as prior

VERSION='citrus-calibration-shape-v1'
KINDS=['isotonic_clipped','smooth_isotonic_clipped','monotone_logit','monotone_logit_group']
SETTINGS={'epsilon':1e-6,'knots':[1e-6,.005,.01,.025,.05,.1,.2,.35,.5,.75,.95,1-1e-6],
    'reference_probability':.1,'slope_identity_ridge':100.,'adjacent_slope_ridge':100.,'group_ridge':100.,
    'maxiter':3000,'ftol':1e-12,'gtol':1e-8,'max_rows':1_000_000,'max_cells':32_000_000,
    'max_plateaus':4096,'optimizer':'L-BFGS-B','threads':1,
    'smoothing':'isotonic_plateau_endpoint_midpoint_then_pchip','tail_policy':'clip_input_to_representative_support',
    'output_policy':'clip_all_new_candidates_to_epsilon','unknown_group_policy':'zero_offset_explicit_context_status'}


def _logit(p):return np.log(p)-np.log1p(-p)


def _basis(p):
    knots=_logit(np.asarray(SETTINGS['knots']));x=_logit(np.clip(p,SETTINGS['epsilon'],1-SETTINGS['epsilon']))
    base=np.clip(x[:,None]-knots[:-1],0,np.diff(knots))
    return base-np.clip(float(_logit(SETTINGS['reference_probability']))-knots[:-1],0,np.diff(knots))


def fit(kind,probabilities,labels,contexts=None):
    if kind not in KINDS:raise ValueError('Undeclared shape calibrator')
    p=prior._probabilities(probabilities)
    if (not isinstance(labels,(list,np.ndarray)) or np.ndim(labels)!=1 or len(labels)!=len(p)
            or any(type(v) not in (int,bool,np.int32,np.int64) or v not in (0,1) for v in labels)):
        raise ValueError('Exact binary calibration labels required')
    y=np.asarray(labels,dtype=float)
    if len(np.unique(y))!=2:raise ValueError('Both calibration outcomes required')
    result={'contract':VERSION,'kind':kind,'settings':deepcopy(SETTINGS),'publishable':False}
    if kind in ('isotonic_clipped','smooth_isotonic_clipped'):
        iso=IsotonicRegression(increasing=True,out_of_bounds='clip',y_min=0,y_max=1).fit(p,y)
        x,v=iso.X_thresholds_,iso.y_thresholds_
        if kind=='isotonic_clipped':return {**result,'x':x.tolist(),'y':v.tolist()}
        starts=np.r_[0,np.flatnonzero(v[1:]!=v[:-1])+1];ends=np.r_[starts[1:]-1,len(x)-1]
        if len(starts)>SETTINGS['max_plateaus']:raise ValueError('Plateau operational bound exceeded')
        representatives=(x[starts]+x[ends])/2
        values=v[starts]
        # A one-plateau model is constant; otherwise serialize spline coefficients.
        coefficients=[] if len(starts)==1 else PchipInterpolator(representatives,values,extrapolate=False).c.T.tolist()
        return {**result,'x':representatives.tolist(),'y':values.tolist(),'coefficients':coefficients}
    vocabulary={}
    if kind=='monotone_logit_group':
        prior._contexts(contexts,len(p))
        for name in prior.CONTEXT_FIELDS:
            values=set()
            for row in contexts:
                values.add(row[name])
                if len(values)>prior.SETTINGS['max_categories_per_field']:raise ValueError('Group vocabulary bound exceeded')
            vocabulary[name]=sorted(values,key=lambda v:(v is not None,v or ''))
    width=len(SETTINGS['knots'])+sum(map(len,vocabulary.values()))
    if len(p)*2*width>SETTINGS['max_cells']:raise ValueError('Shape design resource bound exceeded')
    group=prior._group_matrix(contexts,vocabulary) if vocabulary else np.empty((len(p),0))
    slopes=len(SETTINGS['knots'])-1
    design=np.column_stack((_basis(p),np.ones(len(p)),group))
    initial=np.zeros(width);initial[:slopes]=1;initial[slopes]=float(_logit(SETTINGS['reference_probability']))
    penalty=np.full(width,SETTINGS['group_ridge']);penalty[:slopes]=SETTINGS['slope_identity_ridge'];penalty[slopes]=0
    def objective(theta):
        z=design@theta;delta=theta-initial;diff=np.diff(theta[:slopes])
        loss=np.logaddexp(0,z).sum()-np.dot(y,z)+.5*np.dot(penalty*delta,delta)+.5*SETTINGS['adjacent_slope_ridge']*np.dot(diff,diff)
        gradient=design.T@(expit(z)-y)+penalty*delta
        gradient[:slopes-1]-=SETTINGS['adjacent_slope_ridge']*diff
        gradient[1:slopes]+=SETTINGS['adjacent_slope_ridge']*diff
        return float(loss/len(y)),gradient/len(y)
    with threadpool_limits(limits=1):
        optimized=minimize(objective,initial,jac=True,method=SETTINGS['optimizer'],
            bounds=[(0,None)]*slopes+[(None,None)]*(width-slopes),options={k:SETTINGS[k] for k in ('maxiter','ftol','gtol')})
    if not optimized.success or not np.isfinite(optimized.x).all() or not math.isfinite(optimized.fun):
        raise ValueError('Shape optimization failed to converge')
    return {**result,'slopes':optimized.x[:slopes].tolist(),'intercept':float(optimized.x[slopes]),
        'vocabulary':vocabulary,'offsets':optimized.x[slopes+1:].tolist(),
        'optimization':{'converged':True,'iterations':int(optimized.nit),'objective':float(optimized.fun)}}


def validate(model):
    if (not isinstance(model,dict) or model.get('contract')!=VERSION or model.get('kind') not in KINDS
            or model.get('publishable') is not False
            or json.dumps(model.get('settings'),sort_keys=True)!=json.dumps(SETTINGS,sort_keys=True)):
        raise ValueError('Exact shape calibration contract required')
    kind=model['kind'];base={'contract','kind','settings','publishable'}
    extra={'x','y'} if kind=='isotonic_clipped' else {'x','y','coefficients'} if kind=='smooth_isotonic_clipped' else {'slopes','intercept','vocabulary','offsets','optimization'}
    if set(model)!=base|extra:raise ValueError('Exact shape fields required')
    if kind in ('isotonic_clipped','smooth_isotonic_clipped'):
        limit=SETTINGS['max_rows'] if kind=='isotonic_clipped' else SETTINGS['max_plateaus']
        x,y=model['x'],model['y']
        if (not isinstance(x,list) or not isinstance(y,list) or not 0<len(x)==len(y)<=limit
                or any(not prior._finite(v) or not 0<=v<=1 for v in x+y)
                or any(a>=b for a,b in zip(x,x[1:])) or any(a>b for a,b in zip(y,y[1:]))):
            raise ValueError('Ordered bounded shape knots required')
        if kind=='smooth_isotonic_clipped':
            coefficients=model['coefficients']
            if (not isinstance(coefficients,list) or len(coefficients)!=len(x)-1
                    or any(not isinstance(c,list) or len(c)!=4 or any(not prior._finite(v) for v in c) for c in coefficients)):
                raise ValueError('Bounded finite PCHIP coefficients required')
            # Reconstruct the defined PCHIP, rejecting arbitrary cubic/overshooting maps.
            expected=[] if len(x)==1 else PchipInterpolator(x,y,extrapolate=False).c.T.tolist()
            if coefficients!=expected:raise ValueError('Coefficients differ from declared monotone PCHIP')
    else:
        if (not isinstance(model['slopes'],list) or len(model['slopes'])!=len(SETTINGS['knots'])-1
                or any(not prior._finite(v) or v<0 for v in model['slopes']) or not prior._finite(model['intercept'])):
            raise ValueError('Finite nonnegative piecewise slopes required')
        vocab,offsets=model['vocabulary'],model['offsets']
        if not isinstance(vocab,dict) or set(vocab)!=(set(prior.CONTEXT_FIELDS) if kind.endswith('_group') else set()):
            raise ValueError('Exact shape vocabulary fields required')
        for values in vocab.values():
            if (not isinstance(values,list) or not 0<len(values)<=prior.SETTINGS['max_categories_per_field']
                    or any(v is not None and (not isinstance(v,str) or not v.strip() or len(v)>128) for v in values)
                    or values!=sorted(set(values),key=lambda v:(v is not None,v or ''))):raise ValueError('Canonical group vocabulary required')
        if not isinstance(offsets,list) or len(offsets)!=sum(map(len,vocab.values())) or any(not prior._finite(v) for v in offsets):
            raise ValueError('Exact finite shape offsets required')
        optimization=model['optimization']
        if (not isinstance(optimization,dict) or set(optimization)!={'converged','iterations','objective'}
                or optimization['converged'] is not True or not prior._finite(optimization['objective'])
                or type(optimization['iterations']) is not int or not 0<=optimization['iterations']<=SETTINGS['maxiter']):
            raise ValueError('Bounded shape optimization receipt required')


def predict(model,probabilities,contexts=None):
    validate(model);p=prior._probabilities(probabilities);kind=model['kind']
    if kind=='isotonic_clipped':result=np.interp(p,model['x'],model['y'])
    elif kind=='smooth_isotonic_clipped':
        if len(model['x'])==1:result=np.full(len(p),model['y'][0])
        else:
            x=np.asarray(model['x']);q=np.clip(p,x[0],x[-1]);indices=np.clip(np.searchsorted(x,q,side='right')-1,0,len(x)-2)
            c=np.asarray(model['coefficients'])[indices];dx=q-x[indices]
            result=((c[:,0]*dx+c[:,1])*dx+c[:,2])*dx+c[:,3]
    else:
        if len(p)*2*len(SETTINGS['knots'])>SETTINGS['max_cells']:raise ValueError('Prediction resource bound exceeded')
        z=model['intercept']+_basis(p)@np.asarray(model['slopes'])
        if kind=='monotone_logit_group':
            prior._contexts(contexts,len(p));z+=prior._group_matrix(contexts,model['vocabulary'])@np.asarray(model['offsets'])
        if not np.isfinite(z).all():raise ValueError('Nonfinite piecewise logit')
        result=expit(z)
    if not np.isfinite(result).all():raise ValueError('Nonfinite shape probability')
    return np.clip(result,SETTINGS['epsilon'],1-SETTINGS['epsilon'])
