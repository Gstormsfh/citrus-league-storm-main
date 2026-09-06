import importlib.util
import json
from pathlib import Path

import pytest

from acquisition.event_observation_service import prepare_observation


@pytest.fixture
def collector():
    path = Path(__file__).resolve().parents[2] / 'scripts/nhl_archive/collect_goal_sog_evidence.py'
    spec = importlib.util.spec_from_file_location('goal_sog_collector_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Response:
    status_code = 200
    url = 'https://www.nhl.com/test'
    headers = {'Content-Type': 'text/html'}
    content = b'<html>synthetic report\r\n</html>'


def test_response_preserves_exact_bytes_and_actual_times(collector, tmp_path):
    times = iter(['2026-09-06T10:00:00Z', '2026-09-06T10:00:01Z'])
    def request(url, **kwargs):
        assert kwargs['allow_redirects'] is False
        return Response()
    result = collector.freeze_response(Response.url, tmp_path, 'one', request, lambda: next(times))
    assert result['raw_body_sha256'] == collector.sha(Response.content)
    assert (tmp_path / 'one.body').read_bytes() == Response.content
    assert result['requested_at'] != result['retrieved_at']
    assert result['status'] == 'retrieved_requires_review'
    with pytest.raises(FileExistsError):
        collector.freeze_response(Response.url, tmp_path, 'one', request)


def test_failure_is_frozen_without_fake_payload_or_leaking_exception(collector, tmp_path):
    def request(*args, **kwargs):
        raise RuntimeError('SECRET should never enter evidence')
    result = collector.freeze_response(Response.url, tmp_path, 'failed', request)
    assert result['status'] == 'unavailable' and result['body_file'] is None
    assert 'SECRET' not in (tmp_path / 'failed.receipt.json').read_text()


@pytest.mark.parametrize('url', ['http://www.nhl.com/a', 'https://example.com/a',
                               'https://user:password@www.nhl.com/a'])
def test_nonofficial_or_credential_urls_rejected(collector, tmp_path, url):
    with pytest.raises(ValueError):
        collector.freeze_response(url, tmp_path, 'bad', lambda *a, **k: Response())
    assert list(tmp_path.iterdir()) == []


def test_redirect_body_retained_but_not_trusted_as_source(collector, tmp_path):
    response = Response()
    response.status_code = 302
    response.headers = {'Location': 'https://example.com'}
    result = collector.freeze_response(Response.url, tmp_path, 'redirect', lambda *a, **k: response)
    assert result['status'] == 'http_failure'
    assert result['location'] == 'https://example.com' and result['raw_body_sha256']


def synthetic_inputs(tmp_path):
    gid = 2025020001
    goals = [{'eventId': i, 'typeCode': 505, 'periodDescriptor': {'number': 1, 'periodType': 'REG'},
              'timeInPeriod': '01:00', 'details': {'eventOwnerTeamId': 1, 'scoringPlayerId': 5}}
             for i in (1, 2)]
    goals[1]['details']['shotType'] = 'wrist'
    payload = {'id': gid, 'season': 20252026, 'gameType': 2, 'gameDate': '2025-10-01',
               'homeTeam': {'id': 1, 'abbrev': 'NJD'}, 'awayTeam': {'id': 2, 'abbrev': 'NYI'},
               'plays': goals}
    prepared = list(prepare_observation(payload, '2026-09-06T01:00:00Z'))
    receipt = {'status': 'complete', 'observed_at': '2026-09-06T01:00:00Z', 'prepared': prepared}
    source_dir = tmp_path / 'receipts'
    source_dir.mkdir()
    (source_dir / f'{gid}.json').write_text(json.dumps(receipt))
    gate = {'reason': 'final_attempt_totals_mismatch', 'differences': [{'field': 'sog', 'team_id': 1}]}
    game = {'game_id': gid, 'source_snapshot_id': prepared[0]['id'], 'final_game_evidence': gate}
    report = tmp_path / 'reconciliation.json'
    report.write_text(json.dumps({'games': [game, game]}))
    return report, source_dir


def test_all_affected_team_goals_retained_not_only_missing_shot_type(collector, tmp_path):
    report, source_dir = synthetic_inputs(tmp_path)
    cases, hashes = collector.build_cases(report, [source_dir])
    assert len(cases) == 1
    assert [g['event_id'] for g in cases[0]['goal_candidates']] == [1, 2]
    assert all(g['sog_contribution'] is None for g in cases[0]['goal_candidates'])
    assert all(g['source_event_sha256'] for g in cases[0]['goal_candidates'])
    assert len(hashes) == 2


def test_tampered_original_normalization_is_rejected(collector, tmp_path):
    report, source_dir = synthetic_inputs(tmp_path)
    path = next(source_dir.iterdir())
    receipt = json.loads(path.read_text())
    receipt['prepared'][0]['payload']['pbp']['plays'][0]['timeInPeriod'] = '02:00'
    path.write_text(json.dumps(receipt))
    with pytest.raises(ValueError, match='normalization conflict'):
        collector.build_cases(report, [source_dir])


def test_review_does_not_convert_narrative_into_adjudication(collector, tmp_path):
    path = Path(__file__).resolve().parents[2] / 'scripts/nhl_archive/review_goal_sog_evidence.py'
    spec = importlib.util.spec_from_file_location('goal_sog_review_test', path)
    reviewer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reviewer)
    report, source_dir = synthetic_inputs(tmp_path)
    cases, _ = collector.build_cases(report, [source_dir])
    case = cases[0]
    case['sources'] = [{'url': Response.url, 'kind': 'article'}]
    evidence = tmp_path / 'evidence.json'
    evidence.write_text(json.dumps({'cases': cases}))
    reviewer.REVIEWS = {case['game_id']: (1, 'awarded_empty_net', 'Synthetic award', 'Synthetic narrative only')}
    class Article(Response):
        content = b'<html><p>Synthetic award described here.</p></html>'
    collector.freeze_response(Response.url, tmp_path, 'article', lambda *a, **k: Article())
    result = reviewer.review(evidence)
    assert result['affirmative_narrative_cases'] == 1
    assert result['cases'][0]['proposed_sog_contribution'] == 0
    assert result['cases'][0]['adjudicated_sog_contribution'] is None
    assert result['adjudicated_cases'] == 0 and not result['canonical_gate_changed']
    assert len(result['cases'][0]['all_affected_team_goal_candidates']) == 2
    case['sources'] = [{'url': 'https://www.nhl.com/news/different-game', 'kind': 'article'}]
    evidence.write_text(json.dumps({'cases': cases}))
    unrelated = reviewer.review(evidence)
    assert unrelated['affirmative_narrative_cases'] == 0
    assert unrelated['cases'][0]['proposed_sog_contribution'] is None
    (tmp_path / 'article.body').write_bytes(b'edited')
    with pytest.raises(ValueError, match='hash changed'):
        reviewer.review(evidence)


def test_report_own_goal_requires_unique_exact_identity_and_clock():
    path = Path(__file__).resolve().parents[2] / 'scripts/nhl_archive/review_goal_sog_evidence.py'
    spec = importlib.util.spec_from_file_location('goal_sog_rows_test', path)
    reviewer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reviewer)
    event = {'team_id': 20, 'period': {'number': 4}, 'clock': '01:53',
             'roster_identity': {'sweaterNumber': 47, 'lastName': {'default': 'Zary'}}}
    teams = {'homeTeam': {'id': 20, 'abbrev': 'CGY'}}
    row = (b'<tr id="PL-290"><td>290</td><td>4</td><td>PP</td>'
           b'<td>1:53<br>3:07</td><td>GOAL</td>'
           b'<td>CGY #47 ZARY(5) , Off. Zone, Own Goal, 6 ft.</td>')
    match = reviewer.report_goal_rows(row, event, teams)
    assert match[0]['explicit_own_goal_label'] is True
    assert match[0]['report_row_id'] == 'PL-290'
    assert reviewer.report_goal_rows(row + row, event, teams) == []
    for old, new in [(b'1:53', b'1:54'), (b'#47', b'#48'), (b'ZARY', b'OTHER'),
                     (b'CGY', b'BOS'), (b'<td>4', b'<td>3')]:
        assert reviewer.report_goal_rows(row.replace(old, new), event, teams) == []
    unlabelled = reviewer.report_goal_rows(row.replace(b'Own Goal, ', b''), event, teams)
    assert unlabelled[0]['explicit_own_goal_label'] is False


@pytest.fixture
def reviewer():
    path = Path(__file__).resolve().parents[2] / 'scripts/nhl_archive/review_goal_sog_evidence.py'
    spec = importlib.util.spec_from_file_location('goal_sog_stats_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def report_row(cells, attr=''):
    return '<tr ' + attr + '>' + ''.join(f'<td>{c}</td>' for c in cells) + '</tr>'


def es_fixture():
    teams = {'awayTeam': {'id': 1, 'abbrev': 'AAA'}, 'homeTeam': {'id': 2, 'abbrev': 'BBB'}}
    roster = [{'teamId': team, 'playerId': team * 10, 'sweaterNumber': 7,
               'lastName': {'default': 'Test'}, 'firstName': {'default': 'Nick'}} for team in (1,2)]
    parts = []
    for side, goal, shot in [('visitor',1,2),('home',0,0)]:
        parts.append(report_row(['TEAM','G','A','P','+/-','PN','PIM','TOI','S','A/B','MS','HT','GV','TK','BS','FW','FL','F%'], f'class="{side}sectionheading"'))
        player = [''] * 25
        player[0:4] = ['7','C','TEST, NICHOLAS',str(goal)]
        player[15] = str(shot) if shot else '&nbsp;'
        parts.append(report_row(player))
        total = [''] * 23
        total[0:2] = ['TEAM TOTALS',str(goal)]
        total[13] = str(shot)
        parts.append(report_row(total))
    return ''.join(parts).encode(), teams, roster


def test_es_complete_population_and_explicit_blank_cell_convention(reviewer):
    body, teams, roster = es_fixture()
    players, totals = reviewer.event_summary(body, teams, roster)
    assert players[(1,10)]['goals'] == 1 and players[(1,10)]['sog'] == 2
    assert players[(2,20)]['sog'] == 0
    assert players[(1,10)]['report_name'] == 'TEST, NICHOLAS'
    assert totals[1]['sog'] == 2
    with pytest.raises(ValueError, match='surname'):
        reviewer.event_summary(body.replace(b'TEST, NICHOLAS', b'OTHER, NICHOLAS'), teams, roster)
    with pytest.raises(ValueError, match='Ambiguous'):
        reviewer.event_summary(body, teams, roster + [roster[0]])
    with pytest.raises(ValueError, match='population'):
        reviewer.event_summary(body, teams, roster + [{**roster[0], 'playerId':99,'sweaterNumber':9}])
    with pytest.raises(ValueError, match='totals mismatch'):
        reviewer.event_summary(body.replace(b'<td>2</td>', b'<td>3</td>', 1), teams, roster)
    with pytest.raises(ValueError):
        reviewer.event_summary(body[:body.index(b'<tr class="homesectionheading"')], teams, roster)


def test_corroboration_requires_original_frozen_receipt(reviewer, tmp_path):
    path = tmp_path / 'original.json'
    path.write_text('{}')
    with pytest.raises(ValueError, match='Original PBP receipt hash changed'):
        reviewer.statistical_corroboration({'original_receipt_path':str(path),
            'original_receipt_bytes_sha256':'edited'}, {}, [])


def test_definition_receipts_cannot_accept_edited_body(reviewer, tmp_path):
    documents = []
    for i,url in enumerate(['https://media.nhl.com/site/asset/public/ext/2025-26/2025-26Rules.pdf',
                            'https://www.nhl.com/info/hockey-glossary']):
        name = f'{i}.body'
        (tmp_path / name).write_bytes(b'synthetic')
        documents.append({'url':url,'response_url':url,'http_status':200,'body_file':name,
                          'body_sha256':reviewer.digest(b'synthetic')})
    receipt = tmp_path / 'receipt.json'
    receipt.write_text(json.dumps({'documents':documents}))
    assert reviewer.validate_definitions(receipt)['publication_approval'] is False
    (tmp_path / '0.body').write_bytes(b'edited')
    with pytest.raises(ValueError, match='Invalid frozen'):
        reviewer.validate_definitions(receipt)


def test_full_statistical_check_preserves_goals_and_excludes_only_explicit_so(reviewer, tmp_path):
    es, teams, roster = es_fixture()
    plays = [{'typeCode':code, 'periodDescriptor':{'number':period,'periodType':kind},
              'details':{'eventOwnerTeamId':1, 'scoringPlayerId':10,'shootingPlayerId':10}}
             for code,period,kind in [(505,1,'REG'),(506,1,'REG'),(506,1,'REG'),(505,5,'SO')]]
    pbp = {'plays':plays,'rosterSpots':roster}
    path = tmp_path / 'original.json'
    path.write_text(json.dumps({'prepared':[{'payload':{'pbp':pbp}}]}))
    pl = ''.join(report_row([str(i),str(period),'EV','1:00<br>19:00',kind,
                'AAA #7 TEST(1)' if kind == 'GOAL' else 'AAA ONGOAL - #7 TEST, Wrist'],
                f'id="PL-{i}"') for i,period,kind in [(1,1,'GOAL'),(2,1,'SHOT'),(3,1,'SHOT'),(4,5,'GOAL')]).encode()
    gs = ''.join(report_row(['TEAM','GOALS-SHOTS AGAINST'],f'class="{side}sectionheading"')
                + report_row(['TEAM TOTALS',value])
                for side,value in [('visitor','0-0'),('home','1-2')]).encode()
    sources = [(None,{'url':f'https://www.nhl.com/{kind}','raw_body_sha256':reviewer.digest(body),
                      'retrieved_at':'2026-09-06T05:00:00Z'},body)
               for kind,body in [('ES',es),('GS',gs),('PL',pl)]]
    case = {'original_receipt_path':str(path),'original_receipt_bytes_sha256':reviewer.digest(path.read_bytes()),
            'teams':teams,'sources':[{'kind':kind,'url':f'https://www.nhl.com/{kind}'} for kind in ('ES','GS','PL')]}
    result = reviewer.statistical_corroboration(case,{'team_id':1,'player_id':10},sources)
    assert result['status'] == 'corroborated'
    assert len(result['excluded_shootout_report_attempts']) == 1
    player = next(p for p in result['players'] if p['player_id']==10)
    assert player['json_unadjusted'] == {'goals':1,'sog':3}
    assert player['proposed'] == {'goals':1,'sog':2}
    wrong_target = reviewer.statistical_corroboration(case,{'team_id':2,'player_id':20},sources)
    assert wrong_target['status'] == 'unresolved_totals'
    # Period 5 must not be blindly excluded: playoff overtime remains counted.
    plays[-1]['periodDescriptor']['periodType'] = 'OT'
    path.write_text(json.dumps({'prepared':[{'payload':{'pbp':pbp}}]}))
    case['original_receipt_bytes_sha256'] = reviewer.digest(path.read_bytes())
    overtime = reviewer.statistical_corroboration(case,{'team_id':1,'player_id':10},sources)
    assert overtime['excluded_shootout_report_attempts'] == []
    assert overtime['status'] == 'unresolved_totals'
