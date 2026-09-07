"""Source-bound descriptive finishing ledger; neither talent fit nor publication."""
import argparse
from collections import defaultdict
import hashlib
import math
from pathlib import Path
from finishing_quantity_contract import Scope, observed_rates
from run_calibration_transfer import ROOT, encode, reuse, pin_run, file_sha, fingerprint
from review_actor_attribution import verify_raw_actors

COMPOSED='scripts/proof/results/composed-xg-replay-20260907-full'
COMPOSED_SHA='e962af6cf6b319c349bbc1cbd93ef8d2b43b742c7804a0461b8dedd89c5f2955'
ACTORS='scripts/proof/results/official-actor-attribution-20260906'
ACTORS_SHA='167e0b7eed959083b4c93d5bf33673755a8e3fb8fe60c9fde0a74ccfe790a755'
REVIEW='scripts/proof/results/actor-attribution-review-20260906/review.json'
REVIEW_SHA='c2a6d3c7310ca5d38a41132df34f868c84b7afdeed92150f9ea82da0e802e8be'


def aggregate(rows, baseline):
    """Preserve goal/SOG/attempt populations and historical team stints."""
    ledger=defaultdict(list); seen=set()
    for r in rows:
        key=r['game_id'],r['event_id']
        if any(type(v) is not int for v in key) or key in seen: raise ValueError('Unique event identity required')
        seen.add(key)
        if r['event_type'] not in ('goal','shot-on-goal','missed-shot') or type(r['is_goal']) is not bool or r['is_goal'] != (r['event_type']=='goal'):
            raise ValueError('Aligned eligible event outcome required')
        p=r['neutral_xg']
        if type(p) not in (int,float) or not math.isfinite(p) or not 0<=p<=1: raise ValueError('Probability required')
        if r['game_type'] not in ('regular','playoff') or type(r['team_id']) is not int or r['team_id']<=0: raise ValueError('Explicit regular/playoff and team required')
        Scope(r['player_id'],('regular_season' if r['game_type']=='regular' else 'playoff')+'_unblocked_attempts',baseline).validate()
        if type(r['season']) is not int or r['season']!=r['game_id']//1_000_000:raise ValueError('Game-season identity required')
        for team in (None,r['team_id']):ledger[r['season'],r['game_type'],r['player_id'],team].append(r)
    def total(key):
        season,kind,player,team=key; events=ledger[key]
        goals=sum(r['is_goal'] for r in events); sog=sum(r['event_type']!='missed-shot' for r in events)
        xg=math.fsum(r['neutral_xg'] for r in events)
        population=('regular_season' if kind=='regular' else 'playoff')+'_unblocked_attempts'
        return {'season':season,'game_type':kind,'player_id':player,'team_id':team,
            'population':'eligible_model_events_only','baseline_sha256':baseline,
            'eligible_event_goals':goals,'eligible_event_sog':sog,'eligible_event_attempts':len(events),
            'neutral_xg':xg,'rates':observed_rates(scope=Scope(player,population,baseline),goals=goals,
                shots_on_goal=sog,xg_attempts=len(events),neutral_xg=xg),
            'appearance_games':None,'toi_seconds':None,'xg_per60':None,'publishable':False}
    result=[]
    for key in sorted(k for k in ledger if k[-1] is None):
        r=total(key); r['team_stints']=[total((*key[:-1],team)) for team in sorted({e['team_id'] for e in ledger[key]})]
        result.append(r)
    return result


def join_game(game,body,predictions,bundles):
    """Reverify actual source attribution before attaching the new baseline."""
    verify_raw_actors(game,body)
    raw=reuse.strict_json(body); rows=[]; expected={(game['game_id'],e['event_id']) for e in game['events']}
    types={e['eventId']:e['typeCode'] for e in raw['plays']}
    if set(predictions)!=expected: raise ValueError('Exact whole-game prediction membership required')
    for event in game['events']:
        if event['event_type'] != {505:'goal',506:'shot-on-goal',507:'missed-shot'}[types[event['event_id']]]:
            raise ValueError('Source on-goal/miss classification mismatch')
        p=predictions[game['game_id'],event['event_id']]; actor=event['shooter']
        if p.get('publishable') is not False or p['bundle_fingerprint'] not in bundles: raise ValueError('Certified composed bundle required')
        bundle=bundles[p['bundle_fingerprint']]
        if not bundle['valid_from']<=raw['gameDate']<=bundle['valid_to']: raise ValueError('Bundle date mismatch')
        rows.append({'game_id':game['game_id'],'event_id':event['event_id'],'game_date':raw['gameDate'],
            'season':game['season'],'game_type':game['game_type'],'player_id':actor['player_id'],
            'team_id':actor['team_id'],'event_type':event['event_type'],'is_goal':event['is_goal'],
            'neutral_xg':p['neutral_xg'],'bundle_fingerprint':p['bundle_fingerprint'],
            'source_event_sha256':event['source_event_sha256'],'source_body_sha256':game['source_body_sha256']})
    return rows


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure=reuse.Closure(ROOT); files={}
    def save(name,value):
        raw=encode(value); path=output/name;path.parent.mkdir(parents=True,exist_ok=True)
        with path.open('xb') as stream:stream.write(raw)
        files[name]=hashlib.sha256(raw).hexdigest()
    for name in ('scripts/proof/compose_player_finishing.py','scripts/proof/test_compose_player_finishing.py',
                 'scripts/proof/finishing_quantity_contract.py','scripts/proof/review_actor_attribution.py'):
        closure.pin(name,file_sha(ROOT/name))
    pin_run(closure,COMPOSED,COMPOSED_SHA,'complete-composed-xg-retrospective-replay')
    closure.mapping(closure.read(COMPOSED+'/consumed-file-sha256.json'))
    health=pin_run(closure,ACTORS,ACTORS_SHA,'complete-source-model-actor-diagnostic-not-accepted')
    closure.pin(REVIEW,REVIEW_SHA); review=closure.read(REVIEW);closure.mapping(review['bound_file_sha256'])
    manifest=closure.read(COMPOSED+'/manifest.json'); baseline=fingerprint(manifest); summaries={}
    print('All composed and actor source pins checked',flush=True)
    for fold in ('fold1','fold2'):
        bundles={}
        for item in manifest['bundles']:
            if item['fold']==fold:
                closure.pin(COMPOSED+'/'+item['bundle'],item['sha256'])
                bundle=closure.read(COMPOSED+'/'+item['bundle']);bundles[fingerprint(bundle)]=bundle
        pred=closure.read(f'{COMPOSED}/{fold}/predictions.json'); by_game=defaultdict(dict)
        for p in pred:
            key=p['game_id'],p['event_id']
            if key in by_game[key[0]]:raise ValueError('Duplicate composed event')
            by_game[key[0]][key]=p
        rows=[];seen=set()
        for name in sorted(n for n in health['files'] if n.startswith(fold+'/games/')):
            game=closure.read(ACTORS+'/'+name);gid=game['game_id']
            body_path=f'scripts/proof/results/historical-official-freeze-20260906/{str(gid)[:4]}/pbp/{gid}.body.json'
            closure.pin(body_path,game['source_body_sha256']);body=closure.safe(body_path).read_bytes()
            rows.extend(join_game(game,body,by_game[gid],bundles));seen.add(gid)
        if seen!=set(by_game) or len(rows)!=len(pred):raise ValueError('Full composed cohort required')
        totals=aggregate(rows,baseline)
        if totals!=aggregate(list(reversed(rows)),baseline):raise ValueError('Order-dependent finishing ledger')
        if sum(r['eligible_event_attempts'] for r in totals)!=len(rows):raise ValueError('Attempt conservation failed')
        if sum(r['eligible_event_goals'] for r in totals)!=sum(r['is_goal'] for r in rows):raise ValueError('Goal conservation failed')
        save(f'{fold}/events.json',rows);save(f'{fold}/players.json',totals)
        summaries[fold]={'events':len(rows),'player_population_rows':len(totals),
            'goals':sum(r['is_goal'] for r in rows),'sog':sum(r['event_type']!='missed-shot' for r in rows),
            'neutral_xg':math.fsum(r['neutral_xg'] for r in rows),
            'multi_team_rows':sum(len(r['team_stints'])>1 for r in totals)}
        print(f'{fold}: {summaries[fold]}',flush=True)
    closure.verify();save('consumed-file-sha256.json',closure.checked)
    save('summary.json',{'folds':summaries,'baseline_sha256':baseline,'publishable':False,
        'estimated_talent':None,'official_actuals_replaced':False,'production_changed':False})
    save('health.json',{'status':'complete-source-bound-descriptive-finishing','publishable':False,'files':dict(files)})


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);run(parser.parse_args().output)
