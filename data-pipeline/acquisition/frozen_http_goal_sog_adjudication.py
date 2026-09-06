"""Additive exact HTTP-revision overlays, not an exporter/validator activation.

Prior approvals and pins remain unchanged. Exact body/receipt bytes, new revision
review and both generations of approval artifacts are required. Digests establish
consistency, not authenticity. All original bytes remain attached as base64, with
their unchanged receipt/prepared observation and separate statistical overlay.
"""
import base64
import hashlib
import json

from acquisition import goal_sog_adjudication as prior
from projections.analytics_publication import fingerprint
from projections.frozen_feature_source import adapt_frozen_feature_source

VERSION = 'citrus-approved-frozen-http-goal-sog-overlay-v1'
APPROVED_HTTP_MANIFEST_SHA256 = '733e340e77a69f35a017cbb719f9fc1bb2b158a8c2648c961eef16ce2aa81478'
APPROVED_REVISION_REVIEW_SHA256 = '413272be05c454d683a06c4fa75b9354c0ec116d42c6108d4f2235a54c911234'


def sha(raw):
    if type(raw) is not bytes:
        raise ValueError('Exact artifact bytes required')
    return hashlib.sha256(raw).hexdigest()


def validate_http_approval(*, http_manifest_bytes, revision_review_bytes,
                           prior_manifest_bytes, prior_bundle_bytes):
    old = prior.validate_approval(prior_manifest_bytes, prior_bundle_bytes)
    if (sha(http_manifest_bytes) != APPROVED_HTTP_MANIFEST_SHA256
            or sha(revision_review_bytes) != APPROVED_REVISION_REVIEW_SHA256):
        raise ValueError('Unapproved HTTP adjudication artifact revision')
    manifest, review = json.loads(http_manifest_bytes), json.loads(revision_review_bytes)
    if (manifest['contract'] != 'citrus-approved-frozen-http-goal-sog-manifest-v1'
            or review['contract'] != 'citrus-goal-sog-revision-review-v1'
            or manifest['revision_review_sha256'] != sha(revision_review_bytes)
            or manifest['prior_manifest_sha256'] != sha(prior_manifest_bytes)
            or manifest['prior_bundle_sha256'] != sha(prior_bundle_bytes)
            or review['approved_manifest_sha256'] != sha(prior_manifest_bytes)
            or review['approved_bundle_sha256'] != sha(prior_bundle_bytes)):
        raise ValueError('Approval generations are detached')
    old_index = {r['game_id']:r for r in old['records']}
    review_index = {r['game_id']:r for r in review['cases']}
    records = manifest['records']
    ids = [r['game_id'] for r in records]
    if (len(set(ids)) != len(ids) or set(ids) != set(old_index) or set(ids) != set(review_index)
            or len(review_index) != len(review['cases']) or len(old_index) != len(old['records'])):
        raise ValueError('Incomplete or duplicate approval population')
    for r in records:
        case, original = review_index[r['game_id']], old_index[r['game_id']]
        if (any(r[k] != case[k] for k in r)
                or case['status'] != 'pending_new_revision_review_same_semantic_payload'
                or case['same_semantic_payload'] is not True or case['same_semantic_event'] is not True
                or case['same_original_final_gate'] is not True
                or r['approved_old_source_snapshot_id'] != original['source_snapshot_id']
                or r['new_source_payload_sha256'] != original['source_payload_sha256']
                or r['new_source_event_sha256'] != original['source_event_sha256']
                or r['event_id'] != original['event_id']
                or r['new_original_final_gate'] != original['prior_final_game_evidence']):
            raise ValueError('New approval differs from exact reviewed source')
    return manifest, old_index


def adjudicate_frozen_http(body_bytes, receipt_bytes, *, http_manifest_bytes,
                          revision_review_bytes, prior_manifest_bytes, prior_bundle_bytes,
                          now=None):
    manifest, old_index = validate_http_approval(http_manifest_bytes=http_manifest_bytes,
        revision_review_bytes=revision_review_bytes, prior_manifest_bytes=prior_manifest_bytes,
        prior_bundle_bytes=prior_bundle_bytes)
    body_hash, receipt_hash = sha(body_bytes), sha(receipt_bytes)
    receipt = json.loads(receipt_bytes)
    source = adapt_frozen_feature_source(body_bytes, receipt, now=now)
    snapshot, _, observation_set = source['prepared']
    payload = snapshot['payload']['pbp']
    if observation_set['status'] != 'complete':
        raise ValueError('Complete original normalization required')
    ids = [p.get('eventId') for p in payload['plays']]
    if any(type(i) is not int or i < 0 for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('Unique complete full-stream identities required')
    original_gate = receipt['final_game_evidence']
    result = {'contract':VERSION,'source_body_sha256':body_hash,
        'source_receipt_bytes_sha256':receipt_hash,
        'source_http_body_base64':base64.b64encode(body_bytes).decode('ascii'),
        'source_receipt_base64':base64.b64encode(receipt_bytes).decode('ascii'),
        'source_observation':source,'original_final_game_evidence':original_gate,
        'adjudicated_final_game_evidence':None,'event_overlays':[],
        'approved_http_manifest_sha256':APPROVED_HTTP_MANIFEST_SHA256,
        'approved_revision_review_sha256':APPROVED_REVISION_REVIEW_SHA256,
        'prior_manifest_sha256':sha(prior_manifest_bytes),'prior_bundle_sha256':sha(prior_bundle_bytes),
        'source_authenticity_verified':False,'historical_as_of_verified':False,
        'production_activated':False,'feature_export_activated':False}
    matches = [r for r in manifest['records'] if r['game_id'] == payload['id']
        and r['new_http_body_sha256'] == body_hash and r['new_receipt_bytes_sha256'] == receipt_hash
        and r['new_source_snapshot_id'] == snapshot['id']]
    if not matches:
        result.update(status='quarantined',reason='unapproved_http_revision')
        return {**result,'result_sha256':fingerprint(result)}
    if len(matches) != 1:
        raise ValueError('Ambiguous approved HTTP revision')
    record = matches[0]; old = old_index[payload['id']]
    event = next((p for p in payload['plays'] if p['eventId'] == record['event_id']), None)
    if (fingerprint(payload) != record['new_source_payload_sha256']
            or original_gate != record['new_original_final_gate']
            or original_gate['status'] != 'quarantined'
            or original_gate['reason'] != 'final_attempt_totals_mismatch'
            or receipt['observed_at'] != record['new_observed_at']
            or event is None or fingerprint(event) != record['new_source_event_sha256']
            or event['typeCode'] != 505 or event['details']['eventOwnerTeamId'] != old['team_id']
            or event['details']['scoringPlayerId'] != old['player_id']
            or event['periodDescriptor'] != old['period'] or event['timeInPeriod'] != old['clock']
            or event.get('sortOrder') != old['sort_order']):
        raise ValueError('Approved exact HTTP event/gate conflict')
    gate = prior._recount(payload,record['event_id'])
    if gate['status'] != 'verified':
        raise ValueError('Approved overlay does not reconcile final totals')
    overlay = {'game_id':payload['id'],'event_id':record['event_id'],
        'source_snapshot_id':snapshot['id'],'source_event_sha256':record['new_source_event_sha256'],
        'goal_credit':1,'recorded_sog_contribution':0,'base_shot_model_attempt_eligible':False,
        'exclusion_reason':'credited_goal_without_additional_recorded_shot',
        'probability_interpretation':'no_probability_assigned','mechanism':old['mechanism']}
    overlay['adjudication_id'] = fingerprint({'overlay':overlay,'manifest_sha256':APPROVED_HTTP_MANIFEST_SHA256})
    result.update(status='verified_statistical_overlay',reason='approved_exact_http_event_adjudication',
                  adjudicated_final_game_evidence=gate,event_overlays=[overlay],
                  source_references={'body_path':record['new_body_path'],'receipt_path':record['new_receipt_path']})
    return {**result,'result_sha256':fingerprint(result)}
