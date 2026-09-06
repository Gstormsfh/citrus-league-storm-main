"""Offline review candidates for newly frozen source revisions, never approval.

Original JSON receipts did not retain original HTTP body bytes. Comparisons to
those receipts are explicitly semantic canonical-JSON hashes, not HTTP-byte
equality. New HTTP body hashes remain separately bound. No pins are relaxed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from acquisition.canonical_events import normalize_pbp
from acquisition.event_observation_service import prepare_observation
from acquisition.goal_sog_adjudication import adjudicate_receipt, validate_approval
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def detached(value):
    return json.loads(json.dumps(value, allow_nan=False))


def aware(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError('Aware observation time required')
    return dt.astimezone(timezone.utc)


def compare_receipt(record, old_bytes, new_receipt_path, *, now):
    """Validate raw new freeze evidence before returning a review-only candidate."""
    if sha(old_bytes) != record['original_receipt_bytes_sha256']:
        raise ValueError('Old receipt hash mismatch')
    old = json.loads(old_bytes)['prepared'][0]['payload']['pbp']
    path = Path(new_receipt_path)
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError('Symlink source path prohibited')
    raw = path.read_bytes()
    receipt = json.loads(raw)
    body_path = path.parent / receipt['body_file']
    if body_path.name != receipt['body_file'] or body_path.is_symlink():
        raise ValueError('Unsafe source body path')
    body = body_path.read_bytes()
    gid = record['game_id']
    endpoint = f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play'
    if (receipt.get('game_id') != gid or receipt.get('http_status') != 200
            or receipt.get('url') != endpoint or receipt.get('response_url') != endpoint
            or sha(body) != receipt.get('body_sha256') or len(body) != receipt.get('body_bytes')
            or not aware(receipt['requested_at']) <= aware(receipt['observed_at']) <= now):
        raise ValueError('New source provenance mismatch')
    payload = json.loads(body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-JSON constant')))
    expected = receipt['schedule_identity']
    if (payload.get('id') != gid or type(payload.get('id')) is not int
            or payload.get('gameDate') != expected['date']
            or payload.get('homeTeam', {}).get('id') != expected['home_team_id']
            or payload.get('awayTeam', {}).get('id') != expected['away_team_id']):
        raise ValueError('New schedule/source identity conflict')
    normalized = normalize_pbp(payload)
    gate = detached(verify_final_game(payload))
    if (not normalized['complete'] or normalized != receipt.get('normalization')
            or gate != receipt.get('final_game_evidence')
            or receipt.get('status') != ('verified' if gate['status'] == 'verified' else 'quarantined')
            or fingerprint(payload) != receipt.get('source_payload_sha256')):
        raise ValueError('New normalization/final evidence conflict')
    ids = [p.get('eventId') for p in payload['plays']]
    if any(type(i) is not int or i < 0 for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('Non-unique full event population')
    events = [p for p in payload['plays'] if p['eventId'] == record['event_id']]
    event = events[0] if len(events) == 1 else None
    same_payload = fingerprint(payload) == record['source_payload_sha256']
    same_event = event is not None and fingerprint(event) == record['source_event_sha256']
    old_event = next(p for p in old['plays'] if p['eventId'] == record['event_id'])
    snapshot = prepare_observation(payload, receipt['observed_at'])[0]
    if path.read_bytes() != raw or body_path.read_bytes() != body:
        raise ValueError('New source changed during review')
    return {'status': 'pending_new_revision_review_same_semantic_payload' if same_payload and same_event
            else 'unresolved_changed_source',
        'new_receipt_path':str(path), 'new_receipt_bytes_sha256':sha(raw),
        'new_body_path':str(body_path), 'new_http_body_sha256':sha(body),
        'new_observed_at':receipt['observed_at'], 'new_source_snapshot_id':snapshot['id'],
        'new_source_payload_sha256':fingerprint(payload),
        'new_source_event_sha256':fingerprint(event) if event is not None else None,
        'same_semantic_payload':same_payload, 'same_semantic_event':same_event,
        'original_http_byte_equality':'unavailable_original_http_body_not_retained',
        'changed_top_level_fields':sorted(k for k in set(old) | set(payload) if old.get(k) != payload.get(k)),
        'old_event':old_event, 'new_event':event,
        'new_original_final_gate':gate,
        'same_original_final_gate':gate == record['prior_final_game_evidence'],
        'new_revision_approved':False, 'overlay_applied':False}


def review_revisions(*, manifest_bytes, approved_bundle_bytes, original_index, new_pbp_dir, now=None):
    clock = datetime.now(timezone.utc) if now is None else now
    if clock.tzinfo is None or clock.utcoffset() is None:
        raise ValueError('Aware validation clock required')
    manifest = validate_approval(manifest_bytes, approved_bundle_bytes)
    index_path = Path(original_index)
    raw_index = index_path.read_bytes()
    index = json.loads(raw_index)
    lookup = {(c['game_id'],c['source_snapshot_id']):c for c in index['cases']}
    if len(lookup) != len(index['cases']):
        raise ValueError('Duplicate original index identity')
    results = []
    for record in manifest['records']:
        base = {'game_id':record['game_id'],'event_id':record['event_id'],
                'approved_old_source_snapshot_id':record['source_snapshot_id'],
                'approved_old_payload_sha256':record['source_payload_sha256'],
                'approved_old_event_sha256':record['source_event_sha256'],
                'new_revision_approved':False,'overlay_applied':False}
        old_path = Path(lookup[(record['game_id'],record['source_snapshot_id'])]['original_receipt_path'])
        old_bytes = old_path.read_bytes()
        # Independently replay OLD approval only. This does not approve new data.
        original = adjudicate_receipt(old_bytes, manifest_bytes=manifest_bytes, approved_bundle_bytes=approved_bundle_bytes)
        if original['status'] != 'verified_statistical_overlay':
            raise ValueError('Original approved receipt no longer replays')
        base['old_replay_result_sha256'] = original['result_sha256']
        new_path = Path(new_pbp_dir) / f"{record['game_id']}.receipt.json"
        try:
            result = compare_receipt(record, old_bytes, new_path, now=clock)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            result = {'status':'unavailable_new_revision_evidence','failure_type':type(exc).__name__,
                      'new_receipt_path':str(new_path)}
        if old_path.read_bytes() != old_bytes:
            raise ValueError('Original evidence changed during review')
        results.append({**base, **result})
    return {'contract':'citrus-goal-sog-revision-review-v1','reviewed_at':clock.isoformat(),
        'approved_manifest_sha256':sha(manifest_bytes),'approved_bundle_sha256':sha(approved_bundle_bytes),
        'original_index_sha256':sha(raw_index),'cases':results,
        'new_approved_records':0,'production_activated':False,
        'limitation':'Matching semantics permits review, never transfers approval to new timestamps/snapshots. Changed and unavailable cases are retained.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('manifest','approved-bundle','original-index','new-pbp-dir','output'):
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args()
    result = review_revisions(manifest_bytes=args.manifest.read_bytes(),
        approved_bundle_bytes=args.approved_bundle.read_bytes(), original_index=args.original_index,
        new_pbp_dir=args.new_pbp_dir)
    with args.output.open('x') as stream:
        json.dump(result, stream, sort_keys=True, indent=2, allow_nan=False)


if __name__ == '__main__':
    main()
