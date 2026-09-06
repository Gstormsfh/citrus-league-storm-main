"""Versioned official PL variant with explicit historical team spellings.

Only reviewed NHL header aliases and the same-clock PEND/GEND/GOFF terminal
triple extend v1. Original bytes, rows, ambiguity, clocks and coordinates remain
unchanged. This is retrospective source correspondence, not model acceptance.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import re

from acquisition.canonical_events import normalize_pbp
from acquisition.event_observation_service import prepare_observation
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint, timestamp
from projections.causal_feature_contract import UNAVAILABLE_FAMILIES
from projections.report_feature_source import (
    _ReportParser, report_url, validate_report_transport, CODE, ATTEMPTS, PREGAME,
)

VERSION = 'citrus-official-pl-retrospective-features-v2'
# Explicit official-report spellings, bound to canonical NHL team identities.
HISTORICAL_ALIASES = {
    'SJS': (28, 'S.J', 'SAN JOSE SHARKS'),
    'LAK': (26, 'L.A', 'LOS ANGELES KINGS'),
    'TBL': (14, 'T.B', 'TAMPA BAY LIGHTNING'),
    'NJD': (1, 'N.J', 'NEW JERSEY DEVILS'),
}


def _header_label(header, canonical, team_id, observed):
    if observed == canonical:
        return canonical
    approved = HISTORICAL_ALIASES.get(canonical)
    if (approved is None or type(team_id) is not int or team_id != approved[0]
            or observed != approved[1] or approved[2] not in header):
        raise ValueError('Unapproved report team alias/identity')
    return observed


def parse_report(body, *, game_id, game_date, away_abbrev, home_abbrev, away_team_id=None, home_team_id=None):
    """Parse exact official English report layout; fail rather than skip rows."""
    report_url(game_id)
    if type(body) is not bytes:raise ValueError('Exact report bytes required')
    parser=_ReportParser()
    # NHL legacy reports declare ISO-8859-1; ASCII identity fields are identical.
    parser.feed(body.decode('latin-1'));parser.close()
    header=' '.join(' '.join(parser.header).split())
    day=datetime.strptime(game_date,'%Y-%m-%d')
    date_text=f'{day.strftime("%A, %B")} {day.day}, {day.year}'
    observed_labels = re.findall(r'([A-Z.]+) On Ice', header)
    if len(observed_labels) != 2:
        raise ValueError('Exact pair of report header team labels required')
    away_label = _header_label(header, away_abbrev, away_team_id, observed_labels[0])
    home_label = _header_label(header, home_abbrev, home_team_id, observed_labels[1])
    aliases = {away_label:away_abbrev, home_label:home_abbrev}
    if (date_text not in header or f'Game {game_id%10000:04d}' not in header or 'Final' not in header
            or 'Play By Play' not in header or f'{away_label} On Ice' not in header
            or f'{home_label} On Ice' not in header
            or header.index(f'{away_label} On Ice')>=header.index(f'{home_label} On Ice')):
        raise ValueError('Report header identity/date/team/final conflict')
    rows=[];previous=None
    for cells in parser.rows:
        if not cells[0].isdigit() or not cells[1].isdigit():raise ValueError('Unsupported report row/period identity')
        number,period=int(cells[0]),int(cells[1])
        clock=cells[3].split('|')[0].strip()
        if re.fullmatch(r'\d{1,2}:\d{2}',clock) is None:raise ValueError('Invalid report clock')
        minutes,seconds=map(int,clock.split(':'));elapsed=60*minutes+seconds
        if seconds>=60 or elapsed>1200 or period<1 or number != len(rows)+1:
            raise ValueError('Invalid report clock or incomplete numbered inventory')
        if previous and (period<previous[0] or (period==previous[0] and elapsed<previous[1])):
            raise ValueError('Report chronology is nonmonotone')
        previous=(period,elapsed)
        description=cells[5]
        actor=re.match(r'([A-Z.]+) (?:ONGOAL - )?#(\d+)',description)
        distance=re.search(r'(?<![\d.])(\d+) ft\.',description)
        rows.append({'report_row':number,'period':period,'seconds_into_period':elapsed,
                     'event_type':cells[4],'strength_annotation':cells[2] or None,
                     'description':description,'raw_report_cells':list(cells),
                     'actor_team_label_raw':actor[1] if actor else None,
                     'header_team_labels_raw':[away_label,home_label],
                     'actor_team_abbrev':aliases.get(actor[1],actor[1]) if actor else None,
                     'actor_sweater':int(actor[2]) if actor else None,
                     'reported_distance_ft':int(distance[1]) if distance and cells[4] in ATTEMPTS else None})
    tail=rows[-3:]
    official_end=(len(tail)==3 and [r['event_type'] for r in tail]==['PEND','GEND','GOFF']
        and len({(r['period'],r['seconds_into_period']) for r in tail})==1
        and sum(r['event_type']=='GEND' for r in rows)==1
        and sum(r['event_type']=='GOFF' for r in rows)==1)
    if any(r['event_type']=='GOFF' for r in rows) and not official_end:
        raise ValueError('Nonterminal or duplicate GOFF administrative marker')
    if not rows or parser.row_depth is not None or (rows[-1]['event_type']!='GEND' and not official_end):
        raise ValueError('Incomplete report stream')
    return rows



def build_report_feature_source(pbp_receipt, report_body, report_receipt, *, now=None):
    """Report-first retrospective features with exact explicit correspondence.

    Original bytes remain caller-owned, addressed by their immutable digest;
    all parsed report rows and full PBP receipt are retained here. Ambiguous
    nonattempt identities do not get forced into an arbitrary one-to-one map.
    """
    source=json.loads(json.dumps(pbp_receipt,allow_nan=False))
    payload=source['prepared'][0]['payload']['pbp'];gid=payload['id']
    validate_report_transport(report_body,report_receipt,game_id=gid,now=now)
    observed=timestamp(source['observed_at'])
    clock=datetime.now(timezone.utc) if now is None else datetime.fromisoformat(timestamp(now))
    if (source['game_id']!=gid or type(source['game_id']) is not int
            or source['url']!=f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play'
            or datetime.fromisoformat(observed)>clock
            or list(prepare_observation(payload,observed))!=source['prepared']):
        raise ValueError('PBP receipt identity or normalization conflict')
    normalized=normalize_pbp(payload);final=verify_final_game(payload)
    if source['status']!='complete' or not normalized['complete'] or final['status']!='verified':
        raise ValueError('PBP final/population source gate unavailable')
    day=datetime.strptime(payload['gameDate'],'%Y-%m-%d').date()
    if (day.isoformat()!=payload['gameDate'] or day.year not in (gid//1000000,gid//1000000+1)
            or day>datetime.fromisoformat(observed).date()
            or day>datetime.fromisoformat(timestamp(report_receipt['observed_at'])).date()):
        raise ValueError('Game date conflicts with source observations')
    event_ids=[event.get('eventId') for event in payload['plays']]
    if any(type(eid) is not int or eid<0 for eid in event_ids) or len(set(event_ids))!=len(event_ids):
        raise ValueError('Full PBP event identity missing or duplicated')
    home,away=payload['homeTeam'],payload['awayTeam']
    rows=parse_report(report_body,game_id=gid,game_date=payload['gameDate'],away_abbrev=away['abbrev'],home_abbrev=home['abbrev'],away_team_id=away['id'],home_team_id=home['id'])
    teams={home['id']:home['abbrev'],away['id']:away['abbrev']}
    report_index=defaultdict(list)
    for row in rows:report_index[(row['period'],row['seconds_into_period'],row['event_type'])].append(row)
    roster=defaultdict(set)
    for person in payload.get('rosterSpots',[]):
        if all(type(person.get(k)) is int for k in ('teamId','playerId','sweaterNumber')):
            roster[(person['teamId'],person['playerId'])].add(person['sweaterNumber'])
    matches=[];ambiguous=[];features=[];used=set();source_counts=Counter()
    for ordinal,event in enumerate(payload['plays']):
        eid=event.get('eventId');descriptor=event.get('periodDescriptor',{});kind=CODE.get(event.get('typeCode'))
        identity={'event_id':eid,'raw_ordinal':ordinal,'raw_sort_order':event.get('sortOrder'),
                  'source_event_sha256':fingerprint(event)}
        if type(eid) is not int or kind is None or descriptor.get('periodType')=='SO':
            ambiguous.append({**identity,'reason':'unknown_event_type_identity_or_shootout','report_candidates':[]});continue
        minutes,seconds=map(int,event['timeInPeriod'].split(':'));elapsed=minutes*60+seconds
        source_counts[kind]+=1
        candidates=report_index.get((descriptor['number'],elapsed,kind),[])
        details=event.get('details') or {}
        if kind in ATTEMPTS:
            owner=details.get('eventOwnerTeamId');actor=details.get('scoringPlayerId' if kind=='GOAL' else 'shootingPlayerId')
            sweaters=roster.get((owner,actor),set())
            candidates=[r for r in candidates if r['actor_team_abbrev']==teams.get(owner)
                        and len(sweaters)==1 and r['actor_sweater'] in sweaters]
        if len(candidates)!=1 or candidates[0]['report_row'] in used:
            ambiguous.append({**identity,'reason':'unmatched_or_ambiguous_report_identity',
                              'report_candidates':[r['report_row'] for r in candidates]});continue
        row=candidates[0];used.add(row['report_row']);matches.append({**identity,'report_row':row['report_row']})
        if kind not in ATTEMPTS:continue
        distance=row['reported_distance_ft'];diag={'status':'unavailable','net':None}
        x,y=details.get('xCoord'),details.get('yCoord')
        if distance is not None and all(type(v) in (int,float) and math.isfinite(v) for v in (x,y)):
            errors={'+89':abs(math.hypot(89-x,y)-distance),'-89':abs(math.hypot(-89-x,y)-distance)}
            nets=[net for net,error in errors.items() if error<=1]
            diag={'status':'one_net_within_diagnostic_1ft' if len(nets)==1 else 'ambiguous_or_distance_conflict',
                  'net':nets[0] if len(nets)==1 else None,'absolute_distance_errors_ft':errors,
                  'semantics':'diagnostic_not_orientation_acceptance'}
        prefix=rows[:row['report_row']-1]
        score_known=any(r['event_type']=='PSTR' and r['period']==1 and r['seconds_into_period']==0 for r in prefix)
        goals=Counter(r['actor_team_abbrev'] for r in prefix if r['event_type']=='GOAL')
        score_known=score_known and set(goals)<=set(teams.values())
        owner_abbrev=teams[details['eventOwnerTeamId']];opponent=away['abbrev'] if owner_abbrev==home['abbrev'] else home['abbrev']
        features.append({**identity,'game_id':gid,'game_date':payload['gameDate'],'report_row':row['report_row'],
                         'reported_distance_ft':distance,'reported_distance_status':'available' if distance is not None else 'unavailable',
                         'report_pre_shot_score_differential':goals[owner_abbrev]-goals[opponent] if score_known else None,
                         'coordinate_distance_diagnostic':diag,'retrospective_labels':{'is_goal':kind=='GOAL'}})
    report_counts=Counter(r['event_type'] for r in rows)
    administrative=[{'report_row':r['report_row'],'period':r['period'],
        'seconds_into_period':r['seconds_into_period'],'raw_report_cells_sha256':fingerprint(r['raw_report_cells']),
        'reason':'validated_same_clock_terminal_game_official_marker'} for r in rows if r['event_type']=='GOFF']
    gameplay_counts=Counter(r['event_type'] for r in rows if r['event_type'] not in PREGAME and r['event_type']!='GOFF')
    body={'contract':VERSION,'status':'retrospective_candidate_not_training_ready','training_ready':False,
          'publishable':False,'historical_as_of_verified':False,'game_id':gid,
          'preserved_family_catalog':dict(UNAVAILABLE_FAMILIES),
          'source_receipt':source,'source_receipt_sha256':fingerprint(source),
          'report_transport_receipt':json.loads(json.dumps(report_receipt,allow_nan=False)),
          'report_body_sha256':hashlib.sha256(report_body).hexdigest(),'report_rows':rows,
          'exact_matches':matches,'unresolved_identities':ambiguous,
          'unmatched_report_rows':[r['report_row'] for r in rows if r['report_row'] not in used],
          'source_type_counts':dict(source_counts),'report_type_counts':dict(report_counts),
          'report_gameplay_type_counts':dict(gameplay_counts),'excluded_administrative_report_rows':administrative,
          'gameplay_type_counts_match':source_counts==gameplay_counts,
          'attempt_population_matched':len(features)==len(normalized['events'])==sum(report_counts[k] for k in ATTEMPTS),
          'features_in_report_order':sorted(features,key=lambda r:r['report_row']),
          'limitations':['retrospective_report_order_not_original_delivery_order',
                         'distinct_representations_not_independent_sensors','no_automatic_orientation_repair']}
    return {**body,'feature_source_sha256':fingerprint(body)}
