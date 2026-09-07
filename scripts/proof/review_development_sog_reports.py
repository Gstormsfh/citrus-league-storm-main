"""Exact-event own-goal statistical review; no production/feature activation."""
import argparse
from collections import Counter
from datetime import date
import re
from pathlib import Path
from collect_development_sog_reports import module, goal_candidates
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint

SOURCE='scripts/proof/results/development-sog-reports-20260907-full'
SHA='155c3a0c444b82a385bc4139bc1ac1d87c4fe7cfdd104efe11c347097e9d6149'


def report_identity(body,payload,reviewer):
    text=reviewer.plain(body.decode('utf-8'));day=date.fromisoformat(payload['gameDate'])
    label=f'{day.strftime("%A, %B")} {day.day}, {day.year}'
    if label not in text or not re.search(r'\bGame '+f'{payload["id"]%10000:04}'+r'\b',text):
        raise ValueError('Report date/game header mismatch')


def reconcile_counts(raw,official,adjustments):
    if set(raw)!=set(official):raise ValueError('Exact player population required')
    if len(set(adjustments))!=len(adjustments):raise ValueError('Unique reviewed event IDs required')
    corrections=Counter(adjustments.values());rows=[]
    if set(corrections)-set(raw):raise ValueError('Unknown correction actor')
    for key,before in sorted(raw.items()):
        after={'goals':before['goals'],'sog':before['sog']-corrections[key]}
        if after['sog']<0:raise ValueError('Negative corrected exposure')
        rows.append({'team_id':key[0],'player_id':key[1],'before':before,'after':after,
            'official':{s:official[key][s] for s in ('goals','sog')},
            'matches':all(after[s]==official[key][s] for s in after)})
    return rows


def analyze(payload,bodies,reviewer):
    teams={s:payload[s] for s in ('homeTeam','awayTeam')}
    for body in bodies.values():report_identity(body,payload,reviewer)
    official,team_totals=reviewer.event_summary(bodies['ES'],teams,payload['rosterSpots'])
    raw={k:{'goals':0,'sog':0} for k in official};pl={k:{'goals':0,'sog':0} for k in official}
    for p in payload['plays']:
        if p['periodDescriptor']['periodType']=='SO' or p['typeCode'] not in (505,506):continue
        d=p['details'];key=d['eventOwnerTeamId'],d['scoringPlayerId' if p['typeCode']==505 else 'shootingPlayerId']
        raw[key]['goals']+=p['typeCode']==505;raw[key]['sog']+=1
    own=[]
    for event in goal_candidates(payload,set(team_totals)):
        matched=reviewer.report_goal_rows(bodies['PL'],event,teams)
        if len(matched)!=1:raise ValueError('Every raw non-shootout goal needs one exact PL identity/clock match')
        if matched[0]['explicit_own_goal_label']:
            own.append({**event,'report_match':matched[0]})
    roster={(t['abbrev'],str(p['sweaterNumber'])):(p['teamId'],p['playerId']) for t in teams.values()
            for p in payload['rosterSpots'] if p['teamId']==t['id']}
    so={str(p['periodDescriptor']['number']) for p in payload['plays'] if p['periodDescriptor']['periodType']=='SO'}
    pattern=r'<tr\b[^>]*id="(PL-\d+)"[^>]*>\s*((?:<td\b[^>]*>.*?</td>\s*){6})'
    seen=set()
    for m in re.finditer(pattern,bodies['PL'].decode('utf-8'),re.S):
        cells=[reviewer.plain(v) for v in re.findall(r'<td\b[^>]*>(.*?)</td>',m[2],re.S)]
        if cells[4] not in ('GOAL','SHOT') or cells[1] in so:continue
        if m[1] in seen:raise ValueError('Duplicate report attempt locator')
        seen.add(m[1]);ident=re.match(r'^([A-Z]{3}) (?:ONGOAL - )?#([0-9]+) ',cells[5])
        if ident is None or tuple(ident.groups()) not in roster:raise ValueError('Unmatched PL shooter')
        key=roster[tuple(ident.groups())];pl[key]['goals']+=cells[4]=='GOAL';pl[key]['sog']+=1
    if pl!=raw:raise ValueError('PL and raw player attempt distributions differ')
    comparisons=reconcile_counts(raw,official,{e['event_id']:(e['team_id'],e['player_id']) for e in own})
    gs=[];defending=None
    for text,cells in reviewer.leaf_rows(bodies['GS']):
        if cells[-1]=='GOALS-SHOTS AGAINST':
            defending=teams['awayTeam']['id'] if 'visitorsectionheading' in text else teams['homeTeam']['id'] if 'homesectionheading' in text else None
        elif defending is not None and cells[0]=='TEAM TOTALS':
            if not re.fullmatch(r'\d+-\d+',cells[-1]):raise ValueError('GS goal/shot totals required')
            goals,shots=map(int,cells[-1].split('-'));opponent=next(t for t in team_totals if t!=defending)
            gs.append({'defending_team_id':defending,'goals_against':goals,'shots_against':shots,
                'matches':goals==team_totals[opponent]['goals'] and shots==team_totals[opponent]['sog']})
            defending=None
    if len(gs)!=2 or len({r['defending_team_id'] for r in gs})!=2:raise ValueError('Complete GS team totals required')
    supported=bool(own) and all(r['matches'] for r in comparisons+gs)
    return {'game_id':payload['id'],'statistical_treatment_supported':supported,
        'own_goal_events':own,'players':comparisons,'gs_teams':gs,'pl_raw_distributions_match':True,
        'event_overlays':[{'event_id':e['event_id'],'source_event_sha256':e['source_event_sha256'],
            'player_id':e['player_id'],'team_id':e['team_id'],'goal_credit':1,'recorded_sog_contribution':0,
            'base_shot_model_attempt_eligible':False,'model_probability':None} for e in own] if supported else [],
        'production_activated':False,'feature_export_activated':False,'publishable':False}


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);collector=module('collect_goal_sog_evidence');reviewer=module('review_goal_sog_evidence')
    for name in ('scripts/proof/review_development_sog_reports.py','scripts/proof/test_review_development_sog_reports.py'):
        closure.pin(name,file_sha(ROOT/name))
    health=pin_run(closure,SOURCE,SHA,'complete-official-report-collection-not-adjudication')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'));results=[]
    for name in sorted(n for n in health['files'] if n.endswith('-review.json')):
        case=closure.read(SOURCE+'/'+name);gid=case['game_id'];path=f'scripts/proof/results/historical-official-freeze-20260906/{gid//1000000}/pbp/{gid}.body.json'
        closure.pin(path,case['source_body_sha256']);payload=closure.read(path);bodies={}
        for kind,meta in case['reports'].items():
            if meta['status']!='retrieved_requires_review':raise ValueError('Complete report retrieval required')
            p=SOURCE+'/'+meta['body_file'];closure.pin(p,meta['raw_body_sha256']);bodies[kind]=closure.safe(p).read_bytes()
        try:out=analyze(payload,bodies,reviewer)
        except (ValueError,KeyError) as error:out={'game_id':gid,'statistical_treatment_supported':False,'reason':str(error),'event_overlays':[],'publishable':False}
        out.update(source_body_sha256=case['source_body_sha256'],source_receipt_sha256=case['source_receipt_sha256'],
            reports={k:{x:m[x] for x in ('url','raw_body_sha256','retrieved_at')} for k,m in case['reports'].items()})
        collector.write_new(output/f'{gid}.json',out);results.append(out)
    closure.verify();collector.write_new(output/'consumed-file-sha256.json',closure.checked)
    summary={'games':len(results),'supported_games':sum(r['statistical_treatment_supported'] for r in results),
        'supported_events':sum(len(r['event_overlays']) for r in results),'unresolved_games':[r['game_id'] for r in results if not r['statistical_treatment_supported']],
        'production_changed':False,'feature_export_activated':False,'publishable':False}
    collector.write_new(output/'summary.json',summary)
    collector.write_new(output/'health.json',{'status':'complete-development-own-goal-statistical-review','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})
    print(summary,flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
