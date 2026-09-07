"""Retain independent official reports for exact development quarantine cases.

Own-goal matches are evidence candidates only, not automatic source approvals.
"""
import argparse
from collections import Counter
import importlib.util
from pathlib import Path
import time
import requests
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint

SOURCE='scripts/proof/results/finishing-exposure-reconciliation-20260907-full'
SHA='5aaafe10ae36e3b0e794eb3077bc330074182b1f9cbe9cdbbafa23c9d464e847'


def module(name):
    path=ROOT/f'scripts/nhl_archive/{name}.py'
    spec=importlib.util.spec_from_file_location(name,path);out=importlib.util.module_from_spec(spec);spec.loader.exec_module(out)
    return out


def goal_candidates(payload,affected):
    roster={r['playerId']:r for r in payload['rosterSpots']};out=[]
    for p in payload['plays']:
        d=p.get('details',{})
        if p['typeCode']!=505 or p['periodDescriptor']['periodType']=='SO' or d.get('eventOwnerTeamId') not in affected:continue
        pid=d['scoringPlayerId']
        out.append({'event_id':p['eventId'],'team_id':d['eventOwnerTeamId'],'player_id':pid,
            'roster_identity':roster[pid],'period':p['periodDescriptor'],'clock':p['timeInPeriod'],
            'source_event_sha256':fingerprint(p),'goal_credit':1,'sog_contribution':None})
    return out


def run(output,request=requests.get):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT)
    collector=module('collect_goal_sog_evidence');reviewer=module('review_goal_sog_evidence')
    for name in ('scripts/proof/collect_development_sog_reports.py','scripts/proof/test_collect_development_sog_reports.py',
        'scripts/nhl_archive/collect_goal_sog_evidence.py','scripts/nhl_archive/review_goal_sog_evidence.py'):
        closure.pin(name,file_sha(ROOT/name))
    pin_run(closure,SOURCE,SHA,'complete-finishing-exposure-reconciliation')
    original=closure.read(SOURCE+'/consumed-file-sha256.json');cases=[];seen=set()
    for fold in ('fold1','fold2'):
        for item in closure.read(f'{SOURCE}/{fold}/excluded-games.json'):
            gid=item['game_id'];prefix=f'scripts/proof/results/historical-official-freeze-20260906/{gid//1000000}/pbp/{gid}'
            if gid in seen:raise ValueError('Unique game required')
            seen.add(gid)
            for suffix in ('.body.json','.receipt.json'):closure.pin(prefix+suffix,original[prefix+suffix])
            p=closure.read(prefix+'.body.json');receipt=closure.read(prefix+'.receipt.json')
            if receipt['body_sha256']!=original[prefix+'.body.json']:raise ValueError('Receipt/body mismatch')
            affected={d['team_id'] for d in receipt['final_game_evidence']['differences'] if d['field']=='sog'}
            cases.append({'fold':fold,'game_id':gid,'source_body_sha256':original[prefix+'.body.json'],
                'source_receipt_sha256':original[prefix+'.receipt.json'],'teams':{s:p[s] for s in ('homeTeam','awayTeam')},
                'goal_candidates':goal_candidates(p,affected),'payload':p})
    collector.write_new(output/'request-plan.json',{'games':[c['game_id'] for c in cases],'reports':['PL','ES','GS'],
        'publishable':False,'automatic_adjudication':False})
    results=[]
    for case in cases:
        gid=case['game_id'];season=gid//1000000;reports={};bodies={}
        for kind in ('PL','ES','GS'):
            url=f'https://www.nhl.com/scores/htmlreports/{season}{season+1}/{kind}{gid%1000000:06}.HTM'
            meta=collector.freeze_response(url,output,f'{gid}-{kind}',request);reports[kind]=meta
            if meta['status']=='retrieved_requires_review':bodies[kind]=(output/meta['body_file']).read_bytes()
            time.sleep(.2)
        out={k:v for k,v in case.items() if k!='payload'};out['reports']=reports
        matches=[]
        if 'PL' in bodies:
            for event in case['goal_candidates']:
                rows=reviewer.report_goal_rows(bodies['PL'],event,case['teams'])
                if rows:matches.append({'event_id':event['event_id'],'player_id':event['player_id'],**rows[0]})
        out['matched_goal_rows']=matches
        out['explicit_own_goal_candidates']=[r for r in matches if r['explicit_own_goal_label']]
        if 'ES' in bodies:
            try:
                players,totals=reviewer.event_summary(bodies['ES'],case['teams'],case['payload']['rosterSpots'])
                out['es_status']='complete_original_roster_reconciled'
                out['es_players']=[{'team_id':k[0],'player_id':k[1],**v} for k,v in sorted(players.items())]
                out['es_teams']=totals
            except ValueError as error:
                out['es_status']='unavailable';out['es_reason']=str(error)
        else:out['es_status']='unavailable'
        out['publishable']=False;out['adjudicated']=False;results.append(out)
        collector.write_new(output/f'{gid}-review.json',out)
        print({'game_id':gid,'retrieval':{k:v['status'] for k,v in reports.items()},
            'own_goal_candidates':len(out['explicit_own_goal_candidates']),'es_status':out['es_status']},flush=True)
    closure.verify();collector.write_new(output/'consumed-file-sha256.json',closure.checked)
    collector.write_new(output/'summary.json',{'status':'complete-official-report-collection-not-adjudication',
        'games':len(results),'report_statuses':dict(Counter(m['status'] for c in results for m in c['reports'].values())),
        'games_with_explicit_own_goal_candidates':sum(bool(c['explicit_own_goal_candidates']) for c in results),
        'complete_es_games':sum(c['es_status']=='complete_original_roster_reconciled' for c in results),
        'publishable':False,'adjudicated_games':0,'production_changed':False})
    files={p.name:file_sha(p) for p in output.iterdir() if p.is_file()}
    collector.write_new(output/'health.json',{'status':'complete-official-report-collection-not-adjudication','publishable':False,'files':files})


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);run(parser.parse_args().output)
