"""Explain missing finishing exposure without admitting rejected source events."""
import argparse
from collections import Counter, defaultdict
import hashlib
from pathlib import Path
from run_calibration_transfer import ROOT, encode, reuse, pin_run, fingerprint, file_sha

FINISH='scripts/proof/results/composed-player-finishing-20260907-full'
FINISH_SHA='debe080c52507e884231a72ad3c4abf0251ac282b9f148d3564f112e1eef6dc0'
EXPORT='scripts/proof/results/official-development-features-20260906'
EXPORT_SHA='9e19e40264c826d8cf818d2c02b0a10b3de1d4d13cba65c470433b616b2f4534'


def reconcile(game,payload,modeled):
    gid=game['game_id']
    if payload['id']!=gid or payload['gameDate']!=game['game_date']:raise ValueError('Source game identity mismatch')
    raw={r['eventId']:r for r in payload['plays']}; stream={r['event_id']:r for r in game['stream_inventory']}
    if len(raw)!=len(payload['plays']) or len(stream)!=len(game['stream_inventory']) or set(raw)!=set(stream):
        raise ValueError('Exact unique source stream required')
    expected={eid for eid,s in stream.items() if s['is_unblocked_attempt'] and not game['source_excluded_game']
              and s.get('cohort_eligibility',{}).get('geometry_baseline') is True}
    if set(modeled)!=expected:raise ValueError('Model membership must match frozen exclusions exactly')
    roster={r['playerId']:r for r in payload['rosterSpots']}; rows=[]
    for eid,s in stream.items():
        play=raw[eid]
        if fingerprint(play)!=s['source_event_sha256']:raise ValueError('Source event hash mismatch')
        attempt=play['typeCode'] in (505,506,507) and play['periodDescriptor']['periodType']!='SO'
        if s['is_unblocked_attempt'] is not attempt:raise ValueError('Attempt population mismatch')
        if not attempt:continue
        goal=play['typeCode']==505;d=play.get('details',{});pid=d.get('scoringPlayerId' if goal else 'shootingPlayerId')
        owner=d.get('eventOwnerTeamId'); actor=roster.get(pid)
        known=(type(pid) is int and 1_000_000<=pid<=9_999_999 and owner in (payload['homeTeam']['id'],payload['awayTeam']['id'])
               and actor is not None and actor['teamId']==owner)
        included=eid in modeled
        if included:
            r=modeled[eid]
            if not known or r['player_id']!=pid or r['team_id']!=owner or r['is_goal'] is not goal or r['source_event_sha256']!=s['source_event_sha256']:
                raise ValueError('Included actor/outcome parity mismatch')
            reasons=[]
        elif game['source_excluded_game']:
            if not game['source_reason']:raise ValueError('Explicit rejected-game reason required')
            reasons=['source_gate:'+game['source_reason']]
        else:
            reasons=s.get('cohort_exclusions',{}).get('geometry_baseline',[]) or [s.get('exclusion_reason')]
            if not reasons or any(not isinstance(r,str) or not r for r in reasons):raise ValueError('Every missing attempt needs a reason')
        rows.append({'game_id':gid,'event_id':eid,'season':gid//1_000_000,
            'game_type':'regular' if payload['gameType']==2 else 'playoff','game_date':game['game_date'],
            'player_id':pid if known else None,'source_player_id':pid,'team_id':owner,
            'actor_status':'roster_consistent' if known else 'unresolved','is_goal':goal,
            'is_sog':play['typeCode'] in (505,506),'model_included':included,'exclusion_reasons':reasons,
            'source_event_sha256':s['source_event_sha256'],'source_body_sha256':game['source_body_bytes_sha256'],
            'source_accepted':not game['source_excluded_game'],'publishable':False})
    return rows


def totals(rows):
    out=[];grouped=defaultdict(list)
    for r in rows:grouped[r['season'],r['game_type'],r['player_id']].append(r)
    for key,events in sorted(grouped.items(),key=lambda x:(x[0][0],x[0][1],x[0][2] or -1)):
        missing=[r for r in events if not r['model_included']]
        count=lambda rs:{'attempts':len(rs),'goals':sum(r['is_goal'] for r in rs),'sog':sum(r['is_sog'] for r in rs)}
        out.append({'season':key[0],'game_type':key[1],'player_id':key[2],
            'captured_source':count(events),'model_included':count([r for r in events if r['model_included']]),
            'not_modeled':count(missing),'affected_game_ids':sorted({r['game_id'] for r in missing}),
            'captured_exposure_fully_modeled':not missing,'official_season_completeness_verified':False,
            'talent_training_authorized':False,'publishable':False})
    return out


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);files={}
    def save(name,value):
        raw=encode(value);p=output/name;p.parent.mkdir(parents=True,exist_ok=True)
        with p.open('xb') as stream:stream.write(raw)
        files[name]=hashlib.sha256(raw).hexdigest()
    for name in ('scripts/proof/reconcile_finishing_exposure.py','scripts/proof/test_reconcile_finishing_exposure.py'):
        closure.pin(name,file_sha(ROOT/name))
    pin_run(closure,FINISH,FINISH_SHA,'complete-source-bound-descriptive-finishing')
    closure.mapping(closure.read(FINISH+'/consumed-file-sha256.json'))
    closure.pin(EXPORT+'/manifest.json',EXPORT_SHA);manifest=closure.read(EXPORT+'/manifest.json')
    closure.mapping(manifest['evidence_file_sha256'])
    inventory=EXPORT+'/game-inventory.jsonl'
    closure.pin(inventory,manifest['outputs']['game-inventory.jsonl']['sha256'])
    modeled={};rows={};game_counts=Counter();excluded_games=defaultdict(list);seen=set()
    for fold in ('fold1','fold2'):
        modeled[fold]=defaultdict(dict);rows[fold]=[]
        for r in closure.read(f'{FINISH}/{fold}/events.json'):
            gid,eid=r['game_id'],r['event_id']
            if eid in modeled[fold][gid]:raise ValueError('Duplicate modeled event')
            modeled[fold][gid][eid]=r
    print('Pinned source closure checked; reconciling captured game inventories',flush=True)
    for line in closure.safe(inventory).open():
        game=reuse.strict_json(line);gid=game['game_id'];season=gid//1_000_000
        if season not in (2022,2023):continue
        fold='fold1' if season==2022 else 'fold2'
        if gid in seen:raise ValueError('Duplicate captured game')
        seen.add(gid);game_counts[fold]+=1
        if game['source_excluded_game']:excluded_games[fold].append({'game_id':gid,'reason':game['source_reason']})
        path=game['source_body_file'];closure.pin(path,game['source_body_bytes_sha256'])
        payload=closure.read(path);rows[fold].extend(reconcile(game,payload,modeled[fold].get(gid,{})))
    summary={}
    for fold in ('fold1','fold2'):
        if set(modeled[fold])-seen:raise ValueError('Modeled game missing from captured inventory')
        allrows=rows[fold];missing=[r for r in allrows if not r['model_included']];players=totals(allrows)
        if sum(r['model_included'] for r in allrows)!=sum(len(r) for r in modeled[fold].values()):raise ValueError('Included conservation failed')
        save(f'{fold}/missing-events.json',missing);save(f'{fold}/players.json',players)
        save(f'{fold}/excluded-games.json',excluded_games[fold])
        reasons=Counter(reason for r in missing for reason in r['exclusion_reasons'])
        summary[fold]={'captured_games':game_counts[fold],'excluded_games':len(excluded_games[fold]),
            'captured_attempts':len(allrows),'modeled_attempts':len(allrows)-len(missing),
            'missing_attempts':len(missing),'missing_goals':sum(r['is_goal'] for r in missing),
            'missing_sog':sum(r['is_sog'] for r in missing),'affected_player_population_rows':sum(bool(r['not_modeled']['attempts']) for r in players),
            'unresolved_actor_attempts':sum(r['player_id'] is None for r in allrows),'reason_counts':dict(reasons)}
        print(f'{fold}: {summary[fold]}',flush=True)
    closure.verify();save('consumed-file-sha256.json',closure.checked)
    save('summary.json',{'folds':summary,'publishable':False,'source_exclusions_changed':False,
        'official_season_completeness_verified':False,'production_changed':False})
    save('health.json',{'status':'complete-finishing-exposure-reconciliation','publishable':False,'files':dict(files)})


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
