"""Verify forward adapter against historical certified vectors and predictions."""
import json
from pathlib import Path
from projections import verified_movement_reuse_v2 as reuse
from projections.frozen_feature_source import adapt_frozen_feature_source
from export_last_season_candidate_features import project,FREEZE
from evaluate_frozen_last_season import FrozenForward,ROOT,OUT,FEATURES


def run():
    data=reuse.load(ROOT);model=FrozenForward()
    original=[r for r in data.folds['fold2']['validation']['rows'] if r['game_date'][:7]=='2024-06']
    gid=original[0]['game_id'];original=[r for r in original if r['game_id']==gid]
    body=FREEZE/f'{gid//1000000}/pbp/{gid}.body.json';receipt=FREEZE/f'{gid//1000000}/pbp/{gid}.receipt.json'
    source=adapt_frozen_feature_source(body.read_bytes(),json.loads(receipt.read_bytes()))
    rebuilt,_,_=project(source);indexed={(r['game_id'],r['event_id']):r for r in rebuilt}
    assert len(original)==len(rebuilt)
    for r in original:
        b=indexed[r['game_id'],r['event_id']]
        for field in ('features','categorical','feature_sha256','label'):assert r[field]==b[field],field
    # Synthetic metadata-shifted fixture ONLY, never part of season scoring.
    shifted=[{**r,'game_date':'2025-07-01'} for r in original]
    a,b,c,_,_=model.predict(shifted)
    expected={r['event_id']:r for r in json.loads((ROOT/'scripts/proof/results/bounded-xg-refresh-20260907/fold2-predictions.json').read_bytes()) if r['game_id']==gid}
    error=0.
    for row,x,y in zip(original,a,b):
        r=expected[row['event_id']];error=max(error,abs(x-r['reference']),abs(y-r['symmetric_geometry_timing']))
    assert error<1e-12
    changed=[{**r,'label':not r['label']} for r in shifted]
    for x,y in zip(model.predict(changed)[:3],(a,b,c)):assert (x==y).all()
    data.verify()
    with (OUT/'protocol-review.json').open('x') as f:json.dump({'historical_fixture_game':gid,
        'feature_vectors_reproduced':len(original),'max_frozen_prediction_error':error,
        'target_invariance':True,'synthetic_date_shift_used_only_in_test':True,'production_changed':False},f)
    print({'feature_vectors_reproduced':len(original),'max_frozen_prediction_error':error,'target_invariance':True},flush=True)


if __name__=='__main__':run()
