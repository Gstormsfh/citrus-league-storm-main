"""JSON-only numeric-tree development inference, never a serving authorization.

Exports only a freshly fitted, binary sklearn 1.5.2 HGB in memory. No pickle
reader exists. Source validation and temporal membership remain upstream gates.
The numeric branch convention was checked against the versioned upstream source:
https://github.com/scikit-learn/scikit-learn/blob/1.5.2/sklearn/ensemble/_hist_gradient_boosting/_predictor.pyx
"""
from copy import deepcopy
import math

import numpy as np
from scipy.special import expit

VERSION='citrus-json-numeric-context-model-v1'
LIMITS={'features':1024,'trees':256,'nodes_per_tree':511,'rows':1_000_000,'design_cells':32_000_000}


def _finite(value):
    return type(value) in (int,float) and math.isfinite(value)


def _names(values,limit):
    return (isinstance(values,list) and len(values)<=limit
        and all(isinstance(n,str) and 0<len(n.strip())<=128 for n in values) and len(set(values))==len(values))


def validate_design(design):
    if not isinstance(design,dict) or set(design)!={'schema','numeric_names','categorical_names','medians','vocabulary'}:
        raise ValueError('Exact portable design fields required')
    schema=design['schema']
    if (not isinstance(schema,dict) or set(schema)!={'version','names','categorical_names'}
            or not isinstance(schema['version'],str) or not schema['version'].strip()
            or not _names(schema['names'],64) or not _names(schema['categorical_names'],8)
            or set(schema['names'])&set(schema['categorical_names'])):
        raise ValueError('Bounded disjoint feature schema required')
    nums,cats=design['numeric_names'],design['categorical_names']
    if (not _names(nums,64) or not nums or not set(nums)<=set(schema['names'])
            or not _names(cats,8) or not set(cats)<=set(schema['categorical_names'])):
        raise ValueError('Explicit bounded portable feature view required')
    if (not isinstance(design['medians'],dict) or set(design['medians'])!=set(nums)
            or any(not _finite(v) for v in design['medians'].values())):
        raise ValueError('Exact finite train-only medians required')
    vocab=design['vocabulary']
    if not isinstance(vocab,dict) or set(vocab)!=set(cats):raise ValueError('Exact train vocabulary required')
    for values in vocab.values():
        if not _names(values,256) or values!=sorted(values):raise ValueError('Canonical bounded vocabulary required')
    width=2*len(nums)+sum(len(v)+2 for v in vocab.values())
    if width>LIMITS['features']:raise ValueError('Portable feature-count bound exceeded')
    return width


def design_rows(design, rows):
    """Independent train-median + missing-indicator + known/missing/unseen design."""
    width=validate_design(design)
    if (not isinstance(rows,list) or not 0<len(rows)<=LIMITS['rows']
            or len(rows)*width>LIMITS['design_cells']):raise ValueError('Portable design resource bound exceeded')
    schema=design['schema']; numeric_indices=[schema['names'].index(n) for n in design['numeric_names']]
    lookup={name:{v:i for i,v in enumerate(design['vocabulary'][name])} for name in design['categorical_names']}
    out=np.zeros((len(rows),width),dtype=float)
    for i,row in enumerate(rows):
        if (not isinstance(row,dict) or not isinstance(row.get('features'),list)
                or len(row['features'])!=len(schema['names'])
                or any(v is not None and not _finite(v) for v in row['features'])
                or not isinstance(row.get('categorical'),dict) or set(row['categorical'])!=set(schema['categorical_names'])
                or any(v is not None and (not isinstance(v,str) or not v.strip() or len(v)>128) for v in row['categorical'].values())):
            raise ValueError('Exact portable feature vector required')
        for j,index in enumerate(numeric_indices):
            value=row['features'][index]
            out[i,j]=design['medians'][design['numeric_names'][j]] if value is None else value
            out[i,j+len(numeric_indices)]=float(value is None)
        for name in ('distance_to_goal_ft','signed_angle_deg'):
            if name in design['numeric_names']:
                value=out[i,design['numeric_names'].index(name)]
                if (name=='distance_to_goal_ft' and value<0) or (name=='signed_angle_deg' and abs(value)>180):
                    raise ValueError('Invalid portable geometry')
        start=2*len(numeric_indices)
        for name in design['categorical_names']:
            value=row['categorical'][name];size=len(lookup[name])
            out[i,start+(size if value is None else lookup[name].get(value,size+1))]=1.
            start+=size+2
    return out


def export_model(fitted, design):
    """No disk/object loader: caller provides its newly fitted in-memory model."""
    import sklearn
    from sklearn.ensemble import HistGradientBoostingClassifier
    width=validate_design(design)
    if (type(fitted) is not HistGradientBoostingClassifier or sklearn.__version__!='1.5.2'
            or fitted.classes_.tolist()!=[0,1] or fitted.n_features_in_!=width
            or fitted._baseline_prediction.shape!=(1,1)
            or not 0<len(fitted._predictors)<=LIMITS['trees']):
        raise ValueError('Supported freshly fitted binary numeric HGB required')
    trees=[]
    for iteration in fitted._predictors:
        if len(iteration)!=1:raise ValueError('Binary tree iteration required')
        nodes=iteration[0].nodes
        if len(nodes)>LIMITS['nodes_per_tree'] or np.any(nodes['is_categorical']):
            raise ValueError('Bounded numeric-only tree required')
        tree=[]
        for n in nodes:
            if n['is_leaf']:tree.append({'leaf':float(n['value'])})
            else:tree.append({'feature':int(n['feature_idx']),'threshold':float(n['num_threshold']),
                'left':int(n['left']),'right':int(n['right'])})
        trees.append(tree)
    result={'contract':VERSION,'publishable':False,'source_sklearn_version':'1.5.2',
        'input_policy':'finite_design_after_explicit_imputation','branch_policy':'less_than_or_equal_left',
        'leaf_policy':'already_learning_rate_scaled','design':deepcopy(design),
        'baseline_logit':float(fitted._baseline_prediction[0,0]),'trees':trees}
    validate_model(result)
    return result


def validate_model(model):
    if (not isinstance(model,dict) or set(model)!={'contract','publishable','source_sklearn_version','input_policy',
            'branch_policy','leaf_policy','design','baseline_logit','trees'}
            or model['contract']!=VERSION or model['publishable'] is not False
            or model['source_sklearn_version']!='1.5.2'
            or model['input_policy']!='finite_design_after_explicit_imputation'
            or model['branch_policy']!='less_than_or_equal_left' or model['leaf_policy']!='already_learning_rate_scaled'
            or not _finite(model['baseline_logit'])):raise ValueError('Unsupported portable model contract')
    width=validate_design(model['design']);trees=model['trees']
    if not isinstance(trees,list) or not 0<len(trees)<=LIMITS['trees']:raise ValueError('Bounded trees required')
    for tree in trees:
        if not isinstance(tree,list) or not 0<len(tree)<=LIMITS['nodes_per_tree']:raise ValueError('Bounded tree nodes required')
        parents=[0]*len(tree)
        for i,node in enumerate(tree):
            if not isinstance(node,dict):raise ValueError('Explicit tree node required')
            if set(node)=={'leaf'}:
                if not _finite(node['leaf']):raise ValueError('Finite leaf required')
            elif set(node)=={'feature','threshold','left','right'}:
                if (type(node['feature']) is not int or not 0<=node['feature']<width
                        or not _finite(node['threshold']) or node['left']==node['right']
                        or any(type(node[k]) is not int or not i<node[k]<len(tree) for k in ('left','right'))):
                    raise ValueError('Bounded acyclic numeric split required')
                for k in ('left','right'):parents[node[k]]+=1
            else:raise ValueError('Exact numeric node fields required')
        if parents!=[0]+[1]*(len(tree)-1):raise ValueError('Every nonroot node must have exactly one parent')
    return width


def predict_design(model, matrix):
    width=validate_model(model)
    if (not isinstance(matrix,np.ndarray) or matrix.ndim!=2 or matrix.dtype.kind not in 'fi'
            or not 0<len(matrix)<=LIMITS['rows'] or matrix.shape[1]!=width
            or matrix.size>LIMITS['design_cells'] or not np.isfinite(matrix).all()):
        raise ValueError('Bounded finite numeric design required')
    logits=np.full(len(matrix),model['baseline_logit'],dtype=float)
    # Each tree contributes once per row, in fitted iteration order.
    for tree in model['trees']:
        stack=[(0,np.arange(len(matrix)))]
        while stack:
            index,rows=stack.pop();node=tree[index]
            if 'leaf' in node:logits[rows]+=node['leaf']
            else:
                left=matrix[rows,node['feature']]<=node['threshold']
                if left.any():stack.append((node['left'],rows[left]))
                if (~left).any():stack.append((node['right'],rows[~left]))
    if not np.isfinite(logits).all():raise ValueError('Nonfinite portable logit')
    return expit(logits)


def predict_rows(model, rows):
    validate_model(model)
    return predict_design(model,design_rows(model['design'],rows))
