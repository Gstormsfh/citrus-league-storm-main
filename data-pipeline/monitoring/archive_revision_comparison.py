"""Pure paired-receipt audit; neither archive age nor equality proves as-of data."""
from datetime import datetime, timezone
import json

from acquisition.event_observation_service import prepare_observation
from monitoring.archive_source_receipt import legacy_semantic_sha256, validate_archive_receipt, _aware_time
from projections.analytics_publication import fingerprint, stable_id

CONTRACT = 'official-archive-revision-comparison-v1'


def changed_paths(before, after, path=''):
    """Exact JSON Pointer differences; absent keys differ from explicit null."""
    if type(before) is not type(after):
        return [path]
    if isinstance(before, dict):
        result = []
        for key in sorted(before.keys() | after.keys()):
            child = path + '/' + key.replace('~', '~0').replace('/', '~1')
            result.extend([child] if key not in before or key not in after
                          else changed_paths(before[key], after[key], child))
        return result
    if isinstance(before, list):
        result = []
        for index in range(max(len(before), len(after))):
            child = path + '/' + str(index)
            result.extend([child] if index >= min(len(before), len(after))
                          else changed_paths(before[index], after[index], child))
        return result
    return [] if before == after else [path]


def compare_archive_revision(archive, current, *, now=None):
    """Validate both full receipts before comparing; never rewrite timestamps.

    Event hashes include original event evidence hashes. A separate typed-field
    comparison excludes those hashes so event media changes are not reported as
    changed normalized shot fields. Array payload differences use source indices;
    event comparisons align by event_id and ignore source list order.
    """
    now = datetime.now(timezone.utc) if now is None else now
    archived = validate_archive_receipt(archive, now=now)
    report = {'contract': CONTRACT, 'archive': archived,
              'current': {'status': 'rejected', 'reasons': []},
              'status': 'rejected', 'historical_as_of_verified': False,
              'corpus_coverage_verified': False}
    reasons = report['current']['reasons']
    try:
        current = json.loads(json.dumps(current, allow_nan=False))
        if not isinstance(current, dict):
            raise ValueError('not_object')
        report['current']['observed_at'] = current.get('observed_at')
        prepared = current['prepared']
        payload = prepared[0]['payload']['pbp']
        synthetic = {'game_id': current.get('game_id'), 'game_date': payload.get('gameDate'),
                     'source_url': current.get('url'), 'fetched_at': current.get('observed_at'),
                     'raw_json': payload, 'content_sha256': legacy_semantic_sha256(payload)}
        validation = validate_archive_receipt(synthetic, now=now)
        # This recomputed hash is not an independently stored current digest.
        report['current']['identity_and_payload_validation'] = validation
        if not validation['eligible']:
            reasons.append('current_source_validation_failed')
        rebuilt = prepare_observation(payload, current['observed_at'])
        if fingerprint(prepared) != fingerprint(rebuilt):
            reasons.append('prepared_receipt_mismatch')
        if current.get('status') != rebuilt[2]['status']:
            reasons.append('envelope_status_mismatch')
        report['current']['evidence_sha256'] = fingerprint(current)
        if current.get('game_id') != archived.get('game_id'):
            reasons.append('paired_game_identity_mismatch')
        if archived.get('fetched_at') and _aware_time(current['observed_at']) < _aware_time(archived['fetched_at']):
            reasons.append('current_observation_precedes_archive_fetch')
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, OverflowError):
        reasons.append('malformed_current_receipt')
        return report
    report['current']['status'] = 'verified' if not reasons else 'rejected'
    if not archived['eligible'] or reasons:
        return report
    old_payload = archive['raw_json']
    old_events = prepare_observation(old_payload, archive['fetched_at'])[0]['payload']['normalization']['events']
    new_events = rebuilt[0]['payload']['normalization']['events']
    old_map = {str(e['event_id']): e for e in old_events}
    new_map = {str(e['event_id']): e for e in new_events}
    def typed(events):
        return {key: {k: v for k, v in event.items() if k != 'source_event_sha256'}
                for key, event in events.items()}
    paths = changed_paths(old_payload, payload)
    event_paths = changed_paths(old_map, new_map)
    typed_paths = changed_paths(typed(old_map), typed(new_map))
    report.update(status='compared', game_id=archive['game_id'],
                  archive_fetched_at=archive['fetched_at'], current_observed_at=current['observed_at'],
                  payload={'archive_semantic_sha256': legacy_semantic_sha256(old_payload),
                           'current_semantic_sha256': legacy_semantic_sha256(payload),
                           'changed_paths': paths, 'equal': not paths},
                  events={'archive_sha256': fingerprint(old_map), 'current_sha256': fingerprint(new_map),
                          'archive_count': len(old_map), 'current_count': len(new_map),
                          'equal': not event_paths, 'changed_paths': event_paths,
                          'typed_fields_equal': not typed_paths, 'typed_changed_paths': typed_paths})
    binding = {'contract': CONTRACT, 'archive_evidence_sha256': archived['evidence_sha256'],
               'current_evidence_sha256': report['current']['evidence_sha256']}
    report['evidence_id'] = stable_id('archive-revision-comparison', binding)
    report['evidence_sha256'] = fingerprint(binding)
    return report
