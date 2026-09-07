"""Provisional visual alignment hypothesis, never automatically approved labels."""
import hashlib
import json
from pathlib import Path
from projections.passing_time_alignment import reconcile, assess_video_coverage

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/proof/results'


def run():
    out=BASE/'knies-alignment-review-20260907'
    index=json.loads((out/'index.json').read_bytes())
    for f in index['frames']:
        assert hashlib.sha256((out/f['file']).read_bytes()).hexdigest()==f['sha256']
    pts=[f['video_pts_seconds'] for f in index['frames']]
    source=BASE/'tracked-comotion-unseen-20260907/2025020061-271.json'
    receipt=json.loads(source.with_suffix('.receipt.json').read_bytes())
    assert hashlib.sha256(source.read_bytes()).hexdigest()==receipt['sha256']
    # Coarse visual hypotheses from original-PTS stills and replay puck path.
    # These are deliberately intervals, not exact contact labels.
    anchors=[dict(name='point_pass_departure',video_seconds=[pts[0],pts[1]],replay_ticks=[64,68],
                  evidence_reference='frame-001.png..002.png; puck turns away from TOR95 in replay ticks64..68'),
             dict(name='wing_acquisition',video_seconds=[pts[1],pts[2]],replay_ticks=[69,73],
                  evidence_reference='frame-002.png..003.png; puck approaches TOR88 in replay ticks69..73'),
             dict(name='shot_departure',video_seconds=[pts[5],pts[6]],replay_ticks=[91,95],
                  evidence_reference='frame-006.png..007.png; puck rapidly heads toward crease in replay ticks91..95')]
    alignment=reconcile(anchors,seconds_per_tick=.1)
    live=[dict(video_seconds=[pts[0],pts[9]],normal_speed=True,
               evidence_reference='frame-001.png..010.png show continuous live angle; frame-011.png is celebration close-up')]
    coverage=None
    if alignment['consistent']:
        coverage=assess_video_coverage(replay_ticks=[126,128],offset_seconds=alignment['video_minus_replay_seconds'],
                                      seconds_per_tick=.1,segments=live)
    result=dict(review_status='single_reviewer_provisional_hypothesis',reviewer='Codex',
        model_suggestions_seen=True,independent_second_review=False,
        source_sha256=receipt['sha256'],video_sha256=index['video_sha256'],anchors=anchors,
        alignment=alignment,reviewed_live_segments=live,
        live_to_closeup_cut_interval=[pts[9],pts[10]],target_goalie_window_coverage=coverage,
        training_eligible=False,production_eligible=False,
        limitations=['Coarse sampling and small puck limit contact certainty',
                    'Consistency does not verify landmarks or identity',
                    'Goalie-window exclusion is conditional on this provisional alignment'])
    with (out/'coverage-review.json').open('x') as f:json.dump(result,f,indent=2)
    print(json.dumps(dict(alignment=alignment,coverage=coverage)))


if __name__=='__main__':run()
