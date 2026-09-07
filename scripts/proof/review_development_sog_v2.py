"""Additive reviewed award evidence and exact accent-normalized report matching."""
import argparse
from pathlib import Path
import re
from types import SimpleNamespace
import unicodedata
from collect_development_sog_reports import module,goal_candidates
import review_development_sog_reports as prior
from run_calibration_transfer import ROOT,reuse,pin_run,file_sha,fingerprint

NARRATIVE='scripts/proof/results/development-award-narratives-20260907-full'
NARRATIVE_SHA='6d0af9585f61b8cd79d9b3ec72cf92fa110b536d146a8a0e7b7a116cac6b8f02'
# Explicit main-agent review: game, original event, paragraph locator/hash, mechanism.
# These are exact cases, never a text classifier or missing-shotType inference.
REVIEWED={
2022020276:(88,7,'8d9bfd903df5b420aa6df849bc0dc3f2df6777d2b5ade684db613b2437baf576','displaced_net_award'),
2022020650:(743,11,'49d6714ee5c27ce331c414fddb9450e25cecbd78b6db5774f189942788105026','empty_net_award'),
2022020673:(59,5,'bd915dce573327f40391270542eef1c9ff897195b964526229dc06a94dfccbce','displaced_net_award'),
2022020714:(729,7,'4af07cec87a88c830a1af858f99ff06fc3d65072e5eb41866dfa0a2de11354c8','empty_net_award'),
2022020779:(478,7,'65b8dfc0e5b711078fff81ebb18e29053695a72e2bf6566915e48146f6df3f07','displaced_net_award'),
2022020887:(687,9,'59c3a5f8c014a8024f324568fd87c5921c809a3793062135ad75c60b822fa654','empty_net_award'),
2023020483:(1066,12,'9106ef74fe0ed8c4652cd2fbd8091b8ebc197e0786b4197f9d607edfb2d8948f','empty_net_award'),
2023020799:(45,30,'6188b84c425742afbe1bc6b98797dd9a36fb591e8e208c1cac46158399d64449','empty_net_award'),
}


def surname(value):
    return ''.join(c for c in unicodedata.normalize('NFKD',value.upper()) if not unicodedata.combining(c))


def goal_rows(data,event,teams,reviewer):
    team=next(t['abbrev'] for t in teams.values() if t['id']==event['team_id']);r=event['roster_identity']
    identity=f"{team} #{r['sweaterNumber']} {surname(r['lastName']['default'])}(";matches=[]
    pattern=r'<tr\b[^>]*id="(PL-\d+)"[^>]*>\s*((?:<td\b[^>]*>.*?</td>\s*){6})'
    for m in re.finditer(pattern,data.decode('utf-8'),re.S):
        cells=re.findall(r'<td\b[^>]*>(.*?)</td>',m[2],re.S);text=list(map(reviewer.plain,cells))
        clock=reviewer.plain(re.split(r'<br\s*/?>',cells[3])[0])
        if text[4]!='GOAL' or text[1]!=str(event['period']['number']) or not surname(text[5]).startswith(identity):continue
        if tuple(map(int,clock.split(':')))!=tuple(map(int,event['clock'].split(':'))):continue
        matches.append({'report_row_id':m[1],'report_period':int(text[1]),'report_clock':clock,
            'report_description':text[5],'row_prefix_utf8_sha256':reviewer.digest(m[0].encode()),
            'explicit_own_goal_label':bool(re.search(r'\bOwn Goal\b',text[5])),
            'identity_basis':'exact team/sweater, accent-normalized surname, period and clock'})
    return matches if len(matches)==1 else []


def add_reviewed_award(out,event,proof):
    known={e['event_id']:(e['team_id'],e['player_id']) for e in out['own_goal_events']}
    if event['event_id'] in known:raise ValueError('Statistical effect already applied')
    known[event['event_id']]=(event['team_id'],event['player_id'])
    raw={(r['team_id'],r['player_id']):r['before'] for r in out['players']}
    official={(r['team_id'],r['player_id']):r['official'] for r in out['players']}
    out['players']=prior.reconcile_counts(raw,official,known)
    out['statistical_treatment_supported']=all(r['matches'] for r in out['players']+out['gs_teams'])
    out['narrative_event']={**event,'evidence':proof}
    out['event_overlays']=[{'event_id':e['event_id'],'source_event_sha256':e['source_event_sha256'],
        'player_id':e['player_id'],'team_id':e['team_id'],'goal_credit':1,'recorded_sog_contribution':0,
        'base_shot_model_attempt_eligible':False,'model_probability':None}
        for e in [*out['own_goal_events'],event]] if out['statistical_treatment_supported'] else []
    return out


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);collector=module('collect_goal_sog_evidence');reviewer=module('review_goal_sog_evidence')
    for name in ('scripts/proof/review_development_sog_v2.py','scripts/proof/test_review_development_sog_v2.py',
                 'scripts/proof/review_development_sog_reports.py'):
        closure.pin(name,file_sha(ROOT/name))
    health=pin_run(closure,prior.SOURCE,prior.SHA,'complete-official-report-collection-not-adjudication')
    closure.mapping(closure.read(prior.SOURCE+'/consumed-file-sha256.json'))
    pin_run(closure,NARRATIVE,NARRATIVE_SHA,'complete-narrative-collection-not-adjudication')
    proxy=SimpleNamespace(**vars(reviewer));proxy.report_goal_rows=lambda b,e,t:goal_rows(b,e,t,reviewer)
    results=[]
    for name in sorted(n for n in health['files'] if n.endswith('-review.json')):
        case=closure.read(prior.SOURCE+'/'+name);gid=case['game_id']
        path=f'scripts/proof/results/historical-official-freeze-20260906/{gid//1000000}/pbp/{gid}.body.json'
        closure.pin(path,case['source_body_sha256']);payload=closure.read(path);bodies={}
        for kind,meta in case['reports'].items():
            p=prior.SOURCE+'/'+meta['body_file'];closure.pin(p,meta['raw_body_sha256']);bodies[kind]=closure.safe(p).read_bytes()
        out=prior.analyze(payload,bodies,proxy)
        if gid in REVIEWED:
            eid,index,digest,mechanism=REVIEWED[gid];meta=closure.read(f'{NARRATIVE}/{gid}.receipt.json')
            if meta['status']!='retrieved_requires_review':raise ValueError('Retained narrative required')
            p=NARRATIVE+'/'+meta['body_file'];closure.pin(p,meta['raw_body_sha256'])
            paragraphs=reviewer.paragraphs(closure.safe(p).read_bytes())
            if reviewer.digest(paragraphs[index].encode())!=digest:raise ValueError('Reviewed paragraph changed')
            event=next(e for e in goal_candidates(payload,{t['id'] for t in case['teams'].values()}) if e['event_id']==eid)
            proof={k:meta[k] for k in ('url','raw_body_sha256','retrieved_at')}
            proof.update(paragraph_index=index,paragraph_sha256=digest,reviewed_mechanism=mechanism)
            out=add_reviewed_award(out,event,proof)
        out.update(source_body_sha256=case['source_body_sha256'],source_receipt_sha256=case['source_receipt_sha256'],
            reports={k:{x:m[x] for x in ('url','raw_body_sha256','retrieved_at')} for k,m in case['reports'].items()})
        collector.write_new(output/f'{gid}.json',out);results.append(out)
    closure.verify();collector.write_new(output/'consumed-file-sha256.json',closure.checked)
    summary={'games':len(results),'supported_games':sum(r['statistical_treatment_supported'] for r in results),
        'supported_events':sum(len(r['event_overlays']) for r in results),'unresolved_games':[r['game_id'] for r in results if not r['statistical_treatment_supported']],
        'production_changed':False,'feature_export_activated':False,'publishable':False}
    collector.write_new(output/'summary.json',summary)
    collector.write_new(output/'health.json',{'status':'complete-development-statistical-review-v2','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})
    print(summary,flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
