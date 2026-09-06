"""Read-only TOI receipts and complete-population reconciliation CLI.

Writes only a newly created local output directory. Official retrieval times are
current observations of corrected history, never historical availability claims.
No database mutation or publication is performed. Failed HTTP responses remain
receipts; a complete expected-player manifest survives individual source failure.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _bootstrap  # noqa: E402,F401
from monitoring.appearance_contract import SUMMARY_URL, official_summary_population
from projections.analytics_publication import fingerprint, timestamp
from projections.verified_toi_publication import build_candidate


def now():
    return datetime.now(timezone.utc).isoformat()


def capture(url, params, request):
    receipt = {'url':url, 'params':params, 'requested_at':now(),
               'status':'failed', 'payload':None, 'http_status':None}
    try:
        response = request(url, params=params, timeout=30, max_retries=2)
        receipt['http_status'] = response.status_code
        response.raise_for_status()
        receipt['payload'] = response.json()
        receipt['status'] = 'ok'
    except Exception as exc:
        # Exception text may contain proxy credentials. Retain only its class.
        receipt['error_type'] = type(exc).__name__
        if getattr(exc, 'response', None) is not None:
            receipt['http_status'] = exc.response.status_code
    receipt['observed_at'] = now()
    return receipt


def collect_summary(season, request, pause, emit=lambda receipt: None):
    pages = []
    offset = 0
    expected_total = None
    while True:
        params = {'isAggregate':'false', 'isGame':'false', 'start':offset, 'limit':100,
                  'sort':'[{"property":"playerId","direction":"ASC"}]',
                  'cayenneExp':f'seasonId={season}{season + 1} and gameTypeId=2'}
        receipt = capture(SUMMARY_URL, params, request)
        pages.append(receipt)
        emit(receipt)
        payload = receipt['payload']
        if receipt['status'] != 'ok' or not isinstance(payload, dict):
            break
        rows, total = payload.get('data'), payload.get('total')
        if (not isinstance(rows, list) or type(total) is not int or total <= 0
                or len(rows) != min(100, total - offset)
                or (expected_total is not None and total != expected_total)):
            break
        expected_total = total
        offset += len(rows)
        if offset >= total:
            break
        pause()
    return pages


def collect_player(pid, season, request):
    source = capture(f'https://api-web.nhle.com/v1/player/{pid}/game-log/{season}{season + 1}/2', {}, request)
    payload = source['payload']
    log = payload.get('gameLog') if source['status'] == 'ok' and isinstance(payload, dict) else None
    return {'observed_at':source['observed_at'], 'game_log':log,
            'source_receipt':source}


def export_stored(db, season):
    rows = []
    offset = 0
    while True:
        page = db.select_exact('player_game_stats',
            select='season,player_id,game_id,is_goalie,nhl_toi_seconds',
            filters=[('season','eq',season),('game_id','gte',season * 1000000 + 20000),
                     ('game_id','lt',season * 1000000 + 30000)],
            order='game_id.asc,player_id.asc',limit=1000,offset=offset)
        rows.extend(row for row in page if not row.get('is_goalie'))
        if len(page) < 1000:
            return rows
        offset += 1000


def write_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, sort_keys=True, separators=(',', ':'), allow_nan=False)
        stream.write('\n')


STORED_COLUMNS = ['season','player_id','game_id','is_goalie','nhl_toi_seconds']


def load_stored_snapshot(path, season):
    """Load a JSON snapshot or bounded, local-only manifest of compact parts."""
    manifest = json.loads(path.read_text())
    if not isinstance(manifest, dict):
        raise ValueError('Stored snapshot requires an object manifest')
    timestamp(manifest['observed_at'])  # Actual explicitly zoned export time.
    if 'parts' in manifest:
        names = manifest['parts']
        if (manifest.get('columns') != STORED_COLUMNS or 'rows' in manifest
                or not isinstance(names,list) or not names
                or any(not isinstance(name,str) for name in names)
                or len(set(names)) != len(names)
                or type(manifest.get('expected_rows')) is not int
                or manifest['expected_rows'] < 0):
            raise ValueError('Invalid stored part manifest')
        rows = []
        directory = path.resolve().parent
        for name in names:
            part = directory / name
            if (not name or Path(name).name != name or name in ('.','..')
                    or '/' in name or '\\' in name or part.resolve().parent != directory
                    or part.is_symlink()):
                raise ValueError('Stored part names must be local basenames')
            payload = json.loads(part.read_text())
            if not isinstance(payload,list):
                raise ValueError('Stored part must be an array')
            for row in payload:
                if not isinstance(row,list) or len(row) != len(STORED_COLUMNS):
                    raise ValueError('Stored compact row has wrong length')
                rows.append(dict(zip(STORED_COLUMNS,row)))
        if len(rows) != manifest['expected_rows']:
            raise ValueError('Stored row count does not match manifest')
        manifest = {**manifest,'rows':rows,'source_parts':names}
        del manifest['parts']
        del manifest['columns']
    rows = manifest.get('rows')
    if not isinstance(rows,list):
        raise ValueError('Stored snapshot requires rows')
    seen = set()
    for row in rows:
        if (not isinstance(row,dict) or set(row) != set(STORED_COLUMNS)
                or type(row['season']) is not int or row['season'] != season
                or type(row['player_id']) is not int or row['player_id'] <= 0
                or type(row['game_id']) is not int
                or not season * 1000000 + 20000 <= row['game_id'] < season * 1000000 + 30000
                or type(row['is_goalie']) is not bool or row['is_goalie']
                or (row['nhl_toi_seconds'] is not None and type(row['nhl_toi_seconds']) is not int)):
            raise ValueError('Stored row has invalid columns, types or population')
        key = (row['game_id'],row['player_id'])
        if key in seen:
            raise ValueError('Stored snapshot repeats a player appearance')
        seen.add(key)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season',type=int,required=True)
    parser.add_argument('--output-dir',type=Path,required=True,help='Must not exist')
    parser.add_argument('--code-revision',required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--stored-snapshot',type=Path,help='JSON {rows, observed_at}; actual export timestamp required')
    source.add_argument('--env-file',type=Path,help='Read-only Supabase export using credentials; never saved')
    parser.add_argument('--delay-seconds',type=float,default=1.0)
    args = parser.parse_args(argv)
    if not 1917 <= args.season <= 2100 or args.delay_seconds < 0.5:
        parser.error('Season must be valid; request delay must be at least 0.5 seconds')
    args.output_dir.mkdir(parents=True, exist_ok=False)
    if args.stored_snapshot:
        stored = load_stored_snapshot(args.stored_snapshot,args.season)
    else:
        from dotenv import dotenv_values
        from utils.supabase_rest import SupabaseRest
        env = dotenv_values(args.env_file)
        db = SupabaseRest(env['VITE_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])
        started = now()
        rows = export_stored(db, args.season)
        stored = {'rows':rows, 'observed_at':started, 'export_completed_at':now(),
                  'consistency':'ordered exact-count REST pages; not a transaction snapshot'}
    write_json(args.output_dir / 'stored.json', stored)
    from utils.citrus_request import citrus_request
    pause = lambda: time.sleep(args.delay_seconds)
    pages = collect_summary(args.season, citrus_request, pause,
        emit=lambda receipt: write_json(args.output_dir / f'summary-{receipt["params"]["start"]}.json',receipt))
    population = official_summary_population(pages,args.season)
    expected = sorted({r['player_id'] for r in stored['rows']} | set(population or {}))
    write_json(args.output_dir / 'expected-players.json',expected)
    evidence = {}
    for index,pid in enumerate(expected,1):
        pause()
        evidence[pid] = collect_player(pid,args.season,citrus_request)
        write_json(args.output_dir / f'player-{pid}.json',evidence[pid])
        if index % 25 == 0:
            print(json.dumps({'expected':len(expected),'receipts':index}),flush=True)
    prepared = build_candidate(expected,stored['rows'],evidence,args.season,now(),args.code_revision,
                               summary_receipts=pages,stored_observed_at=stored['observed_at'])
    write_json(args.output_dir / 'candidate.json',prepared)
    health = {**prepared[1]['validation']['coverage'],
              'reason_counts':dict(Counter(row['reason'] for row in prepared[2])),
              'source_sha256':fingerprint(prepared[0]),
              'snapshot_complete':True,'database_modified':False}
    write_json(args.output_dir / 'health.json',health)
    print(json.dumps(health),flush=True)
    return 0 if health['official_population_complete'] and not health['withheld'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
