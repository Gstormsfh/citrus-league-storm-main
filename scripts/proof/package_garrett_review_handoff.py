"""Preserve submitted observations separately from subsequent reviewer qualifications."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
from projections.possession_review_import import validate_export


def main():
    source = ROOT/'scripts/proof/results/body-possession-review-20260907/garrett-batch-one-import-20260907'
    out = ROOT/'docs/citrus-review-handoff-20260907'
    out.mkdir(exist_ok=False)
    original = (source/'original-export.json').read_bytes()
    manifest_raw = (source/'manifest.json').read_bytes()
    manifest = json.loads(manifest_raw)
    validated = validate_export(manifest, json.loads(original))
    qualifications = []
    for row in validated['observations']:
        hall = row['frame_file'].startswith('hall/')
        ambiguous = row['frame_file'] == 'hall/transfer/frame-024.png'
        qualifications.append(dict(frame_file=row['frame_file'],
            submitted_state=row['state'], submitted_player_id=row['player_id'],
            identity_status='unverified_reviewer_reported_guess' if hall and row['state']=='controlled'
                else 'reviewer_identified_not_independently_verified' if row['state']=='controlled' else 'not_applicable',
            control_status='ambiguous_nonvisibility_is_not_no_control' if ambiguous else 'single_reviewer_observation',
            usable_as_actor_training_label=False, adjudicated=False))
    missing = [dict(clip=c['name'], frame_file=c['directory']+'/'+f['file'], video_seconds=f['video_pts_seconds'])
        for c in manifest['clips'] for f in c['frames']
        if not any(r['frame_file']==c['directory']+'/'+f['file'] for r in validated['observations'])]
    (out/'original-export.json').write_bytes(original)
    (out/'manifest.json').write_bytes(manifest_raw)
    report = dict(summary=validated['summary'], qualifications=qualifications, missing=missing,
        clarification='Garrett reported he could not rewatch Carolina and did not know player identities; he could watch Toronto and identify players.',
        clarification_source='User clarification in this conversation after export; not an independent second review',
        original_sha256=hashlib.sha256(original).hexdigest(), manifest_sha256=hashlib.sha256(manifest_raw).hexdigest(),
        training_eligible=False, production_eligible=False,
        media_location='scripts/proof/results/body-possession-review-20260907/garrett-batch-one (local only)')
    (out/'qualified-review.json').write_text(json.dumps(report, indent=2))
    assert (out/'original-export.json').read_bytes() == original
    print(json.dumps(report['summary']))


if __name__ == '__main__':
    main()
