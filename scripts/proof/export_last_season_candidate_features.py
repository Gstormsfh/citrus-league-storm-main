"""User-authorized 2025-26 evaluation export; original source gates unchanged."""
import json
from pathlib import Path
from collections import Counter
from projections.frozen_feature_source import adapt_frozen_feature_source
from projections.compact_feature_export import project_compact_game,FEATURES
from projections.development_feature_export import prefix_measurements,EXTRA_NUMERIC,_period,SOURCE_WINDOWS
from projections.analytics_publication import fingerprint
from run_movement_candidate import project as movement_project,NAMES
from run_bounded_xg_refresh import ROOT,sha

FREEZE=ROOT/'scripts/proof/results/historical-official-freeze-20260906'
OUT=ROOT/'scripts/proof/results/last-season-candidate-features-20260907'
SCHEMA={'version':'citrus-matched-pre-shot-movement-v1','names':list(FEATURES+EXTRA_NUMERIC+NAMES),'categorical_names':['shot_type','previous_event_type']}


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def project(source):
    compact=project_compact_game(source,evidence_kind='real',windows=SOURCE_WINDOWS)
    payload=source['prepared'][0]['payload']['pbp'];inventory=compact['game_inventory']
    if inventory['source_excluded_game']:return [],inventory,{}
    base={r['event_id']:r for r in compact['rows']};plays=payload['plays']
    movement=movement_project(plays,home=payload['homeTeam']['id'],away=payload['awayTeam']['id'])
    previous=faceoff=None;rows=[];missing=Counter()
    for play in plays:
        if play['eventId'] in base:
            b=base[play['eventId']]
            if b['cohort_eligibility']['geometry_baseline']:
                extra=prefix_measurements(play,previous,faceoff,home=payload['homeTeam']['id'],away=payload['awayTeam']['id'],base_row=b)
                values=[b['features'][n] for n in FEATURES]+[extra['values'][n] for n in EXTRA_NUMERIC]+movement[play['eventId']]
                values=[int(v) if type(v) is bool else v for v in values]
                missing.update(n for n,v in zip(SCHEMA['names'],values) if v is None)
                row={'game_id':payload['id'],'event_id':play['eventId'],'game_date':payload['gameDate'],
                    'label':bool(b['label']),'features':values,'categorical':extra['categorical'],
                    'source_event_sha256':b['source_event_sha'],'game_type':payload['gameType'],'home_team_id':payload['homeTeam']['id']}
                row['feature_sha256']=fingerprint({'schema_sha256':fingerprint(SCHEMA),'values':values,'categorical':row['categorical']})
                rows.append(row)
        if not previous or _period(previous)!=_period(play):faceoff=None
        if play['typeCode']==502:faceoff=play
        previous=play
    return rows,inventory,dict(missing)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json',{'season':2025,'date_window':['2025-07-01','2026-08-31'],
        'purpose':'Evaluate frozen candidate; no training or parameter selection on this season',
        'coverage':'All scheduled terminal regular/playoff games; existing source and geometry exclusions retained',
        'historical_as_of_verified':False,'untouched_status':'Not asserted: archive/source diagnostics were previously inspected.',
        'code_sha256':sha(Path(__file__)),'publishable':False})
    assert sha(FREEZE/'manifest.json')=='2dd3b6851e75fe004d47ea0a10f7a98cf13a46776729f00ab6f14a881ce154a9'
    assert sha(FREEZE/'schedule-manifest.json')=='17e23b533a25b3ffce7460f54643600bbec67538e157db0eeb5a93c61dcc2a50'
    manifest=json.loads((FREEZE/'manifest.json').read_bytes());schedule=json.loads((FREEZE/'schedule-manifest.json').read_bytes())['2025']
    assert schedule['window_complete'] and not schedule['unresolved_game_ids']
    entries={r['game_id']:r for r in manifest['games']};games=schedule['terminal_game_ids']
    receipts=[];pins={};total=goals=0;missing=Counter()
    for i,gid in enumerate(games):
        body=FREEZE/f'2025/pbp/{gid}.body.json';receipt=FREEZE/f'2025/pbp/{gid}.receipt.json'
        assert sha(body)==entries[gid]['body_sha256'];pins[str(body)]=sha(body);pins[str(receipt)]=sha(receipt)
        source=adapt_frozen_feature_source(body.read_bytes(),json.loads(receipt.read_bytes()))
        rows,inventory,absent=project(source)
        inventory.pop('stream_inventory')
        assert all(r['game_id']==gid and '2025-07-01'<=r['game_date']<='2026-08-31' for r in rows)
        write(f'{gid}.json',rows);receipts.append(inventory);total+=len(rows);goals+=sum(r['label'] for r in rows);missing.update(absent)
        if (i+1)%100==0:print({'games_processed':i+1,'shots':total},flush=True)
    for name,digest in pins.items():assert sha(Path(name))==digest
    write('schema.json',SCHEMA);write('game-inventory.json',receipts);write('source-sha256.json',pins)
    write('summary.json',{'scheduled_games':len(games),'included_games':sum(not r['source_excluded_game'] for r in receipts),
        'excluded_games':sum(r['source_excluded_game'] for r in receipts),'shots':total,'goals':goals,
        'exclusion_reasons':dict(Counter(r['source_reason'] for r in receipts if r['source_excluded_game'])),
        'missing_by_feature':dict(missing),'publishable':False})
    write('health.json',{'status':'complete-last-season-candidate-features','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({'games':len(games),'shots':total,'goals':goals},flush=True)


if __name__=='__main__':run()
