"""Create-only full eligible-shot sequence export and outcome-separated examples."""
import json
from pathlib import Path
from projections.recorded_sequence_map import project
from run_bounded_xg_refresh import ROOT,sha
from evaluate_frozen_last_season import FEATURES
from export_last_season_candidate_features import FREEZE

OUT=ROOT/'scripts/proof/results/recorded-sequence-maps-20260907'


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json',{'scope':'All existing eligible 2025-26 shots, unchanged cohort and source exclusions',
        'max_prior_events':4,'horizon_seconds':10,'outcomes_separate_from_features':True,
        'not_verified_passes_or_goalie_tracking':True,'production_changed':False,'code_sha256':sha(Path(__file__))})
    assert sha(FREEZE/'manifest.json')=='2dd3b6851e75fe004d47ea0a10f7a98cf13a46776729f00ab6f14a881ce154a9'
    manifest={g['game_id']:g for g in json.loads((FREEZE/'manifest.json').read_bytes())['games']}
    fh=json.loads((FEATURES/'health.json').read_bytes());pins={};counts={'shots':0,'goals':0,'with_prior':0,'with_two_or_more_prior':0};examples=[]
    inventory=json.loads((FEATURES/'game-inventory.json').read_bytes())
    for i,g in enumerate(inventory):
        gid=g['game_id'];fp=FEATURES/f'{gid}.json';assert sha(fp)==fh['files'][fp.name]
        eligible=json.loads(fp.read_bytes())
        if not eligible:continue
        body=FREEZE/f'2025/pbp/{gid}.body.json';digest=sha(body);assert digest==manifest[gid]['body_sha256'];pins[str(body)]=digest
        raw=json.loads(body.read_bytes());maps=project(raw['plays'],home=raw['homeTeam']['id'],away=raw['awayTeam']['id'])
        output=[]
        for r in eligible:
            m=maps[r['event_id']];f=m['features'];counts['shots']+=1;counts['goals']+=int(r['label'])
            counts['with_prior']+=len(f['nodes'])>1;counts['with_two_or_more_prior']+=len(f['nodes'])>2
            item={'game_id':gid,'game_date':r['game_date'],'event_id':r['event_id'],'source_body_sha256':digest,**m,
                'outcome':{'goal':bool(r['label'])}}
            output.append(item)
            s=f['summary']
            if len(f['nodes'])>=3 and s['centerline_crossings'] and s['path_lateral_ft']>=30:
                examples.append(item)
        write(f'{gid}.json',output)
        if (i+1)%300==0:print({'games_processed':i+1,**counts},flush=True)
    expected=json.loads((FEATURES/'summary.json').read_bytes());assert counts['shots']==expected['shots'] and counts['goals']==expected['goals']
    # Illustrative examples, explicitly not a representative model-evaluation sample.
    selected=[]
    for goal in (True,False):
        pool=[r for r in examples if r['outcome']['goal']==goal]
        pool.sort(key=lambda r:(-r['features']['summary']['path_lateral_ft'],r['game_id'],r['event_id']))
        selected.extend(pool[:3])
    write('examples.json',selected);write('summary.json',{**counts,'production_changed':False,'publishable':False})
    write('source-sha256.json',pins)
    write('health.json',{'status':'complete-recorded-sequence-maps','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print(counts,flush=True)


if __name__=='__main__':run()
