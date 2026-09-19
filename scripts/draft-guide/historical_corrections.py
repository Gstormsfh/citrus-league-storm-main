"""Reviewed historical corrections only. No changes to canonical forecasts."""
import copy
from datetime import date
from urllib.parse import urlparse, parse_qs

CORRECTIONS=[dict(playerId='8476453',name='Nikita Kucherov',season=2025,field='games_played',before=77,after=76,
                 source='https://media.nhl.com/site/vasset/public/attachments/2026/06/19935/HartWinner061126.pdf',
                 sourceDate='2026-06-11',reviewed='2026-09-15',reason='Official award release and season-review table both report 76 regular-season appearances.')]
for pid,name,before,after in [('8478398','Kyle Connor',2,3),('8480797','Joel Farabee',4,5)]:
    CORRECTIONS.append(dict(playerId=pid,name=name,season=2025,field='nhl_shp',before=before,after=after,
        source='https://api.nhle.com/stats/rest/en/skater/summary?cayenneExp=seasonId%3D20252026%20and%20gameTypeId%3D2%20and%20playerId%3D'+pid,
        sourceDate='2026-09-15',reviewed='2026-09-15',reason='Official regular-season summary reports the combined shorthanded goals and assists.'))

CATEGORY_FIELDS={'realtime':{'nhl_hits':'hits','nhl_blocks':'blockedShots'},
                 'powerplay':{'nhl_ppp':'ppPoints'},'summary':{'nhl_shp':'shPoints'}}

def category_receipt(evidence,players,report):
    """Recheck source payloads, not a cached success flag or imported values."""
    if report.get('complete') is not True or report.get('season')!=2025 or report.get('gameType')!=2:
        raise ValueError('Incomplete or wrong-season category verification')
    actuals={str(a['player_id']):a for a in evidence['actuals'] if a['season']==2025}
    eligible={str(p['playerId']) for p in players if not p['isGoalie'] and actuals.get(str(p['playerId']),{}).get('games_played',0)>0}
    fields=0;component_checks=0;source_urls=[]
    for endpoint,mapping in CATEGORY_FIELDS.items():
        pages=[r for r in report.get('responses',[]) if r.get('endpoint')==endpoint]
        if not pages:raise ValueError('Missing category source: '+endpoint)
        total=pages[0]['total'];starts=[];rows={}
        for page in pages:
            parsed=urlparse(page['url']);query=parse_qs(parsed.query)
            if (parsed.scheme!='https' or parsed.netloc!='api.nhle.com' or
                parsed.path!='/stats/rest/en/skater/'+endpoint or
                query.get('cayenneExp')!=['seasonId=20252026 and gameTypeId=2'] or
                query.get('isAggregate')!=['false'] or query.get('isGame')!=['false'] or
                query.get('limit')!=['100'] or page['total']!=total):
                raise ValueError('Wrong category source scope')
            if date.fromisoformat(page['checkedAt'][:10])>date.today():raise ValueError('Future category source date')
            start=int(query['start'][0]);starts.append(start)
            if len(page['data'])!=min(100,total-start):raise ValueError('Incomplete category page')
            source_urls.append(page['url'])
            for row in page['data']:
                pid=str(row['playerId'])
                if row.get('seasonId')!=20252026 or pid in rows:raise ValueError('Wrong season or duplicate category identity')
                rows[pid]=row
        if sorted(starts)!=list(range(0,total,100)) or len(rows)!=total:
            raise ValueError('Missing or duplicate category pages')
        if not eligible.issubset(rows):raise ValueError('Historical skater missing from category source')
        for pid in eligible:
            row=rows[pid]
            for field,source_field in mapping.items():
                value=row.get(source_field)
                if type(value) is not int or value<0:raise ValueError('Invalid category source value')
                if actuals[pid].get(field)!=value:
                    raise ValueError('Historical category differs from reviewed source: '+pid+'/'+field)
                fields+=1
            if endpoint=='powerplay':
                if any(type(row.get(f)) is not int or row[f]<0 for f in ('ppGoals','ppAssists')) or row['ppGoals']+row['ppAssists']!=row['ppPoints']:
                    raise ValueError('Power-play components disagree')
                component_checks+=1
    return dict(verifiedSkaters=len(eligible),fieldsChecked=fields,powerPlayComponentChecks=component_checks,
                fields=[f for mapping in CATEGORY_FIELDS.values() for f in mapping],
                checkedAt=report['checkedAt'],sourceUrls=source_urls,
                limitations=['Power-play assists are an NHL source component of verified power-play points, not a separately stored Citrus historical field.'])

def reviewed_evidence(evidence):
    result=copy.deepcopy(evidence)
    for fix in CORRECTIONS:
        rows=[a for a in result['actuals'] if str(a['player_id'])==fix['playerId'] and a['season']==fix['season']]
        if len(rows)!=1:raise ValueError('Historical correction identity/season missing: '+fix['name'])
        row=rows[0]
        if row.get(fix['field']) not in (fix['before'],fix['after']):
            raise ValueError('Historical correction needs review: '+fix['name'])
        row[fix['field']]=fix['after']
    result['reviewedHistoricalCorrections']=copy.deepcopy(CORRECTIONS)
    return result

def verification_receipt(evidence,players,report):
    ids={str(p['playerId']) for p in players}
    actuals={str(a['player_id']):a for a in evidence['actuals'] if a['season']==report['season']}
    checked=set();fields=0
    for check in report['checks']:
        pid=check['playerId']
        if pid not in ids:continue
        row=actuals.get(pid)
        if row is None:raise ValueError('Verified historical row disappeared')
        value=row.get(check['field'])
        if value is not None and check['field'] in ('nhl_gaa','nhl_save_pct'):
            value=round(value,2 if check['field']=='nhl_gaa' else 3)
        if value!=check['verified']:raise ValueError('Historical total differs from reviewed source: '+check['name']+'/'+check['field'])
        checked.add(pid);fields+=1
    return dict(verifiedPlayers=len(checked),fieldsChecked=fields,unverifiedPlayerIds=sorted(ids-checked),
                sourceUrl=report['sourceUrl'],sourceSha256=report['sourceSha256'],
                limitations=report['limitations'],corrections=copy.deepcopy(CORRECTIONS))
