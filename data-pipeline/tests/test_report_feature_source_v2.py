"""Synthetic v2 report contracts; no model fit or raw source repair."""
import hashlib
import json
from copy import deepcopy

import pytest
from acquisition.event_observation_service import prepare_observation
from projections.report_feature_source_v2 import parse_report, build_report_feature_source, report_url, HISTORICAL_ALIASES

NOW='2026-09-06T10:00:00Z'


def fixture(canonical='SJS', alias='S.J', team_id=28, full_name='SAN JOSE SHARKS', terminal=True):
    plays=[{'eventId':i,'sortOrder':i,'typeCode':code,'timeInPeriod':clock,
            'periodDescriptor':{'number':1,'periodType':'REG'},
            'details':{'eventOwnerTeamId':team_id,'scoringPlayerId':10,'shootingPlayerId':10,'xCoord':79,'yCoord':0}}
           for i,code,clock in [(1,520,'00:00'),(2,506,'00:10'),(3,505,'00:20'),(4,521,'20:00'),(5,524,'20:00')]]
    payload={'id':2017020001,'gameDate':'2017-10-04','gameType':2,'season':20172018,'gameState':'OFF',
             'periodDescriptor':{'number':3,'periodType':'REG'},
             'homeTeam':{'id':team_id,'abbrev':canonical,'score':1,'sog':2},
             'awayTeam':{'id':2,'abbrev':'NYI','score':0,'sog':0},'plays':plays,
             'rosterSpots':[{'teamId':team_id,'playerId':10,'sweaterNumber':7}]}
    observed='2026-09-06T05:00:01+00:00'
    source={'game_id':payload['id'],'observed_at':observed,'status':'complete',
            'url':f"https://api-web.nhle.com/v1/gamecenter/{payload['id']}/play-by-play",
            'prepared':list(prepare_observation(payload,observed))}
    header=f'Play By Play Wednesday, October 4, 2017 Game 0001 Final NEW YORK ISLANDERS {full_name} NYI On Ice {alias} On Ice'
    entries=[('0:00','PSTR','Period Start'),('0:10','SHOT',f'{alias} ONGOAL - #7 PLAYER, Wrist, 10 ft.'),
             ('0:20','GOAL',f'{alias} #7 PLAYER(1), Wrist, 10 ft.'),('20:00','PEND','Period End'),('20:00','GEND','Game End')]
    if terminal:entries.append(('20:00','GOFF','Game Official'))
    rows=''.join('<tr class="evenColor">'+''.join(f'<td>{x}</td>' for x in (n,1,'EV',clock+'<br>0:00',kind,desc))+'</tr>'
                 for n,(clock,kind,desc) in enumerate(entries,1))
    body=('<html>'+header+'<table>'+rows+'</table></html>').encode()
    receipt={'game_id':payload['id'],'url':report_url(payload['id']),'response_url':report_url(payload['id']),
             'http_status':200,'body_sha256':hashlib.sha256(body).hexdigest(),'body_bytes':len(body),
             'requested_at':'2026-09-06T05:00:00Z','observed_at':observed,'historical_as_of_verified':False,
             'byte_contract':'requests-content-after-decompression-not-wire-bytes','timing_semantics':'per-response'}
    return payload,source,body,receipt


@pytest.mark.parametrize('canonical',list(HISTORICAL_ALIASES))
def test_explicit_official_alias_preserves_raw_and_matches_exact_roster(canonical):
    tid,alias,name=HISTORICAL_ALIASES[canonical]
    payload,source,body,receipt=fixture(canonical,alias,tid,name)
    original=deepcopy(source)
    out=build_report_feature_source(source,body,receipt,now=NOW)
    assert out['attempt_population_matched'] and len(out['features_in_report_order'])==2
    assert out['report_rows'][1]['actor_team_label_raw']==alias
    assert out['report_rows'][1]['actor_team_abbrev']==canonical
    assert out['report_rows'][-1]['event_type']=='GOFF'
    assert out['report_type_counts']['GOFF']==1 and 'GOFF' not in out['report_gameplay_type_counts']
    assert len(out['excluded_administrative_report_rows'])==1 and out['gameplay_type_counts_match']
    assert out['source_receipt']==original and source==original
    assert all('raw_report_cells' in r for r in out['report_rows'])
    assert not out['training_ready'] and not out['publishable']


@pytest.mark.parametrize('kind',['alias','id','name','clock','rows','missing_gend','after_gend','nonterminal_goff'])
def test_alias_and_terminal_policy_does_not_weaken_other_gates(kind):
    payload,source,body,receipt=fixture()
    kwargs={'game_id':payload['id'],'game_date':payload['gameDate'],'away_abbrev':'NYI','home_abbrev':'SJS',
            'away_team_id':2,'home_team_id':28}
    if kind=='alias':body=body.replace(b'S.J',b'S..J')
    elif kind=='id':kwargs['home_team_id']=29
    elif kind=='name':body=body.replace(b'SAN JOSE SHARKS',b'OTHER TEAM')
    elif kind=='clock':body=body.replace(b'0:20',b'0:05')
    elif kind=='rows':body=body.replace(b'<td>3</td>',b'<td>8</td>')
    elif kind=='missing_gend':body=body.replace(b'GEND',b'STOP')
    elif kind=='nonterminal_goff':body=body.replace(b'PSTR',b'GOFF').replace(b'<td>GOFF</td><td>Game Official',b'<td>GEND</td><td>Game Official')
    else:body=body.replace(b'PEND',b'SHOT')
    with pytest.raises(ValueError):parse_report(body,**kwargs)


def test_missing_roster_stays_ambiguous_not_inferred():
    payload,source,body,receipt=fixture();payload['rosterSpots']=[]
    source['prepared']=list(prepare_observation(payload,source['observed_at']))
    out=build_report_feature_source(source,body,receipt,now=NOW)
    assert not out['attempt_population_matched'] and not out['features_in_report_order']
    assert len(out['unresolved_identities'])==2


def test_standard_spelling_remains_supported():
    payload,source,body,receipt=fixture(alias='SJS',terminal=False)
    out=build_report_feature_source(source,body,receipt,now=NOW)
    assert out['attempt_population_matched']
