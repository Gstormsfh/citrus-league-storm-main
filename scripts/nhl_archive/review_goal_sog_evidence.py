"""Offline, explicitly provisional review index of frozen primary reports.

Manual narrative classifications below are NOT executable statistical overrides.
No source changes, missing-shotType inference, or canonical publication occurs.
Source paragraph indexes/hashes are locators; report aggregate discrepancies
remain corroborating evidence, not an automatic event-level SOG adjudication.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import unicodedata
from collections import Counter


# game -> (original JSON event ID, narrative class, paragraph locator, paraphrase)
REVIEWS = {
2025020184:(104,'awarded_displaced_net','MacKinnon then tied','MacKinnon awarded goal after opponent displaced the net.'),
2025020208:(1052,'awarded_displaced_net','After Predators goalie Justus','Johansson awarded goal following goalkeeper net displacement.'),
2025020236:(804,'opponent_put_loose_puck_in','Carlson tied it','Cernak punched the loose puck in after the initial attempt.'),
2025020282:(162,'opponent_touch_after_kick','Drouin was credited','Drouin credited after a kicked puck contacted Schmidt and entered.'),
2025020307:(74,'opponent_put_loose_puck_in','The Blues went up','Nylander swatted in the puck following a blocked Walker attempt.'),
2025020395:(304,'awarded_empty_net','Tippett was awarded','Tippett awarded empty-net goal after being tripped.'),
2025020470:(406,'opponent_put_loose_puck_in','Sennecke shoveled','Karlsson gloved the puck into his own net.'),
2025020499:(106,'opponent_put_pass_in','McDavid began','Stecher put McDavid’s centering pass into his own net.'),
2025020561:(110,'opponent_put_loose_puck_in','Graf gave the Sharks','Larsson put the loose puck into his own net.'),
2025020599:(252,'opponent_put_loose_puck_in','William Eklund was credited','Rossi batted the puck into his own net.'),
2025020613:(210,'unresolved_defender_touch_not_sufficient','Boston defenseman Jonathan Aspirot','Recap describes Zary’s shot with possible defender help, insufficient to establish a non-shot credited goal.'),
2025020630:(603,'opponent_put_loose_puck_in','Konecny was credited','Kadri knocked the loose puck across the goal line.'),
2025020653:(472,'awarded_empty_net','MacKinnon was awarded','MacKinnon awarded empty-net goal after being taken down.'),
2025020655:(15,'opponent_put_loose_puck_in','Byfield put Los Angeles','A Wild stick knocked the puck in during a scramble.'),
2025020660:(101,'opponent_put_loose_puck_in','Ehlers gave Carolina','Hughes put a rebound into his own net.'),
2025020671:(285,'goalkeeper_put_saved_puck_in','Robertson tied it','Bussi moved the saved puck into the net while rolling over.'),
2025020683:(1021,'awarded_empty_net','Slafkovsky was awarded','Slafkovsky awarded empty-net goal after his stick was slashed.'),
2025020708:(210,'opponent_put_loose_puck_in','Jean-Gabriel Pageau was credited','Johansson pushed the rebound into his own net; Pageau received credit.'),
2025020723:(301,'opponent_deflected_pass_in','Cowan gave Toronto','Cowan’s pass entered off Burns’s skate.'),
2025020811:(404,'awarded_empty_net','JJ Peterka was awarded','Peterka awarded empty-net goal after being taken down.'),
2025020887:(309,'awarded_empty_net','Olivier was then credited','Olivier credited after Hamilton slashed him during an empty-net attempt.'),
2025020930:(1169,'opponent_put_loose_puck_in','Sam Bennett was credited','Dahlin swept a post rebound into his own net.'),
2025021003:(803,'opponent_put_pass_in','Brayden Point made it','Byram knocked Point’s centering pass into the net.'),
2025021019:(704,'opponent_put_loose_puck_in','Ritchie made it','Finley inadvertently put the puck into his own net.'),
2025021058:(169,'opponent_deflected_pass_in','Ottawa tied it 1-1','Recap calls Batherson’s goal an own goal off Ferraro’s stick.'),
2025021102:(863,'opponent_put_loose_puck_in','On the ensuing power play after Carrick','Ceci knocked the puck in following the stopped Dahlin attempt.'),
2025021109:(552,'opponent_put_loose_puck_in','Josh Samanski closed','Bjorkstrand sent the puck into his own net; Samanski received credit.'),
2025021123:(959,'opponent_deflected_pass_in','Gregor gave the Panthers','Gregor’s centering pass entered off Wright’s stick.'),
2025021127:(202,'awarded_empty_net','Hagel scored into an empty net','Holmberg awarded empty-net goal after being taken down.'),
2025021285:(886,'opponent_put_loose_puck_in','Dallas tied it 5-5','Stecher stole the puck then backhanded it into his own net.'),
2025030172:(450,'opponent_put_loose_puck_in','MacKenzie Weegar was credited','Andersson kicked a saved-shot rebound into his own net; Weegar credited.'),
2025030213:(208,'awarded_empty_net','Newhook, who scored twice','Newhook awarded empty-net goal after being hooked and hitting the post.'),
}

# Explicit alternate recap identities; paragraph wording alone never binds a game.
SUPPLEMENTAL_URLS = {
    2025020282: {'https://www.nhl.com/news/new-york-islanders-utah-mammoth-november-14-2025'},
    2025030172: {'https://www.nhl.com/news/utah-mammoth-vegas-golden-knights-game-2-recap-april-21-2026'},
    2025030213: {'https://www.nhl.com/news/topic/playoffs/buffalo-sabres-montreal-canadiens-game-3-recap-may-10-2026'},
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def paragraphs(data):
    return [' '.join(html.unescape(re.sub('<[^>]+>', ' ', value)).split())
            for value in re.findall(r'<p\b[^>]*>(.*?)</p>', data.decode('utf-8'), re.S)]


def report_goal_rows(data, event, teams):
    """Match report identity, not its unrelated PL ordinal, to the JSON goal.

    Six leading cells precede nested on-ice tables in official PL reports.
    Missing/ambiguous matches remain unavailable. Own Goal is an affirmative
    report label; absence of shot type is never consulted.
    """
    team = next(t['abbrev'] for t in teams.values() if t['id'] == event['team_id'])
    roster = event['roster_identity']
    identity = f"{team} #{roster['sweaterNumber']} {roster['lastName']['default'].upper()}("
    matches = []
    pattern = r'<tr\b[^>]*id="(PL-\d+)"[^>]*>\s*((?:<td\b[^>]*>.*?</td>\s*){6})'
    for match in re.finditer(pattern, data.decode('utf-8'), re.S):
        cells = re.findall(r'<td\b[^>]*>(.*?)</td>', match[2], re.S)
        clean = lambda value: ' '.join(html.unescape(re.sub('<[^>]+>', ' ', value)).split())
        text = list(map(clean, cells))
        clock = clean(re.split(r'<br\s*/?>', cells[3])[0])
        if (text[4] != 'GOAL' or text[1] != str(event['period']['number'])
                or tuple(map(int, clock.split(':'))) != tuple(map(int, event['clock'].split(':')))
                or not text[5].startswith(identity)):
            continue
        matches.append({'report_row_id': match[1], 'report_period': int(text[1]),
                        'report_clock': clock, 'report_description': text[5],
                        'row_prefix_utf8_sha256': digest(match[0].encode()),
                        'explicit_own_goal_label': bool(re.search(r'\bOwn Goal\b', text[5]))})
    if len(matches) != 1:
        return []
    return matches


def plain(value):
    return ' '.join(html.unescape(re.sub('<[^>]+>', ' ', value)).split())


def leaf_rows(data):
    """Read complete non-nested report rows; do not flatten on-ice tables."""
    pattern = r'<tr\b[^>]*>\s*((?:<td\b[^>]*>(?:(?!<tr\b).)*?</td>\s*)+)</tr>'
    for match in re.finditer(pattern, data.decode('utf-8'), re.S):
        yield match[0], [plain(v) for v in re.findall(r'<td\b[^>]*>(.*?)</td>', match[1], re.S)]


def event_summary(data, teams, roster):
    """Frozen NHL ES G/S columns; blank numeric cells mean zero only in this
    recognized complete report table, never in an unavailable API field.
    Verify table headers, identities, row widths, and player/team sums.
    """
    lookup = {(p['teamId'], str(p['sweaterNumber'])): p for p in roster}
    if len(lookup) != len(roster):
        raise ValueError('Ambiguous original roster team/sweater identity')
    players, totals, current = {}, {}, None
    number = lambda value: 0 if value == '' else int(value)
    for raw, cells in leaf_rows(data):
        if 'visitorsectionheading' in raw and len(cells) > 4 and cells[1:4] == ['G', 'A', 'P']:
            if cells[1:] != ['G','A','P','+/-','PN','PIM','TOI','S','A/B','MS','HT','GV','TK','BS','FW','FL','F%']:
                raise ValueError('Unrecognized ES statistical columns')
            current = teams['awayTeam']['id']
        elif 'homesectionheading' in raw and len(cells) > 4 and cells[1:4] == ['G', 'A', 'P']:
            if cells[1:] != ['G','A','P','+/-','PN','PIM','TOI','S','A/B','MS','HT','GV','TK','BS','FW','FL','F%']:
                raise ValueError('Unrecognized ES statistical columns')
            current = teams['homeTeam']['id']
        else:
            if current is None:
                continue
            if len(cells) == 25 and cells[0].isdigit() and cells[1] in ('C','L','R','D','G'):
                player = lookup.get((current, cells[0]))
                if player is None:
                    raise ValueError('ES player absent from original roster')
                surname = lambda v: ''.join(c for c in unicodedata.normalize('NFKD', v.upper())
                                            if not unicodedata.combining(c))
                if surname(cells[2].split(',')[0]) != surname(player['lastName']['default']):
                    raise ValueError('ES player surname mismatch')
                key = (current, player['playerId'])
                if key in players:
                    raise ValueError('Duplicate ES player')
                players[key] = {'goals': number(cells[3]), 'sog': number(cells[15]),
                                'report_name': cells[2],
                                'identity_basis': 'unique original team/sweater plus accent-normalized surname; given names retained without nickname inference',
                                'row_utf8_sha256': digest(raw.encode())}
            elif cells[0] == 'TEAM TOTALS':
                if len(cells) != 23 or current in totals:
                    raise ValueError('Invalid ES team totals')
                totals[current] = {'goals': number(cells[1]), 'sog': number(cells[13]),
                                   'row_utf8_sha256': digest(raw.encode())}
                current = None
    if set(totals) != {t['id'] for t in teams.values()}:
        raise ValueError('Incomplete ES team population')
    if set(players) != {(p['teamId'], p['playerId']) for p in roster}:
        raise ValueError('Incomplete ES original roster population')
    for team, total in totals.items():
        for stat in ('goals', 'sog'):
            if sum(p[stat] for (tid, _), p in players.items() if tid == team) != total[stat]:
                raise ValueError('ES player/team totals mismatch')
    return players, totals


def statistical_corroboration(case, event, sources):
    """Offline exact-event subtraction test; agreement alone authorizes nothing."""
    original = Path(case['original_receipt_path']).read_bytes()
    if digest(original) != case['original_receipt_bytes_sha256']:
        raise ValueError('Original PBP receipt hash changed')
    pbp = json.loads(original)['prepared'][0]['payload']['pbp']
    urls = {s['kind']: s['url'] for s in case['sources'] if s['kind'] in ('ES','PL','GS')}
    selected = {kind: [(p,m,b) for p,m,b in sources if m['url'] == url]
                for kind,url in urls.items()}
    if set(selected) != {'ES','PL','GS'} or any(len(v) != 1 for v in selected.values()):
        return {'status': 'unavailable', 'reason': 'unique_complete_reports_required'}
    players, teams = event_summary(selected['ES'][0][2], case['teams'], pbp['rosterSpots'])
    gs_totals, defending = [], None
    for raw, cells in leaf_rows(selected['GS'][0][2]):
        if cells[-1] == 'GOALS-SHOTS AGAINST':
            defending = (case['teams']['awayTeam']['id'] if 'visitorsectionheading' in raw
                         else case['teams']['homeTeam']['id'] if 'homesectionheading' in raw else None)
        elif defending is not None and cells[0] == 'TEAM TOTALS':
            if not re.fullmatch(r'\d+-\d+', cells[-1]):
                raise ValueError('Invalid GS goalie/team totals')
            goals, shots = map(int, cells[-1].split('-'))
            opponent = next(tid for tid in teams if tid != defending)
            gs_totals.append({'defending_team_id': defending, 'goals_against': goals,
                'shots_against': shots, 'row_utf8_sha256': digest(raw.encode()),
                'matches_opponent_es': goals == teams[opponent]['goals'] and shots == teams[opponent]['sog']})
            defending = None
    if len(gs_totals) != 2:
        raise ValueError('Incomplete GS goalie/team totals')
    json_counts = {stat: Counter() for stat in ('goals','sog')}
    for play in pbp['plays']:
        if play.get('periodDescriptor', {}).get('periodType') == 'SO':
            continue
        code, detail = play['typeCode'], play.get('details', {})
        if code not in (505,506):
            continue
        key = (detail['eventOwnerTeamId'], detail['scoringPlayerId' if code == 505 else 'shootingPlayerId'])
        if key not in players:
            raise ValueError('Attempt player absent from ES population')
        json_counts['sog'][key] += 1
        json_counts['goals'][key] += int(code == 505)
    # PL's displayed GOAL and SHOT events are counted independently. PL numbers
    # are report locators, never substituted for JSON eventId.
    roster_lookup = {(t['abbrev'], str(p['sweaterNumber'])): p for t in case['teams'].values()
                     for p in pbp['rosterSpots'] if p['teamId'] == t['id']}
    pl_counts = {stat: Counter() for stat in ('goals','sog')}
    pl_rows, excluded_so_rows = [], []
    so_periods = {str(p['periodDescriptor']['number']) for p in pbp['plays']
                  if p.get('periodDescriptor', {}).get('periodType') == 'SO'}
    pattern = r'<tr\b[^>]*id="(PL-\d+)"[^>]*>\s*((?:<td\b[^>]*>.*?</td>\s*){6})'
    for match in re.finditer(pattern, selected['PL'][0][2].decode('utf-8'), re.S):
        cells = [plain(v) for v in re.findall(r'<td\b[^>]*>(.*?)</td>', match[2], re.S)]
        if cells[4] not in ('GOAL','SHOT'):
            continue
        if cells[1] in so_periods:
            excluded_so_rows.append({'row_id': match[1], 'period': cells[1],
                                     'row_prefix_utf8_sha256': digest(match[0].encode())})
            continue
        identity = re.match(r'^([A-Z]{3}) (?:ONGOAL - )?#([0-9]+) ', cells[5])
        if identity is None or tuple(identity.groups()) not in roster_lookup:
            raise ValueError('Unmatched PL attempt identity')
        p = roster_lookup[tuple(identity.groups())]
        key = (p['teamId'], p['playerId'])
        pl_counts['sog'][key] += 1
        pl_counts['goals'][key] += int(cells[4] == 'GOAL')
        pl_rows.append({'row_id': match[1], 'team_id': key[0], 'player_id': key[1],
                        'period': cells[1], 'clock': cells[3], 'event_type': cells[4],
                        'row_prefix_utf8_sha256': digest(match[0].encode())})
    target = (event['team_id'], event['player_id'])
    comparisons = []
    for key, official in sorted(players.items()):
        before = {s: json_counts[s][key] for s in json_counts}
        after = {**before, 'sog': before['sog'] - int(key == target)}
        comparisons.append({'team_id': key[0], 'player_id': key[1],
            'official': official, 'json_unadjusted': before,
            'pl_unadjusted': {s: pl_counts[s][key] for s in pl_counts}, 'proposed': after,
            'proposed_matches_official': all(after[s] == official[s] for s in after)})
    team_comparisons = []
    for tid, official in teams.items():
        before = {s: sum(c['json_unadjusted'][s] for c in comparisons if c['team_id'] == tid) for s in json_counts}
        after = {s: sum(c['proposed'][s] for c in comparisons if c['team_id'] == tid) for s in json_counts}
        team_comparisons.append({'team_id': tid, 'official': official,
            'json_unadjusted': before, 'proposed': after,
            'proposed_matches_official': all(after[s] == official[s] for s in after)})
    concordant = json_counts == pl_counts
    matched = (all(c['proposed_matches_official'] for c in comparisons + team_comparisons)
               and all(c['matches_opponent_es'] for c in gs_totals))
    return {'status': 'corroborated' if matched and concordant else 'unresolved_totals',
        'json_pl_unadjusted_distributions_match': concordant,
        'all_proposed_player_team_totals_match': matched,
        'players': comparisons, 'teams': team_comparisons, 'complete_pl_attempt_rows': pl_rows,
        'gs_goalie_team_totals': gs_totals, 'excluded_shootout_report_attempts': excluded_so_rows,
        'sources': [{ 'kind': k, 'url': v[0][1]['url'], 'raw_body_sha256': v[0][1]['raw_body_sha256'],
                     'retrieved_at': v[0][1]['retrieved_at']} for k,v in selected.items()],
        'limitations': ['ES report blank numeric cells interpreted as zero only after recognized table validation',
                       'Aggregate agreement is corroboration, not sole event evidence or a publication approval']}


def review(evidence_path, supplemental_dirs=(), statistical=False):
    evidence_path = Path(evidence_path)
    raw = evidence_path.read_bytes()
    evidence = json.loads(raw)
    sources = []
    for directory in (evidence_path.parent, *map(Path, supplemental_dirs)):
        for path in directory.glob('*.receipt.json'):
            meta = json.loads(path.read_text())
            if meta.get('http_status') != 200 or not meta.get('body_file'):
                continue
            body_path = path.parent / meta['body_file']
            if body_path.name != meta['body_file'] or body_path.is_symlink():
                raise ValueError('Unsafe body path')
            body = body_path.read_bytes()
            if digest(body) != meta['raw_body_sha256']:
                raise ValueError('Frozen response hash changed')
            sources.append((path, meta, body))
    cases = []
    for case in evidence['cases']:
        gid = case['game_id']
        eid, classification, locator, explanation = REVIEWS[gid]
        matches = []
        allowed_urls = {source['url'] for source in case['sources']}
        allowed_urls.update(SUPPLEMENTAL_URLS.get(gid, set()))
        for path, meta, body in sources:
            if meta['url'] not in allowed_urls or '/scores/htmlreports/' in meta['url']:
                continue
            for index, paragraph in enumerate(paragraphs(body)):
                if paragraph.startswith(locator):
                    matches.append({'url': meta['url'], 'receipt_file': str(path),
                        'receipt_bytes_sha256': digest(path.read_bytes()),
                        'body_file': str(path.parent / meta['body_file']),
                        'raw_body_sha256': meta['raw_body_sha256'],
                        'retrieved_at': meta['retrieved_at'], 'paragraph_index': index,
                        'paragraph_text_sha256': digest(paragraph.encode())})
        event = next(g for g in case['goal_candidates'] if g['event_id'] == eid)
        report_events = []
        pl_urls = {s['url'] for s in case['sources'] if s['kind'] == 'PL'}
        for path, meta, body in sources:
            if meta['url'] in pl_urls:
                for row in report_goal_rows(body, event, case['teams']):
                    report_events.append({**row, 'url': meta['url'],
                        'raw_body_sha256': meta['raw_body_sha256'],
                        'retrieved_at': meta['retrieved_at'],
                        'body_file': str(path.parent / meta['body_file']),
                        'receipt_bytes_sha256': digest(path.read_bytes())})
        reports = [{key: source['receipt'].get(key) for key in
                   ('url','http_status','raw_body_sha256','retrieved_at','body_file')}
                   for source in case['sources'] if source['kind'] in ('GS','PL','ES')]
        supported = bool(matches) and not classification.startswith('unresolved')
        explicit_own_goal = len(report_events) == 1 and report_events[0]['explicit_own_goal_label']
        event_supported = explicit_own_goal or (supported and classification.startswith('awarded_'))
        cases.append({'game_id': gid, 'game_date': case['game_date'],
            'source_snapshot_id': case['source_snapshot_id'],
            'source_payload_sha256': case['source_payload_sha256'],
            'original_receipt_bytes_sha256': case['original_receipt_bytes_sha256'],
            'original_observed_at': case['original_observed_at'], 'reviewed_event': event,
            'all_affected_team_goal_candidates': case['goal_candidates'],
            'original_final_game_evidence': case['original_final_game_evidence'],
            'narrative_classification': classification, 'narrative_explanation': explanation,
            'narrative_source_frozen': bool(matches), 'article_evidence': matches,
            'statistical_report_sources': reports,
            'matched_play_by_play_report_events': report_events,
            'affirmative_event_mechanism': 'official_report_own_goal' if explicit_own_goal else
                ('official_article_awarded_goal' if event_supported else None),
            'status': 'affirmative_event_evidence_pending_statistical_adjudication' if event_supported else 'unresolved',
            'narrative_supported': supported,
            'proposed_goal_credit': 1, 'proposed_sog_contribution': 0 if event_supported else None,
            'adjudicated_sog_contribution': None,
            'statistical_basis_limit': 'Narrative is event-specific; team/goalie GA-SA discrepancies only corroborate. No automatic statistical override approved.'})
        if statistical:
            corroboration = statistical_corroboration(case, event, sources)
            cases[-1]['statistical_corroboration'] = corroboration
            cases[-1]['recommendation'] = ('eligible_for_explicit_versioned_event_adjudication'
                if event_supported and len(report_events) == 1 and corroboration['status'] == 'corroborated' else 'remain_unresolved')
    return {'contract': 'citrus-goal-sog-statistical-review-v2' if statistical else 'citrus-goal-sog-provisional-review-v1',
        'source_evidence_file': str(evidence_path), 'source_evidence_bytes_sha256': digest(raw),
        'cases': cases, 'case_count': len(cases),
        'affirmative_narrative_cases': sum(c['narrative_supported'] for c in cases),
        'unresolved_narrative_cases': sum(not c['narrative_supported'] for c in cases),
        'affirmative_event_evidence_cases': sum(c['status'].startswith('affirmative') for c in cases),
        'unresolved_event_evidence_cases': sum(c['status']=='unresolved' for c in cases),
        'adjudicated_cases': 0, 'canonical_gate_changed': False,
        'review_limitations': ['No missing-shotType rule', 'No goal or shot removed',
                              'Narrative classifiers are manual review proposals, not a production policy',
                              'Full original candidate sets and source revisions retained']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--supplemental-dir', type=Path, action='append', default=[])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--statistical', action='store_true', help='Revalidate frozen original PBP and complete PL/ES/GS statistical corroboration')
    parser.add_argument('--definitions-receipt', type=Path)
    parser.add_argument('--previous-review', type=Path)
    args = parser.parse_args()
    result = review(args.evidence, args.supplemental_dir, args.statistical)
    if args.previous_review:
        previous = args.previous_review.read_bytes()
        if json.loads(previous)['source_evidence_bytes_sha256'] != result['source_evidence_bytes_sha256']:
            raise ValueError('Previous review refers to different frozen input')
        result['previous_review'] = {'file': str(args.previous_review.resolve()), 'sha256': digest(previous)}
    if args.definitions_receipt:
        result['primary_definitions'] = validate_definitions(args.definitions_receipt)
    with args.output.open('x') as stream:
        json.dump(result, stream, indent=2, sort_keys=True, allow_nan=False)


def validate_definitions(path):
    raw = path.read_bytes()
    receipt = json.loads(raw)
    expected = {'https://media.nhl.com/site/asset/public/ext/2025-26/2025-26Rules.pdf',
                'https://www.nhl.com/info/hockey-glossary'}
    if {d['url'] for d in receipt['documents']} != expected or len(receipt['documents']) != 2:
        raise ValueError('Exact primary definition population required')
    for doc in receipt['documents']:
        body = path.parent / doc['body_file']
        if (doc['http_status'] != 200 or doc['response_url'] != doc['url']
                or body.name != doc['body_file'] or body.is_symlink()
                or digest(body.read_bytes()) != doc['body_sha256']):
            raise ValueError('Invalid frozen primary definition')
    return {'receipt_file': str(path.resolve()), 'receipt_sha256': digest(raw),
        'documents': receipt['documents'],
        'interpretation': [
            {'source': 'NHL hockey glossary', 'sections': ['Goal', 'Shot on Goal'],
             'summary': 'Goal credit follows scoring-team touch; SOG requires an attacking shot, tip or deflection toward the net.'},
            {'source': '2025-26 NHL rules', 'rules': ['25.1','25.2','33.2','78.4'],
             'pdf_pages_one_based': [53,65,67,129],
             'summary': 'Rules distinguish awarded goals and defending-side own goals from normal scoring, and retain attacking-player goal credit.'}],
        'decision_scope': 'Exact frozen events only: affirmative official Own Goal label or event-specific awarded-goal report, with matching identity and independently concordant full-stream/player/team statistical evidence.',
        'residual_limit': 'No explicit blanket SOG-exception sentence was located in the rulebook. SOG=0 is a source-specific statistical adjudication recommendation from combined evidence, not a newly asserted universal NHL rule. General defender deflections and future awarded goals are not automatically reclassified.',
        'publication_approval': False}


if __name__ == '__main__':
    main()
