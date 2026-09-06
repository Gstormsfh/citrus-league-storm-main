"""Append source revisions and seal exact event sets; never modify legacy scores.

Service-role background boundary. Tables must be separately rolled out. A failed
write leaves unpublished evidence, which an identical receipt can safely resume.
The database serializes sealing and event insertion against the source row.
"""
import json

from acquisition.canonical_events import normalize_pbp
from projections.analytics_publication import AnalyticsPublisher, stable_id, timestamp


def prepare_observation(payload, observed_at):
    # Detach mutable caller data before hashing or preparing inserts.
    payload = json.loads(json.dumps(payload, allow_nan=False))
    result = normalize_pbp(payload)
    snapshot = {
        'source': 'NHL official play-by-play',
        'observed_at': timestamp(observed_at),
        'payload': {'pbp': payload, 'normalization': result},
    }
    snapshot['id'] = stable_id('source', snapshot)
    events = [{**event, 'snapshot_id': snapshot['id']} for event in result['events']]
    manifest = {
        'snapshot_id': snapshot['id'], 'game_id': result['game_id'],
        'status': 'complete' if result['complete'] else 'quarantined',
        'expected_events': len(events), 'quarantined_events': len(result['quarantine']),
        'excluded_events': sum(result['excluded'].values()),
        'contract': result['contract'],
    }
    return snapshot, events, manifest


class EventObservationService:
    def __init__(self, db):
        self.db = db

    def record(self, payload, observed_at):
        snapshot, events, manifest = prepare_observation(payload, observed_at)
        AnalyticsPublisher(self.db)._ensure('analytics_source_snapshots', snapshot)
        columns = ','.join(events[0]) if events else 'snapshot_id,game_id,event_id'
        stored = self.db.select('analytics_event_observations', select=columns,
                                filters=[('snapshot_id', 'eq', snapshot['id'])], order='event_id.asc')
        expected = {row['event_id']: row for row in events}
        if any(expected.get(row['event_id']) != row for row in stored):
            raise ValueError('Existing observation conflicts with frozen source revision')
        present = {row['event_id'] for row in stored}
        missing = [row for row in events if row['event_id'] not in present]
        for offset in range(0, len(missing), 500):
            self.db.insert('analytics_event_observations', missing[offset:offset + 500])
        sealed = self.db.select_exact('analytics_event_observation_sets', select=','.join(manifest),
                                      filters=[('snapshot_id', 'eq', snapshot['id'])], limit=1)
        if sealed and sealed[0] != manifest:
            raise ValueError('Existing observation manifest conflicts with frozen revision')
        if not sealed:
            self.db.insert('analytics_event_observation_sets', [manifest])
        return {**manifest, 'replayed': bool(sealed)}
