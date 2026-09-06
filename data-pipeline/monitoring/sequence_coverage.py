"""Offline full-game sequence audit; no probabilities, publication, or DB calls."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

from acquisition.observed_sequences import extract_observed_sequences
from projections.analytics_publication import fingerprint


def audit(receipt_dirs, schedule_path, max_gap_seconds):
    if (type(max_gap_seconds) not in (int, float)
            or not 0 <= max_gap_seconds < float('inf')):
        raise ValueError('An explicit finite nonnegative gap threshold is required')
    schedule_path = Path(schedule_path)
    if schedule_path.is_symlink() or not schedule_path.is_file():
        raise ValueError('An explicit regular frozen schedule file is required')
    schedule_bytes = schedule_path.read_bytes()
    schedule = json.loads(schedule_bytes)
    if not isinstance(schedule, dict):
        raise ValueError('Explicit complete frozen schedule expectations required')
    ids = schedule.get('terminal_game_ids')
    season = schedule.get('season')
    if (type(season) is not int or not 1900 <= season < 9999
            or schedule.get('contract') != 'citrus-official-schedule-window-v1'
            or schedule.get('window_complete') is not True
            or schedule.get('reported_season_within_window') is not True
            or schedule.get('unresolved_game_ids') != []
            or not isinstance(ids, list) or not ids
            or any(type(gid) is not int or gid // 1000000 != season
                   or (gid // 10000) % 100 not in (2, 3) or gid % 10000 == 0 for gid in ids)
            or ids != sorted(set(ids))):
        raise ValueError('Explicit complete frozen schedule expectations required')
    paths, inodes = {}, set()
    for directory in receipt_dirs:
        directory = Path(directory)
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError('Explicit frozen receipt directories required')
        for path in directory.glob('*.json'):
            if not re.fullmatch(r'\d{10}\.json', path.name):
                continue
            gid = int(path.stem)
            if gid in paths or path.is_symlink() or not path.is_file():
                raise ValueError('One explicitly selected frozen revision per game is required')
            stat = path.stat()
            identity = (stat.st_dev, stat.st_ino)
            if identity in inodes:
                raise ValueError('Receipt paths must identify distinct files')
            inodes.add(identity)
            paths[gid] = path
    if set(paths) != set(ids):
        raise ValueError('Frozen receipt population differs from scheduled terminal games')
    reports, source_hashes = [], {}
    for gid in ids:
        content = paths[gid].read_bytes()
        source_hashes[gid] = hashlib.sha256(content).hexdigest()
        receipt = json.loads(content)
        if not isinstance(receipt, dict) or type(receipt.get('game_id')) is not int or receipt['game_id'] != gid:
            raise ValueError('Receipt filename and game identity disagree')
        result = extract_observed_sequences(receipt, max_gap_seconds=max_gap_seconds)
        chains = result.pop('chains')
        reports.append({**result, 'game_id': gid, 'chain_count': len(chains),
                        'multi_attempt_chains': sum(len(chain['events']) > 1 for chain in chains),
                        'chain_membership_sha256': fingerprint(chains)})
    if any(hashlib.sha256(paths[gid].read_bytes()).hexdigest() != digest
           for gid, digest in source_hashes.items()):
        raise ValueError('Frozen receipt changed during audit')
    if schedule_path.read_bytes() != schedule_bytes:
        raise ValueError('Frozen schedule changed during audit')
    return {'contract': 'citrus-sequence-source-coverage-v1',
            'season': season, 'max_gap_seconds': max_gap_seconds, 'expected_games': len(ids),
            'source_file_sha256': source_hashes,
            'schedule_report_sha256': hashlib.sha256(schedule_bytes).hexdigest(),
            'statuses': dict(Counter(row['status'] for row in reports)),
            'reasons': dict(Counter(row['reason'] for row in reports)), 'games': reports,
            'network_used': False, 'database_modified': False,
            'limitations': ['No probabilities, predictions, model acceptance or production publication.',
                           'Explicit gap is a declared descriptive definition, not a fitted threshold.',
                           'Verified chains do not establish possession or omitted-event completeness.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipts', type=Path, action='append', required=True)
    parser.add_argument('--schedule-report', type=Path, required=True)
    parser.add_argument('--max-gap-seconds', type=float, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output must not exist')
    report = audit(args.receipts, args.schedule_report, args.max_gap_seconds)
    with args.output.open('x') as stream:
        json.dump(report, stream, sort_keys=True, allow_nan=False)
        stream.write('\n')
    print(json.dumps({key: value for key, value in report.items()
                      if key not in ('source_file_sha256', 'games')}))
    return 0 if report['statuses'].get('verified') == report['expected_games'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
