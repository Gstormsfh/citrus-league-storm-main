"""Pure, deterministic official-source manifest split planning; no model fitting.

Checks declared membership and immutable hashes, not authenticity of externally
supplied source/feature receipts. Historical observations do not imply historical
availability. No dates, exclusions, or held-out claims are inferred.
"""
from datetime import date, datetime
import json
import re

from projections.analytics_publication import fingerprint, timestamp


def _date(value):
    if not isinstance(value, str) or re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) is None:
        raise ValueError('Explicit ISO game/window dates required')
    return date.fromisoformat(value)


def _time(value):
    if not isinstance(value, str) or 'T' not in value:
        raise ValueError('Explicit timezone-qualified timestamp required')
    return datetime.fromisoformat(timestamp(value))


def _hash(value):
    if not isinstance(value, str) or re.fullmatch('[0-9a-f]{64}', value) is None:
        raise ValueError('Explicit SHA-256 digest required')
    return value


def _text(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Explicit feature/population/eligibility semantics required')
    return value


def _keys(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise ValueError('Unknown or missing manifest fields')


def _game_id(value):
    if (type(value) is not int or len(str(value)) != 10
            or not 1900 <= value // 1000000 <= 9998
            or (value // 10000) % 100 not in (2, 3) or value % 10000 == 0):
        raise ValueError('Canonical regular-season/playoff NHL game identity required')
    return value


def plan_chronological_split(manifest, windows, *, now, historical_as_of=None,
                             test_claim='retrospective', declaration=None):
    """Validate exact receipt/event membership and assign whole games by date.

    Windows have inclusive start/end ISO dates for train/calibration/test.
    Observations after game dates are allowed retrospectively, but never after
    now or an explicit historical_as_of cutoff. All eligible events must fall
    in exactly one window. Every other source event needs an exclusion reason.
    """
    manifest = json.loads(json.dumps(manifest, allow_nan=False))
    windows = json.loads(json.dumps(windows, allow_nan=False))
    declaration = json.loads(json.dumps(declaration, allow_nan=False))
    current = _time(now)
    cutoff = _time(historical_as_of) if historical_as_of is not None else current
    if cutoff > current:
        raise ValueError('Historical availability cutoff cannot be in the future')
    if test_claim not in ('retrospective', 'prospective-reservation'):
        raise ValueError('Untouched/history or evaluated-prospective claims are not supported')
    if test_claim == 'retrospective' and declaration is not None:
        raise ValueError('Retrospective plan cannot claim a prospective declaration')
    _keys(manifest, ('source', 'feature_origin', 'feature_version', 'population_version',
                     'features_sha256', 'source_receipts', 'events'))
    if manifest.get('source') != 'official-nhl' or manifest.get('feature_origin') != 'citrus-official-nhl':
        raise ValueError('Only explicit official NHL source and independent Citrus feature lineage accepted')
    feature_version = _text(manifest['feature_version'])
    population_version = _text(manifest['population_version'])
    features_sha256 = _hash(manifest['features_sha256'])
    _keys(windows, ('train', 'calibration', 'test'))
    bounds = {}
    previous_end = None
    for name in ('train', 'calibration', 'test'):
        _keys(windows[name], ('start', 'end'))
        start, end = _date(windows[name]['start']), _date(windows[name]['end'])
        if start > end or (previous_end is not None and start <= previous_end):
            raise ValueError('Windows must be strictly chronological and disjoint')
        bounds[name] = (start, end)
        previous_end = end
    receipts, inventory, games = {}, set(), {}
    if not isinstance(manifest['source_receipts'], list) or not isinstance(manifest['events'], list):
        raise ValueError('Source receipts and event membership must be explicit lists')
    for receipt in manifest['source_receipts']:
        _keys(receipt, ('sha256', 'game_id', 'game_date', 'observed_at', 'source_url', 'event_ids'))
        sha = _hash(receipt['sha256'])
        gid = _game_id(receipt['game_id'])
        game_date = _date(receipt['game_date'])
        observed = _time(receipt['observed_at'])
        if gid in games or sha in receipts:
            raise ValueError('Duplicate/ambiguous game or source receipt')
        if receipt['source_url'] != f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play':
            raise ValueError('Unknown source provenance')
        # Basic calendar consistency only: supplied gameDate is retained, not
        # derived from the game ID or mistaken for an exact puck-drop time.
        if (game_date.year not in (gid // 1000000, gid // 1000000 + 1)
                or game_date > current.date() or game_date > observed.date()
                or observed > current or observed > cutoff):
            raise ValueError('Source observation conflicts with availability/game timing')
        events = receipt['event_ids']
        if not isinstance(events, list) or not events:
            raise ValueError('Explicit nonempty receipt event inventory required')
        for eid in events:
            key = (gid, eid)
            if type(eid) is not int or eid < 0 or key in inventory:
                raise ValueError('Duplicate/invalid source event identity')
            inventory.add(key)
        receipts[sha] = receipt
        games[gid] = receipt
    if not inventory:
        raise ValueError('No source event inventory')
    members = {name: [] for name in bounds}
    exclusions, seen = [], set()
    for event in manifest['events']:
        _keys(event, ('game_id', 'event_id', 'game_date', 'source_receipt_sha256',
                      'feature_sha256', 'eligible'), ('exclusion_reason',))
        gid, eid = event['game_id'], event['event_id']
        key = (gid, eid)
        if type(gid) is not int or type(eid) is not int or key not in inventory or key in seen:
            raise ValueError('Duplicate/unbound event membership')
        seen.add(key)
        source = games[gid]
        game_date = _date(event['game_date'])
        if (event['game_date'] != source['game_date']
                or event['source_receipt_sha256'] != source['sha256']):
            raise ValueError('Conflicting game date/source identity')
        _hash(event['feature_sha256'])
        if type(event['eligible']) is not bool:
            raise ValueError('Eligibility must be explicit boolean')
        if not event['eligible']:
            _text(event.get('exclusion_reason'))
            exclusions.append(event)
            continue
        if 'exclusion_reason' in event:
            raise ValueError('Eligible event cannot also be excluded')
        assigned = [name for name, (start, end) in bounds.items() if start <= game_date <= end]
        if len(assigned) != 1:
            raise ValueError('Eligible event outside declared windows')
        members[assigned[0]].append(event)
    if seen != inventory:
        raise ValueError('Incomplete source event membership, including exclusions')
    for name in members:
        members[name].sort(key=lambda e: (e['game_date'], e['game_id'], e['event_id']))
        if not members[name] and not (name == 'test' and test_claim == 'prospective-reservation'):
            raise ValueError('Every evaluation split must contain eligible events')
    canonical_manifest = {**manifest,
        'source_receipts': sorted(receipts.values(), key=lambda r: r['game_id']),
        'events': sorted(manifest['events'], key=lambda e: (e['game_id'], e['event_id']))}
    source_manifest_sha256 = fingerprint(canonical_manifest)
    if test_claim == 'prospective-reservation':
        _keys(declaration, ('frozen_at', 'pipeline_sha256', 'criteria_sha256', 'plan_spec_sha256'))
        spec = {'windows': windows, 'feature_version': feature_version,
                'population_version': population_version, 'features_sha256': features_sha256,
                'source_manifest_sha256': source_manifest_sha256}
        # Reservation timing uses UTC calendar dates, not an inferred puck-drop.
        if (members['test'] or _time(declaration['frozen_at']) > current
                or current.date() >= bounds['test'][0]
                or declaration['plan_spec_sha256'] != fingerprint(spec)):
            raise ValueError('Prospective reservation timing/specification conflict')
        _hash(declaration['pipeline_sha256'])
        _hash(declaration['criteria_sha256'])
    exclusions.sort(key=lambda e: (e['game_date'], e['game_id'], e['event_id']))
    body = {'planner_version': 'official-nhl-chronological-manifest-v1',
            'status': 'reserved-not-evaluated' if test_claim == 'prospective-reservation' else 'planned-not-executed',
            'test_claim': test_claim, 'declaration': declaration,
            'evidence_semantics': 'manifest-consistency-only',
            'historical_as_of_verified': False,
            'now': current.isoformat(),
            'historical_as_of': cutoff.isoformat() if historical_as_of is not None else None,
            'observation_cutoff_check': 'timestamps-only' if historical_as_of is not None else None,
            'feature_version': feature_version, 'population_version': population_version,
            'features_sha256': features_sha256, 'source_manifest_sha256': source_manifest_sha256,
            'windows': windows, 'members': members, 'exclusions': exclusions,
            'membership_sha256': {name: fingerprint(rows) for name, rows in members.items()},
            'exclusions_sha256': fingerprint(exclusions)}
    return {**body, 'receipt_sha256': fingerprint(body)}
