"""Offline composed recent-timing inference, exact dated frozen dependencies.

Structural validation is not source authentication or production authorization.
"""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
import math
from pathlib import Path
from projections.xg_candidate_inference import XGCandidate
from projections.calibration_candidate import context_from_row
from projections.analytics_publication import fingerprint
from projections.verified_export_experiment import strict_json

VERSION='citrus-recent-timing-composed-offline-v1'
BANDS=('same_clock','up_to_1s','over_1_under_3s','from_3_to_10s')


class RecentCandidate:
    def __init__(self, base, sidecar):
        self.base=XGCandidate(base);self.schema=deepcopy(base['raw_model']['design']['schema']);s=deepcopy(sidecar)
        if (set(s)!={'contract','publishable','usage','base_fingerprint','source_health_sha256','fit'}
                or s['contract']!=VERSION or s['publishable'] is not False or s['usage']!='offline_replay_only'
                or s['base_fingerprint']!=self.base.bundle_fingerprint):raise ValueError('Exact offline base binding required')
        digest=s['source_health_sha256']
        if not isinstance(digest,str) or len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):raise ValueError('Exact source hash required')
        f=s['fit']
        if set(f)!={'month','start_inclusive','end_exclusive','bands'}:raise ValueError('Exact fit fields required')
        cutoff=date.fromisoformat(f['month']+'-01')
        if (f['end_exclusive']!=cutoff.isoformat() or f['start_inclusive']!=(cutoff-timedelta(days=90)).isoformat()
                or base['valid_from'][:7]!=f['month'] or base['valid_to'][:7]!=f['month']
                or f['end_exclusive']>base['valid_from'] or set(f['bands'])!=set(BANDS)):
            raise ValueError('Exact earlier window and replay month required')
        seen=set()
        for b in f['bands'].values():
            if set(b)!={'offset','events','games','training_keys','training_end'}:raise ValueError('Exact band fields required')
            if (type(b['offset']) not in (int,float) or not math.isfinite(b['offset']) or abs(b['offset'])>10
                    or type(b['events']) is not int or type(b['games']) is not int or not 0<=b['games']<=b['events']<=1000000
                    or not isinstance(b['training_keys'],list) or len(b['training_keys'])!=b['events']):raise ValueError('Bounded support and finite offset required')
            keys=[]
            for k in b['training_keys']:
                if not isinstance(k,list) or len(k)!=2 or any(type(v) is not int for v in k) or k[0]<=0 or k[1]<0:raise ValueError('Canonical training key required')
                key=tuple(k)
                if key in seen:raise ValueError('Training events unique across bands')
                seen.add(key);keys.append(key)
            if len({k[0] for k in keys})!=b['games']:raise ValueError('Exact game support required')
            if b['events']==0:
                if b['training_end'] is not None:raise ValueError('Empty support has no training date')
            elif not isinstance(b['training_end'],str) or not f['start_inclusive']<=b['training_end']<f['end_exclusive']:
                raise ValueError('Training must end strictly before prediction month')
            if (b['events']<30 or b['games']<10) and b['offset']!=0:raise ValueError('Sparse band must preserve baseline')
        self.fit=f;self.training_games={k[0] for k in seen};self.fingerprint=fingerprint(s)

    @classmethod
    def load(cls,base_path,base_sha,sidecar_path,sidecar_sha):
        def read(path,expected,limit):
            path=Path(path)
            if any(p.is_symlink() for p in (path,*path.parents)) or not path.is_file() or path.stat().st_size>limit:raise ValueError('Bounded regular file required')
            raw=path.read_bytes()
            if hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('File hash mismatch')
            return strict_json(raw)
        return cls(read(base_path,base_sha,64*1024*1024),read(sidecar_path,sidecar_sha,16*1024*1024))

    def predict(self,rows,*,chunk_rows=4096):
        predictions=self.base.predict(rows,chunk_rows=chunk_rows);gi=self.schema['names'].index('seconds_since_immediate_event');out=[]
        for row,prediction in zip(rows,predictions):
            if row['game_id'] in self.training_games:raise ValueError('Training game cannot be replayed as held out')
            context=context_from_row(row,self.schema);gap=row['features'][gi];band=None
            if context['prior_sog_same_team']=='1':
                if type(gap) not in (int,float) or not math.isfinite(gap) or gap<0:raise ValueError('Observed prior-SOG timing required')
                if gap<=10:band='same_clock' if gap==0 else 'up_to_1s' if gap<=1 else 'over_1_under_3s' if gap<3 else 'from_3_to_10s'
            offset=self.fit['bands'][band]['offset'] if band else 0.;baseline=prediction['neutral_xg'];p=baseline
            if offset!=0:
                q=min(1-1e-6,max(1e-6,p));z=math.log(q)-math.log1p(-q)+offset
                p=1/(1+math.exp(-z)) if z>=0 else math.exp(z)/(1+math.exp(z));p=min(1-1e-6,max(1e-6,p))
            out.append({**prediction,'baseline_neutral_xg':baseline,'neutral_xg':p,'recent_sidecar_fingerprint':self.fingerprint})
        return out
