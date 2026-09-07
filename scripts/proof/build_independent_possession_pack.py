"""Frozen video-only reviewer pack: no model predictions or inferred owners."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'scripts/proof/results'


def run():
    parser=argparse.ArgumentParser();parser.add_argument('output',type=Path)
    parser.add_argument('--samples-per-clip',type=int)
    args=parser.parse_args()
    if args.samples_per_clip is not None and args.samples_per_clip<2:
        raise ValueError('At least two evenly spaced samples per clip required')
    specs=[('Hall',2025030416,117,BASE/'passing-landmarks-20260907',BASE/'passing-video-review-20260907/highlight.mp4'),
           ('Knies',2025020061,271,BASE/'knies-alignment-review-20260907',BASE/'knies-alignment-review-20260907/highlight.mp4')]
    clips=[]
    # Validate everything before copying a new deliverable. Never overwrite evidence.
    for name,game,event,directory,video in specs:
        index=json.loads((directory/'index.json').read_bytes())
        if hashlib.sha256(video.read_bytes()).hexdigest()!=index['video_sha256']:
            raise ValueError('Video hash mismatch')
        for f in index['frames']:
            if hashlib.sha256((directory/f['file']).read_bytes()).hexdigest()!=f['sha256']:
                raise ValueError('Sample hash mismatch')
        if args.samples_per_clip and args.samples_per_clip<len(index['frames']):
            last=len(index['frames'])-1
            selected=[round(i*last/(args.samples_per_clip-1)) for i in range(args.samples_per_clip)]
            index['frames']=[index['frames'][i] for i in selected]
        replay_path=BASE/('linked-replay-pilot-20260907' if name=='Hall' else 'tracked-comotion-unseen-20260907')/f'{game}-{event}.json'
        raw=replay_path.read_bytes()
        receipt_path=replay_path.with_suffix('.json.receipt.json') if name=='Hall' else replay_path.with_suffix('.receipt.json')
        if hashlib.sha256(raw).hexdigest()!=json.loads(receipt_path.read_bytes())['sha256']:
            raise ValueError('Roster replay source mismatch')
        players={a['playerId']:dict(player_id=a['playerId'],team=a['teamAbbrev'],jersey=a['sweaterNumber'])
                 for f in json.loads(raw) for a in f['onIce'].values() if a.get('playerId')}
        clips.append(dict(name=name,game_id=game,event_id=event,directory=name.lower(),
                          video_sha256=index['video_sha256'],frames=index['frames'],
                          roster_source_sha256=hashlib.sha256(raw).hexdigest(),players=list(players.values())))
    out=args.output;out.mkdir()
    for clip,(_,_,_,directory,video) in zip(clips,specs):
        dest=out/clip['directory'];dest.mkdir();shutil.copyfile(video,dest/'highlight.mp4')
        for f in clip['frames']:
            target=dest/f['file'];target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(directory/f['file'],target)
    pack_digest=hashlib.sha256(json.dumps(clips,sort_keys=True).encode()).hexdigest()
    manifest=dict(pack_id='citrus-possession-review-'+pack_digest[:16],clips=clips,
        selection='All saved samples' if args.samples_per_clip is None else f'Up to {args.samples_per_clip} evenly spaced saved samples per clip; no model-score selection',
        sampling_limit='Two goal-selected development clips; not a holdout or population-representative sample',
        model_suggestions_included=False,labels_collected=0,training_eligible=False,production_eligible=False)
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
    shutil.copyfile(ROOT/'scripts/proof/possession-blind-review.html',out/'index.html')
    (out/'receipt.json').write_text(json.dumps(dict(files={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest()
        for p in out.rglob('*') if p.is_file()},production_changed=False),indent=2))
    print(out)


if __name__=='__main__':run()
