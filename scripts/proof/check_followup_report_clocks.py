"""Bounded official report cross-check; no physical/video timing claim."""
import argparse
from pathlib import Path
import re
import requests
from collect_development_sog_reports import module
from review_development_sog_reports import report_identity
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha

SOURCE = 'scripts/proof/results/raw-followup-clock-audit-20260907-full'
SHA = '1ed619dbe91b839ec13f69d881b18f5fa60830a2cfefae1b5be3921b51300d6e'


def matches(body, play, payload, reviewer):
    d = play['details']; code = {505:'GOAL',506:'SHOT',507:'MISS'}[play['typeCode']]
    pid = d['scoringPlayerId'] if code == 'GOAL' else d['shootingPlayerId']
    team = next(payload[s] for s in ('homeTeam','awayTeam') if payload[s]['id'] == d['eventOwnerTeamId'])
    roster = [r for r in payload['rosterSpots'] if r['playerId'] == pid and r['teamId'] == team['id']]
    if len(roster) != 1: raise ValueError('Unique exact roster actor required')
    actor = re.compile(r'^'+re.escape(team['abbrev'])+r' (?:ONGOAL - )?#'+str(roster[0]['sweaterNumber'])+r' ')
    result = []
    pattern = r'<tr\b[^>]*id="(PL-\d+)"[^>]*>\s*((?:<td\b[^>]*>.*?</td>\s*){6})'
    for m in re.finditer(pattern, body.decode('utf-8'), re.S):
        cells = re.findall(r'<td\b[^>]*>(.*?)</td>', m[2], re.S); plain = list(map(reviewer.plain,cells))
        clock = reviewer.plain(re.split(r'<br\s*/?>',cells[3])[0])
        if (plain[4] == code and plain[1] == str(play['periodDescriptor']['number']) and actor.match(plain[5])
                and tuple(map(int,clock.split(':'))) == tuple(map(int,play['timeInPeriod'].split(':')))):
            result.append({'report_row_id':m[1], 'clock':clock, 'description':plain[5]})
    return result


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure=reuse.Closure(ROOT)
    collector=module('collect_goal_sog_evidence'); reviewer=module('review_goal_sog_evidence')
    for n in ('scripts/proof/check_followup_report_clocks.py','scripts/proof/test_check_followup_report_clocks.py',
              'scripts/nhl_archive/collect_goal_sog_evidence.py','scripts/nhl_archive/review_goal_sog_evidence.py',
              'scripts/proof/review_development_sog_reports.py'):
        closure.pin(n,file_sha(ROOT/n))
    pin_run(closure,SOURCE,SHA,'complete-raw-followup-clock-audit')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    selected=[]
    for fold in ('fold1','fold2'):
        rows=closure.read(SOURCE+'/'+fold+'-pairs.json')
        for band in ('same_clock','up_to_1s','from_3_to_10s'):
            for target in (0,1):
                eligible=[r for r in rows if r['population']=='original' and r['band']==band and r['target']==target]
                if not eligible: raise ValueError('Declared sample cell unavailable')
                selected.append({**min(eligible,key=lambda r:(r['game_id'],r['event_id'])),'fold':fold})
    collector.write_new(output/'selection.json',{'rule':'First game/event ID per fold, timing band and goal/non-goal; original population only',
        'cases':selected,'representative_sample':False,'no_model_fit':True})
    cache={}; results=[]
    for case in selected:
        gid=case['game_id']; season=gid//1000000
        path=f'scripts/proof/results/historical-official-freeze-20260906/{season}/pbp/{gid}.body.json'
        payload=closure.read(path); raw={p['eventId']:p for p in payload['plays']}
        if gid not in cache:
            url=f'https://www.nhl.com/scores/htmlreports/{season}{season+1}/PL{gid%1000000:06}.HTM'
            meta=collector.freeze_response(url,output,str(gid),requests.get)
            body=(output/meta['body_file']).read_bytes() if meta['status']=='retrieved_requires_review' else None
            if body is not None: report_identity(body,payload,reviewer)
            cache[gid]=(meta,body)
        meta,body=cache[gid]; found=[]
        for eid in (case['previous_event_id'],case['event_id']):
            rows=matches(body,raw[eid],payload,reviewer) if body is not None else []
            found.append({'event_id':eid,'matches':rows})
        exact=all(len(r['matches'])==1 for r in found)
        if exact and found[0]['matches'][0]['report_row_id']==found[1]['matches'][0]['report_row_id']:exact=False
        results.append({'case':case,'report':meta,'events':found,'distinct_exact_matches':exact})
        print(f'{gid}/{case["event_id"]}: distinct report matches={exact}',flush=True)
    closure.verify();collector.write_new(output/'cases.json',results)
    collector.write_new(output/'consumed-file-sha256.json',closure.checked)
    collector.write_new(output/'summary.json',{'cases':len(results),'reports':len(cache),
        'distinct_exact_matches':sum(r['distinct_exact_matches'] for r in results),
        'physical_timing_validated':False,'publishable':False,'production_changed':False})
    collector.write_new(output/'health.json',{'status':'complete-sampled-followup-report-clock-check','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
