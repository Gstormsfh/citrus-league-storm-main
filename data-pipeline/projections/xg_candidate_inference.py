"""Composed JSON-only neutral xG inference for bounded offline replay.

One feature vector supplies both the tree model and calibration context. This
module does not authorize publication or substitute xG for official actuals.
"""
from copy import deepcopy
from datetime import date
import hashlib
import math
from pathlib import Path

from projections import portable_context_model as portable
from projections import conditional_calibration_shape as conditional
from projections.calibration_candidate import context_from_row, CONTEXT_FIELDS
from projections.analytics_publication import fingerprint
from projections.verified_export_experiment import strict_json

VERSION = 'citrus-composed-neutral-xg-replay-v1'
MAP_VERSION = 'citrus-timing-conditional-calibration-ridge10-v1'
BANDS = ['same_clock', 'up_to_1s', 'over_1_under_3s', 'from_3_to_10s']


def day(value):
    if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
        raise ValueError('Canonical date required')
    return value


def calibrate(model, probabilities, contexts, gaps):
    """Scalar logit arithmetic; timing adjustment precedes final clipping."""
    if not len(probabilities) == len(contexts) == len(gaps): raise ValueError('Exact calibration membership required')
    s = model['settings']; logit = lambda p: math.log(p)-math.log1p(-p)
    knots = [logit(p) for p in s['knots']]; reference = logit(s['reference_probability']); result = []
    for p, context, gap in zip(probabilities, contexts, gaps):
        if isinstance(p, bool) or not math.isfinite(float(p)) or not 0 <= p <= 1: raise ValueError('Finite probability required')
        state = context['prior_sog_same_team']
        if gap is not None and (type(gap) not in (int,float) or not math.isfinite(gap) or gap < 0):
            raise ValueError('Finite nonnegative recorded gap required')
        if state == '1' and gap is None: raise ValueError('Prior-SOG timing must be observed')
        x = logit(min(1-s['epsilon'], max(s['epsilon'], float(p))))
        slopes = model['context_slopes'][model['states'].index(state)] if state in model['states'] else model['shared_slopes']
        z = model['intercept']
        for slope, left, right in zip(slopes, knots, knots[1:]):
            z += slope*(min(right-left,max(0.,x-left))-min(right-left,max(0.,reference-left)))
        offset = 0
        for field in CONTEXT_FIELDS:
            vocabulary = model['vocabulary'][field]
            if context[field] in vocabulary: z += model['offsets'][offset+vocabulary.index(context[field])]
            offset += len(vocabulary)
        if state == '1' and gap <= 10:
            band = BANDS[0] if gap == 0 else BANDS[1] if gap <= 1 else BANDS[2] if gap < 3 else BANDS[3]
            if band in model['timing_categories']: z += model['timing_offsets'][model['timing_categories'].index(band)]
        if not math.isfinite(z): raise ValueError('Nonfinite calibrated logit')
        probability = 1/(1+math.exp(-z)) if z >= 0 else math.exp(z)/(1+math.exp(z))
        result.append(min(1-s['epsilon'], max(s['epsilon'], probability)))
    return result


class XGCandidate:
    def __init__(self, bundle):
        b = deepcopy(bundle)
        if (not isinstance(b,dict) or set(b) != {'contract','publishable','usage','raw_model','calibrator','schema_sha256','train_through','valid_from','valid_to','source_health_sha256'}
                or b['contract'] != VERSION or b['publishable'] is not False or b['usage'] != 'offline_replay_only'):
            raise ValueError('Exact nonpublishing bundle contract required')
        portable.validate_model(b['raw_model'])
        schema = b['raw_model']['design']['schema']
        if (fingerprint(schema) != b['schema_sha256'] or b['raw_model']['design']['numeric_names'] != schema['names']
                or b['raw_model']['design']['categorical_names'] != schema['categorical_names']
                or not {'seconds_since_immediate_event','immediate_previous_sog_same_team','shooting_skaters','defending_skaters'} <= set(schema['names'])):
            raise ValueError('Complete declared feature view required')
        m = b['calibrator']; base = {k:v for k,v in m.items() if k not in ('timing_categories','timing_offsets','timing_ridge')}
        if m.get('contract') != MAP_VERSION or type(m.get('timing_ridge')) not in (int,float) or m['timing_ridge'] != 10:
            raise ValueError('Exact ridge10 map required')
        base['contract'] = conditional.VERSION; conditional.validate(base)
        bands = m.get('timing_categories'); offsets = m.get('timing_offsets')
        if (not isinstance(bands,list) or bands != [x for x in BANDS if x in bands]
                or not isinstance(offsets,list) or len(offsets) != len(bands)
                or any(type(v) not in (int,float) or not math.isfinite(v) for v in offsets)
                or bands and '1' not in m['states']): raise ValueError('Exact supported timing coefficients required')
        if not day(b['train_through']) < day(b['valid_from']) <= day(b['valid_to']): raise ValueError('Strictly earlier fit and bounded replay window required')
        digest = b['source_health_sha256']
        if not isinstance(digest,str) or len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest): raise ValueError('Source health hash required')
        self._bundle = b; self.bundle_fingerprint = fingerprint(b)

    @classmethod
    def load(cls, path, expected_sha256):
        path = Path(path)
        if any(p.is_symlink() for p in (path,*path.parents)): raise ValueError('Regular nonsymlink bundle required')
        if not path.is_file() or path.stat().st_size > 64*1024*1024: raise ValueError('Bounded regular bundle required')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected_sha256: raise ValueError('Bundle file hash mismatch')
        return cls(strict_json(raw))

    def predict(self, rows, *, chunk_rows=4096):
        if not isinstance(rows,list) or not 0 < len(rows) <= 1_000_000 or type(chunk_rows) is not int or not 0 < chunk_rows <= 4096:
            raise ValueError('Bounded rows and chunks required')
        b = self._bundle; schema = b['raw_model']['design']['schema']; seen = set(); result = []
        gap_index = schema['names'].index('seconds_since_immediate_event')
        for start in range(0,len(rows),chunk_rows):
            batch = rows[start:start+chunk_rows]; contexts = []; gaps = []
            for r in batch:
                key = r['game_id'],r['event_id']
                if any(type(v) is not int for v in key) or key[0] <= 0 or key[1] < 0 or key in seen: raise ValueError('Unique event identity required')
                seen.add(key)
                if not b['valid_from'] <= day(r['game_date']) <= b['valid_to']: raise ValueError('Outside certified replay window')
                if r.get('feature_sha256') != fingerprint({'schema_sha256':b['schema_sha256'],'values':r['features'],'categorical':r['categorical']}):
                    raise ValueError('Feature-schema hash mismatch')
                contexts.append(context_from_row(r,schema)); gaps.append(r['features'][gap_index])
            raw = portable.predict_rows(b['raw_model'],batch)
            calibrated = calibrate(b['calibrator'],raw,contexts,gaps)
            result.extend({'game_id':r['game_id'],'event_id':r['event_id'],'raw_xg':float(p),'neutral_xg':q,
                'bundle_fingerprint':self.bundle_fingerprint,'publishable':False} for r,p,q in zip(batch,raw,calibrated))
        return result
