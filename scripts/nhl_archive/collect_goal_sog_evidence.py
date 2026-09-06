"""Freeze primary-source HTML evidence for unresolved goal/SOG discrepancies.

Source collection only: no adjudications, canonical changes, inferred shotType
rules, or database writes. Every affected-team goal is retained as a candidate.
Each HTTP response body and metadata are create-only files in a new directory.
Report rows/aggregate goalie GA-SA are corroboration, not event-level proof.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from acquisition.event_observation_service import prepare_observation
from projections.analytics_publication import fingerprint

TEAM_SLUGS = dict(zip(
    'ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH'.split(),
    ['anaheim-ducks','boston-bruins','buffalo-sabres','carolina-hurricanes','columbus-blue-jackets',
     'calgary-flames','chicago-blackhawks','colorado-avalanche','dallas-stars','detroit-red-wings',
     'edmonton-oilers','florida-panthers','los-angeles-kings','minnesota-wild','montreal-canadiens',
     'new-jersey-devils','nashville-predators','new-york-islanders','new-york-rangers','ottawa-senators',
     'philadelphia-flyers','pittsburgh-penguins','seattle-kraken','san-jose-sharks','st-louis-blues',
     'tampa-bay-lightning','toronto-maple-leafs','utah-mammoth','vancouver-canucks',
     'vegas-golden-knights','winnipeg-jets','washington-capitals']))
KNOWN_ARTICLES = {
    2025020184: ['https://www.nhl.com/avalanche/news/game-recap-11-01-25'],
    2025020208: ['https://www.nhl.com/news/nashville-predators-minnesota-wild-game-recap-november-4-2025'],
    2025020683: ['https://www.nhl.com/news/florida-panthers-montreal-canadiens-game-recap-january-8-2026'],
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def write_new(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, sort_keys=True, allow_nan=False, indent=2)


def official_url(url):
    parsed = urlparse(url)
    if (parsed.scheme != 'https' or parsed.hostname not in ('www.nhl.com', 'nhl.com')
            or parsed.username or parsed.password or parsed.port not in (None, 443)
            or parsed.fragment):
        raise ValueError('Only explicit official NHL/team HTTPS sources are permitted')
    return url


def build_cases(reconciliation_path, receipt_dirs):
    path = Path(reconciliation_path)
    raw = path.read_bytes()
    report = json.loads(raw)
    cases, inputs = {}, {str(path): sha(raw)}
    for game in report['games']:
        gate = game.get('final_game_evidence', {})
        if gate.get('reason') != 'final_attempt_totals_mismatch':
            continue
        gid, snapshot = game['game_id'], game['source_snapshot_id']
        key = (gid, snapshot)
        if key in cases:
            if cases[key]['original_final_game_evidence'] != gate:
                raise ValueError('Conflicting reconciliation evidence for one revision')
            continue
        matches = []
        for directory in receipt_dirs:
            candidate = Path(directory) / f'{gid}.json'
            if candidate.exists():
                body = candidate.read_bytes()
                receipt = json.loads(body)
                if receipt.get('prepared', [{}])[0].get('id') == snapshot:
                    matches.append((candidate, body, receipt))
        if not matches:
            raise ValueError('Missing original frozen source revision')
        candidate, body, receipt = matches[0]
        source = receipt['prepared'][0]
        payload = source['payload']['pbp']
        if (gid != payload['id'] or receipt['status'] != 'complete'
                or list(prepare_observation(payload, receipt['observed_at'])) != receipt['prepared']):
            raise ValueError('Original frozen source identity/normalization conflict')
        inputs[str(candidate)] = sha(body)
        affected = {difference['team_id'] for difference in gate['differences'] if difference['field'] == 'sog'}
        roster = {player['playerId']: player for player in payload.get('rosterSpots', [])}
        goals = []
        for play in payload['plays']:
            details = play.get('details', {})
            if (play.get('typeCode') != 505 or play.get('periodDescriptor', {}).get('periodType') == 'SO'
                    or details.get('eventOwnerTeamId') not in affected):
                continue
            pid = details.get('scoringPlayerId')
            goals.append({'game_id': gid, 'event_id': play['eventId'],
                'team_id': details['eventOwnerTeamId'], 'player_id': pid,
                'roster_identity': roster.get(pid), 'period': play['periodDescriptor'],
                'clock': play['timeInPeriod'], 'sort_order': play.get('sortOrder'),
                'source_event_sha256': fingerprint(play), 'goal_credit': 1,
                'sog_contribution': None, 'status': 'unresolved',
                'reason': 'requires_affirmative_independent_event_statistical_evidence'})
        season = gid // 1000000
        root = f'https://www.nhl.com/scores/htmlreports/{season}{season+1}/'
        urls = [{'kind': kind, 'url': root + f'{kind}{gid % 1000000:06}.HTM',
                 'purpose': 'official_statistical_report_requires_identity_review'} for kind in ('GS', 'PL', 'ES')]
        day = datetime.strptime(payload['gameDate'], '%Y-%m-%d')
        away, home = (TEAM_SLUGS[payload[side]['abbrev']] for side in ('awayTeam', 'homeTeam'))
        article = f'https://www.nhl.com/news/{away}-{home}-game-recap-{day.strftime("%B").lower()}-{day.day}-{day.year}'
        for url in dict.fromkeys([article] + KNOWN_ARTICLES.get(gid, [])):
            urls.append({'kind': 'article', 'url': url, 'purpose': 'candidate_recap_url_requires_response_and_identity_review'})
        cases[key] = {'game_id': gid, 'game_date': payload['gameDate'],
            'teams': {side: payload[side] for side in ('awayTeam', 'homeTeam')},
            'source_snapshot_id': snapshot, 'original_receipt_path': str(candidate),
            'original_receipt_bytes_sha256': sha(body), 'source_payload_sha256': fingerprint(payload),
            'original_observed_at': source['observed_at'], 'original_final_game_evidence': gate,
            'goal_candidates': goals, 'status': 'unresolved', 'sources': urls}
    if not cases:
        raise ValueError('No unresolved discrepancies selected')
    return list(cases.values()), inputs


def freeze_response(url, output, stem, request, clock=utc_now):
    official_url(url)
    meta = {'url': url, 'requested_at': clock(), 'status': 'unavailable',
            'body_file': None, 'raw_body_sha256': None,
            'byte_contract': 'requests-response-content-body-not-wire-headers-or-transfer-encoding'}
    try:
        response = request(url, timeout=30, allow_redirects=False)
        data = response.content
        meta.update(http_status=response.status_code, response_url=response.url,
                    content_type=response.headers.get('Content-Type'),
                    location=response.headers.get('Location'), retrieved_at=clock())
        body_path = output / f'{stem}.body'
        with body_path.open('xb') as stream:
            stream.write(data)
        meta.update(body_file=body_path.name, raw_body_sha256=sha(data), body_bytes=len(data))
        meta['status'] = 'retrieved_requires_review' if response.status_code == 200 and data else 'http_failure'
    except FileExistsError:
        raise
    except Exception as exc:
        meta.update(retrieved_at=clock(), error_type=type(exc).__name__)
    write_new(output / f'{stem}.receipt.json', meta)
    return meta


def collect(reconciliation, receipt_dirs, output, request, delay=0.5):
    cases, inputs = build_cases(reconciliation, receipt_dirs)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    for case in cases:
        for index, source in enumerate(case['sources']):
            source['receipt'] = freeze_response(source['url'], output,
                f'{case["game_id"]}-{case["source_snapshot_id"]}-{index}', request)
            time.sleep(delay)
    if any(sha(Path(name).read_bytes()) != digest for name, digest in inputs.items()):
        raise ValueError('Original inputs changed during collection')
    result = {'contract': 'citrus-goal-sog-source-evidence-v1', 'cases': cases,
        'case_count': len(cases), 'input_files_sha256': inputs, 'collected_at': utc_now(),
        'adjudicated_cases': 0, 'status': 'unresolved_pending_event_level_review',
        'limitations': ['No missing-shotType inference', 'Aggregate GA/SA is corroboration only',
                       'HTML report ordinals are not JSON event IDs',
                       'Successful retrieval is not report identity validation or adjudication']}
    write_new(output / 'evidence.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reconciliation', type=Path, required=True)
    parser.add_argument('--receipt-dir', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--delay', type=float, default=0.5)
    args = parser.parse_args()
    if not 0 < args.delay < float('inf'):
        parser.error('Positive finite delay required')
    from utils.citrus_request import citrus_request
    result = collect(args.reconciliation, args.receipt_dir, args.output, citrus_request, args.delay)
    print(json.dumps({'case_count': result['case_count'], 'status': result['status']}))


if __name__ == '__main__':
    main()
