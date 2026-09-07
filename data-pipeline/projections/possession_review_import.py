"""Import video-only human observations; never promote them to training labels."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path


def validate_export(manifest, export):
    if export.get('schema_version') != 1 or export.get('pack_id') != manifest['pack_id']:
        raise ValueError('Export schema or frozen pack mismatch')
    if export.get('training_eligible') is not False or export.get('production_eligible') is not False:
        raise ValueError('Video observations cannot authorize training or production')
    expected = {}
    for clip in manifest['clips']:
        for frame in clip['frames']:
            key = (clip['game_id'], clip['event_id'], clip['directory']+'/'+frame['file'])
            if key in expected:
                raise ValueError('Duplicate manifest sample')
            expected[key] = (clip, frame)
    observations = export.get('observations')
    if not isinstance(observations, list):
        raise ValueError('Observations must be a list')
    seen = set()
    normalized = []
    for row in observations:
        key = (row.get('game_id'), row.get('event_id'), row.get('frame_file'))
        if key not in expected:
            raise ValueError('Unknown sample')
        clip, frame = expected[key]
        timestamp = row.get('video_seconds')
        if (type(timestamp) not in (int, float) or not math.isfinite(timestamp)
                or timestamp != frame['video_pts_seconds']
                or row.get('frame_sha256') != frame['sha256']
                or row.get('video_sha256') != clip['video_sha256']):
            raise ValueError('Sample provenance mismatch')
        reviewer = row.get('reviewer')
        note = row.get('evidence_note')
        if not isinstance(reviewer, str) or not reviewer.strip() or not isinstance(note, str) or not note.strip():
            raise ValueError('Reviewer and evidence note required')
        unique = (reviewer.strip().casefold(), key)
        if unique in seen:
            raise ValueError('Duplicate reviewer/sample; resolve conflict explicitly')
        seen.add(unique)
        state = row.get('state')
        if state not in ('controlled', 'controlled_unidentified', 'no_control', 'uncertain', 'not_play'):
            raise ValueError('Unknown control state')
        player = row.get('player_id')
        if state == 'controlled':
            if type(player) is not int or player not in {p['player_id'] for p in clip['players']}:
                raise ValueError('Controller must belong to source roster')
        elif player is not None:
            raise ValueError('Non-controlled state cannot assign an owner')
        if (row.get('model_suggestion_shown') is not False
                or row.get('review_status') != 'single_reviewer_unadjudicated'
                or row.get('training_eligible') is not False):
            raise ValueError('Expected blind, unadjudicated observation')
        # Explicit allowlist: never carry injected replay-frame/target/approval fields.
        normalized.append({field: row[field] for field in (
            'game_id', 'event_id', 'video_sha256', 'frame_sha256', 'video_seconds',
            'frame_file', 'reviewer', 'state', 'player_id', 'evidence_note',
            'model_suggestion_shown', 'review_status', 'training_eligible')})
    reviewed = {(r['game_id'], r['event_id'], r['frame_file']) for r in normalized}
    return dict(pack_id=manifest['pack_id'], observations=normalized,
                summary=dict(expected_samples=len(expected), reviewed_samples=len(reviewed),
                             remaining_samples=len(expected)-len(reviewed),
                             states=dict(Counter(r['state'] for r in normalized))),
                alignment_status='unverified', training_eligible=False, production_eligible=False)


def import_file(manifest_path, export_path, output):
    raw = Path(export_path).read_bytes()
    manifest_raw = Path(manifest_path).read_bytes()
    result = validate_export(json.loads(manifest_raw), json.loads(raw))
    result['export_sha256'] = hashlib.sha256(raw).hexdigest()
    result['manifest_sha256'] = hashlib.sha256(manifest_raw).hexdigest()
    output = Path(output)
    output.mkdir()  # Create-only: preserve earlier reviews and the exact raw export.
    (output/'original-export.json').write_bytes(raw)
    (output/'manifest.json').write_bytes(manifest_raw)
    (output/'observations.json').write_text(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('export', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(json.dumps(import_file(args.manifest, args.export, args.output)['summary']))
