"""Normalize observed NHL PBP into versioned evidence, never overwrite raw shots.

Coordinates remain raw source feet. Empty net is from the shooting perspective.
Missing actors/context stay NULL. Excluded/non-identifiable events are accounted
for separately; no ordering/coordinate fallback invents an event identity.
"""
from collections import Counter
import math
from monitoring.appearance_contract import parse_toi
from projections.analytics_publication import fingerprint


def player_id(value):
    return value if type(value) is int and value > 0 else None


def coordinate(value):
    return float(value) if type(value) in (float,int) and math.isfinite(value) else None


def normalize_pbp(payload):
    gid=payload.get('id')
    if type(gid) is not int or len(str(gid))!=10:
        raise ValueError('Missing canonical NHL game identity')
    season=gid//1000000
    gt=(gid//10000)%100
    if gt not in (2,3) or payload.get('gameType')!=gt or payload.get('season')!=season*10000+season+1:
        raise ValueError('Game season/type conflict')
    home=payload.get('homeTeam',{}).get('id')
    away=payload.get('awayTeam',{}).get('id')
    if type(home) is not int or type(away) is not int or home<=0 or away<=0 or home==away:
        raise ValueError('Game team identity missing or conflicting')
    plays=payload.get('plays')
    if not isinstance(plays,list):
        raise ValueError('Missing PBP event list')
    events=[]
    quarantine=[]
    excluded=Counter()
    seen=set()
    for play in plays:
        if not isinstance(play,dict):
            quarantine.append({'event':play,'reason':'malformed_event'})
            continue
        if play.get('typeCode') not in (505,506,507):
            excluded['not_unblocked_attempt']+=1
            continue
        period=play.get('periodDescriptor') or {}
        if not isinstance(period,dict):
            quarantine.append({'event':play,'reason':'invalid_period'})
            continue
        if period.get('periodType')=='SO':
            excluded['shootout']+=1
            continue
        eid=play.get('eventId')
        if type(eid) is not int or eid<0 or eid in seen:
            quarantine.append({'event':play,'reason':'missing_or_duplicate_event_id'})
            continue
        seen.add(eid)
        if (type(period.get('number')) is not int or period['number']<1
                or period.get('periodType') != ('REG' if period['number']<=3 else 'OT')):
            quarantine.append({'event':play,'reason':'invalid_period'})
            continue
        details=play.get('details') or {}
        if not isinstance(details,dict):
            quarantine.append({'event':play,'reason':'invalid_details'})
            continue
        own=details.get('eventOwnerTeamId')
        is_home=True if own==home else False if own==away else None
        situation=play.get('situationCode')
        empty=None
        if isinstance(situation,str) and len(situation)==4 and situation.isdigit() and is_home is not None:
            empty=situation[0 if is_home else 3]=='0'
        pseconds=parse_toi(play.get('timeInPeriod'))
        limit=300 if gt==2 and period['number']>3 else 1200
        if pseconds is None or pseconds>limit:
            quarantine.append({'event':play,'reason':'invalid_period_clock'})
            continue
        shooter=player_id(details.get('scoringPlayerId' if play['typeCode']==505 else 'shootingPlayerId'))
        event={'game_id':gid,'event_id':eid,'season':season,'game_type':'regular' if gt==2 else 'playoff',
               'period':period['number'],'period_type':period['periodType'],'seconds_into_period':pseconds,
               'shooter_id':shooter,'goalie_id':player_id(details.get('goalieInNetId')),
               'event_type':{505:'goal',506:'shot-on-goal',507:'missed-shot'}[play['typeCode']],
               'is_goal':play['typeCode']==505,
               'shot_type':details.get('shotType') if isinstance(details.get('shotType'),str) and details['shotType'] else None,
               'x_raw':coordinate(details.get('xCoord')),'y_raw':coordinate(details.get('yCoord')),
               'is_home':is_home,'is_empty_net':empty,'source_event_sha256':fingerprint(play)}
        events.append(event)
    return {'contract':'nhl-unblocked-observation-v1','game_id':gid,
            'source_payload_sha256':fingerprint(payload),'events':events,
            'quarantine':quarantine,'excluded':dict(excluded),
            'input_events':len(plays),'complete':not quarantine and bool(events)}
