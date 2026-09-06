"""Exact, reviewed source-revision statistical overlays; never source rewriting.

Only the pinned local approval manifest and its reviewed evidence bundle authorize
these records. Hashes establish consistency, not NHL authentication. This module
does not activate publication or amend the canonical/final-game validators.
Credited non-shot goals retain their outcome and coordinates, but are excluded
from base shot-model attempt populations: exclusion is NOT p(goal)=0.
"""
import hashlib
import json

from acquisition.event_observation_service import prepare_observation
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint


VERSION = 'citrus-exact-goal-sog-overlay-v1'
APPROVED_MANIFEST_SHA256 = 'e193ab68d55ae1f43c423df8dc07022aef4f264865af64e19c0e4a7eacc8c5a9'
APPROVED_BUNDLE_SHA256 = '43a7d5c2c17782ee5e4fe65dcf8512a46fef1248a337080f14aeeb93ea0bc864'
APPROVED_RECORD_COUNT = 32


def _detach(value):
    return json.loads(json.dumps(value, allow_nan=False))


def _sha(value):
    if not isinstance(value, bytes):
        raise ValueError('Exact frozen artifact bytes required')
    return hashlib.sha256(value).hexdigest()


def validate_approval(manifest_bytes, approved_bundle_bytes):
    """Require both exact reviewed artifacts, not a caller-declared hash alone."""
    if (_sha(manifest_bytes) != APPROVED_MANIFEST_SHA256
            or _sha(approved_bundle_bytes) != APPROVED_BUNDLE_SHA256):
        raise ValueError('Unapproved adjudication artifact revision')
    manifest, bundle = json.loads(manifest_bytes), json.loads(approved_bundle_bytes)
    if (manifest.get('contract') != 'citrus-exact-goal-sog-adjudication-manifest-v1'
            or manifest.get('approved_bundle_sha256') != APPROVED_BUNDLE_SHA256
            or bundle.get('contract') != 'citrus-goal-sog-statistical-review-v2'):
        raise ValueError('Invalid approved evidence contract')
    records, cases = manifest.get('records'), bundle.get('cases')
    if (not isinstance(records, list) or not isinstance(cases, list)
            or len(records) != APPROVED_RECORD_COUNT or len(cases) != APPROVED_RECORD_COUNT):
        raise ValueError('Incomplete approved record population')
    case_index = {(c['game_id'], c['source_snapshot_id']): c for c in cases}
    keys = [(r['game_id'], r['source_snapshot_id']) for r in records]
    if len(set(keys)) != len(keys) or set(keys) != set(case_index) or len(case_index) != len(cases):
        raise ValueError('Duplicate or unmatched approved revision')
    for record in records:
        case = case_index[(record['game_id'], record['source_snapshot_id'])]
        event = case['reviewed_event']
        if (case.get('recommendation') != 'eligible_for_explicit_versioned_event_adjudication'
                or case.get('statistical_corroboration', {}).get('status') != 'corroborated'
                or record['goal_credit'] != 1 or record['recorded_sog_contribution'] != 0
                or record['base_shot_model_attempt_eligible'] is not False
                or record['source_payload_sha256'] != case['source_payload_sha256']
                or record['prior_final_game_evidence'] != case['original_final_game_evidence']
                or any(record[k] != event[k] for k in
                       ('event_id','source_event_sha256','team_id','player_id','period','clock','sort_order'))):
            raise ValueError('Approved manifest/bundle consistency failure')
    return manifest


def _recount(payload, excluded_event_id):
    """Recount entire source including explicit shootout winner bonus.

    Caller has already revalidated complete normalization and the prior gate.
    No event is removed and no source goal is converted to a non-goal.
    """
    teams = [payload['homeTeam'], payload['awayTeam']]
    counts = {t['id']: {'goals': 0, 'sog': 0, 'shootout_goals': 0} for t in teams}
    so_attempts = 0
    for play in payload['plays']:
        if play['typeCode'] not in (505,506,507):
            continue
        code, owner = play['typeCode'], play['details']['eventOwnerTeamId']
        if play['periodDescriptor']['periodType'] == 'SO':
            so_attempts += 1
            counts[owner]['shootout_goals'] += int(code == 505)
        else:
            counts[owner]['goals'] += int(code == 505)
            counts[owner]['sog'] += int(code in (505,506) and play['eventId'] != excluded_event_id)
    bonuses = dict.fromkeys(counts, 0)
    if payload['periodDescriptor']['periodType'] == 'SO':
        home, away = [t['id'] for t in teams]
        if (payload['gameType'] != 2 or not so_attempts
                or counts[home]['shootout_goals'] == counts[away]['shootout_goals']
                or counts[home]['goals'] != counts[away]['goals']):
            raise ValueError('Invalid shootout evidence')
        bonuses[home if counts[home]['shootout_goals'] > counts[away]['shootout_goals'] else away] = 1
    elif so_attempts:
        raise ValueError('Unexpected shootout evidence')
    differences = []
    for team in teams:
        tid = team['id']
        for field, observed in [('sog', counts[tid]['sog']), ('score', counts[tid]['goals'] + bonuses[tid])]:
            if observed != team[field]:
                differences.append({'team_id':tid, 'field':field, 'observed':observed, 'reported':team[field]})
    return _detach({'status':'quarantined' if differences else 'verified',
        'reason':'adjudicated_totals_mismatch' if differences else 'verified_exact_adjudicated_totals',
        'differences':differences, 'team_counts':counts, 'shootout_score_bonus':bonuses})


def adjudicate_receipt(receipt_bytes, *, manifest_bytes, approved_bundle_bytes):
    """Return whole frozen source plus separate exact SOG/eligibility overlay.

    Invalid/incomplete receipt contracts raise; valid but unapproved revisions
    stay quarantined with no overlay. Replaying identical inputs is deterministic.
    No observation timestamp is refreshed, no DB/network/model call is made.
    """
    manifest = validate_approval(manifest_bytes, approved_bundle_bytes)
    receipt_sha256 = _sha(receipt_bytes)
    original = _detach(json.loads(receipt_bytes))
    if (not isinstance(original, dict) or original.get('status') != 'complete'
            or not isinstance(original.get('prepared'), list) or len(original['prepared']) != 3):
        raise ValueError('Complete frozen observation receipt required')
    snapshot, events, observation_set = original['prepared']
    payload = snapshot['payload']['pbp']
    expected = _detach(list(prepare_observation(payload, original['observed_at'])))
    if original['prepared'] != expected or observation_set['status'] != 'complete':
        raise ValueError('Incomplete or changed prepared observation')
    # Full source identities must be unique, including events outside the shot
    # normalizer. A shot-only deduplication cannot establish a complete receipt.
    ids = [p.get('eventId') for p in payload['plays']]
    if any(type(eid) is not int or eid < 0 for eid in ids) or len(set(ids)) != len(ids):
        raise ValueError('Missing or duplicate full-stream event identity')
    prior = _detach(verify_final_game(payload))
    base = {'contract':VERSION, 'source_receipt':original,
            'source_receipt_bytes_sha256':receipt_sha256,
            'source_snapshot_id':snapshot['id'], 'source_payload_sha256':fingerprint(payload),
            'original_final_game_evidence':prior, 'event_overlays':[],
            'adjudicated_final_game_evidence':None,
            'approved_manifest_sha256':APPROVED_MANIFEST_SHA256,
            'approved_bundle_sha256':APPROVED_BUNDLE_SHA256,
            'source_authenticity_verified':False, 'production_activated':False}
    matching = [r for r in manifest['records'] if r['game_id'] == payload['id']
                and r['source_snapshot_id'] == snapshot['id']
                and r['source_payload_sha256'] == fingerprint(payload)]
    if not matching:
        result = {**base, 'status':'quarantined', 'reason':'unapproved_source_revision'}
        return {**result, 'result_sha256':fingerprint(result)}
    if len(matching) != 1:
        raise ValueError('Ambiguous approved source revision')
    record = matching[0]
    if (prior != record['prior_final_game_evidence'] or prior['status'] != 'quarantined'
            or prior['reason'] != 'final_attempt_totals_mismatch'
            or receipt_sha256 != record['original_receipt_bytes_sha256']
            or original['observed_at'] != record['original_observed_at']):
        raise ValueError('Approved prior gate/observation conflict')
    raw = next((p for p in payload['plays'] if p['eventId'] == record['event_id']), None)
    if (raw is None or raw['typeCode'] != 505 or fingerprint(raw) != record['source_event_sha256']
            or raw['details'].get('eventOwnerTeamId') != record['team_id']
            or raw['details'].get('scoringPlayerId') != record['player_id']
            or raw['periodDescriptor'] != record['period'] or raw['timeInPeriod'] != record['clock']
            or raw.get('sortOrder') != record['sort_order']):
        raise ValueError('Approved exact event identity conflict')
    gate = _recount(payload, record['event_id'])
    if gate['status'] != 'verified':
        raise ValueError('Approved overlay does not reconcile complete final totals')
    overlay = {'game_id':payload['id'], 'source_snapshot_id':snapshot['id'],
        'event_id':record['event_id'], 'source_event_sha256':record['source_event_sha256'],
        'goal_credit':1, 'recorded_sog_contribution':0,
        'base_shot_model_attempt_eligible':False,
        'exclusion_reason':'credited_goal_without_additional_recorded_shot',
        'probability_interpretation':'no_probability_assigned', 'mechanism':record['mechanism']}
    overlay['adjudication_id'] = fingerprint({'overlay':overlay,'manifest_sha256':APPROVED_MANIFEST_SHA256})
    result = {**base, 'status':'verified_statistical_overlay', 'reason':'approved_exact_event_adjudication',
              'event_overlays':[overlay], 'adjudicated_final_game_evidence':gate}
    return {**result, 'result_sha256':fingerprint(result)}
