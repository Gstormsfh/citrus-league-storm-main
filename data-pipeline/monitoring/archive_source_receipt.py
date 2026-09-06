"""Read-only verification of official archived PBP receipt rows.

The legacy content hash describes Python's sorted-key JSON serialization, not
HTTP bytes. A matching hash is integrity evidence for this archived object; it
does not authenticate who fetched it or prove historical-as-of availability.
Normalization completeness and final-game totals are independently reported.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
import hashlib
import json
import re

from acquisition.canonical_events import normalize_pbp
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint, stable_id


CONTRACT = 'official-archive-source-receipt-v1'
HASH_CONTRACT = 'legacy-python-json-sort-keys-default-v1'


def legacy_semantic_sha256(payload):
    """Match fetch_pbp._sha256_of, but reject non-JSON NaN/infinity values."""
    return hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode('utf-8')).hexdigest()


def _aware_time(value):
    if not isinstance(value, str):
        raise ValueError('Expected timestamp string')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError('Expected explicit timezone')
    return result.astimezone(timezone.utc)


def _calendar_date(value):
    if not isinstance(value, str) or re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) is None:
        raise ValueError('Expected ISO calendar date')
    return date.fromisoformat(value)


def validate_archive_receipt(row, *, now=None):
    """Return separate provenance, normalization and final-game assessments.

    ``now`` is an aware datetime used only to assess future timestamps. It never
    replaces the archived fetched_at and never changes the content identity.
    No files, databases or network are accessed by this function.
    """
    now = datetime.now(timezone.utc) if now is None else now
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('Validation clock must be timezone-aware')
    report = {'contract': CONTRACT, 'hash_contract': HASH_CONTRACT,
              'hash_representation': 'semantic-json-not-http-bytes',
              'historical_as_of_verified': False, 'corpus_coverage_verified': False,
              'provenance': {'status': 'rejected', 'reasons': []},
              'normalization': {'status': 'unavailable', 'reason': 'invalid_archive_payload'},
              'final_game': {'status': 'unavailable', 'reason': 'invalid_archive_payload'},
              'eligible': False}
    reasons = report['provenance']['reasons']
    if not isinstance(row, dict):
        reasons.append('archive_row_not_object')
        return report
    # Detach caller-owned data; reject non-JSON representations rather than
    # allowing NaN or a mutable alias into the content-addressed evidence.
    try:
        frozen = json.loads(json.dumps(row, allow_nan=False))
        binding = {'contract': CONTRACT, 'archive_row': frozen}
        report['evidence_sha256'] = fingerprint(binding)
        report['evidence_id'] = stable_id('archive-source-receipt', binding)
    except (TypeError, ValueError, OverflowError):
        reasons.append('archive_row_not_strict_json')
        return report
    gid = frozen.get('game_id')
    report['game_id'] = gid
    report['fetched_at'] = frozen.get('fetched_at')  # Preserve original archive metadata.
    identity_valid = (type(gid) is int and gid > 0 and len(str(gid)) == 10
                      and gid % 10000 > 0 and (gid // 10000) % 100 in (2, 3))
    if not identity_valid:
        reasons.append('invalid_canonical_game_identity')
    expected_url = f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play'
    if not identity_valid or frozen.get('source_url') != expected_url:
        reasons.append('official_endpoint_mismatch')
    try:
        fetched = _aware_time(frozen.get('fetched_at'))
        report['fetched_at_utc'] = fetched.isoformat()
        if fetched > now:
            reasons.append('fetched_at_in_future')
    except (ValueError, TypeError, OverflowError):
        reasons.append('invalid_or_naive_fetched_at')
    try:
        game_date = _calendar_date(frozen.get('game_date'))
        if identity_valid and game_date.year not in (gid // 1000000, gid // 1000000 + 1):
            reasons.append('game_date_outside_season_years')
    except ValueError:
        reasons.append('invalid_archive_game_date')
    payload = frozen.get('raw_json')
    if not isinstance(payload, dict):
        reasons.append('missing_or_corrupt_raw_payload')
        return report
    stored_hash = frozen.get('content_sha256')
    computed_hash = legacy_semantic_sha256(payload)
    report['recomputed_content_sha256'] = computed_hash
    if (not isinstance(stored_hash, str) or re.fullmatch('[0-9a-f]{64}', stored_hash) is None
            or stored_hash != computed_hash):
        reasons.append('legacy_semantic_hash_mismatch')
    if (not identity_valid or type(payload.get('id')) is not int or payload.get('id') != gid
            or type(payload.get('season')) is not int
            or payload.get('season') != (gid // 1000000) * 10000 + gid // 1000000 + 1
            or type(payload.get('gameType')) is not int or payload.get('gameType') != (gid // 10000) % 100):
        reasons.append('raw_game_season_type_conflict')
    try:
        _calendar_date(payload.get('gameDate'))
        if payload['gameDate'] != frozen.get('game_date'):
            reasons.append('raw_game_date_conflict')
    except ValueError:
        reasons.append('missing_or_invalid_raw_game_date')
    report['provenance']['status'] = 'verified' if not reasons else 'rejected'
    try:
        normalized = normalize_pbp(payload)
        report['normalization'] = {
            'status': 'complete' if normalized['complete'] else 'quarantined',
            'contract': normalized['contract'], 'input_events': normalized['input_events'],
            'normalized_events': len(normalized['events']),
            'quarantined_events': len(normalized['quarantine']),
            'quarantine_reasons': sorted({item['reason'] for item in normalized['quarantine']}),
            'excluded_events': normalized['excluded'],
            'normalization_sha256': fingerprint(normalized),
            'scope': 'recorded_payload_only',
        }
    except (ValueError, TypeError, AttributeError, KeyError) as exc:
        report['normalization'] = {'status': 'unavailable', 'reason': 'normalization_rejected', 'detail': str(exc)}
    report['final_game'] = verify_final_game(payload)
    report['eligible'] = (not reasons and report['normalization']['status'] == 'complete'
                          and report['final_game']['status'] == 'verified')
    return report
