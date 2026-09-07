"""Reconcile conservative analyst-reviewed landmarks; never auto-certify labels."""
import hashlib,json
from pathlib import Path
from projections.passing_time_alignment import reconcile,duration_bounds

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/proof/results'
OUT=BASE/'passing-landmarks-20260907'

def run():
    body=(BASE/'linked-replay-pilot-20260907/2025030416-117.json').read_bytes()
    receipt=json.loads((BASE/'linked-replay-pilot-20260907/2025030416-117.json.receipt.json').read_bytes())
    assert hashlib.sha256(body).hexdigest()==receipt['sha256']
    frames=json.loads(body)
    assert all(b['timeStamp']-a['timeStamp']==1 for a,b in zip(frames,frames[1:]))
    index=json.loads((OUT/'index.json').read_bytes())
    pts={item['file']:item['video_pts_seconds'] for item in index['frames']}
    def video_range(folder,first,last):
        return [pts[f'{folder}/frame-{first:03d}.png'],pts[f'{folder}/frame-{last:03d}.png']]
    # These deliberately broad ranges were selected by inspecting the decoded
    # broadcast contact sheets and source motion, not by optimizing agreement.
    # Replay labels are relative frame indices (contiguous source ticks).
    anchors=[
        dict(name='pass_departure',video_seconds=video_range('transfer',10,13),replay_ticks=[59,61],
             evidence_reference='transfer/frame-010.png through frame-013.png; source frames 59-61'),
        dict(name='receiver_acquisition',video_seconds=video_range('transfer',23,28),replay_ticks=[69,71],
             evidence_reference='transfer/frame-023.png through frame-028.png; source frames 69-71'),
        dict(name='shot_departure',video_seconds=video_range('shot',15,18),replay_ticks=[92,94],
             evidence_reference='shot/frame-015.png through frame-018.png; source frames 92-94')]
    alignment=reconcile(anchors,seconds_per_tick=.1)
    intervals=duration_bounds(release=anchors[0]['replay_ticks'],reception=anchors[1]['replay_ticks'],
                             shot=anchors[2]['replay_ticks'],seconds_per_tick=.1)
    video_intervals=duration_bounds(release=anchors[0]['video_seconds'],reception=anchors[1]['video_seconds'],
                                   shot=anchors[2]['video_seconds'],seconds_per_tick=1)
    result={'game':2025030416,'event':117,'reviewer':'Codex provisional visual/motion review',
            'video_sha256':index['video_sha256'],'replay_sha256':receipt['sha256'],
            'replay_tick_origin':frames[0]['timeStamp'],'anchors':anchors,
            'alignment_relative_to_first_replay_frame':alignment,
            'tracking_duration_bounds':intervals,'video_duration_bounds':video_intervals,
            'review_status':'provisional_interval_alignment',
            'independent_second_review':False,'exhaustive_pass_labels':False,
            'limitations':['Broadcast puck contact is visually small/partly occluded',
                          'Replay motion is a control proxy, not direct stick-contact measurement',
                          'Bounds reflect reviewer uncertainty, not statistical confidence',
                          'Alignment consistency does not certify the landmarks'],
            'production_eligible':False,'model_training_eligible':False}
    result['supersedes']='reconciliation.json: receiver video PTS transcription corrected from the saved index'
    with (OUT/'reconciliation-v2.json').open('x') as f:json.dump(result,f,allow_nan=False)
    print({'alignment':alignment,'tracking':intervals,'video':video_intervals})

if __name__=='__main__':run()
