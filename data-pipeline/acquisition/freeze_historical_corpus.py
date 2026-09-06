"""Freeze independently scheduled official NHL PBP, locally and create-only.

No database/model access. HTTP content bytes are after requests decompression,
not wire bytes. Current historical revisions are retrospective, never as-of data.
Unresolved source/statistical cases stay present; collection != model acceptance.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import threading
import time

from acquisition.canonical_events import normalize_pbp
from monitoring.final_game_evidence import verify_final_game
from monitoring.schedule_coverage import capture, parse_date, verify, week_starts
from projections.analytics_publication import fingerprint


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, sort_keys=True, allow_nan=False, separators=(',', ':'))


def validate_spec(spec):
    if not isinstance(spec, list) or not spec:
        raise ValueError('Explicit nonempty historical season windows required')
    seen = set()
    for item in spec:
        if not isinstance(item, dict) or set(item) != {'season', 'from_date', 'through_date'}:
            raise ValueError('Unknown/missing historical window fields')
        season = item['season']
        if type(season) is not int or not 1917 <= season <= 2100 or season in seen:
            raise ValueError('Invalid/duplicate historical season')
        seen.add(season)
        week_starts(item['from_date'], item['through_date'])
        if parse_date(item['through_date']) > datetime.now(timezone.utc).date():
            raise ValueError('Historical source window cannot include future dates')
    return sorted(spec, key=lambda row: row['season'])


def freeze_game(gid, expected, output, request):
    url = f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play'
    receipt = {'game_id': gid, 'url': url, 'requested_at': now(),
               'status': 'unavailable', 'schedule_identity': expected,
               'byte_contract': 'requests-content-after-decompression-not-wire-bytes',
               'historical_as_of_verified': False}
    try:
        response = request(url, timeout=30, allow_redirects=False)
        body = response.content
        receipt.update(observed_at=now(), http_status=response.status_code,
                       response_url=response.url, body_sha256=digest(body), body_bytes=len(body),
                       body_file=f'{gid}.body.json')
        with (output / receipt['body_file']).open('xb') as stream:
            stream.write(body)
        if response.status_code != 200 or response.url != url:
            raise ValueError('PBP HTTP response identity/status conflict')
        payload = json.loads(body, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-JSON constant')))
        if (payload.get('id') != gid or type(payload.get('id')) is not int
                or payload.get('gameDate') != expected['date']
                or payload.get('homeTeam', {}).get('id') != expected['home_team_id']
                or payload.get('awayTeam', {}).get('id') != expected['away_team_id']):
            raise ValueError('PBP conflicts with independently frozen schedule identity')
        normalized = normalize_pbp(payload)
        final = verify_final_game(payload)
        receipt.update(source_payload_sha256=fingerprint(payload),
                       normalization=normalized, final_game_evidence=final,
                       status='verified' if normalized['complete'] and final['status'] == 'verified' else 'quarantined')
    except FileExistsError:
        raise
    except Exception as exc:
        receipt.update(observed_at=receipt.get('observed_at', now()), error_type=type(exc).__name__)
    write_json(output / f'{gid}.receipt.json', receipt)
    return {key: receipt.get(key) for key in ('game_id', 'status', 'body_sha256', 'body_bytes',
                                            'observed_at', 'source_payload_sha256', 'error_type')}


def freeze(spec, output, request, *, workers=2, delay=0.3):
    spec = validate_spec(spec)
    if type(workers) is not int or not 1 <= workers <= 2 or not 0 < delay < 60:
        raise ValueError('Use one/two workers and a positive bounded request delay')
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / 'request-spec.json', spec)
    sources = [Path(__file__), Path(__file__).parents[1] / 'monitoring/schedule_coverage.py',
               Path(__file__).with_name('canonical_events.py'),
               Path(__file__).parents[1] / 'monitoring/final_game_evidence.py']
    code_hashes = {str(path): digest(path.read_bytes()) for path in sources}
    schedules, expected = {}, {}
    for item in spec:
        season = item['season']
        folder = output / str(season)
        folder.mkdir()
        (folder / 'schedule').mkdir()
        (folder / 'pbp').mkdir()
        receipts = []
        for day in week_starts(item['from_date'], item['through_date']):
            receipt = capture(day, request)
            write_json(folder / 'schedule' / f'{day}.json', receipt)
            receipts.append(receipt)
            time.sleep(delay)
        report = verify(receipts, season, item['from_date'], item['through_date'])
        write_json(folder / 'schedule-report.json', report)
        schedules[str(season)] = report
        for gid in report['terminal_game_ids']:
            if gid in expected:
                raise ValueError('Duplicate scheduled game across requested seasons')
            expected[gid] = report['games'][str(gid)]
        print(json.dumps({'event': 'historical_freeze.schedule', 'season': season,
                          'terminal_games': report['terminal_games'],
                          'unresolved_games': len(report['unresolved_game_ids']),
                          'reported_season_within_window': report['reported_season_within_window']}), flush=True)
    write_json(output / 'schedule-manifest.json', schedules)
    rows = []
    def collect(gid):
        row = freeze_game(gid, expected[gid], output / str(gid // 1000000) / 'pbp', request)
        time.sleep(delay)
        return row
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(collect, gid): gid for gid in sorted(expected)}
        for future in as_completed(futures):
            rows.append(future.result())
            if len(rows) % 25 == 0 or len(rows) == len(expected):
                print(json.dumps({'event': 'historical_freeze.progress', 'observed': len(rows),
                                  'expected': len(expected),
                                  'quarantined': sum(row['status'] == 'quarantined' for row in rows),
                                  'unavailable': sum(row['status'] == 'unavailable' for row in rows)}), flush=True)
    if any(digest(Path(path).read_bytes()) != sha for path, sha in code_hashes.items()):
        raise ValueError('Validation code changed during collection; source files retained')
    rows.sort(key=lambda row: row['game_id'])
    result = {'contract': 'citrus-historical-official-source-freeze-v1', 'request_spec': spec,
              'code_sha256': code_hashes, 'completed_at': now(), 'games': rows,
              'schedule_manifest_sha256': digest((output / 'schedule-manifest.json').read_bytes()),
              'expected_games': len(expected), 'captured_games': len(rows),
              'unavailable_games': [row['game_id'] for row in rows if row['status'] == 'unavailable'],
              'quarantined_games': [row['game_id'] for row in rows if row['status'] == 'quarantined'],
              'complete_schedule_windows': all(report['reported_season_within_window']
                  and not report['unresolved_game_ids'] for report in schedules.values()),
              'historical_as_of_verified': False, 'model_ready': False,
              'limitations': ['Current corrected historical observations, not historical availability.',
                  'All quarantined cases remain in the raw corpus.', 'No feature/model/calibrator was fitted.',
                  'Source retrieval does not establish commercial usage rights or peer comparability.']}
    result['status'] = 'captured_requires_validation' if not result['unavailable_games'] else 'incomplete'
    write_json(output / 'manifest.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    import requests
    local = threading.local()
    def request(url, **kwargs):
        kwargs.pop('max_retries', None)
        if not hasattr(local, 'session'):
            local.session = requests.Session()
        return local.session.get(url, **kwargs)
    try:
        result = freeze(json.loads(args.spec.read_text()), args.output, request)
        print(json.dumps({'event': 'historical_freeze.health', 'status': result['status'],
                          'expected': result['expected_games'], 'observed': result['captured_games'],
                          'quarantined': len(result['quarantined_games']),
                          'unavailable': len(result['unavailable_games']), 'model_ready': False}), flush=True)
        return 0 if result['status'] == 'captured_requires_validation' and result['complete_schedule_windows'] else 2
    except Exception as exc:
        print(json.dumps({'event': 'historical_freeze.health', 'status': 'failed',
                          'error_type': type(exc).__name__, 'source_files_retained': True}), flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
