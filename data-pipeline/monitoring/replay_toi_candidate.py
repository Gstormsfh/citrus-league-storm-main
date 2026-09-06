"""Offline revalidation of an immutable TOI receipt directory into a NEW revision.

No HTTP or database calls. The original candidate, source artifacts and cutoff
are preserved. Supply the committed revision containing the executing validator.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _bootstrap  # noqa: E402,F401
from monitoring.collect_toi_receipts import load_stored_snapshot, now, write_json
from projections.analytics_publication import fingerprint, timestamp
from projections.verified_toi_publication import build_candidate


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024 * 1024),b''):
            digest.update(chunk)
    return digest.hexdigest()


def replay_candidate(source_dir, output_dir, code_revision):
    if not re.fullmatch('[0-9a-f]{40}',code_revision):
        raise ValueError('Replay requires the exact committed code revision')
    source_dir,output_dir = Path(source_dir),Path(output_dir)
    if output_dir.exists() or output_dir.resolve() == source_dir.resolve():
        raise ValueError('Replay output must be a new directory')
    source_hashes = {}
    def read(name):
        path = source_dir / name
        source_hashes[name] = file_sha256(path)
        return json.loads(path.read_text())
    original = read('candidate.json')
    if not isinstance(original,list) or len(original) != 3:
        raise ValueError('Original TOI candidate is required')
    metadata = original[1]
    if (metadata.get('metric') != 'avg_toi_per_game' or metadata.get('game_type') != 'regular'
            or metadata.get('population') != 'skaters' or type(metadata.get('season')) is not int):
        raise ValueError('Replay only supports the regular-season skater TOI contract')
    season = metadata['season']
    expected = read('expected-players.json')
    if (not isinstance(expected,list) or not expected
            or any(type(pid) is not int or pid <= 0 for pid in expected)
            or expected != sorted(set(expected))):
        raise ValueError('Frozen expected-player manifest must be unique, positive and ordered')
    stored = load_stored_snapshot(source_dir / 'stored.json',season)
    source_hashes['stored.json'] = file_sha256(source_dir / 'stored.json')
    pages = []
    for path in source_dir.glob('summary-*.json'):
        if re.fullmatch(r'summary-\d+\.json',path.name) is None:
            raise ValueError('Invalid frozen summary receipt filename')
        pages.append(read(path.name))
    pages.sort(key=lambda page:page['params']['start'])
    evidence = {pid:read(f'player-{pid}.json') for pid in expected}
    frozen = original[0]['payload']
    if (expected != frozen['expected_players'] or stored['rows'] != frozen['stored_rows']
            or pages != frozen['official_summary_receipts']
            or {str(pid):value for pid,value in evidence.items()} != frozen['official_receipts']
            or timestamp(stored['observed_at']) != frozen['stored_observed_at']):
        raise ValueError('Frozen artifacts differ from the original candidate sources')
    prepared = build_candidate(expected,stored['rows'],evidence,season,metadata['data_cutoff'],code_revision,
                               summary_receipts=pages,stored_observed_at=stored['observed_at'])
    pipeline = Path(__file__).resolve().parents[1]
    code_files = ('monitoring/replay_toi_candidate.py','monitoring/collect_toi_receipts.py',
                  'monitoring/appearance_contract.py','monitoring/toi_source_receipt.py',
                  'projections/verified_toi_publication.py','projections/analytics_publication.py')
    health = {**prepared[1]['validation']['coverage'],
              'reason_counts':dict(Counter(row['reason'] for row in prepared[2])),
              'source_sha256':fingerprint(prepared[0]),'snapshot_complete':True,
              'database_modified':False,'network_used':False,
              'replayed_at':now(),'replay_of_batch_id':metadata['id'],
              'batch_id':prepared[1]['id'],'code_revision':code_revision,
              'original_files_sha256':source_hashes,
              'validator_files_sha256':{name:file_sha256(pipeline / name) for name in code_files}}
    # Check immutability before installing any new revision artifact.
    if any(file_sha256(source_dir / name) != digest for name,digest in source_hashes.items()):
        raise ValueError('Frozen source files changed during replay')
    output_dir.mkdir(parents=True,exist_ok=False)
    write_json(output_dir / 'candidate.json',prepared)
    write_json(output_dir / 'health.json',health)
    return health


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--code-revision',required=True)
    args = parser.parse_args(argv)
    health = replay_candidate(args.source_dir,args.output_dir,args.code_revision)
    print(json.dumps({key:value for key,value in health.items()
                      if key not in ('original_files_sha256','validator_files_sha256')}))
    return 0 if health['official_population_complete'] and not health['withheld'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
