"""Fixed neutral strength specialists; fresh fitting only, never artifact loading.

Count advantage is NOT adjudicated power play. No actor identity enters design.
The caller authenticates source replay; this module checks fit membership.
"""
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import pickle
import re

import numpy as np
from scipy.special import expit
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits

from projections import development_experiment as development
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests, _fit_logistic

VERSION = 'citrus-neutral-strength-partition-v1'
SETTINGS = {'train_min_events':2000, 'train_min_goals':100, 'train_min_nongoals':100,
            'train_min_games':30, 'calibration_min_events':500,
            'calibration_min_goals':20, 'calibration_min_nongoals':20,
            'calibration_min_games':10,
            'fallback':'pooled-raw-and-pooled-sigmoid', 'epsilon':1e-6}
STATES = ('equal_goalies_present', 'advantage_goalies_present',
          'disadvantage_goalies_present', 'defending_empty_net')


def state(row, schema):
    values = dict(zip(schema['names'], row['features']))
    names = ('shooting_skaters','defending_skaters','shooting_empty_net','defending_empty_net')
    a,b,own,en = (values[n] for n in names)
    if any(v is None for v in (a,b,own,en)): return 'pooled_unknown'
    if (any(type(v) not in (int,float) or not np.isfinite(v) for v in (a,b,own,en))
            or a != int(a) or b != int(b) or not 3 <= a <= 6 or not 3 <= b <= 6
            or own not in (0,1) or en not in (0,1)
            or a + (1-own)>6 or b+(1-en)>6): return 'pooled_unknown'
    if own: return 'pooled_shooting_empty_net'
    if en: return 'defending_empty_net'
    return ('equal_goalies_present' if a==b else 'advantage_goalies_present' if a>b
            else 'disadvantage_goalies_present')


def support(rows, phase):
    counts={'events':len(rows),'goals':sum(int(r['label']) for r in rows),
            'games':len({r['game_id'] for r in rows})}
    counts['nongoals']=counts['events']-counts['goals']
    return counts, all(counts[k]>=SETTINGS[phase+'_min_'+k] for k in counts)


def apply_map(p, mapping):
    p=np.asarray(p,dtype=float)
    z=np.log(np.clip(p,mapping['epsilon'],1-mapping['epsilon']))-np.log1p(-np.clip(p,mapping['epsilon'],1-mapping['epsilon']))
    return expit(mapping['intercept']+mapping['slope']*z)


def _map(p, labels, config):
    epsilon=SETTINGS['epsilon'];p=np.clip(p,epsilon,1-epsilon)
    if np.ptp(p)==0:
        rate=float(np.mean(labels));slope=0.;intercept=float(np.log(rate)-np.log1p(-rate))
    else:
        model=_fit_logistic((np.log(p)-np.log1p(-p)).reshape(-1,1),np.asarray(labels),
             {**config['logistic'],'C':config['sigmoid']['C'],'random_state':config['seed']})
        slope=float(model.coef_[0,0]);intercept=float(model.intercept_[0])
    return {'slope':slope,'intercept':intercept,'epsilon':epsilon}


@dataclass
class Fitted:
    schema: dict
    config: dict
    medians: object
    vocabulary: dict
    models: dict
    maps: dict
    receipt: dict

    def predict(self, rows):
        x=development._design(rows,self.schema,self.medians,self.vocabulary,self.config)['enhanced_context']
        with threadpool_limits(limits=1):
            pooled=self.models['pooled'].predict_proba(x)[:,1]
            result={'pooled_raw':pooled,'pooled_sigmoid':apply_map(pooled,self.maps['pooled']),
                    'partition_raw':pooled.copy(),'partition_sigmoid':apply_map(pooled,self.maps['pooled'])}
            states=[state(r,self.schema) for r in rows]
            for name, model in self.models.items():
                if name=='pooled': continue
                mask=np.asarray([s==name for s in states])
                if mask.any():
                    p=model.predict_proba(x[mask])[:,1]
                    result['partition_raw'][mask]=p
                    result['partition_sigmoid'][mask]=apply_map(p,self.maps[name])
        return result


def fit_candidate(train, calibration, schema, config):
    schema,config=deepcopy((schema,config))
    development.validate_configuration(schema,config)
    ids=set(); game_dates={}
    for name,cohort in [('train',train),('calibration',calibration)]:
        if cohort['split']!=name or any(cohort.get(k)!=v for k,v in cohort_digests(cohort['rows']).items()):
            raise ValueError('Exact fit cohort hashes required')
        for r in cohort['rows']:
            key=r['game_id'],r['event_id']
            if (key in ids or r['split']!=name or not cohort['window']['start']<=r['game_date']<=cohort['window']['end']
                    or r['game_date']>=development.CUTOFF or len(r['features'])!=len(schema['names'])
                    or type(r['label']) not in (bool,int) or r['label'] not in (0,1)):
                raise ValueError('Invalid fit event or late membership')
            ids.add(key)
            if (r['game_id'] in game_dates and game_dates[r['game_id']]!=r['game_date']):
                raise ValueError('One date per whole game required')
            game_dates[r['game_id']]=r['game_date']
            if r['feature_sha256']!=fingerprint({'schema_sha256':fingerprint(schema),
                    'values':r['features'],'categorical':r['categorical']}):
                raise ValueError('Detached feature digest')
            if (any(v is not None and (type(v) not in (int,float) or not np.isfinite(v)) for v in r['features'])
                    or set(r['categorical'])!=set(schema['categorical_names'])
                    or any(v is not None and (not isinstance(v,str) or not v.strip()) for v in r['categorical'].values())
                    or not isinstance(r['source_sha256'],str) or re.fullmatch('[0-9a-f]{64}',r['source_sha256']) is None):
                raise ValueError('Strict numeric/category/source values required')
        if len({r['label'] for r in cohort['rows']})!=2: raise ValueError('Both classes required')
    tr,ca=train['rows'],calibration['rows']
    if (max(r['game_date'] for r in tr)>=min(r['game_date'] for r in ca)
            or {r['game_id'] for r in tr}&{r['game_id'] for r in ca}):
        raise ValueError('Whole-game chronological separation required')
    vocab,bound=development._vocabulary_and_design_bound({'train':tr,'calibration':ca,'validation':[]},schema,config)
    x=development._numeric(tr,schema)
    if np.isnan(x).all(axis=0).any(): raise ValueError('All-missing training feature')
    medians=np.nanmedian(x,axis=0)
    designs={n:development._design(r,schema,medians,vocab,config)['enhanced_context'] for n,r in [('train',tr),('calibration',ca)]}
    labels={n:np.asarray([int(r['label']) for r in rows]) for n,rows in [('train',tr),('calibration',ca)]}
    models={};maps={};decisions={}
    with threadpool_limits(limits=1):
        models['pooled']=HistGradientBoostingClassifier(**config['context'],random_state=config['seed']).fit(designs['train'],labels['train'])
        maps['pooled']=_map(models['pooled'].predict_proba(designs['calibration'])[:,1],labels['calibration'],config)
        for name in STATES:
            tm=np.asarray([state(r,schema)==name for r in tr]);cm=np.asarray([state(r,schema)==name for r in ca])
            tc,tok=support([r for r,m in zip(tr,tm) if m],'train')
            cc,cok=support([r for r,m in zip(ca,cm) if m],'calibration')
            decisions[name]={'train':tc,'calibration':cc,'status':'specialist' if tok and cok else 'pooled_fallback'}
            if tok and cok:
                models[name]=HistGradientBoostingClassifier(**config['context'],random_state=config['seed']).fit(designs['train'][tm],labels['train'][tm])
                maps[name]=_map(models[name].predict_proba(designs['calibration'][cm])[:,1],labels['calibration'][cm],config)
    receipt={'contract':VERSION,'settings':deepcopy(SETTINGS),'schema_sha256':fingerprint(schema),
             'config_sha256':fingerprint(config),'train':{k:v for k,v in train.items() if k!='rows'},
             'calibration':{k:v for k,v in calibration.items() if k!='rows'},'decisions':decisions,
             'design_bound':bound,'maps':deepcopy(maps),'raw_model_sha256':{
                 n:hashlib.sha256(pickle.dumps(m,protocol=5)).hexdigest() for n,m in models.items()},
             'train_medians':medians.tolist(),'vocabulary':deepcopy(vocab),'publishable':False}
    return Fitted(schema,config,medians,vocab,models,maps,receipt)
