"""Freeze independent NHL schedule expectations; never write a database.

The caller explicitly chooses the date window. Exact daily/week counts prove
coverage of that window, not historical as-of availability or model readiness.
Raw response bytes (UTF-8), actual request times and checksums remain replayable.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import time

from monitoring.canonical_corpus import load_export_manifest
from projections.analytics_publication import timestamp


BASE = 'https://api-web.nhle.com/v1/schedule/'


def parse_date(value):
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError('Dates require YYYY-MM-DD')
    return parsed


def week_starts(start, end):
    start, end = parse_date(start), parse_date(end)
    if start > end or (end - start).days > 550:
        raise ValueError('Explicit ordered date window must be at most 551 days')
    return [(start + timedelta(days=offset)).isoformat()
            for offset in range(0, (end - start).days + 1, 7)]


def capture(day, request):
    receipt = {'url': BASE + day, 'params': {}, 'requested_at': datetime.now(timezone.utc).isoformat(),
               'status': 'failed', 'http_status': None}
    try:
        response = request(receipt['url'], timeout=30, max_retries=2)
        receipt['http_status'] = response.status_code
        response.raise_for_status()
        content = response.content
        receipt.update(raw_utf8=content.decode('utf-8'), raw_sha256=hashlib.sha256(content).hexdigest(), status='ok')
    except Exception as exc:
        receipt['error_type'] = type(exc).__name__
    receipt['observed_at'] = datetime.now(timezone.utc).isoformat()
    return receipt


def verify(receipts, season, start, end, stored=None):
    expected_weeks = week_starts(start, end)
    if type(season) is not int or not 1917 <= season <= 2100 or len(receipts) != len(expected_weeks):
        raise ValueError('Missing schedule weeks or invalid season')
    games = {}
    outside_window = []
    boundary_evidence = None
    observation_windows = []
    raw_digests = {}
    for day, receipt in zip(expected_weeks, receipts):
        if (receipt.get('url') != BASE + day or receipt.get('params') != {}
                or receipt.get('status') != 'ok' or type(receipt.get('http_status')) is not int
                or receipt['http_status'] != 200):
            raise ValueError('Schedule source receipt failed or mismatched request')
        requested = datetime.fromisoformat(timestamp(receipt['requested_at']))
        observed = datetime.fromisoformat(timestamp(receipt['observed_at']))
        if requested > observed or observed > datetime.now(timezone.utc):
            raise ValueError('Invalid schedule observation window')
        observation_windows.append((requested, observed))
        raw = receipt['raw_utf8'].encode('utf-8')
        if hashlib.sha256(raw).hexdigest() != receipt.get('raw_sha256'):
            raise ValueError('Schedule raw response checksum conflict')
        raw_digests[day] = receipt['raw_sha256']
        payload = json.loads(raw)
        week = payload.get('gameWeek')
        if not isinstance(week, list) or len(week) != 7:
            raise ValueError('Schedule response requires every day, including empty dates')
        regular_start = payload.get('regularSeasonStartDate')
        playoff_end = payload.get('playoffEndDate')
        week_has_target_season = False
        total = 0
        for offset, entry in enumerate(week):
            expected_day = (parse_date(day) + timedelta(days=offset)).isoformat()
            rows = entry.get('games')
            count = entry.get('numberOfGames')
            if (entry.get('date') != expected_day or type(count) is not int or count < 0
                    or not isinstance(rows, list) or len(rows) != count):
                raise ValueError('Schedule date or daily game count is incomplete')
            total += count
            for row in rows:
                gid, game_type = row.get('id'), row.get('gameType')
                if (type(gid) is not int or type(game_type) is not int
                        or type(row.get('season')) is not int
                        or gid // 1000000 != row['season'] // 10000
                        or gid // 10000 % 100 != game_type):
                    raise ValueError('Schedule game identity is inconsistent')
                if row['season'] != season * 10000 + season + 1 or game_type not in (2, 3):
                    continue
                week_has_target_season = True
                if expected_day > end:
                    outside_window.append(gid)
                    continue
                if gid in games:
                    raise ValueError('Schedule repeats a game; resolve the observed revision explicitly')
                home, away = row.get('homeTeam', {}), row.get('awayTeam', {})
                if (type(home.get('id')) is not int or type(away.get('id')) is not int
                        or home['id'] == away['id'] or home['id'] <= 0 or away['id'] <= 0
                        or not isinstance(row.get('gameState'), str)
                        or not isinstance(row.get('gameScheduleState'), str)):
                    raise ValueError('Schedule team identity or game state is unavailable')
                games[gid] = {'date': expected_day, 'game_type': game_type,
                              'home_team_id': home['id'], 'away_team_id': away['id'],
                              'game_state': row['gameState'], 'schedule_state': row['gameScheduleState']}
        if type(payload.get('numberOfGames')) is not int or payload['numberOfGames'] != total:
            raise ValueError('Schedule week count disagrees with daily counts')
        if (week_has_target_season and isinstance(regular_start, str) and isinstance(playoff_end, str)
                and parse_date(regular_start).year in (season, season + 1)):
            # Bind metadata to an observed target-season week. The 2020 season
            # actually began in January 2021; start-year equality loses it.
            boundaries = {'regular_season_start': regular_start, 'playoff_end': playoff_end}
            if parse_date(playoff_end) <= parse_date(regular_start):
                raise ValueError('Invalid schedule season boundaries')
            if boundary_evidence is not None and boundary_evidence != boundaries:
                raise ValueError('Schedule season boundaries changed during collection')
            boundary_evidence = boundaries
    terminal = sorted(gid for gid, row in games.items()
                      if row['game_state'] in ('OFF', 'FINAL') and row['schedule_state'] == 'OK')
    unresolved = sorted(set(games) - set(terminal))
    report = {'contract': 'citrus-official-schedule-window-v1', 'season': season,
              'from_date': start, 'through_date': end, 'receipt_weeks': len(receipts),
              'observed_from': min(pair[0] for pair in observation_windows).isoformat(),
              'observed_to': max(pair[1] for pair in observation_windows).isoformat(),
              'raw_response_sha256': raw_digests,
              'window_complete': True, 'season_boundary_evidence': boundary_evidence,
              'reported_season_within_window': bool(boundary_evidence
                  and start <= boundary_evidence['regular_season_start']
                  and end >= boundary_evidence['playoff_end']),
              'scheduled_games': len(games), 'terminal_games': len(terminal),
              'terminal_game_ids': terminal, 'unresolved_game_ids': unresolved,
              'games_outside_requested_window': sorted(outside_window),
              'game_type_counts': dict(Counter(str(row['game_type']) for row in games.values())),
              'games': {str(gid): games[gid] for gid in sorted(games)},
              'production_modified': False,
              'limitations': ['Current corrected schedule is not historical as-of evidence.',
                              'Completeness refers to the explicit date window and reported source boundaries.',
                              'A stored game identity does not prove complete events, features or scores.']}
    if stored is not None:
        report['stored_source_coverage'] = {}
        for source in ('nhl', 'raw'):
            ids = {row['game_id'] for row in stored[source] if row.get('period_type') != 'SO'}
            report['stored_source_coverage'][source] = {
                'stored_games': len(ids), 'missing_terminal_games': sorted(set(terminal) - ids),
                'stored_not_terminal_in_window': sorted(ids - set(terminal))}
    return report


def write_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, sort_keys=True, separators=(',', ':'), allow_nan=False)
        stream.write('\n')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season', required=True, type=int)
    parser.add_argument('--from-date', required=True)
    parser.add_argument('--through-date', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--stored-export-manifest', type=Path, required=True)
    parser.add_argument('--project-ref', required=True)
    parser.add_argument('--receipts-dir', type=Path, help='Offline replay; no HTTP requests')
    args = parser.parse_args(argv)
    created = False
    phase = 'create_output'
    try:
        args.output_dir.mkdir(parents=True, exist_ok=False)
        created = True
        phase = 'validate_export'
        stored, export_evidence = load_export_manifest(args.stored_export_manifest, args.season, args.project_ref)
        days = week_starts(args.from_date, args.through_date)
        receipts = []
        if not args.receipts_dir:
            import _bootstrap  # noqa: F401
            from utils.citrus_request import citrus_request
        for day in days:
            phase = 'capture_or_replay_receipt'
            receipt = (json.loads((args.receipts_dir / f'{day}.json').read_text())
                       if args.receipts_dir else capture(day, citrus_request))
            write_json(args.output_dir / f'{day}.json', receipt)
            receipts.append(receipt)
            if not args.receipts_dir:
                print(json.dumps({'event': 'schedule_coverage.progress', 'observed': len(receipts), 'expected': len(days)}), flush=True)
                time.sleep(0.5)
        phase = 'verify'
        report = verify(receipts, args.season, args.from_date, args.through_date, stored)
        report['stored_export_evidence'] = export_evidence
        report['receipt_files_sha256'] = {f'{day}.json': hashlib.sha256(
            (args.output_dir / f'{day}.json').read_bytes()).hexdigest() for day in days}
        write_json(args.output_dir / 'report.json', report)
        complete = (report['reported_season_within_window'] and not report['unresolved_game_ids']
                    and not any(row['missing_terminal_games'] or row['stored_not_terminal_in_window']
                                for row in report['stored_source_coverage'].values()))
        health = {'event': 'schedule_coverage.health', 'status': 'complete' if complete else 'withheld',
                  'terminal_games': report['terminal_games'], 'stored_source_coverage': report['stored_source_coverage']}
        write_json(args.output_dir / 'health.json', health)
        print(json.dumps(health), flush=True)
        return 0 if complete else 2
    except Exception as exc:
        health = {'event': 'schedule_coverage.health', 'status': 'failed', 'phase': phase,
                  'error_type': type(exc).__name__, 'production_modified': False}
        if created and not (args.output_dir / 'health.json').exists():
            try:
                write_json(args.output_dir / 'health.json', health)
            except OSError:
                pass
        print(json.dumps(health), flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
