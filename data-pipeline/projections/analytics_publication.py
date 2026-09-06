"""Service-role publication adapter for the separately rolled-out evidence schema.

No call is made by legacy jobs until rollout. Prepare immutable rows, then publish
one event; readers only consume published batches. Retries resume identical batches.
Source data must already have passed domain-specific reconciliation.
"""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
import math
import uuid


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),allow_nan=False).encode()).hexdigest()


def timestamp(value):
    dt = datetime.fromisoformat(value.replace('Z','+00:00'))
    if dt.tzinfo is None:
        raise ValueError('Timestamp requires explicit timezone')
    return dt.astimezone(timezone.utc).isoformat()


def stable_id(kind, value):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'citrus.analytics/' + kind + '/' + fingerprint(value)))


def prepare(source, observed_at, payload, metadata, values, validation):
    if (validation.get('status') != 'passed' or not validation.get('gate_version')
            or len(validation.get('evidence_sha256','')) != 64):
        raise ValueError('Explicit passed foundation evidence is required')
    required = {'metric','variant','unit','season','game_type','population',
                'feature_version','model_version','code_revision','data_cutoff'}
    if set(metadata) != required:
        raise ValueError('Incomplete or unexpected metric lineage')
    values = sorted(values,key=lambda r:r['entity_id'])
    ids = [r['entity_id'] for r in values]
    if not ids or len(set(ids)) != len(ids) or any(type(i) is not int for i in ids):
        raise ValueError('Expected unique nonempty entity identities')
    for row in values:
        if set(row) != {'entity_id','value','availability','reason','exposure'}:
            raise ValueError('Metric row must carry availability, reason and exposure')
        v = row['value']
        if row['availability']=='available':
            if row['reason']!='verified' or type(v) not in (int,float) or not math.isfinite(v):
                raise ValueError('Available values require finite verified data')
        elif row['availability']!='unavailable' or v is not None or row['reason']=='verified' or not row['reason']:
            raise ValueError('Unavailable metrics require NULL and a reason')
    snapshot = {'source':source,'observed_at':timestamp(observed_at),'payload':payload}
    snapshot['id'] = stable_id('source',snapshot)
    meta = {**metadata,'data_cutoff':timestamp(metadata['data_cutoff'])}
    if datetime.fromisoformat(snapshot['observed_at'])>datetime.fromisoformat(meta['data_cutoff']):
        raise ValueError('Source observed after data cutoff')
    batch = {**meta,'source_snapshot_id':snapshot['id'],'expected_entities':len(ids),
             'validation':{**validation,'entity_ids':ids,'values_sha256':fingerprint(values)}}
    batch['id'] = stable_id('batch',batch)
    return json.loads(json.dumps([snapshot,batch,[{**r,'batch_id':batch['id']} for r in values]],allow_nan=False))


class AnalyticsPublisher:
    """Only accepts a service-role DB adapter; no frontend/user mutation path."""
    def __init__(self, db):
        self.db = db

    def _ensure(self, table, row):
        existing = self.db.select_exact(table,select=','.join(row),filters=[('id','eq',row['id'])],limit=1)
        if existing:
            for key,value in row.items():
                actual = existing[0][key]
                if key in ('observed_at','data_cutoff'):
                    actual = timestamp(actual)
                if actual != value:
                    raise ValueError('Immutable id conflicts with existing evidence')
        else:
            self.db.insert(table,[row])

    def publish(self, prepared):
        snapshot,batch,values = prepared
        self._ensure('analytics_source_snapshots',snapshot)
        self._ensure('analytics_metric_batches',batch)
        stored = self.db.select('analytics_metric_values',select='batch_id,entity_id,value,availability,reason,exposure',
                              filters=[('batch_id','eq',batch['id'])],order='entity_id.asc')
        expected = {r['entity_id']:r for r in values}
        for row in stored:
            if expected.get(row['entity_id']) != row:
                raise ValueError('Prepared values conflict with immutable stored values')
        present = {r['entity_id'] for r in stored}
        missing = [r for r in values if r['entity_id'] not in present]
        for offset in range(0,len(missing),500):
            self.db.insert('analytics_metric_values',missing[offset:offset+500])
        published = self.db.select_exact('analytics_publications',select='id',
                   filters=[('batch_id','eq',batch['id'])],order='id.desc',limit=1)
        if not published:
            self.db.insert('analytics_publications',[{'batch_id':batch['id'],'reason':'verified computation'}])
        return {'batch_id':batch['id'],'expected':len(values),'published':True,'replayed':bool(published)}
